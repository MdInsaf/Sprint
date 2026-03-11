import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { writeAuditLog } from '@/lib/audit-log';
import { getNextPageParam, PaginatedResponse, toPagedResponse } from '@/lib/pagination';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { Sprint } from '@/types';
import { toast } from 'sonner';

export const sprintKeys = {
  all: ['sprints'] as const,
  lists: () => [...sprintKeys.all, 'list'] as const,
  page: (page: number, pageSize: number) => [...sprintKeys.all, 'page', page, pageSize] as const,
  infinite: (pageSize: number) => [...sprintKeys.all, 'infinite', pageSize] as const,
  details: () => [...sprintKeys.all, 'detail'] as const,
  detail: (id: string) => [...sprintKeys.details(), id] as const,
  active: (team?: string) => [...sprintKeys.all, 'active', team] as const,
};

export function useSprints() {
  return useQuery({
    queryKey: sprintKeys.lists(),
    queryFn: async () => {
      const { data, error } = await supabase.from('sprints').select('*');
      if (error) throw error;
      return data as Sprint[];
    },
    staleTime: 60000,
  });
}

export function useSprintsPage(page: number, pageSize = 50) {
  return useQuery({
    queryKey: sprintKeys.page(page, pageSize),
    queryFn: async (): Promise<PaginatedResponse<Sprint>> => {
      const offset = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('sprints')
        .select('*', { count: 'exact' })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return toPagedResponse<Sprint>(data as Sprint[], count, page, pageSize);
    },
  });
}

export function useSprintsInfinite(pageSize = 50) {
  return useInfiniteQuery({
    queryKey: sprintKeys.infinite(pageSize),
    queryFn: async ({ pageParam = 1 }): Promise<PaginatedResponse<Sprint>> => {
      const page = pageParam as number;
      const offset = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('sprints')
        .select('*', { count: 'exact' })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return toPagedResponse<Sprint>(data as Sprint[], count, page, pageSize);
    },
    initialPageParam: 1,
    getNextPageParam,
  });
}

export function useSprint(sprintId: string) {
  return useQuery({
    queryKey: sprintKeys.detail(sprintId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sprints')
        .select('*')
        .eq('id', sprintId)
        .single();
      if (error) throw error;
      return data as Sprint;
    },
    enabled: !!sprintId,
  });
}

export function useActiveSprint(team?: string) {
  return useQuery({
    queryKey: sprintKeys.active(team),
    queryFn: async () => {
      let query = supabase.from('sprints').select('*').eq('is_active', true);
      if (team) query = query.eq('team', team);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as Sprint | null;
    },
  });
}

export function useCreateSprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sprint: Sprint) => {
      const sprintRow = {
        ...sprint,
        id: sprint.id || `sprint-${crypto.randomUUID()}`,
      };
      const { data, error } = await supabase.from('sprints').insert(sprintRow).select('*').single();
      if (error) throw error;
      if (sprint.is_active) {
        await supabase.rpc('set_active_sprint', {
          p_sprint_id: sprintRow.id,
          p_team: sprintRow.team || 'Developers',
        });
      }
      return data as Sprint;
    },
    onSuccess: async (createdSprint) => {
      await writeAuditLog({
        action: 'create',
        entityType: 'sprints',
        entityId: createdSprint.id,
        path: '/sprints',
        method: 'POST',
        statusCode: 201,
        metadata: {
          sprint_name: createdSprint.sprint_name,
          team: createdSprint.team,
          is_active: createdSprint.is_active,
        },
      });
      queryClient.invalidateQueries({ queryKey: sprintKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sprintKeys.active() });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Sprint created successfully');
    },
    onError: (error: unknown) => {
      toast.error(getSupabaseErrorMessage(error, 'Failed to create sprint'));
    },
  });
}

export function useUpdateSprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sprint: Sprint) => {
      const { data, error } = await supabase
        .from('sprints')
        .update(sprint)
        .eq('id', sprint.id)
        .select('*')
        .single();
      if (error) throw error;
      if (sprint.is_active) {
        await supabase.rpc('set_active_sprint', {
          p_sprint_id: sprint.id,
          p_team: sprint.team || 'Developers',
        });
      }
      return data as Sprint;
    },
    onSuccess: async (updatedSprint) => {
      await writeAuditLog({
        action: 'update',
        entityType: 'sprints',
        entityId: updatedSprint.id,
        path: `/sprints/${updatedSprint.id}`,
        method: 'PUT',
        statusCode: 200,
        metadata: {
          sprint_name: updatedSprint.sprint_name,
          team: updatedSprint.team,
          is_active: updatedSprint.is_active,
        },
      });
      queryClient.invalidateQueries({ queryKey: sprintKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sprintKeys.detail(updatedSprint.id) });
      if (updatedSprint.is_active) {
        queryClient.invalidateQueries({ queryKey: sprintKeys.active() });
      }
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Sprint updated successfully');
    },
    onError: (error: unknown) => {
      toast.error(getSupabaseErrorMessage(error, 'Failed to update sprint'));
    },
  });
}
