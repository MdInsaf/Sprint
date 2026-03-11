import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { writeAuditLog } from '@/lib/audit-log';
import { supabase } from '@/lib/supabase';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
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
      const commentRow = {
        ...comment,
        id: comment.id || `comment-${crypto.randomUUID()}`,
      };
      const { data, error } = await supabase
        .from('task_comments')
        .insert(commentRow)
        .select('*')
        .single();
      if (error) throw error;
      return data as TaskComment;
    },
    onSuccess: async (comment) => {
      await writeAuditLog({
        action: 'create',
        entityType: 'task_comments',
        entityId: comment.id,
        path: `/tasks/${comment.task_id}/comments`,
        method: 'POST',
        statusCode: 201,
        metadata: {
          task_id: comment.task_id,
          author_id: comment.author_id,
        },
      });
      queryClient.invalidateQueries({ queryKey: taskCommentKeys.byTask(comment.task_id) });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Comment added successfully');
    },
    onError: (error: unknown) => {
      toast.error(getSupabaseErrorMessage(error, 'Failed to add comment'));
    },
  });
}
