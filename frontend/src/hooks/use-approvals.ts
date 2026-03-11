import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { writeAuditLog } from '@/lib/audit-log';
import { supabase } from '@/lib/supabase';
import { getNextPageParam, PaginatedResponse, toPagedResponse } from '@/lib/pagination';
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
    queryFn: async () => {
      const { data, error } = await supabase.from('approvals').select('*');
      if (error) throw error;
      return data as AdditionalWorkApproval[];
    },
    staleTime: 30000,
    refetchInterval,
  });
}

export function useApprovalByTask(taskId: string) {
  return useQuery({
    queryKey: approvalKeys.byTask(taskId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('approvals')
        .select('*')
        .eq('task_id', taskId)
        .maybeSingle();
      if (error) throw error;
      return data as AdditionalWorkApproval | null;
    },
    enabled: !!taskId,
  });
}

export function useApprovalsPage(page: number, pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useQuery({
    queryKey: approvalKeys.page(page, pageSize),
    queryFn: async (): Promise<PaginatedResponse<AdditionalWorkApproval>> => {
      const offset = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('approvals')
        .select('*', { count: 'exact' })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return toPagedResponse<AdditionalWorkApproval>(data as AdditionalWorkApproval[], count, page, pageSize);
    },
    refetchInterval,
  });
}

export function useApprovalsInfinite(pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useInfiniteQuery({
    queryKey: approvalKeys.infinite(pageSize),
    queryFn: async ({ pageParam = 1 }): Promise<PaginatedResponse<AdditionalWorkApproval>> => {
      const page = pageParam as number;
      const offset = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('approvals')
        .select('*', { count: 'exact' })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return toPagedResponse<AdditionalWorkApproval>(data as AdditionalWorkApproval[], count, page, pageSize);
    },
    initialPageParam: 1,
    getNextPageParam,
    refetchInterval,
  });
}

export function useCreateOrUpdateApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (approval: AdditionalWorkApproval) => {
      const { data: existing, error: existingError } = await supabase
        .from('approvals')
        .select('task_id')
        .eq('task_id', approval.task_id)
        .maybeSingle();
      if (existingError) throw existingError;

      const { data, error } = await supabase
        .from('approvals')
        .upsert(approval, { onConflict: 'task_id' })
        .select('*')
        .single();
      if (error) throw error;
      return {
        approval: data as AdditionalWorkApproval,
        action: existing ? 'update' : 'create',
      } as const;
    },
    onSuccess: async ({ approval, action }) => {
      await writeAuditLog({
        action,
        entityType: 'approvals',
        entityId: approval.task_id,
        path: `/approvals/${approval.task_id}`,
        method: action === 'create' ? 'POST' : 'PUT',
        statusCode: action === 'create' ? 201 : 200,
        metadata: {
          approved: approval.approved,
          impact: approval.impact,
          approved_by: approval.approved_by,
        },
      });
      queryClient.invalidateQueries({ queryKey: approvalKeys.lists() });
      queryClient.invalidateQueries({ queryKey: approvalKeys.byTask(approval.task_id) });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      toast.success('Approval saved successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save approval');
    },
  });
}
