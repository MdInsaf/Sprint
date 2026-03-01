import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
      const { data, error } = await supabase
        .from('sprint_summaries')
        .upsert(summary, { onConflict: 'sprint_id' })
        .select('*')
        .single();
      if (error) throw error;
      return data as SprintSummary;
    },
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: sprintSummaryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sprintSummaryKeys.detail(summary.sprint_id) });
      toast.success('Sprint summary saved successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save sprint summary');
    },
  });
}
