import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDeleteJson, apiGetJson, apiPostFormData, apiPostJson, apiPutFormData, apiPutJson } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-errors';
import { extractResults, getNextPageParam, PaginatedResponse } from '@/lib/pagination';
import { Task, TaskAttachment } from '@/types';
import { toast } from 'sonner';
import { useSmartPolling } from './use-smart-polling';

type TaskMutationInput = Task & { attachments?: File[] | TaskAttachment[] };

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

async function fetchAllTasks(): Promise<Task[]> {
  return apiGetJson<Task[]>('/tasks');
}

function isPendingFile(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

function hasPendingFiles(attachments?: File[] | TaskAttachment[]): attachments is File[] {
  return Array.isArray(attachments) && attachments.some(isPendingFile);
}

function getStableAttachments(
  attachments: TaskMutationInput['attachments'],
  fallback?: TaskAttachment[]
): TaskAttachment[] | undefined {
  if (hasPendingFiles(attachments)) {
    return fallback;
  }
  return attachments as TaskAttachment[] | undefined;
}

function appendFormValue(formData: FormData, key: string, value: unknown) {
  if (value === undefined || value === null) {
    formData.append(key, '');
    return;
  }
  formData.append(key, String(value));
}

function buildTaskFormData(task: TaskMutationInput, includeId = false): FormData {
  const formData = new FormData();

  Object.entries(task).forEach(([key, value]) => {
    if (key === 'attachments') {
      return;
    }
    if (key === 'id' && !includeId) {
      return;
    }
    appendFormValue(formData, key, value);
  });

  (task.attachments || []).filter(isPendingFile).forEach((file) => {
    formData.append('attachments', file);
  });

  return formData;
}

function buildTaskJsonPayload(task: TaskMutationInput, includeId = false): Record<string, unknown> {
  const { attachments: _attachments, ...taskRow } = task;
  const payload = { ...taskRow } as Record<string, unknown>;
  if (!includeId) {
    delete payload.id;
  }
  return payload;
}

async function createTaskRequest(task: TaskMutationInput): Promise<Task> {
  if (hasPendingFiles(task.attachments)) {
    return apiPostFormData<Task>('/tasks', buildTaskFormData(task));
  }
  return apiPostJson<Task>('/tasks', buildTaskJsonPayload(task));
}

async function updateTaskRequest(task: TaskMutationInput): Promise<Task> {
  if (hasPendingFiles(task.attachments)) {
    return apiPutFormData<Task>(`/tasks/${task.id}`, buildTaskFormData(task, true));
  }
  return apiPutJson<Task>(`/tasks/${task.id}`, buildTaskJsonPayload(task, true));
}

export function useTasks() {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useQuery({
    queryKey: taskKeys.lists(),
    queryFn: fetchAllTasks,
    staleTime: 30000,
    refetchInterval,
  });
}

export function useTasksBySprint(sprintId: string | null) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useQuery({
    queryKey: taskKeys.bySprint(sprintId || ''),
    queryFn: async () => apiGetJson<Task[]>('/tasks', { sprint_id: sprintId! }),
    enabled: !!sprintId,
    refetchInterval,
  });
}

export function useTasksByQaSprint(sprintId: string | null) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useQuery({
    queryKey: [...taskKeys.all, 'qa_sprint', sprintId],
    queryFn: async () => {
      const tasks = await apiGetJson<Task[]>('/tasks', { qa_sprint_id: sprintId! });
      return tasks.filter((task) => task.qa_sprint_id === sprintId && task.sprint_id !== sprintId);
    },
    enabled: !!sprintId,
    refetchInterval,
  });
}

export function useTasksPage(page: number, pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useQuery({
    queryKey: taskKeys.page(page, pageSize),
    queryFn: async (): Promise<PaginatedResponse<Task>> =>
      apiGetJson<PaginatedResponse<Task>>('/tasks', {
        page,
        page_size: pageSize,
      }),
    refetchInterval,
  });
}

export function useTasksInfinite(pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useInfiniteQuery({
    queryKey: taskKeys.infinite(pageSize),
    queryFn: async ({ pageParam = 1 }): Promise<PaginatedResponse<Task>> =>
      apiGetJson<PaginatedResponse<Task>>('/tasks', {
        page: pageParam as number,
        page_size: pageSize,
      }),
    initialPageParam: 1,
    getNextPageParam,
    refetchInterval,
  });
}

export function useTask(taskId: string, enabled = true) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: async () => apiGetJson<Task>(`/tasks/${taskId}`),
    enabled: !!taskId && enabled,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTaskRequest,
    onSuccess: async (newTask) => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
      if (newTask.sprint_id) {
        await queryClient.invalidateQueries({ queryKey: taskKeys.bySprint(newTask.sprint_id) });
      }
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Task created successfully');
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Failed to create task'));
    },
    retry: 0,
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTaskRequest,
    onMutate: async (updatedTask) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });
      const previousTask = queryClient.getQueryData<Task>(taskKeys.detail(updatedTask.id));
      const rawList = queryClient.getQueryData<Task[]>(taskKeys.lists());
      const previousListItems = rawList ? extractResults(rawList) : undefined;
      const previousSprintId =
        previousTask?.sprint_id ??
        previousListItems?.find((task) => task.id === updatedTask.id)?.sprint_id ??
        null;
      const rawPreviousBySprint = previousSprintId
        ? queryClient.getQueryData<Task[]>(taskKeys.bySprint(previousSprintId))
        : undefined;
      const rawNextBySprint = updatedTask.sprint_id
        ? queryClient.getQueryData<Task[]>(taskKeys.bySprint(updatedTask.sprint_id))
        : undefined;

      const mergedTask: Task = {
        ...(previousTask || {}),
        ...updatedTask,
        attachments: getStableAttachments(updatedTask.attachments, previousTask?.attachments),
      } as Task;

      queryClient.setQueryData(taskKeys.detail(updatedTask.id), mergedTask);
      if (rawList !== undefined) {
        const items = extractResults(rawList);
        const updatedItems = items.some((task) => task.id === updatedTask.id)
          ? items.map((task) => (task.id === updatedTask.id ? mergedTask : task))
          : [...items, mergedTask];
        queryClient.setQueryData(taskKeys.lists(), updatedItems);
      }

      return { previousTask, rawList, rawPreviousBySprint, previousSprintId, rawNextBySprint };
    },
    onError: (error, updatedTask, context) => {
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
      toast.error(getApiErrorMessage(error, 'Failed to update task'));
    },
    onSuccess: async (serverTask) => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all, refetchType: 'none' });
      queryClient.setQueryData(taskKeys.detail(serverTask.id), serverTask);
      const rawList = queryClient.getQueryData<Task[]>(taskKeys.lists());
      if (rawList) {
        const patched = extractResults(rawList).map((task) => (task.id === serverTask.id ? { ...task, ...serverTask } : task));
        queryClient.setQueryData(taskKeys.lists(), patched);
      }
      if (serverTask.sprint_id) {
        await queryClient.invalidateQueries({ queryKey: taskKeys.bySprint(serverTask.sprint_id) });
      }
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Task updated successfully');
    },
    onSettled: async (_data, _error, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.lists(), refetchType: 'none' });
      if (context?.previousSprintId) {
        await queryClient.invalidateQueries({ queryKey: taskKeys.bySprint(context.previousSprintId), refetchType: 'none' });
      }
      if (variables?.sprint_id && variables.sprint_id !== context?.previousSprintId) {
        await queryClient.invalidateQueries({ queryKey: taskKeys.bySprint(variables.sprint_id), refetchType: 'none' });
      }
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      await apiDeleteJson(`/tasks/${taskId}`);
      return taskId;
    },
    onSuccess: async (taskId) => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
      await queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Task deleted successfully');
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Failed to delete task'));
    },
  });
}
