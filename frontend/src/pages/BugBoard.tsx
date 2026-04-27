import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getNextTaskId } from '@/lib/store';
import { useTasks, useTeamMembers, useCreateTask, useUpdateTask, useDeleteTask, useDebounce } from '@/hooks';
import { exportBugsToCSV } from '@/lib/exportUtils';
import { Task, TaskPriority, TaskStatus, TaskType, TeamMember } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MultiSelect } from '@/components/ui/multi-select';
import { TaskCommentsDialog } from '@/components/TaskCommentsDialog';
import { TaskDetailsDialog } from '@/components/TaskDetailsDialog';
import { Bug as BugIcon, Clock, User, PencilLine, X, Download } from 'lucide-react';
import { toast } from 'sonner';
import { formatLocalDate } from '@/lib/utils';

type BugStatus = Extract<TaskStatus, 'To Do' | 'In Progress' | 'Fixed' | 'Closed' | 'Reopen' | 'Done'>;

const bugStatuses: BugStatus[] = ['To Do', 'In Progress', 'Fixed', 'Closed', 'Reopen', 'Done'];
const severityColors: Record<TaskPriority, 'destructive' | 'warning' | 'secondary' | 'default' | 'success'> = {
  Blocker: 'destructive',
  High: 'destructive',
  Medium: 'warning',
  Low: 'secondary',
};
const DEFAULT_BUG_MODULE = 'QA';
const formatProgressDays = (value?: number | null) => {
  if (!value) return '0';
  return String(Math.round(value * 10) / 10);
};

interface BugFormValues {
  title: string;
  owner_id: string;
  priority: TaskPriority;
  module: string;
  type: TaskType;
  steps_to_reproduce: string;
  description?: string;
  status: BugStatus;
  attachments?: File[];
}

export default function BugBoard() {
  const { user, isManager, isQA } = useAuth();
  const isGrcTeam = ['GRC', 'Ascenders'].includes(user?.team || '');
  const moduleLabel = isGrcTeam ? 'Client' : 'Module';
  const canManage = isManager || isQA;

  // React Query hooks
  const { data: allTasks = [], isLoading: tasksLoading } = useTasks();
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers();
  const updateTaskMutation = useUpdateTask();
  const deleteTaskMutation = useDeleteTask();
  const createTaskMutation = useCreateTask();

  const [filterOwner, setFilterOwner] = useState<string[]>([]);
  const [filterSeverity, setFilterSeverity] = useState<string[]>([]);
  const [filterModule, setFilterModule] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 250);
  const [bugDialogOpen, setBugDialogOpen] = useState(false);
  const [editingBug, setEditingBug] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailBug, setDetailBug] = useState<Task | null>(null);
  const [pageSize, setPageSize] = useState('10');
  const [currentPage, setCurrentPage] = useState(1);

  const bugs = useMemo(() => {
    let tasks = allTasks.filter(
      (t) => t.type === 'Bug' || t.type === 'Change'
    );

    if (filterOwner.length > 0) {
      tasks = tasks.filter((t) => filterOwner.includes(t.owner_id));
    }
    if (filterSeverity.length > 0) {
      tasks = tasks.filter((t) => filterSeverity.includes(t.priority || ''));
    }
    if (filterModule.length > 0) {
      tasks = tasks.filter((t) => filterModule.includes(t.module || ''));
    }
    if (filterStatus.length > 0) {
      tasks = tasks.filter((t) => filterStatus.includes(t.status || ''));
    }
    if (filterType.length > 0) {
      tasks = tasks.filter((t) => filterType.includes(t.type || ''));
    }
    if (filterStartDate || filterEndDate) {
      tasks = tasks.filter((t) => {
        const created = t.created_date || '';
        if (!created) return false;
        if (filterStartDate && created < filterStartDate) return false;
        if (filterEndDate && created > filterEndDate) return false;
        return true;
      });
    }
    if (debouncedSearch.trim()) {
      const term = debouncedSearch.toLowerCase();
      tasks = tasks.filter((t) =>
        (t.title || '').toLowerCase().includes(term) ||
        (t.id || '').toLowerCase().includes(term) ||
        (t.module || '').toLowerCase().includes(term) ||
        (t.description || '').toLowerCase().includes(term) ||
        (t.steps_to_reproduce || '').toLowerCase().includes(term)
      );
    }
    return tasks
      .slice()
      .sort((a, b) => (b.id || '').localeCompare(a.id || ''));
  }, [allTasks, filterOwner, filterSeverity, filterModule, filterStatus, filterType, filterStartDate, filterEndDate, debouncedSearch]);

  const isLoading = tasksLoading || membersLoading;

  const handleStatusChange = (bug: Task, status: BugStatus) => {
    if (bug.status === status) return;
    const closedDate =
      status === 'Closed' || status === 'Done'
        ? new Date().toISOString().split('T')[0]
        : null;
    updateTaskMutation.mutate({ ...bug, status, closed_date: closedDate || undefined });
  };

  const resetDialog = () => {
    setEditingBug(null);
    setBugDialogOpen(false);
  };

  const handleDeleteBug = (bug: Task) => {
    if (!canManage) return;
    const confirmed = window.confirm('Delete this bug? This cannot be undone.');
    if (!confirmed) return;
    deleteTaskMutation.mutate(bug.id);
  };

  const handleSaveBug = (values: BugFormValues) => {
    const { attachments, ...formValues } = values;
    if (!formValues.owner_id) {
      toast.error('Assign the bug to a team member');
      return;
    }

    const payload: Task = {
      id: editingBug?.id || getNextTaskId(formValues.type),
      title: formValues.title.trim(),
      type: formValues.type,
      sprint_id: null,
      module: formValues.module.trim() || DEFAULT_BUG_MODULE,
      owner_id: formValues.owner_id,
      priority: formValues.priority,
      status: editingBug ? formValues.status : 'To Do',
      estimated_hours: editingBug?.estimated_hours || 0,
      actual_hours: editingBug?.actual_hours || 0,
      created_date: editingBug?.created_date || new Date().toISOString().split('T')[0],
      description: formValues.description?.trim(),
      steps_to_reproduce: formValues.steps_to_reproduce.trim(),
    };

    if (editingBug) {
      updateTaskMutation.mutate({ ...payload, attachments } as Task & { attachments?: File[] });
    } else {
      createTaskMutation.mutate(
        { ...payload, attachments } as Task & { attachments?: File[] },
        {
          onSuccess: () => {
            resetDialog();
          },
        }
      );
    }
  };

  const handleSelectToggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    setSelectedIds(bugs.map((b) => b.id));
  };

  const handleClearSelection = () => setSelectedIds([]);

  const handleOpenDetails = (bug: Task) => {
    setDetailBug(bug);
  };

  const handleExportSelected = () => {
    if (selectedIds.length === 0) {
      toast.info('Select at least one bug to export');
      return;
    }
    const selected = bugs.filter((b) => selectedIds.includes(b.id));
    exportBugsToCSV({ bugs: selected, teamMembers, moduleLabel });
    toast.success(`Exported ${selected.length} bug${selected.length === 1 ? '' : 's'}`);
  };

  // Keep selection in sync with filtered list
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => bugs.some((b) => b.id === id)));
  }, [bugs]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterOwner, filterSeverity, filterModule, filterStatus, filterType, filterStartDate, filterEndDate, debouncedSearch]);

  const pageSizeValue = Number.parseInt(pageSize, 10) || 10;
  const totalPages = Math.max(1, Math.ceil(bugs.length / pageSizeValue));
  const clampedPage = Math.min(currentPage, totalPages);
  const pageStart = (clampedPage - 1) * pageSizeValue;
  const pageEnd = pageStart + pageSizeValue;
  const pagedBugs = bugs.slice(pageStart, pageEnd);

  if (isLoading) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Bugs Board</h1>
            <p className="text-muted-foreground">Showing bugs across all work</p>
          </div>
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
                    label="Assignee"
                    allLabel="All Assignees"
                    options={teamMembers.map((m) => ({ label: m.name, value: m.id }))}
                    value={filterOwner}
                    onChange={setFilterOwner}
                  />

                  <MultiSelect
                    variant="inline"
                    label="Severity"
                    allLabel="All Severities"
                    options={[
                      { label: 'Blocker', value: 'Blocker' },
                      { label: 'High', value: 'High' },
                      { label: 'Medium', value: 'Medium' },
                      { label: 'Low', value: 'Low' },
                    ]}
                    value={filterSeverity}
                    onChange={setFilterSeverity}
                  />

                  <MultiSelect
                    variant="inline"
                    label={moduleLabel}
                    allLabel={`All ${moduleLabel}s`}
                    options={Array.from(
                      new Set(
                        allTasks
                          .filter((t) => t.type === 'Bug' || t.type === 'Change')
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
                    label="Type"
                    allLabel="All Types"
                    options={[
                      { label: 'Bug', value: 'Bug' },
                      { label: 'Change', value: 'Change' },
                    ]}
                    value={filterType}
                    onChange={setFilterType}
                  />

                  <MultiSelect
                    variant="inline"
                    label="Status"
                    allLabel="All Statuses"
                    options={bugStatuses.map((state) => ({ label: state, value: state }))}
                    value={filterStatus}
                    onChange={setFilterStatus}
                  />

                  <div className="grid gap-3">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Created from
                      </div>
                      <Input
                        type="date"
                        value={filterStartDate}
                        onChange={(e) => setFilterStartDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Created to
                      </div>
                      <Input
                        type="date"
                        value={filterEndDate}
                        onChange={(e) => setFilterEndDate(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bugs..."
            className="w-56"
            aria-label="Search bugs"
          />

          {canManage && (
            <>
              <Button variant="outline" onClick={handleSelectAll}>
                Select all
              </Button>
              <Button variant="ghost" onClick={handleClearSelection}>
                Clear
              </Button>
              <Button variant="outline" onClick={handleExportSelected} disabled={selectedIds.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                Export selected
              </Button>
            </>
          )}

          {canManage && (
            <Dialog open={bugDialogOpen} onOpenChange={setBugDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditingBug(null)}>
                  <BugIcon className="h-4 w-4 mr-2" />
                  New Bug
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingBug ? 'Edit Bug' : 'Log New Bug'}</DialogTitle>
                  <DialogDescription>
                    Capture the steps, severity, and assign to a developer.
                  </DialogDescription>
                </DialogHeader>
                <BugForm
                  teamMembers={teamMembers}
                  onSubmit={handleSaveBug}
                  moduleLabel={moduleLabel}
                  defaultValues={
                    editingBug
                      ? {
                          title: editingBug.title,
                          owner_id: editingBug.owner_id,
                          priority: editingBug.priority,
                          module: editingBug.module,
                          type: editingBug.type,
                          steps_to_reproduce: editingBug.steps_to_reproduce || '',
                          description: editingBug.description,
                          status: (bugStatuses.includes(editingBug.status as BugStatus)
                            ? (editingBug.status as BugStatus)
                            : 'To Do'),
                        }
                      : undefined
                  }
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between py-3">
          <div className="space-y-1">
            <CardTitle className="text-lg font-semibold">Bugs/Changes</CardTitle>
            <p className="text-sm text-muted-foreground">List of bugs and changes across all {moduleLabel.toLowerCase()}s</p>
          </div>
          <Badge variant="outline">{bugs.length} total</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="hidden md:grid grid-cols-[0.5fr,2fr,0.8fr,0.8fr,1fr,1.2fr,0.8fr] text-xs font-medium text-muted-foreground uppercase tracking-wide px-2">
            <span>Select</span>
            <span>Bug/Change</span>
            <span>Severity</span>
            <span>Type</span>
            <span>Assignee</span>
            <span>Status & Dates</span>
            <span>Actions</span>
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {pagedBugs.length === 0 ? (
              <div className="text-sm text-muted-foreground px-2 py-4">No bugs to show.</div>
            ) : (
              pagedBugs.map((bug) => {
                const owner = teamMembers.find((m) => m.id === bug.owner_id);
                return (
                  <BugRow
                    key={bug.id}
                    bug={bug}
                    ownerName={owner?.name || 'Unassigned'}
                    selected={selectedIds.includes(bug.id)}
                    onToggleSelect={() => handleSelectToggle(bug.id)}
                    onOpenDetails={() => handleOpenDetails(bug)}
                    onEdit={
                      canManage
                        ? () => {
                            setEditingBug(bug);
                            setBugDialogOpen(true);
                          }
                        : undefined
                    }
                    onDelete={canManage ? () => handleDeleteBug(bug) : undefined}
                    onStatusChange={
                      canManage || user?.id === bug.owner_id
                        ? (status) => handleStatusChange(bug, status)
                        : undefined
                    }
                  />
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {detailBug && (
        <TaskDetailsDialog
          task={detailBug}
          open={Boolean(detailBug)}
          onOpenChange={(open) => {
            if (!open) setDetailBug(null);
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {bugs.length === 0
              ? '0'
              : `${pageStart + 1}-${Math.min(pageEnd, bugs.length)}`} of {bugs.length}
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

function BugRow({
  bug,
  ownerName,
  selected,
  onToggleSelect,
  onOpenDetails,
  onEdit,
  onDelete,
  onStatusChange,
}: {
  bug: Task;
  ownerName: string;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenDetails: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onStatusChange?: (status: BugStatus) => void;
}) {
  const severityVariant = severityColors[bug.priority] || 'secondary';
  const showProgress = bug.status === 'In Progress' || bug.status === 'Reopen';
  const progressLabel = bug.status === 'Reopen' ? 'Reopen' : 'Progress';
  const progressValue = formatProgressDays(bug.actual_hours);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[0.5fr,2fr,0.9fr,0.9fr,1fr,1.1fr,0.9fr] md:items-center rounded-lg border border-border bg-background p-3 shadow-sm">
      <div className="flex items-center md:justify-center">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect()}
          aria-label="Select bug"
        />
      </div>
      <div className="space-y-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetails();
          }}
          className="text-left text-sm font-semibold leading-tight hover:underline"
        >
          {bug.title}
        </button>
        <p className="text-xs text-muted-foreground">ID: {bug.id}</p>
        <p className="text-xs text-muted-foreground">{bug.module}</p>
      </div>
      <div className="flex md:justify-start">
        <Badge variant={severityVariant}>{bug.priority} severity</Badge>
      </div>
      <div className="flex md:justify-start">
        <Badge variant="outline" className="text-[10px]">
          {bug.type}
        </Badge>
      </div>
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <User className="h-4 w-4" />
        {ownerName}
      </div>
      <div className="space-y-2">
        <Select
          value={bug.status as BugStatus}
          onValueChange={(v) => onStatusChange?.(v as BugStatus)}
          disabled={!onStatusChange}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bugStatuses.map((state) => (
              <SelectItem key={state} value={state}>
                {state}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-[11px] text-muted-foreground space-y-1 leading-tight">
          <div>Created: {formatLocalDate(bug.created_date)}</div>
          {(bug.status === 'Closed' || bug.status === 'Done') && (
            <div>Closed: {bug.closed_date ? formatLocalDate(bug.closed_date) : 'Not tracked'}</div>
          )}
          {showProgress && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{progressLabel}: {progressValue}d</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <TaskCommentsDialog task={bug} />
        {onEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="text-foreground hover:text-primary"
            title="Edit bug"
            aria-label={`Edit bug ${bug.title}`}
          >
            <PencilLine className="h-4 w-4" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-destructive hover:text-destructive/80"
            title="Delete bug"
            aria-label={`Delete bug ${bug.title}`}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function BugForm({
  defaultValues,
  onSubmit,
  teamMembers,
  moduleLabel = 'Module',
}: {
  defaultValues?: Partial<BugFormValues>;
  onSubmit: (values: BugFormValues) => void;
  teamMembers: TeamMember[];
  moduleLabel?: string;
}) {
  const [title, setTitle] = useState(defaultValues?.title || '');
  const [ownerId, setOwnerId] = useState(defaultValues?.owner_id || '');
  const [priority, setPriority] = useState<TaskPriority>(defaultValues?.priority || 'High');
  const [module, setModule] = useState(defaultValues?.module || '');
  const [type, setType] = useState<TaskType>(defaultValues?.type || 'Bug');
  const [steps, setSteps] = useState(defaultValues?.steps_to_reproduce || '');
  const [description, setDescription] = useState(defaultValues?.description || '');
  const [status, setStatus] = useState<BugStatus>(defaultValues?.status || 'To Do');
  const [attachments, setAttachments] = useState<File[]>([]);
  const isEditing = Boolean(defaultValues);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Bug title is required');
      return;
    }
    onSubmit({
      title,
      owner_id: ownerId,
      priority,
      module,
      type,
      steps_to_reproduce: steps,
      description,
      status,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Title *</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bug title" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Type</label>
          <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Bug">Bug</SelectItem>
              <SelectItem value="Change">Change</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Severity</label>
          <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Assign to</label>
          <Select value={ownerId} onValueChange={(v) => setOwnerId(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Choose assignee" />
            </SelectTrigger>
            <SelectContent>
              {teamMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{moduleLabel}</label>
          <Input
            value={module}
            onChange={(e) => setModule(e.target.value)}
            placeholder={moduleLabel === 'Client' ? 'e.g. Acme Corp' : 'e.g. Checkout flow'}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Steps to Reproduce</label>
        <Textarea
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          placeholder="List the steps..."
          rows={3}
        />
      </div>

      <div className="flex items-center gap-2">
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Description</label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Bug description..."
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{isEditing ? 'Add Attachments' : 'Attachments'}</label>
        <Input
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

      {defaultValues && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Status</label>
          <Select value={status} onValueChange={(v) => setStatus(v as BugStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {bugStatuses.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}