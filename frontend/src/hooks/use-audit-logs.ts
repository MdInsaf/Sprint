import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { appendPaginationParams, getNextPageParam, PaginatedResponse } from '@/lib/pagination';
import { AuditLog } from '@/types';
import { useSmartPolling } from './use-smart-polling';

export const auditLogKeys = {
  all: ['audit-logs'] as const,
  lists: () => [...auditLogKeys.all, 'list'] as const,
  page: (page: number, pageSize: number) => [...auditLogKeys.all, 'page', page, pageSize] as const,
  infinite: (pageSize: number) => [...auditLogKeys.all, 'infinite', pageSize] as const,
};

export function useAuditLogsPage(page: number, pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useQuery({
    queryKey: auditLogKeys.page(page, pageSize),
    queryFn: () =>
      apiRequest<PaginatedResponse<AuditLog>>(appendPaginationParams('/audit-logs', page, pageSize)),
    refetchInterval,
  });
}

export function useAuditLogsInfinite(pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useInfiniteQuery({
    queryKey: auditLogKeys.infinite(pageSize),
    queryFn: ({ pageParam = 1 }) =>
      apiRequest<PaginatedResponse<AuditLog>>(appendPaginationParams('/audit-logs', pageParam, pageSize)),
    initialPageParam: 1,
    getNextPageParam,
    refetchInterval,
  });
}
