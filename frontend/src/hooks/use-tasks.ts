import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { appendPaginationParams, extractResults, getNextPageParam, PaginatedResponse } from '@/lib/pagination';
import { Task } from '@/types';
import { toast } from 'sonner';
import { useSmartPolling } from './use-smart-polling';

// Query keys - centralized for cache invalidation
export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...taskKeys.lists(), filters] as const,
  page: (page: number, pageSize: number) => [...taskKeys.all, 'page', page, pageSize] as const,
  infinite: (pageSize: number) => [...taskKeys.all, 'infinite', pageSize] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
  bySprint: (sprintId: string) => [...taskKeys.all, 'sprint', sprintId] as const,
};

type TaskQueryValue = string | number | boolean | null | undefined;

function buildTasksPath(params?: Record<string, TaskQueryValue>): string {
  if (!params) return '/tasks';
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  const queryString = query.toString();
  return queryString ? `/tasks?${queryString}` : '/tasks';
}

export function useTasks() {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useQuery({
    queryKey: taskKeys.lists(),
    queryFn: () =>
      apiRequest<Task[] | PaginatedResponse<Task>>(
        buildTasksPath({ include_attachments: false })
      ),
    select: (data) => extractResults(data),
    staleTime: 30000,
    refetchInterval,
  });
}

export function useTasksBySprint(sprintId: string | null) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useQuery({
    queryKey: taskKeys.bySprint(sprintId || ''),
    queryFn: () =>
      apiRequest<Task[] | PaginatedResponse<Task>>(
        buildTasksPath({
          sprint_id: sprintId,
          include_attachments: false,
        })
      ),
    select: (data) => extractResults(data),
    enabled: !!sprintId,
    refetchInterval,
  });
}

export function useTasksByQaSprint(sprintId: string | null) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useQuery({
    queryKey: [...taskKeys.all, 'qa_sprint', sprintId],
    queryFn: () =>
      apiRequest<Task[] | PaginatedResponse<Task>>(
        buildTasksPath({
          qa_sprint_id: sprintId,
          include_attachments: false,
        })
      ),
    select: (data) =>
      extractResults(data).filter(
        (t) => t.qa_sprint_id === sprintId && t.sprint_id !== sprintId
      ),
    enabled: !!sprintId,
    refetchInterval,
  });
}

export function useTasksPage(page: number, pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useQuery({
    queryKey: taskKeys.page(page, pageSize),
    queryFn: () =>
      apiRequest<PaginatedResponse<Task>>(
        appendPaginationParams(
          buildTasksPath({ include_attachments: false }),
          page,
          pageSize
        )
      ),
    refetchInterval,
  });
}

export function useTasksInfinite(pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useInfiniteQuery({
    queryKey: taskKeys.infinite(pageSize),
    queryFn: ({ pageParam = 1 }) =>
      apiRequest<PaginatedResponse<Task>>(
        appendPaginationParams(
          buildTasksPath({ include_attachments: false }),
          pageParam,
          pageSize
        )
      ),
    initialPageParam: 1,
    getNextPageParam,
    refetchInterval,
  });
}

export function useTask(taskId: string, enabled = true) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => apiRequest<Task>(`/tasks/${taskId}`),
    enabled: !!taskId && enabled,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: Task & { attachments?: File[] }) => {
      const { attachments, ...taskData } = task;
      const body = attachments?.length
        ? buildTaskFormData(taskData, attachments)
        : JSON.stringify(taskData);

      return apiRequest<Task>('/tasks', {
        method: 'POST',
        body,
      });
    },
    onSuccess: (newTask) => {
      // Invalidate queries to trigger refetch
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      if (newTask.sprint_id) {
        queryClient.invalidateQueries({ queryKey: taskKeys.bySprint(newTask.sprint_id) });
      }
      toast.success('Task created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create task');
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: Task & { attachments?: File[] }) => {
      const { attachments, ...taskData } = task;
      const body = attachments?.length
        ? buildTaskFormData(taskData, attachments)
        : JSON.stringify(taskData);

      return apiRequest<Task>(`/tasks/${task.id}`, {
        method: 'PUT',
        body,
      });
    },
    onMutate: async (updatedTask) => {
      // Cancel outgoing refetches for all task queries
      await queryClient.cancelQueries({ queryKey: taskKeys.all });

      // Snapshot raw cached values (getQueryData returns pre-select raw data)
      const previousTask = queryClient.getQueryData<Task>(taskKeys.detail(updatedTask.id));
      const rawList = queryClient.getQueryData<Task[] | PaginatedResponse<Task>>(taskKeys.lists());
      const previousListItems = rawList ? extractResults(rawList) : undefined;

      const rawBySprint = (sprintId: string) =>
        queryClient.getQueryData<Task[] | PaginatedResponse<Task>>(taskKeys.bySprint(sprintId));

      const previousSprintId =
        previousTask?.sprint_id ??
        previousListItems?.find((t) => t.id === updatedTask.id)?.sprint_id ??
        null;

      const rawPreviousBySprint = previousSprintId ? rawBySprint(previousSprintId) : undefined;
      const rawNextBySprint = updatedTask.sprint_id ? rawBySprint(updatedTask.sprint_id) : undefined;

      const mergedTask: Task = {
        ...(previousTask || {}),
        ...updatedTask,
        attachments: updatedTask.attachments ?? previousTask?.attachments,
      };

      // Optimistically update detail cache
      queryClient.setQueryData(taskKeys.detail(updatedTask.id), mergedTask);

      // Optimistically update flat list cache (preserve paginated wrapper if present)
      if (rawList !== undefined) {
        const items = extractResults(rawList);
        const updatedItems = items.some((t) => t.id === updatedTask.id)
          ? items.map((t) =>
              t.id === updatedTask.id
                ? { ...t, ...mergedTask, attachments: mergedTask.attachments ?? t.attachments }
                : t
            )
          : [...items, mergedTask];
        const nextRawList =
          rawList && !Array.isArray(rawList)
            ? { ...rawList, results: updatedItems }
            : updatedItems;
        queryClient.setQueryData(taskKeys.lists(), nextRawList);
      }

      // Optimistically update sprint-specific caches
      const patchSprintCache = (
        sprintId: string,
        raw: Task[] | PaginatedResponse<Task> | undefined,
        patch: (items: Task[]) => Task[]
      ) => {
        if (raw === undefined) return;
        const items = extractResults(raw);
        const patched = patch(items);
        const next =
          raw && !Array.isArray(raw) ? { ...raw, results: patched } : patched;
        queryClient.setQueryData(taskKeys.bySprint(sprintId), next);
      };

      if (previousSprintId && previousSprintId !== updatedTask.sprint_id) {
        patchSprintCache(previousSprintId, rawPreviousBySprint, (items) =>
          items.filter((t) => t.id !== updatedTask.id)
        );
      }
      if (updatedTask.sprint_id) {
        const sprintId = updatedTask.sprint_id;
        const baseRaw = sprintId === previousSprintId ? rawPreviousBySprint : rawNextBySprint;
        patchSprintCache(sprintId, baseRaw, (items) =>
          items.some((t) => t.id === updatedTask.id)
            ? items.map((t) =>
                t.id === updatedTask.id
                  ? { ...t, ...mergedTask, attachments: mergedTask.attachments ?? t.attachments }
                  : t
              )
            : [...items, mergedTask]
        );
      }

      return { previousTask, rawList, rawPreviousBySprint, previousSprintId, rawNextBySprint };
    },
    onError: (error, updatedTask, context) => {
      // Rollback optimistic updates on error
      if (context?.previousTask) {
        queryClient.setQueryData(taskKeys.detail(updatedTask.id), context.previousTask);
      }
      if (context?.rawList !== undefined) {
        queryClient.setQueryData(taskKeys.lists(), context.rawList);
      }
      if (context?.previousSprintId && context?.rawPreviousBySprint !== undefined) {
        queryClient.setQueryData(taskKeys.bySprint(context.previousSprintId), context.rawPreviousBySprint);
      }
      if (updatedTask.sprint_id && context?.rawNextBySprint !== undefined) {
        queryClient.setQueryData(taskKeys.bySprint(updatedTask.sprint_id), context.rawNextBySprint);
      }
      toast.error(error.message || 'Failed to update task');
    },
    onSuccess: (serverTask) => {
      // Patch cache directly with server-confirmed data — no extra network round-trip
      const patchCache = (
        key: readonly unknown[],
        raw: Task[] | PaginatedResponse<Task> | undefined
      ) => {
        if (!raw) return;
        const items = extractResults(raw);
        const patched = items.map((t) => (t.id === serverTask.id ? { ...t, ...serverTask } : t));
        queryClient.setQueryData(key, Array.isArray(raw) ? patched : { ...raw, results: patched });
      };

      patchCache(taskKeys.lists(), queryClient.getQueryData(taskKeys.lists()));
      if (serverTask.sprint_id) {
        patchCache(
          taskKeys.bySprint(serverTask.sprint_id),
          queryClient.getQueryData(taskKeys.bySprint(serverTask.sprint_id))
        );
      }
      queryClient.setQueryData(taskKeys.detail(serverTask.id), serverTask);
      toast.success('Task updated successfully');
    },
    onSettled: (_data, _error, variables, context) => {
      // Mark as stale so the next natural refetch picks up server state,
      // but do NOT trigger an immediate background refetch that could race
      // against the onSuccess cache patch and cause flicker.
      queryClient.invalidateQueries({ queryKey: taskKeys.lists(), refetchType: 'none' });
      if (context?.previousSprintId) {
        queryClient.invalidateQueries({ queryKey: taskKeys.bySprint(context.previousSprintId), refetchType: 'none' });
      }
      if (variables?.sprint_id && variables.sprint_id !== context?.previousSprintId) {
        queryClient.invalidateQueries({ queryKey: taskKeys.bySprint(variables.sprint_id), refetchType: 'none' });
      }
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) =>
      apiRequest<void>(`/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      toast.success('Task deleted successfully');
    },
  });
}

// Helper function
function buildTaskFormData(task: Task, attachments: File[]): FormData {
  const form = new FormData();
  Object.entries(task).forEach(([key, value]) => {
    if (key !== 'attachments' && value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  });
  attachments.forEach(file => form.append('attachments', file));
  return form;
}
