import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiGetJson } from '@/lib/api';
import { getNextPageParam, PaginatedResponse } from '@/lib/pagination';
import { AuditLog } from '@/types';
import { useSmartPolling } from './use-smart-polling';

export const auditLogKeys = {
  all: ['audit-logs'] as const,
  lists: () => [...auditLogKeys.all, 'list'] as const,
  page: (page: number, pageSize: number) => [...auditLogKeys.all, 'page', page, pageSize] as const,
  infinite: (pageSize: number) => [...auditLogKeys.all, 'infinite', pageSize] as const,
};

async function fetchAuditLogsPage(page: number, pageSize: number): Promise<PaginatedResponse<AuditLog>> {
  return apiGetJson<PaginatedResponse<AuditLog>>('/audit-logs', {
    page,
    page_size: pageSize,
  });
}

export function useAuditLogsPage(page: number, pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useQuery({
    queryKey: auditLogKeys.page(page, pageSize),
    queryFn: async (): Promise<PaginatedResponse<AuditLog>> => fetchAuditLogsPage(page, pageSize),
    refetchInterval,
  });
}

export function useAuditLogsInfinite(pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useInfiniteQuery({
    queryKey: auditLogKeys.infinite(pageSize),
    queryFn: async ({ pageParam = 1 }): Promise<PaginatedResponse<AuditLog>> =>
      fetchAuditLogsPage(pageParam as number, pageSize),
    initialPageParam: 1,
    getNextPageParam,
    refetchInterval,
  });
}
