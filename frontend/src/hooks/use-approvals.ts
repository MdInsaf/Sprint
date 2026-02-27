import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { appendPaginationParams, extractResults, getNextPageParam, PaginatedResponse } from '@/lib/pagination';
import { AdditionalWorkApproval } from '@/types';
import { toast } from 'sonner';
import { useSmartPolling } from './use-smart-polling';

export const approvalKeys = {
  all: ['approvals'] as const,
  lists: () => [...approvalKeys.all, 'list'] as const,
  page: (page: number, pageSize: number) => [...approvalKeys.all, 'page', page, pageSize] as const,
  infinite: (pageSize: number) => [...approvalKeys.all, 'infinite', pageSize] as const,
  byTask: (taskId: string) => [...approvalKeys.all, 'task', taskId] as const,
};

export function useApprovals() {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useQuery({
    queryKey: approvalKeys.lists(),
    queryFn: () => apiRequest<AdditionalWorkApproval[] | PaginatedResponse<AdditionalWorkApproval>>('/approvals'),
    select: (data) => extractResults(data),
    staleTime: 30000,
    refetchInterval,
  });
}

export function useApprovalByTask(taskId: string) {
  return useQuery({
    queryKey: approvalKeys.byTask(taskId),
    queryFn: () => apiRequest<AdditionalWorkApproval[] | PaginatedResponse<AdditionalWorkApproval>>('/approvals'),
    select: (data) => extractResults(data).find(a => a.task_id === taskId),
    enabled: !!taskId,
  });
}

export function useApprovalsPage(page: number, pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useQuery({
    queryKey: approvalKeys.page(page, pageSize),
    queryFn: () =>
      apiRequest<PaginatedResponse<AdditionalWorkApproval>>(appendPaginationParams('/approvals', page, pageSize)),
    refetchInterval,
  });
}

export function useApprovalsInfinite(pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useInfiniteQuery({
    queryKey: approvalKeys.infinite(pageSize),
    queryFn: ({ pageParam = 1 }) =>
      apiRequest<PaginatedResponse<AdditionalWorkApproval>>(
        appendPaginationParams('/approvals', pageParam, pageSize)
      ),
    initialPageParam: 1,
    getNextPageParam,
    refetchInterval,
  });
}

export function useCreateOrUpdateApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (approval: AdditionalWorkApproval) =>
      apiRequest<AdditionalWorkApproval>('/approvals', {
        method: 'POST',
        body: JSON.stringify(approval),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalKeys.lists() });
      toast.success('Approval saved successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save approval');
    },
  });
}
