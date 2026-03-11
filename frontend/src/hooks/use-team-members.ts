import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { writeAuditLog } from '@/lib/audit-log';
import { getNextPageParam, PaginatedResponse, toPagedResponse } from '@/lib/pagination';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
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

const MEMBER_SELECT = 'id,name,username,email,role,avatar,team,leave_dates';

export function useTeamMembers() {
  return useQuery({
    queryKey: teamMemberKeys.lists(),
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select(MEMBER_SELECT);
      if (error) throw error;
      return data as TeamMember[];
    },
    staleTime: 60000,
  });
}

export function useTeamMembersPage(page: number, pageSize = 50) {
  return useQuery({
    queryKey: teamMemberKeys.page(page, pageSize),
    queryFn: async (): Promise<PaginatedResponse<TeamMember>> => {
      const offset = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('team_members')
        .select(MEMBER_SELECT, { count: 'exact' })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return toPagedResponse<TeamMember>(data as TeamMember[], count, page, pageSize);
    },
  });
}

export function useTeamMembersInfinite(pageSize = 50) {
  return useInfiniteQuery({
    queryKey: teamMemberKeys.infinite(pageSize),
    queryFn: async ({ pageParam = 1 }): Promise<PaginatedResponse<TeamMember>> => {
      const page = pageParam as number;
      const offset = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('team_members')
        .select(MEMBER_SELECT, { count: 'exact' })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return toPagedResponse<TeamMember>(data as TeamMember[], count, page, pageSize);
    },
    initialPageParam: 1,
    getNextPageParam,
  });
}

export function useTeamMember(memberId: string) {
  return useQuery({
    queryKey: teamMemberKeys.detail(memberId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select(MEMBER_SELECT)
        .eq('id', memberId)
        .single();
      if (error) throw error;
      return data as TeamMember;
    },
    enabled: !!memberId,
  });
}

export function useCreateTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (member: TeamMember & { password?: string }) => {
      const { data, error } = await supabase.rpc('add_team_member_with_password', {
        p_name: member.name,
        p_username: member.username,
        p_email: member.email,
        p_password: member.password || member.username,
        p_role: member.role,
        p_avatar: member.avatar ?? null,
        p_team: member.team || 'Developers',
        p_leave_dates: member.leave_dates || [],
      });
      if (error) throw error;
      return data as TeamMember;
    },
    onSuccess: async (createdMember) => {
      await writeAuditLog({
        action: 'create',
        entityType: 'team_members',
        entityId: createdMember.id,
        path: '/team-members',
        method: 'POST',
        statusCode: 201,
        metadata: {
          name: createdMember.name,
          email: createdMember.email,
          role: createdMember.role,
          team: createdMember.team,
        },
      });
      queryClient.invalidateQueries({ queryKey: teamMemberKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Team member added successfully');
    },
    onError: (error: unknown) => {
      toast.error(getSupabaseErrorMessage(error, 'Failed to add team member'));
    },
  });
}

export function useUpdateTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (member: TeamMember & { password?: string }) => {
      const { data, error } = await supabase.rpc('update_team_member_with_password', {
        p_id: member.id,
        p_name: member.name,
        p_email: member.email,
        p_role: member.role,
        p_avatar: member.avatar ?? null,
        p_team: member.team || 'Developers',
        p_leave_dates: member.leave_dates || [],
        p_new_password: member.password || null,
      });
      if (error) throw error;
      return data as TeamMember;
    },
    onSuccess: async (updatedMember) => {
      await writeAuditLog({
        action: 'update',
        entityType: 'team_members',
        entityId: updatedMember.id,
        path: `/team-members/${updatedMember.id}`,
        method: 'PUT',
        statusCode: 200,
        metadata: {
          name: updatedMember.name,
          email: updatedMember.email,
          role: updatedMember.role,
          team: updatedMember.team,
        },
      });
      queryClient.invalidateQueries({ queryKey: teamMemberKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamMemberKeys.detail(updatedMember.id) });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Team member updated successfully');
    },
    onError: (error: unknown) => {
      toast.error(getSupabaseErrorMessage(error, 'Failed to update team member'));
    },
  });
}

export function useDeleteTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('team_members').delete().eq('id', memberId);
      if (error) throw error;
      return memberId;
    },
    onSuccess: async (memberId) => {
      await writeAuditLog({
        action: 'delete',
        entityType: 'team_members',
        entityId: memberId,
        path: `/team-members/${memberId}`,
        method: 'DELETE',
        statusCode: 200,
      });
      queryClient.invalidateQueries({ queryKey: teamMemberKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamMemberKeys.detail(memberId) });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Team member removed successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove team member');
    },
  });
}
