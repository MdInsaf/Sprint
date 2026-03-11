import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { writeAuditLog } from '@/lib/audit-log';
import { supabase } from '@/lib/supabase';
import { extractResults, getNextPageParam, PaginatedResponse, toPagedResponse } from '@/lib/pagination';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { Task } from '@/types';
import { toast } from 'sonner';
import { useSmartPolling } from './use-smart-polling';

const TASK_ID_PREFIXES: Record<string, string> = {
  Sprint: 'SP',
  Additional: 'ADD',
  Backlog: 'BLG',
  Bug: 'BUG',
  Change: 'CHG',
};

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
  const { data, error } = await supabase
    .from('tasks')
    .select('*, attachments:task_attachments(*)');
  if (error) throw error;
  return data as Task[];
}

function parseTaskNumber(taskId: string, prefix: string): number | null {
  const match = String(taskId || '').match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isNaN(value) ? null : value;
}

async function buildFallbackTaskId(taskType: Task['type']): Promise<string> {
  const prefix = TASK_ID_PREFIXES[taskType] || 'TASK';
  const { data, error } = await supabase
    .from('tasks')
    .select('id')
    .ilike('id', `${prefix}-%`);

  if (error) {
    throw error;
  }

  let maxNum = 0;
  (data || []).forEach((row) => {
    const next = parseTaskNumber((row as { id?: string }).id || '', prefix);
    if (next != null && next > maxNum) {
      maxNum = next;
    }
  });

  const nextNum = maxNum + 1;
  const digits = Math.max(3, String(nextNum).length);
  return `${prefix}-${String(nextNum).padStart(digits, '0')}`;
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, attachments:task_attachments(*)')
        .eq('sprint_id', sprintId!);
      if (error) throw error;
      return data as Task[];
    },
    enabled: !!sprintId,
    refetchInterval,
  });
}

export function useTasksByQaSprint(sprintId: string | null) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useQuery({
    queryKey: [...taskKeys.all, 'qa_sprint', sprintId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, attachments:task_attachments(*)')
        .eq('qa_sprint_id', sprintId!);
      if (error) throw error;
      return (data as Task[]).filter(
        (t) => t.qa_sprint_id === sprintId && t.sprint_id !== sprintId
      );
    },
    enabled: !!sprintId,
    refetchInterval,
  });
}

export function useTasksPage(page: number, pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useQuery({
    queryKey: taskKeys.page(page, pageSize),
    queryFn: async (): Promise<PaginatedResponse<Task>> => {
      const offset = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('tasks')
        .select('*, attachments:task_attachments(*)', { count: 'exact' })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return toPagedResponse<Task>(data as Task[], count, page, pageSize);
    },
    refetchInterval,
  });
}

export function useTasksInfinite(pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 15000, idleInterval: 60000, inactiveInterval: false });
  return useInfiniteQuery({
    queryKey: taskKeys.infinite(pageSize),
    queryFn: async ({ pageParam = 1 }): Promise<PaginatedResponse<Task>> => {
      const page = pageParam as number;
      const offset = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('tasks')
        .select('*', { count: 'exact' })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return toPagedResponse<Task>(data as Task[], count, page, pageSize);
    },
    initialPageParam: 1,
    getNextPageParam,
    refetchInterval,
  });
}

export function useTask(taskId: string, enabled = true) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, attachments:task_attachments(*)')
        .eq('id', taskId)
        .single();
      if (error) throw error;
      return data as Task;
    },
    enabled: !!taskId && enabled,
  });
}

const DONE_STATUSES = new Set(['Done', 'Closed', 'Fixed']);
const WORK_STATUSES = new Set(['In Progress', 'Reopen']);

function applyStatusDates(next: Task, prev?: Task): Task {
  const result = { ...next };
  const oldStatus = prev?.status;
  const newStatus = next.status;
  if (newStatus && newStatus !== oldStatus) {
    if (WORK_STATUSES.has(newStatus) && !result.in_progress_date) {
      result.in_progress_date = new Date().toISOString();
    }
    if (DONE_STATUSES.has(newStatus) && !DONE_STATUSES.has(oldStatus || '')) {
      result.closed_date = new Date().toISOString();
    }
    if (newStatus === 'Blocked' && oldStatus !== 'Blocked') {
      result.blocker_date = new Date().toISOString();
    }
  }
  const oldQa = prev?.qa_status;
  const newQa = next.qa_status;
  if (newQa && newQa !== oldQa) {
    if ((newQa === 'Testing' || newQa === 'Rework') && !result.qa_in_progress_date) {
      result.qa_in_progress_date = new Date().toISOString();
    }
    if (newQa === 'Fixing' && !result.qa_fixing_in_progress_date) {
      result.qa_fixing_in_progress_date = new Date().toISOString();
    }
  }
  return result;
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (task: Task) => {
      let rpcAvailable = true;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        let taskId = task.id;

        if (rpcAvailable) {
          const { data: generatedId, error: idError } = await supabase.rpc('generate_task_id', { p_type: task.type });
          if (idError || !generatedId) {
            rpcAvailable = false;
          } else {
            taskId = generatedId as string;
          }
        }

        if (!rpcAvailable) {
          taskId = await buildFallbackTaskId(task.type);
        }

        const { attachments: _att, ...taskRow } = { ...task, id: taskId } as Task & { attachments?: unknown };
        const { data, error } = await supabase.from('tasks').insert(taskRow).select('*').single();

        if (!error) {
          return data as Task;
        }

        if (error.code === '23505' && attempt < 2) {
          rpcAvailable = false;
          continue;
        }

        throw error;
      }

      throw new Error('Failed to create task. Please try again.');
    },
    onSuccess: async (newTask) => {
      await writeAuditLog({
        action: 'create',
        entityType: 'tasks',
        entityId: newTask.id,
        path: '/tasks',
        method: 'POST',
        statusCode: 201,
        metadata: {
          title: newTask.title,
          type: newTask.type,
          sprint_id: newTask.sprint_id,
          status: newTask.status,
        },
      });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      if (newTask.sprint_id) {
        queryClient.invalidateQueries({ queryKey: taskKeys.bySprint(newTask.sprint_id) });
      }
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Task created successfully');
    },
    onError: (error: unknown) => {
      toast.error(getSupabaseErrorMessage(error, 'Failed to create task'));
    },
    retry: 0,
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (task: Task) => {
      const previousTask = queryClient.getQueryData<Task>(taskKeys.detail(task.id));
      const updated = applyStatusDates(task, previousTask);
      const { attachments: _att, ...taskRow } = updated as Task & { attachments?: unknown };
      const { data, error } = await supabase
        .from('tasks')
        .update(taskRow)
        .eq('id', task.id)
        .select('*')
        .single();
      if (error) throw error;
      return data as Task;
    },
    onMutate: async (updatedTask) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });
      const previousTask = queryClient.getQueryData<Task>(taskKeys.detail(updatedTask.id));
      const rawList = queryClient.getQueryData<Task[]>(taskKeys.lists());
      const previousListItems = rawList ? extractResults(rawList) : undefined;
      const previousSprintId =
        previousTask?.sprint_id ??
        previousListItems?.find((t) => t.id === updatedTask.id)?.sprint_id ??
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
        attachments: updatedTask.attachments ?? previousTask?.attachments,
      };
      queryClient.setQueryData(taskKeys.detail(updatedTask.id), mergedTask);
      if (rawList !== undefined) {
        const items = extractResults(rawList);
        const updatedItems = items.some((t) => t.id === updatedTask.id)
          ? items.map((t) => t.id === updatedTask.id ? mergedTask : t)
          : [...items, mergedTask];
        queryClient.setQueryData(taskKeys.lists(), updatedItems);
      }
      return { previousTask, rawList, rawPreviousBySprint, previousSprintId, rawNextBySprint };
    },
    onError: (error, updatedTask, context) => {
      if (context?.previousTask) queryClient.setQueryData(taskKeys.detail(updatedTask.id), context.previousTask);
      if (context?.rawList !== undefined) queryClient.setQueryData(taskKeys.lists(), context.rawList);
      if (context?.previousSprintId && context?.rawPreviousBySprint !== undefined) {
        queryClient.setQueryData(taskKeys.bySprint(context.previousSprintId), context.rawPreviousBySprint);
      }
      if (updatedTask.sprint_id && context?.rawNextBySprint !== undefined) {
        queryClient.setQueryData(taskKeys.bySprint(updatedTask.sprint_id), context.rawNextBySprint);
      }
      toast.error(error.message || 'Failed to update task');
    },
    onSuccess: async (serverTask) => {
      await writeAuditLog({
        action: 'update',
        entityType: 'tasks',
        entityId: serverTask.id,
        path: `/tasks/${serverTask.id}`,
        method: 'PUT',
        statusCode: 200,
        metadata: {
          title: serverTask.title,
          sprint_id: serverTask.sprint_id,
          status: serverTask.status,
          qa_status: serverTask.qa_status,
        },
      });
      queryClient.setQueryData(taskKeys.detail(serverTask.id), serverTask);
      const rawList = queryClient.getQueryData<Task[]>(taskKeys.lists());
      if (rawList) {
        const patched = extractResults(rawList).map((t) => t.id === serverTask.id ? { ...t, ...serverTask } : t);
        queryClient.setQueryData(taskKeys.lists(), patched);
      }
      if (serverTask.sprint_id) {
        queryClient.invalidateQueries({ queryKey: taskKeys.bySprint(serverTask.sprint_id) });
      }
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Task updated successfully');
    },
    onSettled: (_data, _error, variables, context) => {
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
    mutationFn: async (taskId: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
      return taskId;
    },
    onSuccess: async (taskId) => {
      await writeAuditLog({
        action: 'delete',
        entityType: 'tasks',
        entityId: taskId,
        path: `/tasks/${taskId}`,
        method: 'DELETE',
        statusCode: 200,
      });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Task deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete task');
    },
  });
}
