import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGetJson, apiPostJson, apiPutJson } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-errors';
import { getNextPageParam, PaginatedResponse } from '@/lib/pagination';
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
    queryFn: async () => apiGetJson<Sprint[]>('/sprints'),
    staleTime: 60000,
  });
}

export function useSprintsPage(page: number, pageSize = 50) {
  return useQuery({
    queryKey: sprintKeys.page(page, pageSize),
    queryFn: async (): Promise<PaginatedResponse<Sprint>> =>
      apiGetJson<PaginatedResponse<Sprint>>('/sprints', {
        page,
        page_size: pageSize,
      }),
  });
}

export function useSprintsInfinite(pageSize = 50) {
  return useInfiniteQuery({
    queryKey: sprintKeys.infinite(pageSize),
    queryFn: async ({ pageParam = 1 }): Promise<PaginatedResponse<Sprint>> =>
      apiGetJson<PaginatedResponse<Sprint>>('/sprints', {
        page: pageParam as number,
        page_size: pageSize,
      }),
    initialPageParam: 1,
    getNextPageParam,
  });
}

export function useSprint(sprintId: string) {
  return useQuery({
    queryKey: sprintKeys.detail(sprintId),
    queryFn: async () => {
      const sprints = await apiGetJson<Sprint[]>('/sprints');
      return sprints.find((sprint) => sprint.id === sprintId) ?? null;
    },
    enabled: !!sprintId,
  });
}

export function useActiveSprint(team?: string) {
  return useQuery({
    queryKey: sprintKeys.active(team),
    queryFn: async () => apiGetJson<Sprint | null>('/active-sprint', { team }),
  });
}

export function useCreateSprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sprint: Sprint) =>
      apiPostJson<Sprint>('/sprints', {
        id: sprint.id,
        sprint_name: sprint.sprint_name,
        start_date: sprint.start_date,
        end_date: sprint.end_date,
        sprint_goal: sprint.sprint_goal,
        holiday_dates: sprint.holiday_dates || [],
        is_active: sprint.is_active,
        team: sprint.team,
      }),
    onSuccess: async (createdSprint) => {
      await queryClient.invalidateQueries({ queryKey: sprintKeys.all });
      await queryClient.invalidateQueries({ queryKey: sprintKeys.active() });
      await queryClient.invalidateQueries({ queryKey: sprintKeys.active(createdSprint.team) });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Sprint created successfully');
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Failed to create sprint'));
    },
  });
}

export function useUpdateSprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sprint: Sprint) =>
      apiPutJson<Sprint>(`/sprints/${sprint.id}`, {
        sprint_name: sprint.sprint_name,
        start_date: sprint.start_date,
        end_date: sprint.end_date,
        sprint_goal: sprint.sprint_goal,
        holiday_dates: sprint.holiday_dates || [],
        is_active: sprint.is_active,
        team: sprint.team,
      }),
    onSuccess: async (updatedSprint) => {
      await queryClient.invalidateQueries({ queryKey: sprintKeys.all });
      await queryClient.invalidateQueries({ queryKey: sprintKeys.detail(updatedSprint.id) });
      await queryClient.invalidateQueries({ queryKey: sprintKeys.active() });
      await queryClient.invalidateQueries({ queryKey: sprintKeys.active(updatedSprint.team) });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Sprint updated successfully');
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Failed to update sprint'));
    },
  });
}
