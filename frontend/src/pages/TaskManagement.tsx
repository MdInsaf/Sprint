import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { DEFAULT_TEAM, getNextTaskId } from '@/lib/store';
import { useSprints, useTeamMembers, useTasksBySprint, useCreateTask, useUpdateTask, useDeleteTask, useDebounce } from '@/hooks';
import { Task, TaskType, TaskPriority, TaskStatus, TeamMember } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MultiSelect } from '@/components/ui/multi-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { TaskCommentsDialog } from '@/components/TaskCommentsDialog';
import { TaskDetailsDialog } from '@/components/TaskDetailsDialog';
import { TeamSelect } from '@/components/TeamSelect';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { toast } from 'sonner';

const CORE_TASK_STATUSES: TaskStatus[] = ['To Do', 'In Progress', 'Blocked', 'Done'];
const BUG_TASK_STATUSES: TaskStatus[] = [...CORE_TASK_STATUSES, 'Fixed', 'Closed', 'Reopen'];
type TaskFormData = Partial<Task> & { attachments?: File[] };

export default function TaskManagement() {
  const { user, isManager } = useAuth();

  // React Query hooks
  const { data: sprints = [], isLoading: sprintsLoading } = useSprints();
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers();
  const createTaskMutation = useCreateTask();
  const updateTaskMutation = useUpdateTask();
  const deleteTaskMutation = useDeleteTask();

  const { teams, selectedTeam, setSelectedTeam } = useTeamSelection(user?.team);
  const isGrcTeam = ['GRC', 'Ascenders'].includes(selectedTeam);
  const moduleLabel = isGrcTeam ? 'Client' : 'Module';
  const teamSprints = sprints.filter((s) => (s.team || DEFAULT_TEAM) === selectedTeam);
  const activeSprint = teamSprints.find(s => s.is_active) || null;
  const [selectedSprintId, setSelectedSprintId] = useState<string>(
    activeSprint?.id || teamSprints[0]?.id || ''
  );
  const teamMembersForTeam = teamMembers.filter(
    (member) => (member.team || DEFAULT_TEAM) === selectedTeam
  );

  // Fetch tasks for selected sprint
  const { data: sprintTasks = [], isLoading: tasksLoading } = useTasksBySprint(selectedSprintId || null);
  const isLoading = sprintsLoading || membersLoading || tasksLoading;

  // Filter tasks for non-managers
  const tasks = useMemo(() => {
    if (!isManager && user) {
      return sprintTasks.filter(t => t.owner_id === user.id);
    }
    return sprintTasks;
  }, [sprintTasks, isManager, user]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterOwner, setFilterOwner] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 250);
  const [pageSize, setPageSize] = useState('10');
  const [currentPage, setCurrentPage] = useState(1);
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const hideTeamSelect = ['GRC', 'Ascenders'].includes(user?.team || '') && !isSuperAdmin;

  const selectedSprint = useMemo(
    () => teamSprints.find((s) => s.id === selectedSprintId) || null,
    [teamSprints, selectedSprintId]
  );

  const filteredTasks = tasks.filter(t => {
    const term = debouncedSearch.trim().toLowerCase();
    if (filterStatus.length > 0 && !filterStatus.includes(t.status)) return false;
    if (!isManager && user && t.owner_id !== user.id) return false;
    if (isManager && filterOwner.length > 0 && !filterOwner.includes(t.owner_id)) return false;
    if (term) {
      return (
        (t.id || '').toLowerCase().includes(term) ||
        (t.title || '').toLowerCase().includes(term) ||
        (t.module || '').toLowerCase().includes(term) ||
        (t.description || '').toLowerCase().includes(term)
      );
    }
    return true;
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSprintId, filterStatus, filterOwner, isManager, user?.id, debouncedSearch]);

  useEffect(() => {
    if (teamSprints.length === 0) {
      if (selectedSprintId) setSelectedSprintId('');
      return;
    }
    if (!teamSprints.some((s) => s.id === selectedSprintId)) {
      setSelectedSprintId(activeSprint?.id || teamSprints[0]?.id || '');
    }
  }, [teamSprints, activeSprint?.id, selectedSprintId]);

  const formatTaskId = (id?: string) => {
    if (!id) return '';
    if (id.length <= 8) return id;
    return `${id.slice(0, 4)}…${id.slice(-4)}`;
  };

  const pageSizeValue = Number.parseInt(pageSize, 10) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSizeValue));
  const clampedPage = Math.min(currentPage, totalPages);
  const pageStart = (clampedPage - 1) * pageSizeValue;
  const pageEnd = pageStart + pageSizeValue;
  const pagedTasks = filteredTasks.slice(pageStart, pageEnd);

  const handleCreateTask = (taskData: TaskFormData) => {
    const { attachments, ...values } = taskData;
    if (!taskData.owner_id) {
      toast.error('Owner is required');
      return;
    }
    const resolvedType = values.type || 'Sprint';
    const isBacklogType = resolvedType === 'Backlog';
    if (!selectedSprint && !isBacklogType) {
      toast.error('Select a sprint');
      return;
    }

    const newTask: Task = {
      id: getNextTaskId(resolvedType),
      title: values.title || '',
      type: resolvedType,
      sprint_id: isBacklogType ? null : selectedSprint?.id || null,
      module: values.module || '',
      owner_id: values.owner_id,
      priority: values.priority || 'Medium',
      status: 'To Do',
      estimated_hours: values.estimated_hours || 0,
      actual_hours: 0,
      created_date: new Date().toISOString().split('T')[0],
      description: values.description,
      steps_to_reproduce: values.steps_to_reproduce,
    };

    createTaskMutation.mutate(
      { ...newTask, attachments } as Task & { attachments?: File[] },
      {
        onSuccess: () => {
          setIsDialogOpen(false);
        },
      }
    );
  };

  const handleUpdateTask = (taskData: TaskFormData) => {
    if (!editingTask) return;
    const { attachments, ...values } = taskData;
    const updated = {
      ...editingTask,
      ...values,
    };
    updateTaskMutation.mutate({ ...updated, attachments } as Task & { attachments?: File[] });
    setEditingTask({ ...editingTask, ...values });
  };

  const handleDeleteTask = (taskId: string) => {
    deleteTaskMutation.mutate(taskId);
  };

  const openEditDialog = (task: Task) => {
    setEditingTask(task);
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingTask(null);
    setIsDialogOpen(true);
  };

  const openDetailsDialog = (task: Task) => {
    setDetailTask(task);
  };

  if (isLoading) return null;

  if (!selectedSprint) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{isManager ? 'Task Management' : 'My Tasks'}</h1>
            <p className="text-muted-foreground">Select a team to view tasks.</p>
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
            No active sprint for {selectedTeam}.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{isManager ? 'Task Management' : 'My Tasks'}</h1>
          <p className="text-muted-foreground">{tasks.length} tasks in {selectedSprint?.sprint_name}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!hideTeamSelect && (
            <TeamSelect
              teams={teams}
              value={selectedTeam}
              onChange={setSelectedTeam}
              triggerClassName="w-40"
              placeholder="Team"
            />
          )}
          <Select
            value={selectedSprintId}
            onValueChange={setSelectedSprintId}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select sprint" />
            </SelectTrigger>
            <SelectContent>
              {teamSprints.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.sprint_name} {s.is_active ? '(Active)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Filters</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0">
              <div className="max-h-[70vh] overflow-y-auto">
                <div className="space-y-4 p-4 pr-5">
                  {isManager && (
                    <MultiSelect
                      variant="inline"
                      label="Owner"
                      allLabel="All Owners"
                      options={teamMembersForTeam.map((m) => ({ label: m.name, value: m.id }))}
                      value={filterOwner}
                      onChange={setFilterOwner}
                    />
                  )}

                  <MultiSelect
                    variant="inline"
                    label="Status"
                    allLabel="All Status"
                    options={[
                      { label: 'To Do', value: 'To Do' },
                      { label: 'In Progress', value: 'In Progress' },
                      { label: 'Blocked', value: 'Blocked' },
                      { label: 'Done', value: 'Done' },
                      { label: 'Fixed', value: 'Fixed' },
                      { label: 'Closed', value: 'Closed' },
                      { label: 'Reopen', value: 'Reopen' },
                    ]}
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
            placeholder="Search title or ID..."
            className="w-52"
            aria-label="Search tasks"
          />
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            {isManager && (
              <DialogTrigger asChild>
                <Button onClick={openCreateDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Task
                </Button>
              </DialogTrigger>
            )}
            <DialogContent className="max-w-lg max-h-[85vh]">
              <DialogHeader>
                <DialogTitle>{editingTask ? 'Edit Task' : 'Create New Task'}</DialogTitle>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto pr-1">
                <TaskForm
                  task={editingTask}
                  teamMembers={teamMembersForTeam}
                  onSubmit={editingTask ? handleUpdateTask : handleCreateTask}
                  onCancel={() => setIsDialogOpen(false)}
                  canEditOwner={isManager}
                  moduleLabel={moduleLabel}
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Priority / Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedTasks.map(task => {
                const owner = teamMembers.find(m => m.id === task.owner_id);
                const canEdit = isManager || (user && task.owner_id === user.id);
                const isBugTask = task.type === 'Bug' || task.type === 'Change';
                const priorityVariant =
                  task.priority === 'Blocker' || task.priority === 'High'
                    ? 'destructive'
                    : task.priority === 'Medium'
                      ? 'warning'
                      : 'secondary';
                const statusVariant =
                  task.status === 'Done'
                    ? 'success'
                    : task.status === 'Blocked'
                      ? 'destructive'
                      : task.status === 'In Progress'
                        ? 'default'
                        : task.status === 'Fixed'
                          ? 'success'
                          : task.status === 'Closed'
                            ? 'secondary'
                            : task.status === 'Reopen'
                              ? 'warning'
                              : 'secondary';
                return (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div>
                        <button
                          type="button"
                          onClick={() => openDetailsDialog(task)}
                          className="text-left font-medium hover:underline"
                        >
                          {task.title}
                        </button>
                        <p className="text-xs text-muted-foreground" title={task.id}>
                          ID: {formatTaskId(task.id)}
                        </p>
                        <p className="text-xs text-muted-foreground">{task.module}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{task.type}</Badge>
                    </TableCell>
                    <TableCell>{owner?.name}</TableCell>
                    <TableCell>
                      <Badge variant={priorityVariant}>
                        {isBugTask ? `${task.priority} severity` : task.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant}>
                        {task.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <TaskCommentsDialog task={task} />
                        {canEdit && (
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => openEditDialog(task)}
                            aria-label={`Edit task ${task.title}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {isManager && (
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => handleDeleteTask(task.id)}
                            aria-label={`Delete task ${task.title}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {pagedTasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No tasks found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {filteredTasks.length === 0
              ? '0'
              : `${pageStart + 1}-${Math.min(pageEnd, filteredTasks.length)}`} of {filteredTasks.length}
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

      {detailTask && (
        <TaskDetailsDialog
          task={detailTask}
          open={Boolean(detailTask)}
          onOpenChange={(open) => {
            if (!open) setDetailTask(null);
          }}
        />
      )}
    </div>
  );
}

function TaskForm({
  task,
  teamMembers,
  onSubmit,
  onCancel,
  canEditOwner = true,
  moduleLabel = 'Module',
}: {
  task: Task | null;
  teamMembers: TeamMember[];
  onSubmit: (data: TaskFormData) => void;
  onCancel: () => void;
  canEditOwner?: boolean;
  moduleLabel?: string;
}) {
  const [title, setTitle] = useState(task?.title || '');
  const [type, setType] = useState<TaskType>(task?.type || 'Sprint');
  const [module, setModule] = useState(task?.module || '');
  const [ownerId, setOwnerId] = useState(task?.owner_id || '');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority || 'Medium');
  const [status, setStatus] = useState<TaskStatus>(task?.status || 'To Do');
  const [estimatedHours, setEstimatedHours] = useState(task?.estimated_hours?.toString() || '');
  const [blocker, setBlocker] = useState(task?.blocker || '');
  const [description, setDescription] = useState(task?.description || '');
  const [stepsToReproduce, setStepsToReproduce] = useState(task?.steps_to_reproduce || '');
  const [attachments, setAttachments] = useState<File[]>([]);
  const allowLegacyBugTypes = Boolean(task && (task.type === 'Bug' || task.type === 'Change'));

  const isBugOrChange = type === 'Bug' || type === 'Change';
  const availableStatuses = isBugOrChange ? BUG_TASK_STATUSES : CORE_TASK_STATUSES;

  // When switching from bug/change to a core task, drop bug-only statuses to avoid invalid states.
  useEffect(() => {
    if (!isBugOrChange && !CORE_TASK_STATUSES.includes(status)) {
      setStatus('To Do');
    }
  }, [isBugOrChange, status]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!module.trim()) {
      toast.error(`${moduleLabel} is required`);
      return;
    }
    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }
    if (description.trim().length < 20) {
      toast.error('Description must be at least 20 characters');
      return;
    }
    const payload: TaskFormData = {
      title,
      type,
      module,
      owner_id: ownerId,
      priority,
      status,
      estimated_hours: Number(estimatedHours),
      blocker: status === 'Blocked' ? blocker : undefined,
      blocker_date: status === 'Blocked' && !task?.blocker_date ? new Date().toISOString() : task?.blocker_date,
      description,
      steps_to_reproduce: isBugOrChange ? stepsToReproduce : undefined,
    };
    if (attachments.length > 0) {
      payload.attachments = attachments;
    }
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Type *</Label>
          <Select value={type} onValueChange={(v: TaskType) => setType(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Sprint">Sprint</SelectItem>
              <SelectItem value="Additional">Additional</SelectItem>
              <SelectItem value="Backlog">Backlog</SelectItem>
              {allowLegacyBugTypes && task?.type === 'Bug' && (
                <SelectItem value="Bug">Bug</SelectItem>
              )}
              {allowLegacyBugTypes && task?.type === 'Change' && (
                <SelectItem value="Change">Change</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

          <div className="space-y-2">
            <Label>Owner *</Label>
          <Select value={ownerId} onValueChange={setOwnerId} disabled={!canEditOwner}>
            <SelectTrigger>
              <SelectValue placeholder="Select owner" />
            </SelectTrigger>
            <SelectContent>
              {teamMembers.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="module">{moduleLabel} *</Label>
          <Input
            id="module"
            value={module}
            onChange={e => setModule(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label>{isBugOrChange ? 'Severity' : 'Priority'}</Label>
          <Select value={priority} onValueChange={(v: TaskPriority) => setPriority(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Blocker">Blocker</SelectItem>
              <SelectItem value="High">High</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {task && (
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v: TaskStatus) => setStatus(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableStatuses.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {status === 'Blocked' && (
        <div className="space-y-2">
          <Label htmlFor="blocker">Blocker Reason</Label>
          <Textarea
            id="blocker"
            value={blocker}
            onChange={e => setBlocker(e.target.value)}
            placeholder="Describe what's blocking this task..."
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="estimatedHours">Story Points (days)</Label>
        <Input
          id="estimatedHours"
          type="number"
          min="0"
          step="0.05"
          value={estimatedHours}
          onChange={e => setEstimatedHours(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">0.05 days ≈ 30 min, 0.25 days = 2 hours (8h/day)</p>
      </div>

      {isBugOrChange && (
        <div className="space-y-3 border border-border rounded-lg p-3">
          <div className="space-y-2">
            <Label htmlFor="steps">Steps to Reproduce</Label>
            <Textarea
              id="steps"
              value={stepsToReproduce}
              onChange={(e) => setStepsToReproduce(e.target.value)}
              placeholder="List the steps to reproduce the bug..."
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="description">Description * <span className="text-xs font-normal text-muted-foreground">(min 20 chars)</span></Label>
        <Textarea
          id="description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          required
          minLength={20}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="attachments">{task ? 'Add Attachments' : 'Attachments'}</Label>
        <Input
          id="attachments"
          type="file"
          multiple
          onChange={(e) => setAttachments(Array.from(e.target.files || []))}
        />
        {attachments.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {attachments.length} file{attachments.length === 1 ? '' : 's'} selected
          </p>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {task ? 'Update Task' : 'Create Task'}
        </Button>
      </div>
    </form>
  );
}
