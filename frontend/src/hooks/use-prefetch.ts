import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiRequest } from '@/lib/api-client';
import { extractResults, PaginatedResponse } from '@/lib/pagination';
import { Sprint, TeamMember, Task } from '@/types';
import { sprintKeys } from './use-sprints';
import { teamMemberKeys } from './use-team-members';
import { taskKeys } from './use-tasks';

/**
 * Prefetches core data (sprints, team members, tasks) at the layout level
 * so it's already cached when individual pages render.
 * This eliminates the waterfall where each page independently fetches the same data.
 */
export function usePrefetchCoreData() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Prefetch all three in parallel — React Query deduplicates if a fetch is already in-flight
    queryClient.prefetchQuery({
      queryKey: sprintKeys.lists(),
      queryFn: () => apiRequest<Sprint[] | PaginatedResponse<Sprint>>('/sprints'),
      staleTime: 60000,
    });

    queryClient.prefetchQuery({
      queryKey: teamMemberKeys.lists(),
      queryFn: () => apiRequest<TeamMember[] | PaginatedResponse<TeamMember>>('/team-members'),
      staleTime: 60000,
    });

    queryClient.prefetchQuery({
      queryKey: taskKeys.lists(),
      queryFn: () =>
        apiRequest<Task[] | PaginatedResponse<Task>>('/tasks?include_attachments=false'),
      staleTime: 30000,
    });
  }, [queryClient]);
}
