import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Sprint, SprintSummary, Task, TaskStatus } from '@/types';
import { DEFAULT_TEAM } from '@/lib/store';
import { useSprints, useTasksBySprint, useUpdateTask, useUpdateSprint, useCreateOrUpdateSprintSummary } from '@/hooks';
import { CheckCircle2, Flag, AlertTriangle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

const DONE_STATUSES: TaskStatus[] = ['Done', 'Closed', 'Fixed'];
const CARRY_FORWARD_STATUSES: TaskStatus[] = ['In Progress', 'Blocked', 'Reopen'];
const isPlannedType = (type?: string) => type === 'Sprint' || type === 'Backlog';

interface CompleteSprintDialogProps {
  sprint: Sprint;
  onSprintCompleted?: () => void;
}

export function CompleteSprintDialog({ sprint, onSprintCompleted }: CompleteSprintDialogProps) {
  const [open, setOpen] = useState(false);
  const [whatWentWell, setWhatWentWell] = useState('');
  const [issues, setIssues] = useState('');
  const [improvements, setImprovements] = useState('');
  const [carryForwardSprintId, setCarryForwardSprintId] = useState('');

  const { data: tasks = [] } = useTasksBySprint(sprint.id);
  const { data: allSprints = [] } = useSprints();
  const updateTaskMutation = useUpdateTask();
  const updateSprintMutation = useUpdateSprint();
  const createSummaryMutation = useCreateOrUpdateSprintSummary();
  const unfinishedTasks = useMemo(
    () => tasks.filter((t) => !DONE_STATUSES.includes(t.status as TaskStatus)),
    [tasks]
  );
  const carryForwardTasks = useMemo(
    () => unfinishedTasks.filter((t) => CARRY_FORWARD_STATUSES.includes(t.status as TaskStatus)),
    [unfinishedTasks]
  );
  const backlogTasks = useMemo(
    () => unfinishedTasks.filter((t) => !CARRY_FORWARD_STATUSES.includes(t.status as TaskStatus)),
    [unfinishedTasks]
  );
  const sprintTeam = sprint.team || DEFAULT_TEAM;
  const availableSprints = allSprints
    .filter((candidate) => (candidate.team || DEFAULT_TEAM) === sprintTeam)
    .filter((candidate) => candidate.id !== sprint.id)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const stats = useMemo(() => {
    const sprintTasks = tasks.filter(t => isPlannedType(t.type));
    const additionalTasks = tasks.filter(t => t.type === 'Additional');
    const bugs = tasks.filter(t => t.type === 'Bug');
    const completed = tasks.filter(t => DONE_STATUSES.includes(t.status as TaskStatus));
    const carryForward = tasks.filter(t => CARRY_FORWARD_STATUSES.includes(t.status as TaskStatus));
    const backlog = tasks.filter(
      t =>
        !DONE_STATUSES.includes(t.status as TaskStatus) &&
        !CARRY_FORWARD_STATUSES.includes(t.status as TaskStatus)
    );

    const plannedCount = sprintTasks.length;
    const completedSprintTasks = completed.filter(t => isPlannedType(t.type)).length;
    const successRate = plannedCount > 0 ? Math.round((completedSprintTasks / plannedCount) * 100) : 0;

    return {
      planned: plannedCount,
      completed: completedSprintTasks,
      carryForward: carryForward.length,
      backlog: backlog.length,
      additional: additionalTasks.length,
      bugs: bugs.length,
      successRate,
      totalCompleted: completed.length,
      totalTasks: tasks.length,
    };
  }, [tasks]);

  useEffect(() => {
    if (!open) return;
    if (carryForwardTasks.length === 0) {
      setCarryForwardSprintId('');
      return;
    }
    if (!carryForwardSprintId || !availableSprints.some((s) => s.id === carryForwardSprintId)) {
      setCarryForwardSprintId(availableSprints[0]?.id || '');
    }
  }, [open, carryForwardTasks.length, availableSprints, carryForwardSprintId]);

  const handleComplete = () => {
    if (carryForwardTasks.length > 0 && !carryForwardSprintId) {
      toast({
        title: 'Select a carry-forward sprint',
        description: 'Create or select a sprint to move in-progress tasks.',
      });
      return;
    }

    if (carryForwardTasks.length > 0 && carryForwardSprintId) {
      carryForwardTasks.forEach((task) => {
        updateTaskMutation.mutate({ ...task, sprint_id: carryForwardSprintId } as Task & { attachments?: File[] });
      });
    }
    if (backlogTasks.length > 0) {
      backlogTasks.forEach((task) => {
        updateTaskMutation.mutate({ ...task, sprint_id: null, status: 'To Do' } as Task & { attachments?: File[] });
      });
    }

    // Create sprint summary
    const summary: SprintSummary = {
      sprint_id: sprint.id,
      planned_tasks: stats.planned,
      completed_tasks: stats.completed,
      carry_forward: stats.carryForward,
      additional_tasks: stats.additional,
      bugs: stats.bugs,
      success_percentage: stats.successRate,
      what_went_well: whatWentWell,
      issues,
      improvements,
      completed_date: new Date().toISOString().split('T')[0],
    };

    createSummaryMutation.mutate(summary);

    // Mark sprint as inactive (or set the carry-forward sprint as active)
    const carryForwardSprint = carryForwardSprintId
      ? allSprints.find((candidate) => candidate.id === carryForwardSprintId)
      : null;
    if (carryForwardSprint) {
      updateSprintMutation.mutate({ ...carryForwardSprint, is_active: true });
    } else {
      updateSprintMutation.mutate({ ...sprint, is_active: false });
    }

    toast({
      title: 'Sprint Completed',
      description: `${sprint.sprint_name} has been closed with ${stats.successRate}% success rate.`,
    });

    setOpen(false);
    onSprintCompleted?.();
  };

  const canComplete = stats.carryForward === 0 || Boolean(carryForwardSprintId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Flag className="h-4 w-4 mr-2" />
          Complete Sprint
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete Sprint: {sprint.sprint_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Success Rate Preview */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold">{stats.successRate}%</span>
                <Badge variant={
                  stats.successRate >= 80 ? 'success' :
                  stats.successRate >= 60 ? 'warning' : 'destructive'
                }>
                  {stats.successRate >= 80 ? 'Excellent' :
                   stats.successRate >= 60 ? 'Good' : 'Needs Improvement'}
                </Badge>
              </div>
              <Progress value={stats.successRate} className="h-2" />
              <p className="text-sm text-muted-foreground">
                {stats.completed} of {stats.planned} planned tasks completed
              </p>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="text-center p-3 rounded-lg bg-secondary">
              <CheckCircle2 className="h-4 w-4 mx-auto mb-1 text-success" />
              <p className="text-lg font-semibold">{stats.totalCompleted}</p>
              <p className="text-[10px] text-muted-foreground">Completed</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-secondary">
              <AlertTriangle className="h-4 w-4 mx-auto mb-1 text-warning" />
              <p className="text-lg font-semibold">{stats.carryForward}</p>
              <p className="text-[10px] text-muted-foreground">Carry Forward</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-secondary">
              <p className="text-lg font-semibold">{stats.backlog}</p>
              <p className="text-[10px] text-muted-foreground">Backlog</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-secondary">
              <p className="text-lg font-semibold">{stats.additional}</p>
              <p className="text-[10px] text-muted-foreground">Additional</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-secondary">
              <p className="text-lg font-semibold">{stats.bugs}</p>
              <p className="text-[10px] text-muted-foreground">Bugs</p>
            </div>
          </div>

          {stats.carryForward > 0 && (
            <div className="space-y-2">
              <Label>Carry forward unfinished tasks to</Label>
              {availableSprints.length > 0 ? (
                <Select value={carryForwardSprintId} onValueChange={setCarryForwardSprintId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select sprint" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSprints.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.sprint_name} ({candidate.start_date} - {candidate.end_date})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  Create a new sprint to carry forward {stats.carryForward} unfinished task
                  {stats.carryForward === 1 ? '' : 's'}.
                </div>
              )}
            </div>
          )}

          {/* Retrospective Notes */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wellDone">What went well?</Label>
              <Textarea
                id="wellDone"
                value={whatWentWell}
                onChange={e => setWhatWentWell(e.target.value)}
                placeholder="Team collaboration, features delivered..."
                className="min-h-16"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="issues">Issues encountered</Label>
              <Textarea
                id="issues"
                value={issues}
                onChange={e => setIssues(e.target.value)}
                placeholder="Blockers, dependencies, scope changes..."
                className="min-h-16"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="improvements">Improvements for next sprint</Label>
              <Textarea
                id="improvements"
                value={improvements}
                onChange={e => setImprovements(e.target.value)}
                placeholder="Better estimation, earlier blocker resolution..."
                className="min-h-16"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleComplete} disabled={!canComplete}>Complete Sprint</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
