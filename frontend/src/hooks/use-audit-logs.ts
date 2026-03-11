import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiGetJson } from '@/lib/api';
import { getNextPageParam, PaginatedResponse, toPagedResponse } from '@/lib/pagination';
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
    queryFn: async (): Promise<PaginatedResponse<AuditLog>> => {
      const response = await apiGetJson<PaginatedResponse<AuditLog> | AuditLog[]>('/audit-logs', {
        page,
        page_size: pageSize,
      });
      if (Array.isArray(response)) {
        return toPagedResponse<AuditLog>(response, response.length, page, pageSize);
      }
      return response;
    },
    refetchInterval,
  });
}

export function useAuditLogsInfinite(pageSize = 50) {
  const refetchInterval = useSmartPolling({ activeInterval: 30000, idleInterval: 120000, inactiveInterval: false });
  return useInfiniteQuery({
    queryKey: auditLogKeys.infinite(pageSize),
    queryFn: async ({ pageParam = 1 }): Promise<PaginatedResponse<AuditLog>> => {
      const page = pageParam as number;
      const response = await apiGetJson<PaginatedResponse<AuditLog> | AuditLog[]>('/audit-logs', {
        page,
        page_size: pageSize,
      });
      if (Array.isArray(response)) {
        return toPagedResponse<AuditLog>(response, response.length, page, pageSize);
      }
      return response;
    },
    initialPageParam: 1,
    getNextPageParam,
    refetchInterval,
  });
}
