import { supabase } from '@/lib/supabase';
import { TeamMember, Sprint, Task, TaskType, AdditionalWorkApproval, SprintSummary, TaskComment, TaskAttachment } from '@/types';

const slugify = (value: string) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `user-${Date.now()}`;

const DEFAULT_TEAMS = ['Developers', 'R&D', 'GRC', 'Ascenders'];
export const DEFAULT_TEAM = DEFAULT_TEAMS[0];

const CURRENT_USER_KEY = 'currentUser';

const normalizeId = (value: unknown) => (value === null || value === undefined ? '' : String(value));
const normalizeOptionalId = (value: unknown) =>
  value === null || value === undefined || value === '' ? undefined : String(value);
const normalizeTeamMember = (member: TeamMember): TeamMember => ({
  ...member,
  id: normalizeId(member.id),
  team: member.team || DEFAULT_TEAM,
  leave_dates: member.leave_dates || [],
});
const normalizeApproval = (approval: AdditionalWorkApproval): AdditionalWorkApproval => ({
  ...approval,
  approved_by: normalizeOptionalId(approval.approved_by),
});
const normalizeTaskComment = (comment: TaskComment): TaskComment => ({
  ...comment,
  author_id: normalizeId(comment.author_id),
});

// ── In-memory state ───────────────────────────────────────────────────────────
let teamMembers: TeamMember[] = [];
let sprints: Sprint[] = [];
let tasks: Task[] = [];
let approvals: AdditionalWorkApproval[] = [];
let sprintSummaries: SprintSummary[] = [];
let taskComments: TaskComment[] = [];
let currentUser: TeamMember | null = null;

let bootstrapPromise: Promise<void> | null = null;

// ── Status tracking helpers ───────────────────────────────────────────────────
const DONE_STATUSES = new Set(['Done', 'Closed', 'Fixed']);
const WORK_STATUSES = new Set(['In Progress', 'Reopen']);

function nowIso(): string {
  return new Date().toISOString();
}

/** Apply status-based date tracking when a task's status changes. */
function applyStatusDates(next: Task, prev?: Task): Task {
  const result = { ...next };
  const oldStatus = prev?.status;
  const newStatus = next.status;

  if (newStatus && newStatus !== oldStatus) {
    if (WORK_STATUSES.has(newStatus) && !result.in_progress_date) {
      result.in_progress_date = nowIso();
    }
    if (DONE_STATUSES.has(newStatus) && !DONE_STATUSES.has(oldStatus || '')) {
      result.closed_date = nowIso();
    }
    if (newStatus === 'Blocked' && oldStatus !== 'Blocked') {
      result.blocker_date = nowIso();
    }
  }

  const oldQa = prev?.qa_status;
  const newQa = next.qa_status;
  if (newQa && newQa !== oldQa) {
    if ((newQa === 'Testing' || newQa === 'Rework') && !result.qa_in_progress_date) {
      result.qa_in_progress_date = nowIso();
    }
    if (newQa === 'Fixing' && !result.qa_fixing_in_progress_date) {
      result.qa_fixing_in_progress_date = nowIso();
    }
  }

  return result;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrapFromSupabase() {
  const [
    { data: membersData },
    { data: sprintsData },
    { data: tasksData },
    { data: approvalsData },
    { data: summariesData },
    { data: commentsData },
  ] = await Promise.all([
    supabase.from('team_members').select('id,name,username,email,role,avatar,team,leave_dates'),
    supabase.from('sprints').select('*'),
    supabase.from('tasks').select('*, attachments:task_attachments(*)'),
    supabase.from('approvals').select('*'),
    supabase.from('sprint_summaries').select('*'),
    supabase.from('task_comments').select('*'),
  ]);

  teamMembers = (membersData || []).map(normalizeTeamMember);
  sprints = (sprintsData || []).map((s) => ({ ...s, team: s.team || DEFAULT_TEAM }));
  tasks = tasksData || [];
  approvals = (approvalsData || []).map(normalizeApproval);
  sprintSummaries = summariesData || [];
  taskComments = (commentsData || []).map(normalizeTaskComment);
}

export function initializeData() {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapFromSupabase();
  }
  return bootstrapPromise;
}

// ── Current user ──────────────────────────────────────────────────────────────
export function getCurrentUser(): TeamMember | null {
  return currentUser;
}

export async function fetchCurrentUser(): Promise<TeamMember | null> {
  try {
    const stored = localStorage.getItem(CURRENT_USER_KEY);
    if (!stored) {
      currentUser = null;
      return null;
    }
    const parsed = JSON.parse(stored) as TeamMember;
    const normalized = normalizeTeamMember(parsed);
    currentUser = normalized;
    return normalized;
  } catch {
    currentUser = null;
    return null;
  }
}

export function setCurrentUser(user: TeamMember | null) {
  currentUser = user ? normalizeTeamMember(user) : null;
  if (currentUser) {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(currentUser));
  } else {
    localStorage.removeItem(CURRENT_USER_KEY);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function loginWithCredentials(email: string, password: string): Promise<TeamMember> {
  // Login by email (look up username first) or by username directly
  // The RPC accepts username; we support login by email by resolving username first.
  const { data: memberRow } = await supabase
    .from('team_members')
    .select('username')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();

  const username = memberRow?.username ?? email.trim();

  const { data, error } = await supabase.rpc('login', {
    p_username: username,
    p_password: password,
  });

  if (error) throw new Error(error.message || 'Login failed');

  const user = data as TeamMember;
  const normalized = normalizeTeamMember(user);
  currentUser = normalized;
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(normalized));
  bootstrapPromise = null;
  return normalized;
}

export async function logoutCurrentUser() {
  currentUser = null;
  localStorage.removeItem(CURRENT_USER_KEY);
  teamMembers = [];
  sprints = [];
  tasks = [];
  approvals = [];
  sprintSummaries = [];
  taskComments = [];
  bootstrapPromise = null;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  if (!currentUser?.id) throw new Error('Not authenticated');
  const { error } = await supabase.rpc('change_password', {
    p_member_id: currentUser.id,
    p_current_password: currentPassword,
    p_new_password: newPassword,
  });
  if (error) throw new Error(error.message || 'Failed to change password');
}

// ── Team members ──────────────────────────────────────────────────────────────
export function getTeamMembers(): TeamMember[] {
  return teamMembers;
}

export function getTeams(): string[] {
  const normalizedRole = (currentUser?.role || '').toLowerCase();
  const isSuperAdmin = normalizedRole === 'super admin';
  if (!isSuperAdmin) {
    return [currentUser?.team || DEFAULT_TEAM];
  }
  const names = new Set(DEFAULT_TEAMS);
  teamMembers.forEach((m) => names.add(m.team || DEFAULT_TEAM));
  sprints.forEach((s) => names.add(s.team || DEFAULT_TEAM));
  if (currentUser?.team) names.add(currentUser.team);
  return Array.from(names);
}

export function addTeamMember(member: TeamMember & { password?: string }) {
  const normalized = {
    ...member,
    team: member.team || DEFAULT_TEAM,
    username: member.username || slugify(member.name || member.id),
    email: (member.email || '').trim().toLowerCase(),
  };
  const { password, ...rest } = normalized;
  teamMembers = [...teamMembers, rest];

  void supabase
    .rpc('add_team_member_with_password', {
      p_name: normalized.name,
      p_username: normalized.username,
      p_email: normalized.email,
      p_password: password || normalized.username,
      p_role: normalized.role,
      p_avatar: normalized.avatar ?? null,
      p_team: normalized.team,
      p_leave_dates: normalized.leave_dates || [],
    })
    .then(({ data, error }) => {
      if (error) { console.error('Failed to save team member', error); return; }
      const saved = normalizeTeamMember(data as TeamMember);
      teamMembers = teamMembers.map((m) => (m.id === member.id ? saved : m));
    });
}

export function updateTeamMember(member: TeamMember & { password?: string }) {
  const normalized = {
    ...member,
    team: member.team || DEFAULT_TEAM,
    username: member.username || slugify(member.name || member.id),
    email: (member.email || '').trim().toLowerCase(),
  };
  const { password, ...rest } = normalized;
  teamMembers = teamMembers.map((m) => (m.id === member.id ? rest : m));
  if (currentUser?.id === member.id) currentUser = rest;

  void supabase
    .rpc('update_team_member_with_password', {
      p_id: member.id,
      p_name: normalized.name,
      p_email: normalized.email,
      p_role: normalized.role,
      p_avatar: normalized.avatar ?? null,
      p_team: normalized.team,
      p_leave_dates: normalized.leave_dates || [],
      p_new_password: password || null,
    })
    .catch((error) => console.error('Failed to update team member', error));
}

export function deleteTeamMember(memberId: string) {
  const removedTaskIds = tasks.filter((t) => t.owner_id === memberId).map((t) => t.id);
  tasks = tasks.filter((t) => t.owner_id !== memberId);
  approvals = approvals.filter(
    (a) => !removedTaskIds.includes(a.task_id) && a.approved_by !== memberId
  );
  taskComments = taskComments.filter(
    (c) => c.author_id !== memberId && !removedTaskIds.includes(c.task_id)
  );
  teamMembers = teamMembers.filter((m) => m.id !== memberId);
  if (currentUser?.id === memberId) setCurrentUser(null);

  void supabase
    .from('team_members')
    .delete()
    .eq('id', memberId)
    .catch((error) => console.error('Failed to delete team member', error));
}

export async function updateLeaveDates(memberId: string, leaveDates: string[]) {
  const normalizedDates = (leaveDates || []).filter(Boolean);
  const { data, error } = await supabase
    .from('team_members')
    .update({ leave_dates: normalizedDates })
    .eq('id', memberId)
    .select('id,name,username,email,role,avatar,team,leave_dates')
    .single();

  if (error) throw new Error(error.message);

  const normalized = normalizeTeamMember(data as TeamMember);
  teamMembers = teamMembers.map((m) => (m.id === memberId ? normalized : m));
  if (currentUser?.id === memberId) {
    currentUser = normalized;
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

// ── Sprints ───────────────────────────────────────────────────────────────────
export function getSprints(): Sprint[] {
  return sprints;
}

export function getActiveSprint(team?: string): Sprint | null {
  if (team) {
    return sprints.find((s) => s.is_active && (s.team || DEFAULT_TEAM) === team) || null;
  }
  return sprints.find((s) => s.is_active) || null;
}

export function addSprint(sprint: Sprint) {
  const sprintTeam = sprint.team || DEFAULT_TEAM;
  if (sprint.is_active) {
    sprints = sprints.map((s) =>
      (s.team || DEFAULT_TEAM) !== sprintTeam ? s : { ...s, is_active: false }
    );
  }
  sprints = [...sprints, { ...sprint, team: sprintTeam }];

  const insertPromise = supabase
    .from('sprints')
    .insert({ ...sprint, team: sprintTeam })
    .catch((error) => console.error('Failed to save sprint', error));

  if (sprint.is_active) {
    void insertPromise.then(() =>
      supabase.rpc('set_active_sprint', { p_sprint_id: sprint.id, p_team: sprintTeam })
        .catch((error) => console.error('Failed to set active sprint', error))
    );
  } else {
    void insertPromise;
  }
}

export function updateSprint(sprint: Sprint) {
  const index = sprints.findIndex((s) => s.id === sprint.id);
  if (index === -1) return;

  const sprintTeam = sprint.team || sprints[index].team || DEFAULT_TEAM;
  if (sprint.is_active) {
    sprints = sprints.map((s) =>
      (s.team || DEFAULT_TEAM) !== sprintTeam ? s : { ...s, is_active: false }
    );
  }
  sprints[index] = { ...sprint, team: sprintTeam };

  const updatePromise = supabase
    .from('sprints')
    .update({ ...sprint, team: sprintTeam })
    .eq('id', sprint.id)
    .catch((error) => console.error('Failed to update sprint', error));

  if (sprint.is_active) {
    void updatePromise.then(() =>
      supabase.rpc('set_active_sprint', { p_sprint_id: sprint.id, p_team: sprintTeam })
        .catch((error) => console.error('Failed to set active sprint', error))
    );
  } else {
    void updatePromise;
  }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export function getTasks(): Task[] {
  return tasks;
}

export function getTasksBySprintId(sprintId: string): Task[] {
  return tasks.filter((t) => t.sprint_id === sprintId);
}

export function getNextTaskId(type: TaskType): string {
  // Client-side fallback — server-side generate_task_id RPC is preferred
  const TASK_ID_PREFIXES: Record<TaskType, string> = {
    Sprint: 'SP', Additional: 'ADD', Backlog: 'BLG', Bug: 'BUG', Change: 'CHG',
  };
  const prefix = TASK_ID_PREFIXES[type] || 'TASK';
  const matcher = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let maxNum = 0;
  tasks.forEach((task) => {
    const match = String(task.id || '').match(matcher);
    if (!match) return;
    const num = Number.parseInt(match[1], 10);
    if (!Number.isNaN(num)) maxNum = Math.max(maxNum, num);
  });
  const next = maxNum + 1;
  const digits = Math.max(3, String(next).length);
  return `${prefix}-${String(next).padStart(digits, '0')}`;
}

async function uploadAttachments(taskId: string, files: File[], uploaderId?: string): Promise<TaskAttachment[]> {
  const results: TaskAttachment[] = [];
  for (const file of files) {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
    const uniqueName = `${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    const storagePath = `tasks/${taskId}/${uniqueName}`;

    const { error: uploadError } = await supabase.storage
      .from('task-attachments')
      .upload(storagePath, file, { contentType: file.type });

    if (uploadError) {
      console.error('Failed to upload attachment', uploadError);
      continue;
    }

    const attachmentId = crypto.randomUUID();
    const now = nowIso();
    const { error: dbError } = await supabase.from('task_attachments').insert({
      id: attachmentId,
      task_id: taskId,
      uploaded_by: uploaderId ?? null,
      file_name: file.name,
      file_size: file.size,
      content_type: file.type || null,
      storage_path: storagePath,
      created_date: now,
    });

    if (dbError) {
      console.error('Failed to record attachment', dbError);
      continue;
    }

    results.push({
      id: attachmentId,
      task_id: taskId,
      uploaded_by: uploaderId,
      file_name: file.name,
      file_size: file.size,
      content_type: file.type || null,
      storage_path: storagePath,
      created_date: now,
    });
  }
  return results;
}

export async function getAttachmentUrl(storagePath: string): Promise<string> {
  const { data } = await supabase.storage
    .from('task-attachments')
    .createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? '';
}

export function addTask(task: Task, attachments?: File[]) {
  tasks = [...tasks, task];

  return supabase
    .rpc('generate_task_id', { p_type: task.type })
    .then(async ({ data: generatedId, error: idError }) => {
      const taskId = idError ? task.id : (generatedId as string);
      const taskToInsert = { ...task, id: taskId, attachments: undefined };

      const { data: saved, error: insertError } = await supabase
        .from('tasks')
        .insert(taskToInsert)
        .select('*')
        .single();

      if (insertError) {
        console.error('Failed to save task', insertError);
        return null;
      }

      let uploadedAttachments: TaskAttachment[] = [];
      if (attachments && attachments.length > 0) {
        uploadedAttachments = await uploadAttachments(taskId, attachments, currentUser?.id);
      }

      const finalTask: Task = { ...saved, attachments: uploadedAttachments };
      tasks = tasks.map((t) => (t.id === task.id ? finalTask : t));
      return finalTask;
    })
    .catch((error) => {
      console.error('Failed to save task', error);
      return null;
    });
}

export function updateTask(task: Task, attachments?: File[]) {
  const index = tasks.findIndex((t) => t.id === task.id);
  if (index === -1) return;

  const prev = tasks[index];
  const updated = applyStatusDates(task, prev);
  tasks[index] = updated;

  const { attachments: _att, ...taskRow } = updated as Task & { attachments?: TaskAttachment[] };

  void supabase
    .from('tasks')
    .update(taskRow)
    .eq('id', task.id)
    .then(async () => {
      if (attachments && attachments.length > 0) {
        const newAttachments = await uploadAttachments(task.id, attachments, currentUser?.id);
        tasks = tasks.map((t) => {
          if (t.id !== task.id) return t;
          return { ...t, attachments: [...(t.attachments || []), ...newAttachments] };
        });
      }
    })
    .catch((error) => console.error('Failed to update task', error));
}

export async function deleteAttachment(taskId: string, attachmentId: string) {
  // Find the storage path before deleting
  const task = tasks.find((t) => t.id === taskId);
  const attachment = (task?.attachments || []).find((a) => a.id === attachmentId);

  if (attachment?.storage_path) {
    await supabase.storage.from('task-attachments').remove([attachment.storage_path]);
  }

  await supabase.from('task_attachments').delete().eq('id', attachmentId);

  tasks = tasks.map((t) => {
    if (t.id !== taskId) return t;
    return { ...t, attachments: (t.attachments || []).filter((a) => a.id !== attachmentId) };
  });
}

export function deleteTask(taskId: string) {
  tasks = tasks.filter((t) => t.id !== taskId);
  void supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .catch((error) => console.error('Failed to delete task', error));
}

// ── Approvals ─────────────────────────────────────────────────────────────────
export function getApprovals(): AdditionalWorkApproval[] {
  return approvals;
}

export function addApproval(approval: AdditionalWorkApproval) {
  const index = approvals.findIndex((a) => a.task_id === approval.task_id);
  if (index !== -1) {
    approvals[index] = approval;
  } else {
    approvals = [...approvals, approval];
  }
  void supabase
    .from('approvals')
    .upsert(approval, { onConflict: 'task_id' })
    .catch((error) => console.error('Failed to save approval', error));
}

// ── Sprint Summaries ──────────────────────────────────────────────────────────
export function getSprintSummaries(): SprintSummary[] {
  return sprintSummaries;
}

export function getSprintSummary(sprintId: string): SprintSummary | null {
  return sprintSummaries.find((s) => s.sprint_id === sprintId) || null;
}

export function addSprintSummary(summary: SprintSummary) {
  const existingIndex = sprintSummaries.findIndex((s) => s.sprint_id === summary.sprint_id);
  if (existingIndex !== -1) {
    sprintSummaries[existingIndex] = summary;
  } else {
    sprintSummaries = [...sprintSummaries, summary];
  }
  void supabase
    .from('sprint_summaries')
    .upsert(summary, { onConflict: 'sprint_id' })
    .catch((error) => console.error('Failed to save sprint summary', error));
}

// ── Task Comments ─────────────────────────────────────────────────────────────
export function getTaskComments(taskId: string): TaskComment[] {
  return taskComments
    .filter((c) => c.task_id === taskId)
    .sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime());
}

export function addTaskComment(comment: TaskComment) {
  taskComments = [...taskComments, comment];
  void supabase
    .from('task_comments')
    .insert(comment)
    .catch((error) => console.error('Failed to save task comment', error));
}

export function getTaskCommentCount(taskId: string): number {
  return taskComments.filter((c) => c.task_id === taskId).length;
}
