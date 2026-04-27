import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { DEFAULT_TEAM } from '@/lib/store';
import { useSprints, useTeamMembers, useTasksBySprint, useTasksByQaSprint } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Task, TeamMember } from '@/types';
import { WORKDAY_HOURS, roundHours, toHours } from '@/lib/time';
import { TeamSelect } from '@/components/TeamSelect';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { AlertTriangle } from 'lucide-react';
import { formatLocalDate } from '@/lib/utils';

const OVERLOAD_THRESHOLD_HOURS = WORKDAY_HOURS * 5;

type WorkloadSource = 'Assigned' | 'QA';

interface WorkloadTaskInfo {
  task: Task;
  source: WorkloadSource;
  effortDays: number;
  effortHours: number;
  actualHours: number;
  qaTestingHours: number;
  qaFixingHours: number;
}

interface TaskBreakdown {
  taskCount: number;
  bugCount: number;
  changeCount: number;
  taskHours: number;
  bugHours: number;
  changeHours: number;
}

interface WorkloadMemberData extends TeamMember {
  estimatedHours: number;
  workedHours: number;
  blockedHours: number;
  fixingHours: number;
  taskCount: number;
  completedCount: number;
  blockedCount: number;
  avgHoursPerWeek: number;
  isOverloaded: boolean;
  utilizationPercent: number;
  completionRate: number;
  assignedTasks: Task[];
  qaTasks: Task[];
  assignedDetailTasks: WorkloadTaskInfo[];
  qaDetailTasks: WorkloadTaskInfo[];
  longTasks: WorkloadTaskInfo[];
  lowTasks: WorkloadTaskInfo[];
  taskBreakdown: TaskBreakdown;
  qaTestingHours: number;
  qaFixingHours: number;
  totalEffortHours: number;
}

const isBug = (type?: string) => type === 'Bug';
const isChange = (type?: string) => type === 'Change';
const isBugType = (type?: string) => isBug(type) || isChange(type);
const isCoreType = (type?: string) => type === 'Sprint' || type === 'Additional' || type === 'Backlog';
const toDateValue = (value?: string) => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export default function TeamWorkload() {
  const { user } = useAuth();
  const { teams, selectedTeam, setSelectedTeam } = useTeamSelection(user?.team);

  // React Query hooks
  const { data: allSprints = [], isLoading: sprintsLoading } = useSprints();
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers();

  const activeSprint = allSprints.find(s => s.is_active && (s.team || DEFAULT_TEAM) === selectedTeam) || null;
  const teamSprints = useMemo(() => {
    return allSprints
      .filter((item) => (item.team || DEFAULT_TEAM) === selectedTeam)
      .sort((a, b) => toDateValue(b.end_date || b.start_date) - toDateValue(a.end_date || a.start_date));
  }, [allSprints, selectedTeam]);
  const [selectedSprintId, setSelectedSprintId] = useState('');
  useEffect(() => {
    const fallback = activeSprint?.id || teamSprints[0]?.id || '';
    setSelectedSprintId((prev) =>
      prev && teamSprints.some((sprint) => sprint.id === prev) ? prev : fallback
    );
  }, [activeSprint?.id, teamSprints]);
  const selectedSprint =
    teamSprints.find((item) => item.id === selectedSprintId) ||
    activeSprint ||
    teamSprints[0] ||
    null;

  const { data: sprintTasksRaw = [], isLoading: tasksLoading } = useTasksBySprint(selectedSprint?.id || null);
  // Tasks from other sprints where QA work was done during this sprint
  const { data: qaSprintTasksRaw = [] } = useTasksByQaSprint(selectedSprint?.id || null);

  const isLoading = sprintsLoading || membersLoading || tasksLoading;

  const teamMembersForTeam = teamMembers.filter(
    (member) => (member.team || DEFAULT_TEAM) === selectedTeam
  );
  const teamMemberIds = new Set(teamMembersForTeam.map((member) => member.id));
  // Only sprint-assigned tasks (no bug board pull by date range)
  const tasks = sprintTasksRaw.filter((task) => teamMemberIds.has(task.owner_id));
  // Split: core tasks for workload, bugs/changes for counts only
  const workloadTasks = tasks.filter((task) => !isBugType(task.type));
  const bugChangeTasks = tasks.filter((task) => isBugType(task.type));
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const hideTeamSelect = ['GRC', 'Ascenders'].includes(user?.team || '') && !isSuperAdmin;

  const workloadMembers = teamMembersForTeam.filter(
    (member) =>
      member.role === 'Developer' ||
      member.role === 'Associate' ||
      member.role === 'Security' ||
      member.role === 'Manager' ||
      member.role === 'QA'
  );

  const workloadData: WorkloadMemberData[] = useMemo(() => {
    // Calculate sprint days when available; fall back to a single work week for bug-only workload.
    let workingWeeks = 1;
    if (selectedSprint) {
      const start = new Date(selectedSprint.start_date);
      const end = new Date(selectedSprint.end_date);
      const sprintDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      const workingDays = Math.ceil(sprintDays * (5 / 7)); // Approximate working days
      workingWeeks = Math.max(1, workingDays / 5);
    }

    // QA activity: tasks from this sprint + cross-sprint tasks where QA was done in this sprint
    const sprintQaTasks = workloadTasks.filter(
      (task) =>
        // Tasks in this sprint that have QA work AND qa_sprint matches (or no qa_sprint set yet)
        ((task.qa_actual_hours || 0) > 0 ||
        (task.qa_fixing_hours || 0) > 0 ||
        Boolean(task.qa_status)) &&
        // Only include if qa_sprint matches this sprint or isn't set (legacy)
        (!task.qa_sprint_id || task.qa_sprint_id === selectedSprint?.id)
    );
    // Cross-sprint QA tasks (from other sprints, tested during this sprint)
    const crossSprintQaTasks = qaSprintTasksRaw.filter(
      (task) => !isBugType(task.type) && teamMemberIds.has(task.owner_id)
    );
    const qaTasks = [...sprintQaTasks, ...crossSprintQaTasks];

    return workloadMembers.map((member) => {
      const isQaMember = member.role === 'QA';
      // Workload uses only core tasks (Sprint/Additional/Backlog)
      const assignedCoreTasks = workloadTasks.filter((t) => t.owner_id === member.id);
      // Bug/change counts from sprint (for display only, not workload hours)
      const assignedBugChanges = bugChangeTasks.filter((t) => t.owner_id === member.id);
      const qaScopeTasks = isQaMember ? qaTasks : [];
      const assignedDetailTaskMap = new Map<string, WorkloadTaskInfo>();

      const getAssignedEffortDays = (task: Task) => task.actual_hours || 0;

      const addAssignedTaskInfo = (task: Task) => {
        const effortDays = getAssignedEffortDays(task);
        assignedDetailTaskMap.set(task.id, {
          task,
          source: 'Assigned',
          effortDays,
          effortHours: toHours(effortDays),
          actualHours: toHours(task.actual_hours || 0),
          qaTestingHours: toHours(task.qa_actual_hours || 0),
          qaFixingHours: toHours(task.qa_fixing_hours || 0),
        });
      };

      assignedCoreTasks.forEach((task) => addAssignedTaskInfo(task));

      const assignedDetailTasks = Array.from(assignedDetailTaskMap.values());
      const qaDetailTasks = qaScopeTasks
        .filter((task) => task.owner_id !== member.id)
        .map((task) => {
          const testingDays = task.qa_actual_hours || 0;
          return {
            task,
            source: 'QA' as const,
            effortDays: testingDays,
            effortHours: toHours(testingDays),
            actualHours: toHours(task.actual_hours || 0),
            qaTestingHours: toHours(testingDays),
            qaFixingHours: 0,
          };
        })
        .filter((item) => item.effortDays > 0);

      const taskCount = assignedCoreTasks.length;
      const completedCount = assignedCoreTasks.filter((t) => t.status === 'Done').length;
      const blockedCount = assignedCoreTasks.filter((t) => t.status === 'Blocked').length;

      const estimatedDays = assignedCoreTasks.reduce((sum, t) => sum + t.estimated_hours, 0);
      const actualDays = assignedCoreTasks.reduce((sum, task) => sum + (task.actual_hours || 0), 0);
      const blockedDays = assignedCoreTasks.reduce((sum, t) => sum + (t.blocked_hours || 0), 0);
      const qaTestingDaysForMember = isQaMember
        ? qaDetailTasks.reduce((sum, item) => sum + item.effortDays, 0)
        : 0;
      const qaFixingDaysForMember = 0;
      const fixingDaysForMember = assignedCoreTasks.reduce(
        (sum, task) => sum + (task.qa_fixing_hours || 0),
        0
      );
      const workedDays = actualDays + qaTestingDaysForMember + fixingDaysForMember;

      const estimatedHours = toHours(estimatedDays);
      const workedHours = toHours(workedDays);
      const blockedHours = toHours(blockedDays);
      const fixingHours = toHours(fixingDaysForMember);

      const avgHoursPerWeek = workingWeeks > 0 ? (isQaMember ? workedHours : estimatedHours) / workingWeeks : 0;
      const isOverloaded = avgHoursPerWeek > OVERLOAD_THRESHOLD_HOURS;
      const utilizationBase = isQaMember ? workedDays : estimatedDays;
      const utilizationPercent = Math.min(100, Math.round((workedDays / Math.max(1, utilizationBase)) * 100));

      // Bug/change counts from sprint (display only, not included in workload hours)
      const bugCount = assignedBugChanges.filter((t) => isBug(t.type)).length;
      const changeCount = assignedBugChanges.filter((t) => isChange(t.type)).length;

      const taskBreakdownDays = assignedDetailTasks.reduce(
        (acc, item) => {
          if (isCoreType(item.task.type)) {
            acc.taskCount += 1;
            acc.taskDays += item.effortDays;
          }
          return acc;
        },
        { taskCount: 0, taskDays: 0 }
      );

      const sortedByEffort = [...assignedDetailTasks].sort((a, b) => b.effortHours - a.effortHours);
      const longTasks = sortedByEffort.filter((item) => item.effortHours > 0).slice(0, 3);
      const lowTasks = [...assignedDetailTasks].sort((a, b) => a.effortHours - b.effortHours).slice(0, 3);
      const totalEffortDays = workedDays;

      return {
        ...member,
        estimatedHours,
        workedHours,
        blockedHours,
        taskCount,
        completedCount,
        blockedCount,
        avgHoursPerWeek,
        isOverloaded,
        utilizationPercent,
        completionRate: taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0,
        assignedTasks: assignedCoreTasks,
        qaTasks: qaDetailTasks.map((item) => item.task),
        assignedDetailTasks,
        qaDetailTasks,
        longTasks,
        lowTasks,
        taskBreakdown: {
          taskCount: taskBreakdownDays.taskCount,
          bugCount,
          changeCount,
          taskHours: toHours(taskBreakdownDays.taskDays),
          bugHours: 0,
          changeHours: 0,
        },
        qaTestingHours: toHours(qaTestingDaysForMember),
        qaFixingHours: toHours(qaFixingDaysForMember),
        fixingHours,
        totalEffortHours: toHours(totalEffortDays),
      };
    });
  }, [selectedSprint, tasks, workloadMembers, qaSprintTasksRaw]);

  const overloadedCount = workloadData.filter(d => d.isOverloaded).length;
  const detailMember = detailMemberId
    ? workloadData.find((member) => member.id === detailMemberId) || null
    : null;

  if (isLoading) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Team Workload</h1>
          <p className="text-muted-foreground">
            {workloadMembers.length} team members {selectedSprint ? `in ${selectedSprint.sprint_name}` : 'with no sprint selected'}
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
          {teamSprints.length > 0 && (
            <Select value={selectedSprintId} onValueChange={setSelectedSprintId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select sprint" />
              </SelectTrigger>
              <SelectContent>
                {teamSprints.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.sprint_name} ({formatLocalDate(item.start_date)} - {formatLocalDate(item.end_date)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {overloadedCount > 0 && (
            <Badge variant="warning" className="text-sm px-3 py-1">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {overloadedCount} Overloaded
            </Badge>
          )}
        </div>
      </div>

      {/* Workload Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workloadData.map(member => (
          <Card key={member.id} className={member.isOverloaded ? 'border-warning' : ''}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                    {member.name.charAt(0)}
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => setDetailMemberId(member.id)}
                      className="text-left"
                      title="View workload details"
                    >
                      <CardTitle className="text-base hover:underline">{member.name}</CardTitle>
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {member.taskBreakdown.taskCount} tasks · {member.taskBreakdown.bugCount} bugs ·{' '}
                      {member.taskBreakdown.changeCount} changes
                    </p>
                    {member.role === 'QA' && (
                      <p className="text-[11px] text-muted-foreground">QA items: {member.qaTasks.length}</p>
                    )}
                  </div>
                </div>
                {member.isOverloaded && (
                  <AlertTriangle className="h-4 w-4 text-warning" />
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Days */}
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Estimated (hrs)</p>
                  <p className="font-semibold">{member.estimatedHours}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Worked (hrs)</p>
                  <p className="font-semibold">{member.workedHours}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Blocked (hrs)</p>
                  <p className="font-semibold">{member.blockedHours}</p>
                </div>
              </div>

              {/* Weekly Average */}
              <div className={`p-2 rounded-lg ${member.isOverloaded ? 'bg-warning/10' : 'bg-secondary'}`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Weekly Avg</span>
                  <span className={`font-medium ${member.isOverloaded ? 'text-warning' : ''}`}>
                    {member.avgHoursPerWeek.toFixed(1)}h/week
                  </span>
                </div>
                {member.isOverloaded && (
                  <p className="text-xs text-warning mt-1">
                    Exceeds {OVERLOAD_THRESHOLD_HOURS}h/week threshold
                  </p>
                )}
              </div>

              {/* Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Completion</span>
                  <span>{member.completionRate}%</span>
                </div>
                <Progress value={member.completionRate} className="h-2" />
              </div>

              {/* Task Breakdown */}
              <div className="flex items-center gap-2">
                <Badge variant="success" className="text-xs">
                  {member.completedCount} Done
                </Badge>
                {member.blockedCount > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {member.blockedCount} Blocked
                  </Badge>
                )}
                <Badge variant="secondary" className="text-xs">
                  {member.taskCount - member.completedCount - member.blockedCount} In Progress
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Summary Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Workload Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4 text-center">
            <div className="p-4 rounded-lg bg-secondary">
              <p className="text-2xl font-semibold">
                {workloadData.reduce((sum, d) => sum + d.taskCount, 0)}
              </p>
              <p className="text-sm text-muted-foreground">Total Tasks</p>
            </div>
            <div className="p-4 rounded-lg bg-secondary">
              <p className="text-2xl font-semibold">
                {workloadData.reduce((sum, d) => sum + d.taskBreakdown.bugCount, 0)}
              </p>
              <p className="text-sm text-muted-foreground">Total Bugs</p>
            </div>
            <div className="p-4 rounded-lg bg-secondary">
              <p className="text-2xl font-semibold">
                {workloadData.reduce((sum, d) => sum + d.taskBreakdown.changeCount, 0)}
              </p>
              <p className="text-sm text-muted-foreground">Total Changes</p>
            </div>
            <div className="p-4 rounded-lg bg-secondary">
              <p className="text-2xl font-semibold">
                {roundHours(workloadData.reduce((sum, d) => sum + d.estimatedHours, 0))}
              </p>
              <p className="text-sm text-muted-foreground">Total Estimated (hrs)</p>
            </div>
            <div className="p-4 rounded-lg bg-secondary">
              <p className="text-2xl font-semibold">
                {roundHours(workloadData.reduce((sum, d) => sum + d.workedHours, 0))}
              </p>
              <p className="text-sm text-muted-foreground">Total Worked (hrs)</p>
            </div>
            <div className="p-4 rounded-lg bg-secondary">
              <p className="text-2xl font-semibold">
                {roundHours(workloadData.reduce((sum, d) => sum + d.blockedHours, 0))}
              </p>
              <p className="text-sm text-muted-foreground">Total Blocked (hrs)</p>
            </div>
            <div className={`p-4 rounded-lg ${overloadedCount > 0 ? 'bg-warning/10' : 'bg-secondary'}`}>
              <p className={`text-2xl font-semibold ${overloadedCount > 0 ? 'text-warning' : ''}`}>
                {overloadedCount}
              </p>
              <p className="text-sm text-muted-foreground">Overloaded</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <WorkloadDetailsDialog
        member={detailMember}
        open={Boolean(detailMember)}
        onOpenChange={(open) => {
          if (!open) setDetailMemberId(null);
        }}
      />
    </div>
  );
}

function DetailGroup({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-lg border bg-secondary/40 p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="space-y-1 text-sm">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-medium text-right">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskEffortList({
  title,
  items,
}: {
  title: string;
  items: WorkloadTaskInfo[];
}) {
  return (
    <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">No tasks available</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.task.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{item.task.title}</p>
                <div className="text-[11px] text-muted-foreground">
                  {item.task.type} · {item.task.status}
                </div>
                {item.source === 'QA' && item.qaTestingHours > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    Testing {item.qaTestingHours}h
                  </div>
                )}
              </div>
              <div className="text-sm font-semibold">{item.effortHours}h</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkloadDetailsDialog({
  member,
  open,
  onOpenChange,
}: {
  member: WorkloadMemberData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!member) return null;

  const longTaskIds = new Set(member.longTasks.map((item) => item.task.id));
  const lowTaskIds = new Set(member.lowTasks.map((item) => item.task.id));
  const detailTasks = [...member.assignedDetailTasks].sort((a, b) => b.effortHours - a.effortHours);
  const isQaMember = member.role === 'QA';

  const assignmentItems = [
    { label: 'Total Items', value: String(member.assignedDetailTasks.length) },
    {
      label: 'Tasks',
      value: `${member.taskBreakdown.taskCount} (${member.taskBreakdown.taskHours}h)`,
    },
    {
      label: 'Bugs',
      value: `${member.taskBreakdown.bugCount} (${member.taskBreakdown.bugHours}h)`,
    },
    {
      label: 'Changes',
      value: `${member.taskBreakdown.changeCount} (${member.taskBreakdown.changeHours}h)`,
    },
    { label: 'Assigned', value: String(member.assignedTasks.length) },
  ];

  const hoursItems = [
    { label: 'Worked', value: `${member.workedHours}h` },
    { label: 'Estimated', value: `${member.estimatedHours}h` },
    { label: 'Blocked', value: `${member.blockedHours}h` },
    ...(member.fixingHours > 0 ? [{ label: 'Fixing', value: `${member.fixingHours}h` }] : []),
  ];

  const qaItems = [
    { label: 'QA Items', value: String(member.qaTasks.length) },
    { label: 'Testing', value: `${member.qaTestingHours}h` },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Workload: {member.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailGroup title="Assignment Mix" items={assignmentItems} />
            <DetailGroup title="Hours" items={hoursItems} />
            {isQaMember && <DetailGroup title="QA Activity" items={qaItems} />}
            <DetailGroup
              title="Totals"
              items={[
                { label: 'Total Effort', value: `${member.totalEffortHours}h` },
                { label: 'Completion', value: `${member.completionRate}%` },
                { label: 'Weekly Avg', value: `${member.avgHoursPerWeek.toFixed(1)}h` },
              ]}
            />
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            <TaskEffortList title="Longest tasks" items={member.longTasks} />
            <TaskEffortList title="Lowest tasks" items={member.lowTasks} />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assigned Workload
            </div>
            {detailTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground">No tasks assigned</div>
            ) : (
              <ScrollArea className="h-72 pr-2">
                <div className="space-y-2">
                  {detailTasks.map((item) => (
                    <div
                      key={item.task.id}
                      className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium truncate">{item.task.title}</p>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <Badge variant="outline" className="text-[10px]">
                            {item.task.type}
                          </Badge>
                          <span>{item.task.status}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Worked {item.actualHours}h
                          {item.qaFixingHours > 0 ? ` · Fixing ${item.qaFixingHours}h` : ''}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="text-sm font-semibold">{item.effortHours}h</div>
                        {longTaskIds.has(item.task.id) && (
                          <Badge variant="warning" className="text-[10px]">
                            Long
                          </Badge>
                        )}
                        {!longTaskIds.has(item.task.id) && lowTaskIds.has(item.task.id) && (
                          <Badge variant="secondary" className="text-[10px]">
                            Low
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
          {isQaMember && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                QA Workload
              </div>
              {member.qaDetailTasks.length === 0 ? (
                <div className="text-sm text-muted-foreground">No QA items</div>
              ) : (
                <ScrollArea className="h-60 pr-2">
                  <div className="space-y-2">
                    {member.qaDetailTasks.map((item) => (
                      <div
                        key={item.task.id}
                        className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium truncate">{item.task.title}</p>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <Badge variant="outline" className="text-[10px]">
                              {item.task.type}
                            </Badge>
                            <span>{item.task.status}</span>
                            <Badge variant="secondary" className="text-[10px]">
                              QA
                            </Badge>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Testing {item.qaTestingHours}h
                          </div>
                        </div>
                        <div className="text-sm font-semibold">{item.effortHours}h</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
