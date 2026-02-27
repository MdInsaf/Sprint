import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { DEFAULT_TEAM } from '@/lib/store';
import { useSprints, useTeamMembers, useTasksBySprint, useDebounce } from '@/hooks';
import { QaStatus, Task, TaskStatus } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TeamSelect } from '@/components/TeamSelect';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { AlertTriangle, ClipboardCheck, FlaskConical, RefreshCcw, TestTube2 } from 'lucide-react';

type QaBoardStatus = QaStatus | 'Blocked';
type SummaryStatus = 'Ready to Test' | 'Testing' | 'Blocked' | 'Rework' | 'Ready to Stage';
const doneStatuses: TaskStatus[] = ['Done', 'Fixed', 'Closed'];

const summaryStatusIcons: Record<SummaryStatus, React.ReactNode> = {
  'Ready to Test': <ClipboardCheck className="h-4 w-4" />,
  Testing: <TestTube2 className="h-4 w-4" />,
  Rework: <RefreshCcw className="h-4 w-4" />,
  'Ready to Stage': <FlaskConical className="h-4 w-4" />,
  Blocked: <AlertTriangle className="h-4 w-4" />,
};

const qaStatusOrder: QaBoardStatus[] = [
  'Ready to Test',
  'Testing',
  'Blocked',
  'Rework',
  'Fixing',
  'Ready to Stage',
];

const summaryStatusOrder: SummaryStatus[] = [
  'Ready to Test',
  'Testing',
  'Blocked',
  'Rework',
  'Ready to Stage',
];

function getQaStatus(task: Task): QaBoardStatus | null {
  if (task.blocker) return 'Blocked';
  const status = task.qa_status;
  if (status && qaStatusOrder.includes(status)) {
    return status;
  }
  if (doneStatuses.includes(task.status as TaskStatus)) {
    return 'Ready to Test';
  }
  return null;
}

function getSummaryStatus(task: Task): SummaryStatus | null {
  const status = getQaStatus(task);
  if (!status) return null;
  if (status === 'Fixing') return 'Rework';
  return status as SummaryStatus;
}

export default function TestSummary() {
  const { user } = useAuth();
  const { data: sprints = [], isLoading: sprintsLoading } = useSprints();
  const { teams, selectedTeam, setSelectedTeam } = useTeamSelection(user?.team);
  const teamSprints = sprints.filter((s) => (s.team || DEFAULT_TEAM) === selectedTeam);
  const activeSprint = sprints.find(s => s.is_active && (s.team || DEFAULT_TEAM) === selectedTeam) || null;
  const [selectedSprintId, setSelectedSprintId] = useState<string>(
    activeSprint?.id || teamSprints[0]?.id || ''
  );
  const selectedSprint = teamSprints.find((s) => s.id === selectedSprintId);
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers();
  const teamMembersForTeam = teamMembers.filter(
    (member) => (member.team || DEFAULT_TEAM) === selectedTeam
  );
  const [filterOwner, setFilterOwner] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<SummaryStatus[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 250);
  const [pageSize, setPageSize] = useState('10');
  const [currentPage, setCurrentPage] = useState(1);
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const hideTeamSelect = (user?.team || '') === 'GRC' && !isSuperAdmin;

  const { data: sprintTasks = [], isLoading: tasksLoading } = useTasksBySprint(selectedSprintId || null);

  const isLoading = sprintsLoading || membersLoading || tasksLoading;

  const qaTasks = useMemo(() => {
    if (!selectedSprint) return [];
    let items = [...sprintTasks];

    // Focus on sprint/extra deliverables for QA staging.
    items = items.filter(
      (t) => t.type === 'Sprint' || t.type === 'Additional' || t.type === 'Backlog'
    );

    // Only show tasks that are in QA pipeline.
    items = items.filter(
      (t) => doneStatuses.includes(t.status as TaskStatus) || Boolean(t.qa_status) || Boolean(t.blocker)
    );

    const qaOwnerIds = new Set(teamMembersForTeam.filter((m) => m.role === 'QA').map((m) => m.id));
    items = items.filter((t) => !qaOwnerIds.has(t.owner_id));

    if (filterOwner.length > 0) {
      items = items.filter((t) => filterOwner.includes(t.owner_id));
    }
    if (filterStatus.length > 0) {
      items = items.filter((t) => {
        const summaryStatus = getSummaryStatus(t);
        return summaryStatus ? filterStatus.includes(summaryStatus) : false;
      });
    }
    if (debouncedSearch.trim()) {
      const term = debouncedSearch.toLowerCase();
      items = items.filter(
        (t) =>
          (t.title || '').toLowerCase().includes(term) ||
          (t.module || '').toLowerCase().includes(term) ||
          (t.description || '').toLowerCase().includes(term)
      );
    }
    return items;
  }, [selectedSprint, sprintTasks, filterOwner, filterStatus, debouncedSearch, teamMembersForTeam]);

  const counts = useMemo(() => {
    const grouped: Record<SummaryStatus, number> = {
      'Ready to Test': 0,
      Testing: 0,
      Rework: 0,
      'Ready to Stage': 0,
      Blocked: 0,
    };
    qaTasks.forEach((task) => {
      const status = getSummaryStatus(task);
      if (status) grouped[status] += 1;
    });
    return grouped;
  }, [qaTasks]);

  const total = qaTasks.length;
  const readyToStage = counts['Ready to Stage'];
  const progress = total > 0 ? Math.round((readyToStage / total) * 100) : 0;

  const byOwner = useMemo(() => {
    const map: Record<string, number> = {};
    qaTasks.forEach((task) => {
      const ownerId = task.owner_id || 'unassigned';
      map[ownerId] = (map[ownerId] || 0) + 1;
    });
    return Object.entries(map)
      .map(([ownerId, count]) => ({
        ownerId,
        ownerName: teamMembersForTeam.find((m) => m.id === ownerId)?.name || 'Unassigned',
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [qaTasks, teamMembersForTeam]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSprintId, filterOwner, filterStatus, debouncedSearch]);

  useEffect(() => {
    if (teamSprints.length === 0) {
      if (selectedSprintId) setSelectedSprintId('');
      return;
    }
    if (!teamSprints.some((s) => s.id === selectedSprintId)) {
      setSelectedSprintId(activeSprint?.id || teamSprints[0]?.id || '');
    }
  }, [teamSprints, activeSprint?.id, selectedSprintId]);

  const sortedQaTasks = useMemo(
    () =>
      qaTasks
        .slice()
        .sort((a, b) => (b.closed_date || b.created_date || '').localeCompare(a.closed_date || a.created_date || '')),
    [qaTasks]
  );

  const pageSizeValue = Number.parseInt(pageSize, 10) || 10;
  const totalPages = Math.max(1, Math.ceil(sortedQaTasks.length / pageSizeValue));
  const clampedPage = Math.min(currentPage, totalPages);
  const pageStart = (clampedPage - 1) * pageSizeValue;
  const pageEnd = pageStart + pageSizeValue;
  const pagedQaTasks = sortedQaTasks.slice(pageStart, pageEnd);

  if (isLoading) return null;

  if (sprints.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Test Summary</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No sprints available. Create a sprint from the Dashboard.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (teamSprints.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Test Summary</h1>
            <p className="text-muted-foreground">Select a team to view QA progress.</p>
          </div>
          {!hideTeamSelect && (
            <TeamSelect
              teams={teams}
              value={selectedTeam}
              onChange={setSelectedTeam}
              triggerClassName="w-40"
              placeholder="Team"
            />
          )}
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No sprints for {selectedTeam}.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Test Summary</h1>
            <p className="text-muted-foreground">
              {selectedSprint?.sprint_name || 'Select a sprint'} - QA pipeline overview
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!hideTeamSelect && (
              <TeamSelect
                teams={teams}
                value={selectedTeam}
                onChange={setSelectedTeam}
                triggerClassName="w-40"
                placeholder="Team"
              />
            )}
            <Select value={selectedSprintId} onValueChange={setSelectedSprintId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select Sprint" />
              </SelectTrigger>
              <SelectContent>
                {teamSprints.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.sprint_name} {s.is_active && '(Active)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Filters</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0">
              <div className="max-h-[70vh] overflow-y-auto">
                <div className="space-y-4 p-4 pr-5">
                  <MultiSelect
                    variant="inline"
                    label="Owner"
                    allLabel="All Owners"
                    options={teamMembersForTeam
                      .filter((m) =>
                        m.role === 'Developer' ||
                        m.role === 'Associate' ||
                        m.role === 'Security' ||
                        m.role === 'Manager'
                      )
                      .map((m) => ({ label: m.name, value: m.id }))}
                    value={filterOwner}
                    onChange={setFilterOwner}
                  />

                  <MultiSelect
                    variant="inline"
                    label="Status"
                    allLabel="All Statuses"
                    options={summaryStatusOrder.map((status) => ({ label: status, value: status }))}
                    value={filterStatus}
                    onChange={(value) => setFilterStatus(value as SummaryStatus[])}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tasks..."
          className="w-full md:w-52"
          aria-label="Search QA tasks"
        />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {summaryStatusOrder.map((status) => (
          <Card key={status}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-secondary">
                  {summaryStatusIcons[status]}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{status}</p>
                  <p className="text-2xl font-semibold">{counts[status]}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ready to Stage Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Ready to Stage</span>
            <span className="font-medium">
              {readyToStage} / {total}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground">{progress}% of QA items ready to stage</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">By Owner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {byOwner.length === 0 ? (
              <div className="text-sm text-muted-foreground">No QA items found.</div>
            ) : (
              byOwner.map((row) => (
                <div
                  key={row.ownerId}
                  className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{row.ownerName}</span>
                  <Badge variant="outline">{row.count}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent QA Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pagedQaTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground">No QA items yet.</div>
            ) : (
              pagedQaTasks.map((task) => {
                const owner = teamMembersForTeam.find((m) => m.id === task.owner_id)?.name || 'Unassigned';
                const qaStatus = getSummaryStatus(task);
                return (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-secondary/50"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{task.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.module || 'Unspecified'} | {owner}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Dev (Fixing) {task.qa_fixing_hours ?? 0}h - QA (Testing) {task.qa_actual_hours ?? 0}h
                      </p>
                    </div>
                    <Badge variant={qaStatus === 'Blocked' ? 'destructive' : 'outline'}>
                      {qaStatus || 'Ready to Test'}
                    </Badge>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {sortedQaTasks.length === 0
              ? '0'
              : `${pageStart + 1}-${Math.min(pageEnd, sortedQaTasks.length)}`} of {sortedQaTasks.length}
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
