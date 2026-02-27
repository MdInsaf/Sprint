import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
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
    queryFn: () => apiRequest<SprintSummary[]>('/sprint-summaries'),
    staleTime: 60000, // 1 minute
  });
}

export function useSprintSummary(sprintId: string) {
  return useQuery({
    queryKey: sprintSummaryKeys.detail(sprintId),
    queryFn: () => apiRequest<SprintSummary>(`/sprint-summaries/${sprintId}`),
    enabled: !!sprintId,
  });
}

export function useCreateOrUpdateSprintSummary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (summary: SprintSummary) =>
      apiRequest<SprintSummary>('/sprint-summaries', {
        method: 'POST',
        body: JSON.stringify(summary),
      }),
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
