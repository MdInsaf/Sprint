import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Sprint, TeamMember, Task } from '@/types';
import { sprintKeys } from './use-sprints';
import { teamMemberKeys } from './use-team-members';
import { taskKeys } from './use-tasks';

/**
 * Prefetches core data (sprints, team members, tasks) at the layout level
 * so it's already cached when individual pages render.
 */
export function usePrefetchCoreData() {
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: sprintKeys.lists(),
      queryFn: async () => {
        const { data, error } = await supabase.from('sprints').select('*');
        if (error) throw error;
        return data as Sprint[];
      },
      staleTime: 60000,
    });

    queryClient.prefetchQuery({
      queryKey: teamMemberKeys.lists(),
      queryFn: async () => {
        const { data, error } = await supabase
          .from('team_members')
          .select('id,name,username,email,role,avatar,team,leave_dates');
        if (error) throw error;
        return data as TeamMember[];
      },
      staleTime: 60000,
    });

    queryClient.prefetchQuery({
      queryKey: taskKeys.lists(),
      queryFn: async () => {
        const { data, error } = await supabase
          .from('tasks')
          .select('*, attachments:task_attachments(*)');
        if (error) throw error;
        return data as Task[];
      },
      staleTime: 30000,
    });
  }, [queryClient]);
}
