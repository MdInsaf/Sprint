import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { appendPaginationParams, extractResults, getNextPageParam, PaginatedResponse } from '@/lib/pagination';
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
    queryFn: () => apiRequest<Sprint[] | PaginatedResponse<Sprint>>('/sprints'),
    select: (data) => extractResults(data),
    staleTime: 60000, // 1 minute - sprints change less frequently
  });
}

export function useSprintsPage(page: number, pageSize = 50) {
  return useQuery({
    queryKey: sprintKeys.page(page, pageSize),
    queryFn: () =>
      apiRequest<PaginatedResponse<Sprint>>(appendPaginationParams('/sprints', page, pageSize)),
  });
}

export function useSprintsInfinite(pageSize = 50) {
  return useInfiniteQuery({
    queryKey: sprintKeys.infinite(pageSize),
    queryFn: ({ pageParam = 1 }) =>
      apiRequest<PaginatedResponse<Sprint>>(appendPaginationParams('/sprints', pageParam, pageSize)),
    initialPageParam: 1,
    getNextPageParam,
  });
}

export function useSprint(sprintId: string) {
  return useQuery({
    queryKey: sprintKeys.detail(sprintId),
    queryFn: () => apiRequest<Sprint>(`/sprints/${sprintId}`),
    enabled: !!sprintId,
  });
}

export function useActiveSprint(team?: string) {
  return useQuery({
    queryKey: sprintKeys.active(team),
    queryFn: () => apiRequest<Sprint>('/active-sprint'),
    select: (sprint) => {
      if (!team) return sprint;
      return sprint && (sprint.team || 'Developers') === team ? sprint : null;
    },
  });
}

export function useCreateSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sprint: Sprint) =>
      apiRequest<Sprint>('/sprints', {
        method: 'POST',
        body: JSON.stringify(sprint),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sprintKeys.lists() });
      toast.success('Sprint created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create sprint');
    },
  });
}

export function useUpdateSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sprint: Sprint) =>
      apiRequest<Sprint>(`/sprints/${sprint.id}`, {
        method: 'PUT',
        body: JSON.stringify(sprint),
      }),
    onSuccess: (updatedSprint) => {
      queryClient.invalidateQueries({ queryKey: sprintKeys.lists() });
      queryClient.invalidateQueries({ queryKey: sprintKeys.detail(updatedSprint.id) });
      if (updatedSprint.is_active) {
        queryClient.invalidateQueries({ queryKey: sprintKeys.active() });
      }
      toast.success('Sprint updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update sprint');
    },
  });
}
