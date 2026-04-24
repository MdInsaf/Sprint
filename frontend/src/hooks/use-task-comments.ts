import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGetJson, apiPostJson } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-errors';
import { TaskComment } from '@/types';
import { toast } from 'sonner';

export const taskCommentKeys = {
  all: ['task-comments'] as const,
  lists: () => [...taskCommentKeys.all, 'list'] as const,
  byTask: (taskId: string) => [...taskCommentKeys.all, 'task', taskId] as const,
};

export function useTaskComments(taskId: string) {
  return useQuery({
    queryKey: taskCommentKeys.byTask(taskId),
    queryFn: async () =>
      apiGetJson<TaskComment[]>('/task-comments', {
        taskId,
      }),
    enabled: !!taskId,
  });
}

export function useCreateTaskComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (comment: TaskComment) =>
      apiPostJson<TaskComment>('/task-comments', {
        id: comment.id,
        task_id: comment.task_id,
        author_id: comment.author_id,
        content: comment.content,
        created_date: comment.created_date,
      }),
    onSuccess: async (comment) => {
      await queryClient.invalidateQueries({ queryKey: taskCommentKeys.byTask(comment.task_id) });
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Comment added successfully');
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Failed to add comment'));
    },
  });
}
