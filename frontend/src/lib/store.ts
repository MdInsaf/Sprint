import { apiDeleteJson, apiGetJson, apiPostJson, apiPutJson } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { teamMemberKeys } from '@/hooks/use-team-members';
import { TeamMember, TaskType } from '@/types';

const TASK_ID_PREFIXES: Record<TaskType, string> = {
  Sprint: 'SP',
  Additional: 'ADD',
  Backlog: 'BLG',
  Bug: 'BUG',
  Change: 'CHG',
};

export const DEFAULT_TEAMS = ['Developers', 'R&D', 'GRC', 'Ascenders'];
export const DEFAULT_TEAM = DEFAULT_TEAMS[0];
export const DEFAULT_TIMEZONE = 'UTC';

let currentUser: TeamMember | null = null;

function normalizeTeamMember(member: TeamMember | null): TeamMember | null {
  if (!member) {
    return null;
  }

  return {
    ...member,
    id: String(member.id),
    team: member.team || DEFAULT_TEAM,
    timezone: member.timezone || DEFAULT_TIMEZONE,
    leave_dates: member.leave_dates || [],
  };
}

export function getCurrentUser(): TeamMember | null {
  return currentUser;
}

export async function fetchCurrentUser(): Promise<TeamMember | null> {
  const me = await apiGetJson<TeamMember | null>('/me');
  currentUser = normalizeTeamMember(me);
  return currentUser;
}

export async function loginWithCredentials(email: string, password: string): Promise<TeamMember> {
  const user = await apiPostJson<TeamMember>('/auth/login', {
    email: email.trim().toLowerCase(),
    password,
  });
  currentUser = normalizeTeamMember(user);
  // If the stored timezone is still the migration default "UTC" but the browser
  // reports a different timezone, persist the browser timezone to the profile so
  // that business-hours calculations (compute_elapsed_days) use the correct window.
  if (currentUser && (!currentUser.timezone || currentUser.timezone === 'UTC')) {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserTz && browserTz !== 'UTC') {
      try {
        await apiPutJson<TeamMember>(`/team-members/${currentUser.id}`, { timezone: browserTz });
        currentUser = { ...currentUser, timezone: browserTz };
        await queryClient.invalidateQueries({ queryKey: teamMemberKeys.all });
      } catch (err) {
        console.error('[store] timezone auto-sync PUT /team-members failed:', err);
      }
    }
  }
  return currentUser as TeamMember;
}

export async function logoutCurrentUser(): Promise<void> {
  await apiPostJson<null>('/auth/logout');
  currentUser = null;
  queryClient.clear();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiPostJson('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

export async function updateLeaveDates(memberId: string, leaveDates: string[]): Promise<TeamMember> {
  const updated = await apiPutJson<TeamMember>(`/team-members/${memberId}`, {
    leave_dates: (leaveDates || []).filter(Boolean),
  });

  const normalized = normalizeTeamMember(updated) as TeamMember;
  if (currentUser?.id === normalized.id) {
    currentUser = normalized;
  }

  queryClient.setQueryData(
    teamMemberKeys.lists(),
    (old: TeamMember[] | undefined) => {
      if (!old) return old;
      return old.map((m) =>
        m.id === normalized.id ? { ...m, leave_dates: normalized.leave_dates } : m,
      );
    },
  );

  await queryClient.invalidateQueries({ queryKey: teamMemberKeys.all });
  return normalized;
}

export async function deleteAttachment(_taskId: string, attachmentId: string): Promise<void> {
  await apiDeleteJson(`/attachments/${attachmentId}`);
  await queryClient.invalidateQueries({ queryKey: ['tasks'] });
}

export function getNextTaskId(type: TaskType): string {
  const prefix = TASK_ID_PREFIXES[type] || 'TASK';
  return `${prefix}-${Date.now()}`;
}
