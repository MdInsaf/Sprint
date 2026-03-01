import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAnnouncer } from '@/context/AnnouncerContext';
import { DEFAULT_TEAM } from '@/lib/store';
import { useSprints, useTeamMembers, useTasks, useUpdateTask, useDebounce } from '@/hooks';
import { Task, TaskStatus, TeamMember } from '@/types';
import { KeyboardDraggable } from '@/components/KeyboardDraggable';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { MultiSelect } from '@/components/ui/multi-select';
import { QuickAddTaskDialog } from '@/components/QuickAddTaskDialog';
import { TaskCommentsDialog } from '@/components/TaskCommentsDialog';
import { TaskDetailsDialog } from '@/components/TaskDetailsDialog';
import { TeamSelect } from '@/components/TeamSelect';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { toHours } from '@/lib/time';
import { AlertTriangle, User, Clock, X } from 'lucide-react';
import { toast } from 'sonner';

const statusColumns: TaskStatus[] = ['To Do', 'In Progress', 'Blocked', 'Done'];
const DONE_STATUSES: TaskStatus[] = ['Done', 'Closed', 'Fixed'];
type SprintBoardColumn = TaskStatus | 'Backlog';

const statusColors: Record<TaskStatus, string> = {
  'To Do': 'border-status-todo',
  'In Progress': 'border-status-progress',
  'Blocked': 'border-status-blocked',
  'Done': 'border-status-done',
};

export default function SprintBoard() {
  const { user, isManager } = useAuth();
  const { announce } = useAnnouncer();

  // React Query hooks for data fetching
  const { data: sprints = [], isLoading: sprintsLoading } = useSprints();
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers();
  const updateTaskMutation = useUpdateTask();

  const { teams, selectedTeam, setSelectedTeam } = useTeamSelection(user?.team);
  const teamSprints = sprints.filter((s) => (s.team || DEFAULT_TEAM) === selectedTeam);
  const activeSprint = teamSprints.find(s => s.is_active) || null;

  const [selectedSprintId, setSelectedSprintId] = useState<string>(
    activeSprint?.id || teamSprints[0]?.id || ''
  );
  const selectedSprint = teamSprints.find((s) => s.id === selectedSprintId);

  // Fetch ALL tasks in parallel with sprints (avoids waterfall)
  const { data: allTasks = [], isLoading: tasksLoading, error: tasksError } = useTasks();
  const sprintTasks = useMemo(
    () => allTasks.filter(t => t.sprint_id === selectedSprintId),
    [allTasks, selectedSprintId]
  );

  const teamMembersForTeam = teamMembers.filter(
    (member) => (member.team || DEFAULT_TEAM) === selectedTeam
  );
  const teamMemberIds = useMemo(
    () => new Set(teamMembersForTeam.map((member) => member.id)),
    [teamMembersForTeam]
  );
  const [filterOwner, setFilterOwner] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [filterModule, setFilterModule] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 250);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [pageSize, setPageSize] = useState('12');
  const [currentPage, setCurrentPage] = useState(1);
  const [activeColumn, setActiveColumn] = useState<SprintBoardColumn | null>(null);
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const hideTeamSelect = ['GRC', 'Ascenders'].includes(user?.team || '') && !isSuperAdmin;
  const isGrcTeam = ['GRC', 'Ascenders'].includes(selectedTeam);
  const moduleLabel = isGrcTeam ? 'Client' : 'Module';

  // Keyboard drag-drop targets for accessibility
  const keyboardDropTargets = useMemo(() => [
    { id: 'Backlog', label: 'Backlog' },
    ...statusColumns.map(s => ({ id: s, label: s })),
  ], []);

  const handleKeyboardDrop = (task: Task, targetId: string) => {
    if (targetId === 'Backlog') {
      handleDropToBacklogForTask(task);
    } else {
      handleDropForTask(task, targetId as TaskStatus);
    }
  };

  const getColumnClass = (column: SprintBoardColumn) => {
    const isBacklogColumn = column === 'Backlog';
    if (activeColumn === column) {
      return 'xl:flex-[1.5_1_0%] xl:min-w-[240px]';
    }
    if (activeColumn) {
      return isBacklogColumn
        ? 'xl:flex-[0.6_1_0%] xl:min-w-[170px]'
        : 'xl:flex-[0.9_1_0%] xl:min-w-[175px]';
    }
    return isBacklogColumn
      ? 'xl:flex-[0.65_1_0%] xl:min-w-[175px]'
      : 'xl:flex-1 xl:min-w-[210px]';
  };

  const tasks = useMemo(() => {
    let filteredTasks = [...sprintTasks];

    // Only show core sprint/extra tasks here; bugs/changes are handled in the Bugs board.
    filteredTasks = filteredTasks.filter(
      (t) => t.type === 'Sprint' || t.type === 'Additional' || t.type === 'Backlog'
    );

    if (filterOwner.length > 0) {
      filteredTasks = filteredTasks.filter((t) => filterOwner.includes(t.owner_id));
    }
    if (filterType.length > 0) {
      filteredTasks = filteredTasks.filter((t) => filterType.includes(t.type));
    }
    if (filterModule.length > 0) {
      filteredTasks = filteredTasks.filter((t) => filterModule.includes(t.module || ''));
    }
    if (filterStatus.length > 0) {
      filteredTasks = filteredTasks.filter((t) => filterStatus.includes(t.status || ''));
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
  }, [sprintTasks, filterOwner, filterType, filterModule, filterStatus, debouncedSearch]);

  const backlogTasks = useMemo(() => {
    if (!selectedTeam) return [];
    let items = allTasks.filter(
      (task) =>
        !task.sprint_id &&
        !DONE_STATUSES.includes(task.status as TaskStatus) &&
        task.type !== 'Bug' &&
        task.type !== 'Change'
    );
    items = items.filter((task) => teamMemberIds.has(task.owner_id));
    if (filterOwner.length > 0) {
      items = items.filter((task) => filterOwner.includes(task.owner_id));
    }
    if (filterType.length > 0) {
      items = items.filter((task) => filterType.includes(task.type));
    }
    if (filterModule.length > 0) {
      items = items.filter((task) => filterModule.includes(task.module || ''));
    }
    if (filterStatus.length > 0) {
      items = items.filter((task) => filterStatus.includes(task.status || ''));
    }
    if (debouncedSearch.trim()) {
      const term = debouncedSearch.toLowerCase();
      items = items.filter(
        (task) =>
          (task.title || '').toLowerCase().includes(term) ||
          (task.module || '').toLowerCase().includes(term) ||
          (task.description || '').toLowerCase().includes(term)
      );
    }
    return items;
  }, [allTasks, selectedTeam, filterOwner, filterType, filterModule, filterStatus, debouncedSearch, teamMemberIds]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSprintId, filterOwner, filterType, filterModule, filterStatus, debouncedSearch]);

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
    const grouped: Record<TaskStatus, Task[]> = {
      'To Do': [],
      'In Progress': [],
      'Blocked': [],
      'Done': [],
    };
    tasks.forEach(task => {
      const statusKey = grouped[task.status as TaskStatus] ? task.status as TaskStatus : 'To Do';
      grouped[statusKey].push(task);
    });
    return grouped;
  }, [tasks]);

  const pageSizeValue = Number.parseInt(pageSize, 10) || 12;
  const maxColumnCount = Math.max(
    backlogTasks.length,
    ...statusColumns.map((status) => tasksByStatus[status].length)
  );
  const totalPages = Math.max(1, Math.ceil(maxColumnCount / pageSizeValue));
  const clampedPage = Math.min(currentPage, totalPages);
  const pageStart = (clampedPage - 1) * pageSizeValue;
  const pageEnd = pageStart + pageSizeValue;

  const pagedTasksByStatus = useMemo(() => {
    const paged: Record<TaskStatus, Task[]> = {
      'To Do': [],
      'In Progress': [],
      'Blocked': [],
      'Done': [],
    };
    statusColumns.forEach((status) => {
      paged[status] = tasksByStatus[status].slice(pageStart, pageEnd);
    });
    return paged;
  }, [tasksByStatus, pageStart, pageEnd]);

  const pagedBacklogTasks = useMemo(() => backlogTasks.slice(pageStart, pageEnd), [backlogTasks, pageStart, pageEnd]);

  const handleDragStart = (task: Task) => {
    setDraggedTask(task);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (status: TaskStatus) => {
    if (!draggedTask) return;
    const isBacklogItem = !draggedTask.sprint_id;
    if (!isBacklogItem && draggedTask.status === status) {
      setDraggedTask(null);
      return;
    }
    if (isBacklogItem && status === 'Done') {
      toast.error('Backlog items must move to an active sprint status first.');
      setDraggedTask(null);
      return;
    }
    if (status === 'Blocked' && !draggedTask.blocker) {
      setDraggedTask(null);
      return;
    }
    if (!selectedSprint) {
      toast.error('Select a sprint first');
      setDraggedTask(null);
      return;
    }
    const { attachments, ...taskWithoutAttachments } = draggedTask;
    const updatedTask = {
      ...taskWithoutAttachments,
      sprint_id: draggedTask.sprint_id || selectedSprint.id,
      status,
      ...(draggedTask.blocker && status !== 'Blocked'
        ? { blocker: null, blocker_date: null }
        : {}),
    };
    updateTaskMutation.mutate(updatedTask);
    announce(`Task ${draggedTask.title} moved to ${status}.`, 'assertive');
    setDraggedTask(null);
  };

  const handleDropToBacklog = () => {
    if (!draggedTask) return;
    if (DONE_STATUSES.includes(draggedTask.status as TaskStatus)) {
      setDraggedTask(null);
      return;
    }
    const { attachments, ...taskWithoutAttachments } = draggedTask;
    const updatedTask = {
      ...taskWithoutAttachments,
      sprint_id: null,
      status: 'To Do' as const,
    };
    updateTaskMutation.mutate(updatedTask);
    announce(`Task ${draggedTask.title} moved to Backlog.`, 'assertive');
    setDraggedTask(null);
  };

  // Keyboard-accessible variants that accept a task parameter directly
  const handleDropForTask = (task: Task, status: TaskStatus) => {
    const isBacklogItem = !task.sprint_id;
    if (!isBacklogItem && task.status === status) return;
    if (isBacklogItem && status === 'Done') {
      toast.error('Backlog items must move to an active sprint status first.');
      return;
    }
    if (status === 'Blocked' && !task.blocker) return;
    if (!selectedSprint) {
      toast.error('Select a sprint first');
      return;
    }
    const { attachments, ...taskWithoutAttachments } = task;
    const updatedTask = {
      ...taskWithoutAttachments,
      sprint_id: task.sprint_id || selectedSprint.id,
      status,
      ...(task.blocker && status !== 'Blocked'
        ? { blocker: null, blocker_date: null }
        : {}),
    };
    updateTaskMutation.mutate(updatedTask);
  };

  const handleDropToBacklogForTask = (task: Task) => {
    if (DONE_STATUSES.includes(task.status as TaskStatus)) return;
    const { attachments, ...taskWithoutAttachments } = task;
    const updatedTask = {
      ...taskWithoutAttachments,
      sprint_id: null,
      status: 'To Do' as const,
    };
    updateTaskMutation.mutate(updatedTask);
  };

  const handleUpdateBlocker = (task: Task, blocker: string | undefined) => {
    const normalizedBlocker = typeof blocker === 'string' && blocker.trim() ? blocker.trim() : null;
    const { attachments, ...taskWithoutAttachments } = task;
    const updatedTask = {
      ...taskWithoutAttachments,
      blocker: normalizedBlocker,
      blocker_date: normalizedBlocker ? new Date().toISOString() : null,
      status: normalizedBlocker ? 'Blocked' as const : (task.status === 'Blocked' ? 'In Progress' as const : task.status)
    };
    updateTaskMutation.mutate(updatedTask);
  };

  const handleOpenDetails = (task: Task) => {
    setDetailTask(task);
  };

  if (sprintsLoading || membersLoading || tasksLoading) return null;

  // Error state for tasks
  if (tasksError) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-destructive" />
          <p className="text-muted-foreground mb-4">
            Failed to load tasks. Please try again.
          </p>
          <Button onClick={() => window.location.reload()}>
            Reload Page
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Sprint Board</h1>
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
          {!isManager && user && selectedSprint && (
            <QuickAddTaskDialog
              ownerId={user.id}
              team={selectedTeam}
            />
          )}
          
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
                    options={statusColumns.map((state) => ({ label: state, value: state }))}
                    value={filterStatus}
                    onChange={setFilterStatus}
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
            aria-label="Search sprint tasks"
          />

        </div>
      </div>

      {selectedSprint ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:gap-4">
          <div
            role="region"
            aria-label={`Backlog column, ${backlogTasks.length} tasks`}
            className={`space-y-3 xl:flex xl:flex-col xl:transition-all ${getColumnClass('Backlog')}`}
            onDragOver={handleDragOver}
            onDrop={handleDropToBacklog}
          >
            <button
              type="button"
              onClick={() => setActiveColumn((prev) => (prev === 'Backlog' ? null : 'Backlog'))}
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-left transition ${
                activeColumn === 'Backlog'
                  ? 'bg-slate-900/10 shadow-sm'
                  : 'hover:bg-secondary/30'
              }`}
              aria-pressed={activeColumn === 'Backlog'}
            >
              <h3 className="font-medium text-sm">Backlog</h3>
              <Badge variant="outline" className="text-xs">
                {backlogTasks.length}
              </Badge>
            </button>
            <div className="min-h-[500px] p-2 rounded-lg bg-slate-900/10 space-y-2 border-2 border-solid border-foreground shadow-sm">
              {pagedBacklogTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  teamMembers={teamMembers}
                  onDragStart={() => handleDragStart(task)}
                  onUpdateBlocker={handleUpdateBlocker}
                  canEditBlocker={isManager || user?.id === task.owner_id}
                  onRefresh={() => {/* React Query handles cache invalidation automatically */}}
                  onOpenDetails={() => handleOpenDetails(task)}
                  dropTargets={keyboardDropTargets}
                  onKeyboardDrop={(targetId) => handleKeyboardDrop(task, targetId)}
                />
              ))}
            </div>
          </div>

          {statusColumns.map((status) => (
            <div
              key={status}
              role="region"
              aria-label={`${status} column, ${tasksByStatus[status].length} tasks`}
              className={`space-y-3 xl:flex xl:flex-col xl:transition-all ${getColumnClass(status)}`}
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
                <h3 className="font-medium text-sm">{status}</h3>
                <Badge variant="outline" className="text-xs">
                  {tasksByStatus[status].length}
                </Badge>
              </button>

              <div
                className={`min-h-[500px] p-2 rounded-lg bg-secondary/30 space-y-2 border-t-2 ${statusColors[status]}`}
              >
                {pagedTasksByStatus[status].map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    teamMembers={teamMembers}
                    onDragStart={() => handleDragStart(task)}
                    onUpdateBlocker={handleUpdateBlocker}
                    canEditBlocker={isManager || user?.id === task.owner_id}
                    onRefresh={() => {/* React Query handles cache invalidation automatically */}}
                    onOpenDetails={() => handleOpenDetails(task)}
                    dropTargets={keyboardDropTargets}
                    onKeyboardDrop={(targetId) => handleKeyboardDrop(task, targetId)}
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
            {tasks.length + backlogTasks.length === 0
              ? '0'
              : `Page ${clampedPage} of ${totalPages} · ${tasks.length + backlogTasks.length} total`}
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
            <SelectItem value="48">48 cards</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  teamMembers,
  onDragStart,
  onUpdateBlocker,
  canEditBlocker,
  onRefresh,
  onOpenDetails,
  dropTargets,
  onKeyboardDrop,
}: {
  task: Task;
  teamMembers: TeamMember[];
  onDragStart: () => void;
  onUpdateBlocker: (task: Task, blocker: string | undefined) => void;
  canEditBlocker: boolean;
  onRefresh: () => void;
  onOpenDetails: () => void;
  dropTargets: { id: string; label: string }[];
  onKeyboardDrop: (targetId: string) => void;
}) {
  const [blockerPopoverOpen, setBlockerPopoverOpen] = useState(false);
  const [blockerValue, setBlockerValue] = useState(task.blocker || '');
  const owner = teamMembers.find(m => m.id === task.owner_id);
  const blockedHoursValue = toHours(task.blocked_hours ?? 0);
  const actualHoursValue = toHours(task.actual_hours ?? 0);
  const isDone = task.status === 'Done' || task.status === 'Fixed' || task.status === 'Closed';
  const isInProgress = task.status === 'In Progress' || task.status === 'Reopen';
  const isBlocked = task.status === 'Blocked';
  const totalHours = actualHoursValue + blockedHoursValue;
  const estimatedHours = toHours(task.estimated_hours ?? 0);
  const isOverdue = !isDone && estimatedHours > 0 && totalHours > estimatedHours;
  let currentTimeLabel = '';
  let currentTimeValue = 0;
  if (isBlocked) {
    currentTimeLabel = 'Blocked';
    currentTimeValue = blockedHoursValue;
  } else if (isInProgress) {
    currentTimeLabel = 'Progress';
    currentTimeValue = actualHoursValue;
  } else if (isDone) {
    currentTimeLabel = 'Total';
    currentTimeValue = totalHours;
  }
  const showTime = Boolean(currentTimeLabel) && (currentTimeValue > 0 || isBlocked || isInProgress || isDone);
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
  
  const cardAriaLabel = `Task ${task.id}: ${task.title}. Type: ${task.type}. Status: ${task.status}. Owner: ${owner?.name || 'Unassigned'}.${task.blocker ? ` Blocked: ${task.blocker}.` : ''} Estimated: ${task.estimated_hours} points. Press Enter to drag, click title for details.`;

  return (
    <KeyboardDraggable
      ariaLabel={cardAriaLabel}
      dropTargets={dropTargets}
      onKeyboardDrop={onKeyboardDrop}
    >
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
              <Badge variant="outline" className="text-[10px]">{task.type}</Badge>
              {task.module && <span className="truncate max-w-[140px]">{task.module}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {showTime && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{currentTimeValue}h</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="space-y-1">
                  {actualHoursValue > 0 && (
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <span>Worked</span>
                      <span>{actualHoursValue}h</span>
                    </div>
                  )}
                  {blockedHoursValue > 0 && (
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <span>Blocked</span>
                      <span>{blockedHoursValue}h</span>
                    </div>
                  )}
                  {totalHours > 0 && (
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <span>Total</span>
                      <span>{totalHours}h</span>
                    </div>
                  )}
                  {!actualHoursValue && !blockedHoursValue && (
                    <div className="text-xs text-muted-foreground">No time tracked yet</div>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            {isOverdue && (
              <Badge className="text-[10px] px-1.5 py-0 shrink-0 bg-orange-500 hover:bg-orange-500 text-white">
                Overdue
              </Badge>
            )}
            {(task.priority === 'High' || task.priority === 'Blocker') && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">
                {task.priority}
              </Badge>
            )}
          </div>
        </div>

        {/* Blocker Section */}
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

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              <span>{owner?.name || 'Unassigned'}</span>
            </div>
            <TaskCommentsDialog task={task} onCommentAdded={onRefresh} />
          </div>
          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-foreground">
            SP: {task.estimated_hours}
          </span>
        </div>
      </CardContent>
    </Card>
    </KeyboardDraggable>
  );
}
