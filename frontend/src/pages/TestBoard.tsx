import { useMemo, useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { DEFAULT_TEAM } from '@/lib/store';
import { useSprints, useTeamMembers, useTasksBySprint, useUpdateTask, useDebounce } from '@/hooks';
import { QaStatus, Task, TaskStatus, TeamMember } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/multi-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { TaskCommentsDialog } from '@/components/TaskCommentsDialog';
import { TaskDetailsDialog } from '@/components/TaskDetailsDialog';
import { TeamSelect } from '@/components/TeamSelect';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { AlertTriangle, ClipboardCheck, Clock, User, X } from 'lucide-react';

const qaColumns: QaStatus[] = ['Ready to Test', 'Testing', 'Rework', 'Fixing', 'Ready to Stage'];
type TestBoardColumn = QaStatus | 'Blocked';
const testBoardColumns: TestBoardColumn[] = [
  'Ready to Test',
  'Testing',
  'Blocked',
  'Rework',
  'Fixing',
  'Ready to Stage',
];
const doneStatuses: TaskStatus[] = ['Done', 'Fixed', 'Closed'];

const qaStatusBorders: Record<QaStatus, string> = {
  'Ready to Test': 'border-primary',
  'Testing': 'border-warning',
  'Rework': 'border-destructive',
  'Fixing': 'border-status-progress',
  'Ready to Stage': 'border-success',
};
const testBoardBorders: Record<TestBoardColumn, string> = {
  ...qaStatusBorders,
  Blocked: 'border-destructive',
};

const getTestBoardLabel = (status: TestBoardColumn) => {
  if (status === 'Rework') return 'Need to Fix';
  return status;
};

export default function TestBoard() {
  const { user, isManager, isQA } = useAuth();

  // React Query hooks
  const { data: sprints = [], isLoading: sprintsLoading } = useSprints();
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers();
  const updateTaskMutation = useUpdateTask();

  const { teams, selectedTeam, setSelectedTeam } = useTeamSelection(user?.team);
  const isGrcTeam = selectedTeam === 'GRC';
  const moduleLabel = isGrcTeam ? 'Client' : 'Module';
  const teamSprints = sprints.filter((s) => (s.team || DEFAULT_TEAM) === selectedTeam);
  const activeSprint = teamSprints.find(s => s.is_active) || null;
  const [selectedSprintId, setSelectedSprintId] = useState<string>(
    activeSprint?.id || teamSprints[0]?.id || ''
  );
  const selectedSprint = teamSprints.find((s) => s.id === selectedSprintId);

  // Fetch tasks for selected sprint
  const { data: sprintTasks = [], isLoading: tasksLoading } = useTasksBySprint(selectedSprintId || null);

  const teamMembersForTeam = useMemo(
    () => teamMembers.filter((member) => (member.team || DEFAULT_TEAM) === selectedTeam),
    [teamMembers, selectedTeam]
  );
  const [filterOwner, setFilterOwner] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [filterModule, setFilterModule] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<TestBoardColumn[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 250);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const canEditBlocker = isManager || isQA;
  const [pageSize, setPageSize] = useState('12');
  const [currentPage, setCurrentPage] = useState(1);
  const [activeColumn, setActiveColumn] = useState<TestBoardColumn | null>('Ready to Test');
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const hideTeamSelect = (user?.team || '') === 'GRC' && !isSuperAdmin;

  const tasks = useMemo(() => {
    if (!selectedSprint) return [];
    let filteredTasks = [...sprintTasks];

    // Focus on sprint/extra deliverables for QA staging.
    filteredTasks = filteredTasks.filter(
      (t) => t.type === 'Sprint' || t.type === 'Additional' || t.type === 'Backlog'
    );

    filteredTasks = filteredTasks.filter(
      (t) => doneStatuses.includes(t.status as TaskStatus) || Boolean(t.qa_status)
    );

    const qaOwnerIds = new Set(teamMembersForTeam.filter((m) => m.role === 'QA').map((m) => m.id));
    filteredTasks = filteredTasks.filter((t) => !qaOwnerIds.has(t.owner_id));

    if (filterOwner.length > 0) {
      filteredTasks = filteredTasks.filter((t) => filterOwner.includes(t.owner_id));
    }
    if (filterType.length > 0) {
      filteredTasks = filteredTasks.filter((t) => filterType.includes(t.type || ''));
    }
    if (filterModule.length > 0) {
      filteredTasks = filteredTasks.filter((t) => filterModule.includes(t.module || ''));
    }
    if (filterStatus.length > 0) {
      filteredTasks = filteredTasks.filter((t) => {
        const boardStatus = t.blocker ? 'Blocked' : getQaStatus(t);
        return boardStatus ? filterStatus.includes(boardStatus) : false;
      });
    }
    if (debouncedSearch.trim()) {
      const term = debouncedSearch.toLowerCase();
      filteredTasks = filteredTasks.filter(
        (t) =>
          (t.title || '').toLowerCase().includes(term) ||
          (t.module || '').toLowerCase().includes(term) ||
          (t.description || '').toLowerCase().includes(term)
      );
    }
    return filteredTasks;
  }, [sprintTasks, selectedSprint, filterOwner, filterType, filterModule, filterStatus, debouncedSearch, teamMembersForTeam]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSprintId, filterOwner, filterType, filterModule, filterStatus, debouncedSearch, teamMembersForTeam]);

  useEffect(() => {
    if (teamSprints.length === 0) {
      if (selectedSprintId) setSelectedSprintId('');
      return;
    }
    if (!teamSprints.some((s) => s.id === selectedSprintId)) {
      setSelectedSprintId(activeSprint?.id || teamSprints[0]?.id || '');
    }
  }, [teamSprints, activeSprint?.id, selectedSprintId]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TestBoardColumn, Task[]> = {
      'Ready to Test': [],
      'Testing': [],
      'Rework': [],
      'Fixing': [],
      'Ready to Stage': [],
      Blocked: [],
    };

    tasks.forEach((task) => {
      if (task.blocker) {
        grouped.Blocked.push(task);
        return;
      }
      const qaStatus = getQaStatus(task);
      if (!qaStatus) return;
      grouped[qaStatus].push(task);
    });
    return grouped;
  }, [tasks]);

  const pageSizeValue = Number.parseInt(pageSize, 10) || 12;
  const maxColumnCount = Math.max(0, ...testBoardColumns.map((status) => tasksByStatus[status].length));
  const totalPages = Math.max(1, Math.ceil(maxColumnCount / pageSizeValue));
  const clampedPage = Math.min(currentPage, totalPages);
  const pageStart = (clampedPage - 1) * pageSizeValue;
  const pageEnd = pageStart + pageSizeValue;

  const pagedTasksByStatus = useMemo(() => {
    const paged: Record<TestBoardColumn, Task[]> = {
      'Ready to Test': [],
      'Testing': [],
      'Rework': [],
      'Fixing': [],
      'Ready to Stage': [],
      Blocked: [],
    };
    testBoardColumns.forEach((status) => {
      paged[status] = tasksByStatus[status].slice(pageStart, pageEnd);
    });
    return paged;
  }, [tasksByStatus, pageStart, pageEnd]);

  const handleDragStart = (task: Task) => {
    setDraggedTask(task);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (status: TestBoardColumn) => {
    if (!draggedTask) return;
    if (status === 'Blocked') return;
    const currentStatus = getQaStatus(draggedTask);
    const isSameStatus = currentStatus === status;
    const nextTask = {
      ...draggedTask,
      qa_status: status,
      ...(draggedTask.blocker ? { blocker: null, blocker_date: null } : {}),
    };
    if (isSameStatus && !draggedTask.blocker) {
      setDraggedTask(null);
      return;
    }
    updateTaskMutation.mutate(nextTask);
    setDraggedTask(null);
  };

  const handleUpdateBlocker = (task: Task, blocker: string | undefined) => {
    if (!canEditBlocker) return;
    const normalizedBlocker = typeof blocker === 'string' && blocker.trim() ? blocker.trim() : null;
    const updatedTask = {
      ...task,
      blocker: normalizedBlocker,
      blocker_date: normalizedBlocker ? new Date().toISOString() : null,
    };
    updateTaskMutation.mutate(updatedTask);
  };

  const handleOpenDetails = (task: Task) => {
    setDetailTask(task);
  };

  if (sprintsLoading || membersLoading || tasksLoading) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Test Board</h1>
            <p className="text-muted-foreground">{selectedSprint?.sprint_name || 'Select a sprint'}</p>
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

          <Select value={selectedSprintId} onValueChange={setSelectedSprintId} disabled={teamSprints.length === 0}>
            <SelectTrigger className="w-48">
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

        <div className="flex items-center gap-3">
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
                    options={teamMembersForTeam.map((m) => ({ label: m.name, value: m.id }))}
                    value={filterOwner}
                    onChange={setFilterOwner}
                  />

                  <MultiSelect
                    variant="inline"
                    label="Type"
                    allLabel="All Types"
                    options={[
                      { label: 'Sprint', value: 'Sprint' },
                      { label: 'Additional', value: 'Additional' },
                      { label: 'Backlog', value: 'Backlog' },
                    ]}
                    value={filterType}
                    onChange={setFilterType}
                  />

                  <MultiSelect
                    variant="inline"
                    label={moduleLabel}
                    allLabel={`All ${moduleLabel}s`}
                    options={Array.from(
                      new Set(
                        sprintTasks
                          .map((t) => t.module || '')
                          .filter(Boolean)
                      )
                    ).map((mod) => ({
                      label: mod || 'Unspecified',
                      value: mod,
                    }))}
                    value={filterModule}
                    onChange={setFilterModule}
                  />

                  <MultiSelect
                    variant="inline"
                    label="Status"
                    allLabel="All Statuses"
                    options={testBoardColumns.map((status) => ({
                      label: getTestBoardLabel(status),
                      value: status,
                    }))}
                    value={filterStatus}
                    onChange={(value) => setFilterStatus(value as TestBoardColumn[])}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks..."
            className="w-48"
            aria-label="Search QA tasks"
          />

        </div>
      </div>

      {selectedSprint ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:gap-4">
          {testBoardColumns.map((status) => (
            <div
              key={status}
              className={`space-y-3 xl:flex xl:flex-col xl:transition-all ${
                activeColumn === status
                  ? 'xl:flex-[2_1_0%] xl:min-w-[260px]'
                  : activeColumn
                    ? 'xl:flex-[0.7_1_0%] xl:min-w-[180px]'
                    : 'xl:flex-1 xl:min-w-[200px]'
              }`}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(status)}
            >
              <button
                type="button"
                onClick={() => setActiveColumn((prev) => (prev === status ? null : status))}
                className={`flex items-center justify-between rounded-md px-1 py-1 text-left transition ${
                  activeColumn === status ? 'bg-secondary/40' : 'hover:bg-secondary/30'
                }`}
                aria-pressed={activeColumn === status}
              >
                <h3 className="font-medium text-sm">{getTestBoardLabel(status)}</h3>
                <Badge variant="outline" className="text-xs">
                  {tasksByStatus[status].length}
                </Badge>
              </button>

              <div
                className={`min-h-[500px] p-2 rounded-lg bg-secondary/30 space-y-2 border-t-2 ${testBoardBorders[status]}`}
              >
                {pagedTasksByStatus[status].map((task) => (
                  <TestTaskCard
                    key={task.id}
                    task={task}
                    teamMembers={teamMembersForTeam}
                    onDragStart={() => handleDragStart(task)}
                    onRefresh={() => {/* React Query handles cache invalidation */}}
                    onUpdateBlocker={handleUpdateBlocker}
                    canEditBlocker={canEditBlocker}
                    onOpenDetails={() => handleOpenDetails(task)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {teamSprints.length === 0
              ? `No sprints for ${selectedTeam}. Create one from the Dashboard.`
              : 'Select a sprint to view the board.'}
          </CardContent>
        </Card>
      )}

      {detailTask && (
        <TaskDetailsDialog
          task={detailTask}
          open={Boolean(detailTask)}
          onOpenChange={(open) => {
            if (!open) setDetailTask(null);
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {tasks.length === 0
              ? '0'
              : `Page ${clampedPage} of ${totalPages} · ${tasks.length} total`}
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
            <SelectValue placeholder="Cards" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="8">8 cards</SelectItem>
            <SelectItem value="12">12 cards</SelectItem>
            <SelectItem value="24">24 cards</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function getQaStatus(task: Task): QaStatus | null {
  const status = task.qa_status;
  if (status && qaColumns.includes(status)) {
    return status;
  }
  if (doneStatuses.includes(task.status as TaskStatus)) {
    return 'Ready to Test';
  }
  return null;
}

function TestTaskCard({
  task,
  teamMembers,
  onDragStart,
  onRefresh,
  onUpdateBlocker,
  canEditBlocker,
  onOpenDetails,
}: {
  task: Task;
  teamMembers: TeamMember[];
  onDragStart: () => void;
  onRefresh: () => void;
  onUpdateBlocker: (task: Task, blocker: string | undefined) => void;
  canEditBlocker: boolean;
  onOpenDetails: () => void;
}) {
  const formatHours = (value: number) => {
    if (!value) return '0';
    const rounded = Math.round(value * 100) / 100;
    const text = rounded.toFixed(2);
    return text.replace(/\.?0+$/, '');
  };
  const [blockerPopoverOpen, setBlockerPopoverOpen] = useState(false);
  const [blockerValue, setBlockerValue] = useState(task.blocker || '');
  const owner = teamMembers.find((m) => m.id === task.owner_id);
  const actualHoursValue = task.actual_hours ?? 0;
  const qaHoursValue = task.qa_actual_hours ?? 0;
  const fixingHoursValue = task.qa_fixing_hours ?? 0;
  const blockedHoursValue = task.blocked_hours ?? 0;
  const testBoardTotalHours = qaHoursValue + fixingHoursValue + blockedHoursValue;
  const qaStatusLabel = getQaStatus(task) || 'Ready to Test';
  const currentBoard = task.blocker ? 'Blocked' : qaStatusLabel;
  let currentTimeLabel = '';
  let currentTimeValue = 0;
  if (currentBoard === 'Blocked') {
    currentTimeLabel = 'Blocked';
    currentTimeValue = blockedHoursValue;
  } else if (currentBoard === 'Testing') {
    currentTimeLabel = 'Testing';
    currentTimeValue = qaHoursValue;
  } else if (currentBoard === 'Fixing') {
    currentTimeLabel = 'Fixing';
    currentTimeValue = fixingHoursValue;
  } else if (currentBoard === 'Ready to Stage') {
    currentTimeLabel = 'Total';
    currentTimeValue = testBoardTotalHours;
  }
  const showTime = Boolean(currentTimeLabel);
  const canSubmitBlocker = Boolean(blockerValue.trim());
  const handleBlockerSubmit = () => {
    if (!blockerValue.trim()) return;
    onUpdateBlocker(task, blockerValue.trim() || undefined);
    setBlockerPopoverOpen(false);
  };

  const handleRemoveBlocker = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateBlocker(task, undefined);
    setBlockerValue('');
  };

  return (
    <Card
      className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow break-words"
      draggable
      onDragStart={onDragStart}
    >
      <CardContent className="p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetails();
              }}
              className="text-left text-sm font-semibold leading-tight hover:underline break-words whitespace-normal"
            >
              {task.title}
            </button>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <Badge variant="outline" className="text-[10px]">
                {task.type}
              </Badge>
              {task.module && <span className="truncate max-w-[140px]">{task.module}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {showTime && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>
                      {currentTimeLabel} {formatHours(currentTimeValue)}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="space-y-1">
                  {qaHoursValue > 0 && (
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <span>Testing</span>
                      <span>{formatHours(qaHoursValue)}</span>
                    </div>
                  )}
                  {fixingHoursValue > 0 && (
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <span>Fixing</span>
                      <span>{formatHours(fixingHoursValue)}</span>
                    </div>
                  )}
                  {blockedHoursValue > 0 && (
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <span>Blocked</span>
                      <span>{formatHours(blockedHoursValue)}</span>
                    </div>
                  )}
                  {testBoardTotalHours > 0 && (
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <span>Total</span>
                      <span>{formatHours(testBoardTotalHours)}</span>
                    </div>
                  )}
                  {!qaHoursValue && !fixingHoursValue && !blockedHoursValue && (
                    <div className="text-xs text-muted-foreground">No time tracked yet</div>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            <Badge variant="secondary" className="text-[10px]">
              {task.status}
            </Badge>
          </div>
        </div>

        {task.blocker ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate flex-1">{task.blocker}</span>
            {canEditBlocker && (
              <button
                onClick={handleRemoveBlocker}
                className="hover:bg-destructive/20 rounded p-0.5"
                title="Remove blocker"
                aria-label="Remove blocker"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : canEditBlocker ? (
          <Popover open={blockerPopoverOpen} onOpenChange={setBlockerPopoverOpen}>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <AlertTriangle className="h-3 w-3" />
                <span>Move to Blocked</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start">
              <div className="space-y-2">
                <Textarea
                  value={blockerValue}
                  onChange={(e) => setBlockerValue(e.target.value)}
                  placeholder="Describe the blocker..."
                  className="min-h-16 text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleBlockerSubmit} className="flex-1" disabled={!canSubmitBlocker}>
                    Move to Blocked
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setBlockerPopoverOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <User className="h-3 w-3" />
            <span>{owner?.name || 'Unassigned'}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <ClipboardCheck className="h-3 w-3" />
            <span>{getTestBoardLabel(qaStatusLabel)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <TaskCommentsDialog task={task} onCommentAdded={onRefresh} />
          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-foreground">
            SP: {task.estimated_hours}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
