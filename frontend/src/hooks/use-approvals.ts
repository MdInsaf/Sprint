import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGetJson, apiPostJson } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-errors';
import { getNextPageParam, PaginatedResponse } from '@/lib/pagination';
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
    queryFn: async () => apiGetJson<AdditionalWorkApproval[]>('/approvals'),
    staleTime: 30000,
    refetchInterval,
  });
}

export function useApprovalByTask(taskId: string) {
  return useQuery({
    queryKey: approvalKeys.byTask(taskId),
    queryFn: async () => {
      const approvals = await apiGetJson<AdditionalWorkApproval[]>('/approvals');
      return approvals.find((approval) => approval.task_id === taskId) ?? null;
    },
    enabled: !!taskId,
  });
}

export function useApprovalsPage(page: number, pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useQuery({
    queryKey: approvalKeys.page(page, pageSize),
    queryFn: async (): Promise<PaginatedResponse<AdditionalWorkApproval>> =>
      apiGetJson<PaginatedResponse<AdditionalWorkApproval>>('/approvals', {
        page,
        page_size: pageSize,
      }),
    refetchInterval,
  });
}

export function useApprovalsInfinite(pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useInfiniteQuery({
    queryKey: approvalKeys.infinite(pageSize),
    queryFn: async ({ pageParam = 1 }): Promise<PaginatedResponse<AdditionalWorkApproval>> =>
      apiGetJson<PaginatedResponse<AdditionalWorkApproval>>('/approvals', {
        page: pageParam as number,
        page_size: pageSize,
      }),
    initialPageParam: 1,
    getNextPageParam,
    refetchInterval,
  });
}

export function useCreateOrUpdateApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (approval: AdditionalWorkApproval) =>
      apiPostJson<AdditionalWorkApproval>('/approvals', {
        task_id: approval.task_id,
        reason: approval.reason,
        approved_by: approval.approved_by,
        impact: approval.impact,
        approved: approval.approved,
      }),
    onSuccess: async (approval) => {
      await queryClient.invalidateQueries({ queryKey: approvalKeys.all });
      await queryClient.invalidateQueries({ queryKey: approvalKeys.byTask(approval.task_id) });
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Approval saved successfully');
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, 'Failed to save approval'));
    },
  });
}
