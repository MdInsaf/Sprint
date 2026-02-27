import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { appendPaginationParams, extractResults, getNextPageParam, PaginatedResponse } from '@/lib/pagination';
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
    queryFn: () => apiRequest<TeamMember[] | PaginatedResponse<TeamMember>>('/team-members'),
    select: (data) => extractResults(data),
    staleTime: 60000, // 1 minute - team members change less frequently
  });
}

export function useTeamMembersPage(page: number, pageSize = 50) {
  return useQuery({
    queryKey: teamMemberKeys.page(page, pageSize),
    queryFn: () =>
      apiRequest<PaginatedResponse<TeamMember>>(appendPaginationParams('/team-members', page, pageSize)),
  });
}

export function useTeamMembersInfinite(pageSize = 50) {
  return useInfiniteQuery({
    queryKey: teamMemberKeys.infinite(pageSize),
    queryFn: ({ pageParam = 1 }) =>
      apiRequest<PaginatedResponse<TeamMember>>(appendPaginationParams('/team-members', pageParam, pageSize)),
    initialPageParam: 1,
    getNextPageParam,
  });
}

export function useTeamMember(memberId: string) {
  return useQuery({
    queryKey: teamMemberKeys.detail(memberId),
    queryFn: () => apiRequest<TeamMember>(`/team-members/${memberId}`),
    enabled: !!memberId,
  });
}

export function useCreateTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (member: TeamMember & { password?: string }) =>
      apiRequest<TeamMember>('/team-members', {
        method: 'POST',
        body: JSON.stringify(member),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamMemberKeys.lists() });
      toast.success('Team member added successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add team member');
    },
  });
}

export function useUpdateTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (member: TeamMember & { password?: string }) =>
      apiRequest<TeamMember>(`/team-members/${member.id}`, {
        method: 'PUT',
        body: JSON.stringify(member),
      }),
    onSuccess: (updatedMember) => {
      queryClient.invalidateQueries({ queryKey: teamMemberKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamMemberKeys.detail(updatedMember.id) });
      toast.success('Team member updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update team member');
    },
  });
}

export function useDeleteTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) =>
      apiRequest<void>(`/team-members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamMemberKeys.lists() });
      toast.success('Team member removed successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove team member');
    },
  });
}
