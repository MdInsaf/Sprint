import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { writeAuditLog } from '@/lib/audit-log';
import { supabase } from '@/lib/supabase';
import { SprintSummary } from '@/types';
import { toast } from 'sonner';

export const sprintSummaryKeys = {
  all: ['sprint-summaries'] as const,
  lists: () => [...sprintSummaryKeys.all, 'list'] as const,
  details: () => [...sprintSummaryKeys.all, 'detail'] as const,
  detail: (sprintId: string) => [...sprintSummaryKeys.details(), sprintId] as const,
};

export function useSprintSummaries() {
  return useQuery({
    queryKey: sprintSummaryKeys.lists(),
    queryFn: async () => {
      const { data, error } = await supabase.from('sprint_summaries').select('*');
      if (error) throw error;
      return data as SprintSummary[];
    },
    staleTime: 60000,
  });
}

export function useSprintSummary(sprintId: string) {
  return useQuery({
    queryKey: sprintSummaryKeys.detail(sprintId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sprint_summaries')
        .select('*')
        .eq('sprint_id', sprintId)
        .maybeSingle();
      if (error) throw error;
      return data as SprintSummary | null;
    },
    enabled: !!sprintId,
  });
}

export function useCreateOrUpdateSprintSummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (summary: SprintSummary) => {
      const { data: existing, error: existingError } = await supabase
        .from('sprint_summaries')
        .select('sprint_id')
        .eq('sprint_id', summary.sprint_id)
        .maybeSingle();
      if (existingError) throw existingError;

      const { data, error } = await supabase
        .from('sprint_summaries')
        .upsert(summary, { onConflict: 'sprint_id' })
        .select('*')
        .single();
      if (error) throw error;
      return {
        summary: data as SprintSummary,
        action: existing ? 'update' : 'create',
      } as const;
    },
    onSuccess: async ({ summary, action }) => {
      await writeAuditLog({
        action,
        entityType: 'sprint_summaries',
        entityId: summary.sprint_id,
        path: `/sprint-summaries/${summary.sprint_id}`,
        method: action === 'create' ? 'POST' : 'PUT',
        statusCode: action === 'create' ? 201 : 200,
        metadata: {
          success_percentage: summary.success_percentage,
          completed_tasks: summary.completed_tasks,
          carry_forward: summary.carry_forward,
        },
      });
      queryClient.invalidateQueries({ queryKey: sprintSummaryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sprintSummaryKeys.detail(summary.sprint_id) });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Sprint summary saved successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save sprint summary');
    },
  });
}
