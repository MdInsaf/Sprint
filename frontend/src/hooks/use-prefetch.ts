import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiGetJson } from '@/lib/api';
import { Sprint, TeamMember, Task } from '@/types';
import { sprintKeys } from './use-sprints';
import { teamMemberKeys } from './use-team-members';
import { taskKeys } from './use-tasks';

export function usePrefetchCoreData() {
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: sprintKeys.lists(),
      queryFn: async () => apiGetJson<Sprint[]>('/sprints'),
      staleTime: 60000,
    });

    queryClient.prefetchQuery({
      queryKey: teamMemberKeys.lists(),
      queryFn: async () => apiGetJson<TeamMember[]>('/team-members'),
      staleTime: 60000,
    });

    queryClient.prefetchQuery({
      queryKey: taskKeys.lists(),
      queryFn: async () => apiGetJson<Task[]>('/tasks'),
      staleTime: 30000,
    });
  }, [queryClient]);
}
