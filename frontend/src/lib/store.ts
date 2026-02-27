import { TeamMember, Sprint, Task, TaskType, AdditionalWorkApproval, SprintSummary, TaskComment } from '@/types';

const API_BASE = import.meta.env.VITE_API_URL || '/v1/api';

const slugify = (value: string) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `user-${Date.now()}`;

const DEFAULT_TEAMS = ['Developers', 'R&D', 'GRC'];
export const DEFAULT_TEAM = DEFAULT_TEAMS[0];

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

const defaultTeamMembers: TeamMember[] = [
  {
    id: 'member-1766729766207',
    name: 'Mohamed Insaf',
    username: 'mohamed-insaf',
    email: 'mohamed.insaf@whizzc.com',
    role: 'Manager',
    team: DEFAULT_TEAM,
  },
  {
    id: 'member-1766729853514',
    name: 'Kamalraj',
    username: 'kamalraj',
    email: 'kamalraj@whizzc.com',
    role: 'Developer',
    team: DEFAULT_TEAM,
  },
  {
    id: 'member-1766729871148',
    name: 'Gladwin',
    username: 'gladwin',
    email: 'gladwin.a@whizzc.com',
    role: 'Developer',
    team: DEFAULT_TEAM,
  },
  {
    id: 'member-1766729891265',
    name: 'Jawahar',
    username: 'jawahar',
    email: 'jawahar.m@whizzc.com',
    role: 'Developer',
    team: DEFAULT_TEAM,
  },
  {
    id: 'member-1766729911736',
    name: 'Ajay',
    username: 'ajay',
    email: 'ajay.j@whizzc.com',
    role: 'Developer',
    team: DEFAULT_TEAM,
  },
  {
    id: 'member-1766729945957',
    name: 'Bhakthavachalu',
    username: 'bhakthavachalu',
    email: 'bhaktha@whizzc.com',
    role: 'Developer',
    team: DEFAULT_TEAM,
  },
  {
    id: 'member-1766729960674',
    name: 'Nivas',
    username: 'nivas',
    email: 'nivas.j@whizzc.com',
    role: 'Developer',
    team: DEFAULT_TEAM,
  },
  {
    id: 'member-1766729993305',
    name: 'Siddhaarth',
    username: 'siddhaarth',
    email: 'siddhaarth@whizzc.com',
    role: 'Developer',
    team: DEFAULT_TEAM,
  },
  {
    id: 'member-1766730010000',
    name: 'QA Tester',
    username: 'qa-tester',
    email: 'qa.tester@example.com',
    role: 'QA',
    team: DEFAULT_TEAM,
  },
];

const defaultSprints: Sprint[] = [];

const defaultTasks: Task[] = [];

const defaultApprovals: AdditionalWorkApproval[] = [];

let teamMembers: TeamMember[] = [...defaultTeamMembers];
let sprints: Sprint[] = [...defaultSprints];
let tasks: Task[] = [...defaultTasks];
let approvals: AdditionalWorkApproval[] = [...defaultApprovals];
let sprintSummaries: SprintSummary[] = [];
let taskComments: TaskComment[] = [];
let currentUser: TeamMember | null = null;

const TASK_ID_PREFIXES: Record<TaskType, string> = {
  Sprint: 'SP',
  Additional: 'ADD',
  Backlog: 'BLG',
  Bug: 'BUG',
  Change: 'CHG',
};

let csrfToken: string | null = null;
let bootstrapPromise: Promise<void> | null = null;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

async function ensureCsrfToken(): Promise<string> {
  const cookieToken = readCookie('csrftoken');
  if (csrfToken && cookieToken === csrfToken) return csrfToken;

  // Force refresh when no token or cookie differs from cached value.
  const response = await fetch(`${API_BASE}/csrf`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to obtain CSRF token');
  }
  csrfToken = readCookie('csrftoken');
  if (!csrfToken) {
    throw new Error('CSRF token missing');
  }
  return csrfToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (needsCsrf) {
    const token = await ensureCsrfToken();
    headers['X-CSRFToken'] = token;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function appendFormValue(form: FormData, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) return;
  form.append(key, String(value));
}

function buildTaskFormData(task: Task, attachments?: File[]) {
  const form = new FormData();
  Object.entries(task).forEach(([key, value]) => {
    if (key === 'attachments') return;
    appendFormValue(form, key, value);
  });
  (attachments || []).forEach((file) => {
    form.append('attachments', file);
  });
  return form;
}

async function bootstrapFromApi() {
  const [
    members,
    sprintsResponse,
    tasksResponse,
    approvalsResponse,
    sprintSummariesResponse,
    taskCommentsResponse,
  ] = await Promise.all([
    request<TeamMember[]>('/team-members'),
    request<Sprint[]>('/sprints'),
    request<Task[]>('/tasks'),
    request<AdditionalWorkApproval[]>('/approvals'),
    request<SprintSummary[]>('/sprint-summaries'),
    request<TaskComment[]>('/task-comments'),
  ]);

  teamMembers = members.length > 0 ? members.map(normalizeTeamMember) : [...defaultTeamMembers];
  sprints = sprintsResponse.length > 0
    ? sprintsResponse.map((sprint) => ({ ...sprint, team: sprint.team || DEFAULT_TEAM }))
    : [...defaultSprints];
  tasks = tasksResponse.length > 0 ? tasksResponse : [...defaultTasks];
  approvals =
    approvalsResponse.length > 0
      ? approvalsResponse.map(normalizeApproval)
      : [...defaultApprovals];
  sprintSummaries = sprintSummariesResponse;
  taskComments = taskCommentsResponse.map(normalizeTaskComment);
}

export function initializeData() {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapFromApi();
  }
  return bootstrapPromise;
}

// Current user
export function getCurrentUser(): TeamMember | null {
  return currentUser;
}

export async function fetchCurrentUser(): Promise<TeamMember | null> {
  try {
    const user = await request<TeamMember>('/me', { method: 'GET' });
    const normalized = normalizeTeamMember(user);
    currentUser = normalized;
    return normalized;
  } catch {
    currentUser = null;
    return null;
  }
}

export function setCurrentUser(user: TeamMember | null) {
  currentUser = user ? normalizeTeamMember(user) : null;
}

// Team members
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
  teamMembers.forEach((member) => {
    names.add(member.team || DEFAULT_TEAM);
  });
  sprints.forEach((sprint) => {
    names.add(sprint.team || DEFAULT_TEAM);
  });
  if (currentUser?.team) {
    names.add(currentUser.team);
  }
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
  void request('/team-members', {
    method: 'POST',
    body: JSON.stringify(normalized),
  }).catch((error) => console.error('Failed to save team member', error));
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

  // Keep current session role/name in sync if the active user is updated.
  if (currentUser?.id === member.id) {
    currentUser = rest;
  }

  void request(`/team-members/${member.id}`, {
    method: 'PUT',
    body: JSON.stringify(normalized),
  }).catch((error) => console.error('Failed to update team member', error));
}

export function deleteTeamMember(memberId: string) {
  // Remove related tasks, approvals, and comments for the unavailable user.
  const removedTaskIds = tasks.filter((t) => t.owner_id === memberId).map((t) => t.id);
  tasks = tasks.filter((t) => t.owner_id !== memberId);
  approvals = approvals.filter(
    (a) => !removedTaskIds.includes(a.task_id) && a.approved_by !== memberId
  );
  taskComments = taskComments.filter(
    (c) => c.author_id !== memberId && !removedTaskIds.includes(c.task_id)
  );
  teamMembers = teamMembers.filter((m) => m.id !== memberId);

  // Clear current session if the active user was removed.
  if (currentUser?.id === memberId) {
    setCurrentUser(null);
  }

  void request(`/team-members/${memberId}`, {
    method: 'DELETE',
  }).catch((error) => console.error('Failed to delete team member', error));
}

export async function loginWithCredentials(email: string, password: string): Promise<TeamMember> {
  const user = await request<TeamMember>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  csrfToken = null;
  const normalized = normalizeTeamMember(user);
  currentUser = normalized;
  bootstrapPromise = null;
  return normalized;
}

export async function updateLeaveDates(memberId: string, leaveDates: string[]) {
  const normalizedDates = (leaveDates || []).filter(Boolean);
  const payload = { leave_dates: normalizedDates };
  const updated = await request<TeamMember>(`/team-members/${memberId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  const normalized = normalizeTeamMember(updated);
  teamMembers = teamMembers.map((m) => (m.id === memberId ? normalized : m));
  if (currentUser?.id === memberId) {
    currentUser = normalized;
  }
  return normalized;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  await request('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export async function logoutCurrentUser() {
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error('Logout failed', error);
  }
  csrfToken = null;
  currentUser = null;
  teamMembers = [];
  sprints = [];
  tasks = [];
  approvals = [];
  sprintSummaries = [];
  taskComments = [];
  bootstrapPromise = null;
}

// Sprints
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
    sprints = sprints.map((s) => {
      if ((s.team || DEFAULT_TEAM) !== sprintTeam) return s;
      return { ...s, is_active: false };
    });
  }
  sprints = [...sprints, { ...sprint, team: sprintTeam }];
  void request('/sprints', {
    method: 'POST',
    body: JSON.stringify({ ...sprint, team: sprintTeam }),
  }).catch((error) => console.error('Failed to save sprint', error));
}

export function updateSprint(sprint: Sprint) {
  const index = sprints.findIndex((s) => s.id === sprint.id);
  if (index !== -1) {
    const sprintTeam = sprint.team || sprints[index].team || DEFAULT_TEAM;
    if (sprint.is_active) {
      sprints = sprints.map((s) => {
        if ((s.team || DEFAULT_TEAM) !== sprintTeam) return s;
        return { ...s, is_active: false };
      });
    }
    sprints[index] = { ...sprint, team: sprintTeam };
    void request(`/sprints/${sprint.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...sprint, team: sprintTeam }),
    }).catch((error) => console.error('Failed to update sprint', error));
  }
}

// Tasks
export function getTasks(): Task[] {
  return tasks;
}

export function getTasksBySprintId(sprintId: string): Task[] {
  return tasks.filter((t) => t.sprint_id === sprintId);
}

export function getNextTaskId(type: TaskType): string {
  const prefix = TASK_ID_PREFIXES[type] || 'TASK';
  const matcher = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let maxNum = 0;
  tasks.forEach((task) => {
    const match = String(task.id || '').match(matcher);
    if (!match) return;
    const num = Number.parseInt(match[1], 10);
    if (!Number.isNaN(num)) {
      maxNum = Math.max(maxNum, num);
    }
  });
  const next = maxNum + 1;
  const minDigits = 3;
  const digits = Math.max(minDigits, String(next).length);
  return `${prefix}-${String(next).padStart(digits, '0')}`;
}

export function addTask(task: Task, attachments?: File[]) {
  tasks = [...tasks, task];
  const body =
    attachments && attachments.length > 0
      ? buildTaskFormData(task, attachments)
      : JSON.stringify(task);
  return request<Task>('/tasks', {
    method: 'POST',
    body,
  })
    .then((saved) => {
      tasks = tasks.map((t) => (t.id === task.id ? saved : t));
      return saved;
    })
    .catch((error) => {
      console.error('Failed to save task', error);
      return null;
    });
}

export function updateTask(task: Task, attachments?: File[]) {
  const index = tasks.findIndex((t) => t.id === task.id);
  if (index !== -1) {
    tasks[index] = task;
    const body =
      attachments && attachments.length > 0
        ? buildTaskFormData(task, attachments)
        : JSON.stringify(task);
    void request<Task>(`/tasks/${task.id}`, {
      method: 'PUT',
      body,
    })
      .then((updated) => {
        tasks = tasks.map((t) => (t.id === task.id ? updated : t));
      })
      .catch((error) => console.error('Failed to update task', error));
  }
}

export async function deleteAttachment(taskId: string, attachmentId: string) {
  await request(`/attachments/${attachmentId}`, {
    method: 'DELETE',
  });
  tasks = tasks.map((task) => {
    if (task.id !== taskId) return task;
    return {
      ...task,
      attachments: (task.attachments || []).filter((file) => file.id !== attachmentId),
    };
  });
}

export function deleteTask(taskId: string) {
  tasks = tasks.filter((t) => t.id !== taskId);
  void request(`/tasks/${taskId}`, {
    method: 'DELETE',
  }).catch((error) => console.error('Failed to delete task', error));
}

// Approvals
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

  void request('/approvals', {
    method: 'POST',
    body: JSON.stringify(approval),
  }).catch((error) => console.error('Failed to save approval', error));
}

// Sprint Summaries
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

  void request('/sprint-summaries', {
    method: 'POST',
    body: JSON.stringify(summary),
  }).catch((error) => console.error('Failed to save sprint summary', error));
}

// Task Comments
export function getTaskComments(taskId: string): TaskComment[] {
  return taskComments
    .filter((c) => c.task_id === taskId)
    .sort(
      (a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime()
    );
}

export function addTaskComment(comment: TaskComment) {
  taskComments = [...taskComments, comment];
  void request('/task-comments', {
    method: 'POST',
    body: JSON.stringify(comment),
  }).catch((error) => console.error('Failed to save task comment', error));
}

export function getTaskCommentCount(taskId: string): number {
  return taskComments.filter((c) => c.task_id === taskId).length;
}
