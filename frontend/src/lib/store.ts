import { apiDeleteJson, apiGetJson, apiPostJson, apiPutJson } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
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

let currentUser: TeamMember | null = null;

function normalizeTeamMember(member: TeamMember | null): TeamMember | null {
  if (!member) {
    return null;
  }

  return {
    ...member,
    id: String(member.id),
    team: member.team || DEFAULT_TEAM,
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

  await queryClient.invalidateQueries({ queryKey: ['team-members'] });
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
