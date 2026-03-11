import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
      const offset = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('audit_logs')
        .select('*, user:team_members(id,name,username,email,role,avatar,team,leave_dates)', { count: 'exact' })
        .order('created_date', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return toPagedResponse<AuditLog>(data as AuditLog[], count, page, pageSize);
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
      const offset = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('audit_logs')
        .select('*, user:team_members(id,name,username,email,role,avatar,team,leave_dates)', { count: 'exact' })
        .order('created_date', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      return toPagedResponse<AuditLog>(data as AuditLog[], count, page, pageSize);
    },
    initialPageParam: 1,
    getNextPageParam,
    refetchInterval,
  });
}
