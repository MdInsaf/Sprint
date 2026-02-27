import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
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
    queryFn: () => apiRequest<TaskComment[]>('/task-comments'),
    select: (comments) =>
      comments
        .filter(c => c.task_id === taskId)
        .sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime()),
    enabled: !!taskId,
  });
}

export function useCreateTaskComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (comment: TaskComment) =>
      apiRequest<TaskComment>('/task-comments', {
        method: 'POST',
        body: JSON.stringify(comment),
      }),
    onSuccess: (comment) => {
      queryClient.invalidateQueries({ queryKey: taskCommentKeys.byTask(comment.task_id) });
      toast.success('Comment added successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add comment');
    },
  });
}
