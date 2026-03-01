import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_comments')
        .select('*')
        .eq('task_id', taskId)
        .order('created_date', { ascending: true });
      if (error) throw error;
      return data as TaskComment[];
    },
    enabled: !!taskId,
  });
}

export function useCreateTaskComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (comment: TaskComment) => {
      const { data, error } = await supabase
        .from('task_comments')
        .insert(comment)
        .select('*')
        .single();
      if (error) throw error;
      return data as TaskComment;
    },
    onSuccess: (comment) => {
      queryClient.invalidateQueries({ queryKey: taskCommentKeys.byTask(comment.task_id) });
      toast.success('Comment added successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add comment');
    },
  });
}
