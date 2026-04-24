import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDeleteJson, apiGetJson, apiPostJson, apiPutJson } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-errors';
import { getNextPageParam, PaginatedResponse } from '@/lib/pagination';
import { TeamMember } from '@/types';
import { toast } from 'sonner';

export const teamMemberKeys = {
  all: ['team-members'] as const,
  lists: () => [...teamMemberKeys.all, 'list'] as const,
  page: (page: number, pageSize: number) => [...teamMemberKeys.all, 'page', page, pageSize] as const,
  infinite: (pageSize: number) => [...teamMemberKeys.all, 'infinite', pageSize] as const,
  details: () => [...teamMemberKeys.all, 'detail'] as const,
  detail: (id: string) => [...teamMemberKeys.details(), id] as const,
};

export function useTeamMembers() {
  return useQuery({
    queryKey: teamMemberKeys.lists(),
    queryFn: async () => apiGetJson<TeamMember[]>('/team-members'),
    staleTime: 60000,
  });
}

export function useTeamMembersPage(page: number, pageSize = 50) {
  return useQuery({
    queryKey: teamMemberKeys.page(page, pageSize),
    queryFn: async (): Promise<PaginatedResponse<TeamMember>> =>
      apiGetJson<PaginatedResponse<TeamMember>>('/team-members', {
        page,
        page_size: pageSize,
      }),
  });
}

export function useTeamMembersInfinite(pageSize = 50) {
  return useInfiniteQuery({
    queryKey: teamMemberKeys.infinite(pageSize),
    queryFn: async ({ pageParam = 1 }): Promise<PaginatedResponse<TeamMember>> =>
      apiGetJson<PaginatedResponse<TeamMember>>('/team-members', {
        page: pageParam as number,
        page_size: pageSize,
      }),
    initialPageParam: 1,
    getNextPageParam,
  });
}

export function useTeamMember(memberId: string) {
  return useQuery({
    queryKey: teamMemberKeys.detail(memberId),
    queryFn: async () => {
      const members = await apiGetJson<TeamMember[]>('/team-members');
      return members.find((member) => member.id === memberId) ?? null;
    },
    enabled: !!memberId,
  });
}

export function useCreateTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (member: TeamMember & { password?: string }) =>
      apiPostJson<TeamMember>('/team-members', {
        name: member.name,
        username: member.username,
        email: member.email,
        password: member.password || member.username,
        role: member.role,
        avatar: member.avatar ?? null,
        team: member.team || 'Developers',
        leave_dates: member.leave_dates || [],
      }),
    onSuccess: async (createdMember) => {
      await queryClient.invalidateQueries({ queryKey: teamMemberKeys.all });
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Team member added successfully');
      return createdMember;
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Failed to add team member'));
    },
  });
}

export function useUpdateTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (member: TeamMember & { password?: string }) =>
      apiPutJson<TeamMember>(`/team-members/${member.id}`, {
        name: member.name,
        username: member.username,
        email: member.email,
        role: member.role,
        avatar: member.avatar ?? null,
        team: member.team || 'Developers',
        leave_dates: member.leave_dates || [],
        password: member.password || undefined,
      }),
    onSuccess: async (updatedMember) => {
      await queryClient.invalidateQueries({ queryKey: teamMemberKeys.all });
      await queryClient.invalidateQueries({ queryKey: teamMemberKeys.detail(updatedMember.id) });
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Team member updated successfully');
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Failed to update team member'));
    },
  });
}

export function useDeleteTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      await apiDeleteJson(`/team-members/${memberId}`);
      return memberId;
    },
    onSuccess: async (memberId) => {
      await queryClient.invalidateQueries({ queryKey: teamMemberKeys.all });
      await queryClient.invalidateQueries({ queryKey: teamMemberKeys.detail(memberId) });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Team member removed successfully');
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Failed to remove team member'));
    },
  });
}
