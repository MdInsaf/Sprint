import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGetJson, apiPostJson } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-errors';
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
    queryFn: async () => apiGetJson<SprintSummary[]>('/sprint-summaries'),
    staleTime: 60000,
  });
}

export function useSprintSummary(sprintId: string) {
  return useQuery({
    queryKey: sprintSummaryKeys.detail(sprintId),
    queryFn: async () => apiGetJson<SprintSummary | null>(`/sprint-summaries/${sprintId}`),
    enabled: !!sprintId,
  });
}

export function useCreateOrUpdateSprintSummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (summary: SprintSummary) =>
      apiPostJson<SprintSummary>('/sprint-summaries', {
        sprint_id: summary.sprint_id,
        planned_tasks: summary.planned_tasks,
        completed_tasks: summary.completed_tasks,
        carry_forward: summary.carry_forward,
        additional_tasks: summary.additional_tasks,
        bugs: summary.bugs,
        success_percentage: summary.success_percentage,
        what_went_well: summary.what_went_well,
        issues: summary.issues,
        improvements: summary.improvements,
        completed_date: summary.completed_date,
      }),
    onSuccess: async (summary) => {
      await queryClient.invalidateQueries({ queryKey: sprintSummaryKeys.all });
      await queryClient.invalidateQueries({ queryKey: sprintSummaryKeys.detail(summary.sprint_id) });
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Sprint summary saved successfully');
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Failed to save sprint summary'));
    },
  });
}
