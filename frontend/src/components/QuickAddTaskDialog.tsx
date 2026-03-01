import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DEFAULT_TEAM, getNextTaskId } from '@/lib/store';
import { useSprints, useCreateTask } from '@/hooks';
import { Task, TaskPriority, TaskType } from '@/types';
import { toast } from 'sonner';

interface QuickAddTaskDialogProps {
  ownerId: string;
  team?: string;
  onTaskCreated?: () => void;
}

export function QuickAddTaskDialog({ ownerId, team, onTaskCreated }: QuickAddTaskDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TaskType>('Sprint');
  const moduleLabel = ['GRC', 'Ascenders'].includes(team) ? 'Client' : 'Module';
  const [module, setModule] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const isBacklog = type === 'Backlog';
  const createTaskMutation = useCreateTask();

  const { data: sprints = [] } = useSprints();
  const teamSprints = team
    ? sprints.filter((s) => (s.team || DEFAULT_TEAM) === team)
    : sprints;
  const activeSprint = sprints.find(s => s.is_active && (team ? (s.team || DEFAULT_TEAM) === team : true)) || null;
  const [selectedSprintId, setSelectedSprintId] = useState<string>(
    activeSprint?.id || teamSprints[0]?.id || ''
  );

  useEffect(() => {
    if (teamSprints.length === 0) {
      if (selectedSprintId) setSelectedSprintId('');
      return;
    }
    if (!teamSprints.some((s) => s.id === selectedSprintId)) {
      setSelectedSprintId(activeSprint?.id || teamSprints[0]?.id || '');
    }
  }, [team, teamSprints, activeSprint?.id, selectedSprintId]);

  const resetForm = () => {
    setTitle('');
    setType('Sprint');
    setModule('');
    setPriority('Medium');
    setEstimatedHours('');
    setDescription('');
    setAttachments([]);
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error('Task title is required');
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
    const sprint = !isBacklog
      ? teamSprints.find((s) => s.id === selectedSprintId) || activeSprint
      : null;
    if (!isBacklog && !sprint) {
      toast.error('No sprint selected');
      return;
    }

    const newTask: Task = {
      id: getNextTaskId(type),
      title: title.trim(),
      type,
      sprint_id: isBacklog ? null : sprint?.id || null,
      module: module.trim() || 'General',
      owner_id: ownerId,
      priority,
      status: 'To Do',
      estimated_hours: parseFloat(estimatedHours) || 0,
      actual_hours: 0,
      created_date: new Date().toISOString().split('T')[0],
      description: description.trim(),
    };

    createTaskMutation.mutate(
      { ...newTask, attachments: attachments.length > 0 ? attachments : undefined } as Task & { attachments?: File[] }
    );
    setOpen(false);
    resetForm();
    onTaskCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[450px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Task</DialogTitle>
          <DialogDescription>
            Create a new task assigned to yourself.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              <SelectContent>
                <SelectItem value="Sprint">Sprint</SelectItem>
                <SelectItem value="Additional">Additional</SelectItem>
                <SelectItem value="Backlog">Backlog</SelectItem>
              </SelectContent>
            </Select>
          </div>

            <div className="grid gap-2">
              <Label>Priority</Label>
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

          {!isBacklog && teamSprints.length > 1 && (
            <div className="grid gap-2">
              <Label>Sprint</Label>
              <Select value={selectedSprintId} onValueChange={setSelectedSprintId}>
                <SelectTrigger>
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
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="module">{moduleLabel}</Label>
              <Input
                id="module"
                placeholder={moduleLabel === 'Client' ? 'e.g., Acme Corp' : 'e.g., Authentication'}
                value={module}
                onChange={(e) => setModule(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="estimated-hours">Story Points (days)</Label>
              <Input
                id="estimated-hours"
                type="number"
                min="0"
                step="0.05"
                placeholder="0"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">0.05 days ≈ 30 min, 0.25 days = 2 hours (8h/day)</p>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description * <span className="text-xs font-normal text-muted-foreground">(min 20 chars)</span></Label>
            <Textarea
              id="description"
              placeholder="Task description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="attachments">Attachments</Label>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Create Task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
