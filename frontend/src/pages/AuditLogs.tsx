import { useEffect, useMemo, useState } from 'react';
import { useAuditLogsPage, useDebounce } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

const actionOptions = ['all', 'create', 'update', 'delete'] as const;

export default function AuditLogs() {
  const [pageSize, setPageSize] = useState('20');
  const [currentPage, setCurrentPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<(typeof actionOptions)[number]>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 250);

  const pageSizeValue = Number.parseInt(pageSize, 10) || 20;
  const { data, isLoading } = useAuditLogsPage(currentPage, pageSizeValue);

  const logs = data?.results ?? [];
  const totalCount = data?.count ?? logs.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSizeValue));
  const clampedPage = Math.min(currentPage, totalPages);
  const pageStart = (clampedPage - 1) * pageSizeValue;
  const pageEnd = pageStart + logs.length;

  const filteredLogs = useMemo(() => {
    let items = [...logs];
    if (actionFilter !== 'all') {
      items = items.filter((log) => log.action === actionFilter);
    }
    if (debouncedSearch.trim()) {
      const term = debouncedSearch.toLowerCase();
      items = items.filter((log) => {
        const userText = `${log.user?.name || ''} ${log.user?.email || ''}`.toLowerCase();
        return (
          log.action.toLowerCase().includes(term) ||
          (log.entity_type || '').toLowerCase().includes(term) ||
          (log.entity_id || '').toLowerCase().includes(term) ||
          (log.path || '').toLowerCase().includes(term) ||
          userText.includes(term)
        );
      });
    }
    return items;
  }, [actionFilter, debouncedSearch, logs]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize]);

  const formatDate = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString();
  };

  const actionVariant = (action: string) => {
    if (action === 'delete') return 'destructive';
    if (action === 'update') return 'warning';
    if (action === 'create') return 'success';
    return 'secondary';
  };

  const statusVariant = (statusCode: number) => {
    if (statusCode >= 500) return 'destructive';
    if (statusCode >= 400) return 'destructive';
    if (statusCode >= 300) return 'warning';
    return 'secondary';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit Logs</h1>
          <p className="text-muted-foreground">Track recent changes across the workspace.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={actionFilter} onValueChange={(value) => setActionFilter(value as typeof actionFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              {actionOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === 'all' ? 'All actions' : option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by user, entity, path..."
            className="w-64"
            aria-label="Search audit logs"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Path</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Loading audit logs...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filteredLogs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No audit logs found.
                  </TableCell>
                </TableRow>
              )}
              {filteredLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(log.created_date)}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{log.user?.name || 'System'}</div>
                    <div className="text-xs text-muted-foreground">{log.user?.email || '-'}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={actionVariant(log.action)}>{log.action}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{log.entity_type || 'unknown'}</div>
                    <div className="text-xs text-muted-foreground">{log.entity_id || '-'}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(log.status_code)}>{log.status_code}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate max-w-[220px]" title={log.path}>
                    {log.path}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {filteredLogs.length === 0
              ? '0'
              : `${pageStart + 1}-${Math.min(pageEnd, totalCount)}`} of {totalCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={clampedPage === 1}
            className="bg-slate-900 text-white hover:bg-slate-800 border-slate-900 disabled:bg-slate-900/40 disabled:text-white/60"
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={clampedPage === totalPages}
            className="bg-slate-900 text-white hover:bg-slate-800 border-slate-900 disabled:bg-slate-900/40 disabled:text-white/60"
          >
            Next
          </Button>
        </div>

        <Select value={pageSize} onValueChange={setPageSize}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder="Rows" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10 rows</SelectItem>
            <SelectItem value="20">20 rows</SelectItem>
            <SelectItem value="50">50 rows</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
