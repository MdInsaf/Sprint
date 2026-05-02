// src/pages/MyWorkspace.tsx
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { DEFAULT_TEAM, updateLeaveDates } from '@/lib/store';
import { useSprints, useTasks, useTeamMembers } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { DayPicker } from 'react-day-picker';
import { ChevronLeft, ChevronRight, AlertTriangle, CalendarDays, Sun, Sunset } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sprint, Task, TeamMember } from '@/types';
import { WORKDAY_HOURS, toHours } from '@/lib/time';
import { format, isSameDay } from 'date-fns';
import { toast } from 'sonner';
import { formatLocalDate } from '@/lib/utils';

// ── Shared leave utilities (single source of truth) ───────────────────────────
import {
  HalfDayPeriod,
  LeaveEntry,
  DAY_MS,
  parseLeaveEntries,
  formatLeaveEntries,
  getLeaveEntryMeta,
  filterLeaveForRange,
  summariseLeave,
} from '@/lib/leave-utils';

// ── Reusable leave display component ─────────────────────────────────────────
import { EmployeeLeavePanel } from '@/components/EmployeeLeavePanel';

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
  taskHours: number;
  bugHours: number;
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

// ── Utility ────────────────────────────────────────────────────────────────────

const isBugType = (type?: string) => type === 'Bug' || type === 'Change';
const isCoreType = (type?: string) =>
  type === 'Sprint' || type === 'Additional' || type === 'Backlog';
const isReopenBug = (task: Task) => isBugType(task.type) && task.status === 'Reopen';
const normalizeTeam = (value?: string) => (value || DEFAULT_TEAM).trim().toLowerCase();

const toDateValue = (value?: string) => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const isBugWithinSprint = (task: Task, sprint: Sprint) => {
  if (!isBugType(task.type)) return false;
  const createdAt = toDateValue(task.created_date);
  const start = toDateValue(sprint.start_date);
  const end = toDateValue(sprint.end_date);
  if (!createdAt || !start || !end) return false;
  const endInclusive = end + DAY_MS - 1;
  return createdAt >= start && createdAt <= endInclusive;
};

// ── Custom Leave Calendar ──────────────────────────────────────────────────────
// Uses DayPicker only for navigation/layout; all selection logic is handled
// manually via onClick so DayPicker's internal selection state never conflicts.

function LeaveCalendar({
  leaveEntries,
  onToggle,
}: {
  leaveEntries: LeaveEntry[];
  /** Called when a date cell is clicked — parent decides add/remove */
  onToggle: (date: Date) => void;
}) {
  const entryMap = useMemo(() => {
    const map = new Map<string, LeaveEntry>();
    for (const e of leaveEntries) {
      map.set(format(e.date, 'yyyy-MM-dd'), e);
    }
    return map;
  }, [leaveEntries]);

  return (
    <DayPicker
      mode="default"
      showOutsideDays
      className="p-3 pointer-events-auto"
      classNames={{
        months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        month: 'space-y-4',
        caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-medium',
        nav: 'space-x-1 flex items-center',
        nav_button: cn(
          buttonVariants({ variant: 'outline' }),
          'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100',
        ),
        nav_button_previous: 'absolute left-1',
        nav_button_next: 'absolute right-1',
        table: 'w-full border-collapse space-y-1',
        head_row: 'flex',
        head_cell: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]',
        row: 'flex w-full mt-2',
        cell: 'h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20',
        day: cn(buttonVariants({ variant: 'ghost' }), 'h-9 w-9 p-0 font-normal'),
        day_outside: 'text-muted-foreground opacity-50',
        day_disabled: 'text-muted-foreground opacity-50',
        day_hidden: 'invisible',
      }}
      components={{
        IconLeft: () => <ChevronLeft className="h-4 w-4" />,
        IconRight: () => <ChevronRight className="h-4 w-4" />,
        Day: ({
          date,
          displayMonth,
        }: {
          date: Date;
          displayMonth: Date;
          [key: string]: unknown;
        }) => {
          const dateStr = format(date, 'yyyy-MM-dd');
          const entry = entryMap.get(dateStr);
          const isOutside = date.getMonth() !== displayMonth.getMonth();
          const isToday = isSameDay(date, new Date());

          let indicator: React.ReactNode = null;
          if (entry) {
            if (entry.type === 'full') {
              indicator = (
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-md bg-blue-500/80 z-0"
                />
              );
            } else if (entry.type === 'half' && entry.period === 'morning') {
              indicator = (
                <span
                  aria-hidden
                  className="absolute top-0 left-0 right-0 h-1/2 rounded-t-md bg-amber-400/80 z-0"
                />
              );
            } else if (entry.type === 'half' && entry.period === 'afternoon') {
              indicator = (
                <span
                  aria-hidden
                  className="absolute bottom-0 left-0 right-0 h-1/2 rounded-b-md bg-orange-400/80 z-0"
                />
              );
            }
          }

          return (
            <button
              type="button"
              onClick={() => onToggle(date)}
              className={cn(
                'relative h-9 w-9 rounded-md text-sm font-normal transition-colors overflow-hidden',
                'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                isOutside && 'text-muted-foreground opacity-50',
                isToday && !entry && 'bg-accent text-accent-foreground',
                entry?.type === 'full' && 'text-white font-semibold',
                entry?.type === 'half' && 'font-semibold',
              )}
            >
              {indicator}
              <span className="relative z-10">{date.getDate()}</span>
            </button>
          );
        },
      }}
    />
  );
}

// ── Workload builder ───────────────────────────────────────────────────────────

const buildWorkloadData = ({
  members,
  tasks,
  sprint,
}: {
  members: TeamMember[];
  tasks: Task[];
  sprint: Sprint | null;
}): WorkloadMemberData[] => {
  let workingWeeks = 1;
  if (sprint) {
    const start = new Date(sprint.start_date);
    const end = new Date(sprint.end_date);
    const sprintDays = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const workingDays = Math.ceil(sprintDays * (5 / 7));
    workingWeeks = Math.max(1, workingDays / 5);
  }

  const qaMemberIds = new Set(
    members.filter((member) => member.role === 'QA').map((member) => member.id),
  );
  const qaTasks = tasks.filter(
    (task) =>
      (task.qa_actual_hours || 0) > 0 ||
      (task.qa_fixing_hours || 0) > 0 ||
      Boolean(task.qa_status),
  );
  const reopenBugTasks = tasks.filter((task) => isReopenBug(task));

  return members.map((member) => {
    const isQaMember = member.role === 'QA';
    const assignedTasks = tasks.filter((t) => t.owner_id === member.id);
    const qaScopeTasks = isQaMember
      ? Array.from(
          new Map(
            [...qaTasks, ...reopenBugTasks].map((task) => [task.id, task]),
          ).values(),
        )
      : [];
    const assignedDetailTaskMap = new Map<string, WorkloadTaskInfo>();

    const getAssignedEffortDays = (task: Task) => {
      const actualDays = task.actual_hours || 0;
      if (!isQaMember && isReopenBug(task)) return 0;
      return actualDays;
    };

    const getQaTestingDays = (task: Task) => {
      if (isReopenBug(task) && !qaMemberIds.has(task.owner_id || '')) {
        return task.actual_hours || 0;
      }
      return task.qa_actual_hours || 0;
    };

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

    assignedTasks.forEach((task) => addAssignedTaskInfo(task));

    const assignedDetailTasks = Array.from(assignedDetailTaskMap.values());
    const qaDetailTasks = qaScopeTasks
      .filter((task) => task.owner_id !== member.id)
      .map((task) => {
        const testingDays = getQaTestingDays(task);
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

    const taskCount = assignedTasks.length;
    const completedCount = assignedTasks.filter((t) => t.status === 'Done').length;
    const blockedCount = assignedTasks.filter((t) => t.status === 'Blocked').length;

    const estimatedDays = assignedTasks.reduce((sum, t) => sum + t.estimated_hours, 0);
    const actualDays = assignedTasks.reduce((sum, task) => {
      if (!isQaMember && isReopenBug(task)) return sum;
      return sum + (task.actual_hours || 0);
    }, 0);
    const blockedDays = assignedTasks.reduce(
      (sum, t) => sum + (t.blocked_hours || 0),
      0,
    );
    const qaTestingDaysForMember = isQaMember
      ? qaDetailTasks.reduce((sum, item) => sum + item.effortDays, 0)
      : 0;
    const qaFixingDaysForMember = 0;
    const fixingDaysForMember = assignedTasks.reduce(
      (sum, task) => sum + (task.qa_fixing_hours || 0),
      0,
    );
    const workedDays = actualDays + qaTestingDaysForMember + fixingDaysForMember;

    const estimatedHours = toHours(estimatedDays);
    const workedHours = toHours(workedDays);
    const blockedHours = toHours(blockedDays);
    const fixingHours = toHours(fixingDaysForMember);

    const avgHoursPerWeek =
      workingWeeks > 0
        ? (isQaMember ? workedHours : estimatedHours) / workingWeeks
        : 0;
    const isOverloaded = avgHoursPerWeek > OVERLOAD_THRESHOLD_HOURS;
    const utilizationBase = isQaMember ? workedDays : estimatedDays;
    const utilizationPercent = Math.min(
      100,
      Math.round((workedDays / Math.max(1, utilizationBase)) * 100),
    );

    const taskBreakdownDays = assignedDetailTasks.reduce(
      (acc, item) => {
        if (isBugType(item.task.type)) {
          acc.bugCount += 1;
          acc.bugDays += item.effortDays;
        } else if (isCoreType(item.task.type)) {
          acc.taskCount += 1;
          acc.taskDays += item.effortDays;
        }
        return acc;
      },
      { taskCount: 0, bugCount: 0, taskDays: 0, bugDays: 0 },
    );

    const sortedByEffort = [...assignedDetailTasks].sort(
      (a, b) => b.effortHours - a.effortHours,
    );
    const longTasks = sortedByEffort.filter((item) => item.effortHours > 0).slice(0, 3);
    const lowTasks = [...assignedDetailTasks]
      .sort((a, b) => a.effortHours - b.effortHours)
      .slice(0, 3);
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
      completionRate:
        taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0,
      assignedTasks,
      qaTasks: qaDetailTasks.map((item) => item.task),
      assignedDetailTasks,
      qaDetailTasks,
      longTasks,
      lowTasks,
      taskBreakdown: {
        taskCount: taskBreakdownDays.taskCount,
        bugCount: taskBreakdownDays.bugCount,
        taskHours: toHours(taskBreakdownDays.taskDays),
        bugHours: toHours(taskBreakdownDays.bugDays),
      },
      qaTestingHours: toHours(qaTestingDaysForMember),
      qaFixingHours: toHours(qaFixingDaysForMember),
      fixingHours,
      totalEffortHours: toHours(totalEffortDays),
    };
  });
};

// ── Main component ─────────────────────────────────────────────────────────────

export default function MyWorkspace() {
  const { user, refreshUser } = useAuth();
  const { data: allSprints = [], isLoading: sprintsLoading } = useSprints();
  const { data: allTasksData = [], isLoading: tasksLoading } = useTasks();
  const { data: allTeamMembers = [], isLoading: membersLoading } = useTeamMembers();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveEntries, setLeaveEntries] = useState<LeaveEntry[]>([]);

  const isLoading = sprintsLoading || tasksLoading || membersLoading;

  useEffect(() => {
    if (!leaveOpen) {
    setLeaveEntries(parseLeaveEntries(user?.leave_dates));
    }
  }, [user?.leave_dates, leaveOpen]);

  if (!user) return null;

  // Reset local state to saved values when dialog opens
  const handleOpenLeave = () => {
    setLeaveEntries(parseLeaveEntries(user.leave_dates));
    setLeaveOpen(true);
  };

  // Toggle a date: if already selected → remove; if not → add as full day
  const handleDateToggle = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    setLeaveEntries((prev) => {
      const exists = prev.find((e) => format(e.date, 'yyyy-MM-dd') === dateStr);
      if (exists) {
        // Remove it
        return prev.filter((e) => format(e.date, 'yyyy-MM-dd') !== dateStr);
      }
      // Add as full day
      return [...prev, { date, type: 'full' }];
    });
  };

  const setLeaveType = (dateStr: string, type: 'full' | 'half') => {
    setLeaveEntries((prev) =>
      prev.map((e) => {
        if (format(e.date, 'yyyy-MM-dd') !== dateStr) return e;
        if (type === 'full') return { date: e.date, type: 'full' };
        return { date: e.date, type: 'half', period: 'morning' };
      }),
    );
  };

  const setHalfPeriod = (dateStr: string, period: HalfDayPeriod) => {
    setLeaveEntries((prev) =>
      prev.map((e) => {
        if (format(e.date, 'yyyy-MM-dd') !== dateStr) return e;
        return { date: e.date, type: 'half', period };
      }),
    );
  };

  const handleLeaveSave = async () => {
    try {
      const formatted = formatLeaveEntries(leaveEntries);
      await updateLeaveDates(user.id, formatted);
      setLeaveOpen(false);
      await refreshUser();
      toast.success('Leave dates updated');
    } catch {
      toast.error('Failed to update leave dates');
    }
  };

  const team = user.team || DEFAULT_TEAM;
  const teamKey = normalizeTeam(team);

  const activeSprint =
    allSprints.find(
      (s) => s.is_active && (s.team || DEFAULT_TEAM) === team,
    ) || null;

  const teamSprints = useMemo(() => {
    return allSprints
      .filter((item) => normalizeTeam(item.team) === teamKey)
      .sort(
        (a, b) =>
          toDateValue(b.end_date || b.start_date) -
          toDateValue(a.end_date || a.start_date),
      );
  }, [allSprints, teamKey]);

  const [selectedSprintId, setSelectedSprintId] = useState('');
  useEffect(() => {
    const fallback = activeSprint?.id || teamSprints[0]?.id || '';
    setSelectedSprintId((prev) =>
      prev && teamSprints.some((sprint) => sprint.id === prev) ? prev : fallback,
    );
  }, [activeSprint?.id, teamSprints]);

  const selectedSprint =
    teamSprints.find((item) => item.id === selectedSprintId) ||
    activeSprint ||
    teamSprints[0] ||
    null;

  const teamMembers = allTeamMembers.filter(
    (member) => normalizeTeam(member.team) === teamKey,
  );
  const teamMemberIds = useMemo(
    () => new Set(teamMembers.map((member) => member.id)),
    [teamMembers],
  );

  const getWorkloadTasksForSprint = (sprint: Sprint | null) => {
    if (!sprint) return [];
    const coreSprintTasks = allTasksData.filter(
      (task) => task.sprint_id === sprint.id && !isBugType(task.type),
    );
    const sprintBugTasks = allTasksData.filter((task) =>
      isBugWithinSprint(task, sprint),
    );
    return [...coreSprintTasks, ...sprintBugTasks].filter((task) =>
      teamMemberIds.has(task.owner_id),
    );
  };

  const tasks = getWorkloadTasksForSprint(selectedSprint);

  const workloadMembers = teamMembers.filter(
    (member) =>
      member.role === 'Developer' ||
      member.role === 'Associate' ||
      member.role === 'Security' ||
      member.role === 'Manager' ||
      member.role === 'QA',
  );

  const workloadData: WorkloadMemberData[] = useMemo(() => {
    return buildWorkloadData({
      members: workloadMembers,
      tasks,
      sprint: selectedSprint,
    });
  }, [workloadMembers, tasks, selectedSprint]);

  const lastTwoSprints = useMemo(() => {
    const nonActive = teamSprints.filter((item) => !item.is_active);
    if (nonActive.length >= 2) return nonActive.slice(0, 2);
    return teamSprints.slice(0, 2);
  }, [teamSprints]);

  const lastTwoWorkloads = useMemo(() => {
    return lastTwoSprints.map((sprintItem) => {
      const sprintTasks = getWorkloadTasksForSprint(sprintItem);
      const sprintWorkload = buildWorkloadData({
        members: workloadMembers,
        tasks: sprintTasks,
        sprint: sprintItem,
      });
      const memberData =
        sprintWorkload.find((item) => item.id === user.id) || null;
      return { sprint: sprintItem, member: memberData };
    });
  }, [allTasksData, lastTwoSprints, teamMemberIds, workloadMembers, user.id]);

  const previousSprint = useMemo(() => {
    if (!selectedSprint) {
      return teamSprints.find((item) => !item.is_active) || null;
    }
    const currentIndex = teamSprints.findIndex(
      (item) => item.id === selectedSprint.id,
    );
    if (currentIndex === -1)
      return teamSprints.find((item) => !item.is_active) || null;
    return teamSprints.find((_, index) => index > currentIndex) || null;
  }, [selectedSprint, teamSprints]);

  const previousWorkload = useMemo(() => {
    if (!previousSprint) return null;
    const sprintTasks = getWorkloadTasksForSprint(previousSprint);
    const sprintWorkload = buildWorkloadData({
      members: workloadMembers,
      tasks: sprintTasks,
      sprint: previousSprint,
    });
    const memberData =
      sprintWorkload.find((item) => item.id === user.id) || null;
    return { sprint: previousSprint, member: memberData };
  }, [allTasksData, previousSprint, teamMemberIds, workloadMembers, user.id]);

  const member = workloadData.find((item) => item.id === user.id) || null;

  if (isLoading) return null;

  if (!member) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">My Workspace</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No workload data available yet.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My Workspace</h1>
          <p className="text-muted-foreground">
            {selectedSprint
              ? `Sprint: ${selectedSprint.sprint_name}`
              : 'No sprint selected'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleOpenLeave}>
            Manage Leave
          </Button>
          {teamSprints.length > 0 && (
            <Select value={selectedSprintId} onValueChange={setSelectedSprintId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select sprint" />
              </SelectTrigger>
              <SelectContent>
                {teamSprints.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.sprint_name} ({formatLocalDate(item.start_date)} -{' '}
                    {formatLocalDate(item.end_date)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* ── Workload cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

        {/* Current sprint card */}
        <Card className={member.isOverloaded ? 'border-warning' : ''}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                  {member.name.charAt(0)}
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    {selectedSprint?.sprint_name || 'Current Sprint'}
                  </p>
                  <CardTitle className="text-base">{member.name}</CardTitle>
                  {member.role === 'QA' ? (
                    <p className="text-xs text-muted-foreground">
                      Assigned {member.taskCount} · QA {member.qaTasks.length}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {member.taskCount} tasks
                    </p>
                  )}
                </div>
              </div>
              {member.isOverloaded && (
                <Badge variant="warning" className="text-xs px-2 py-1">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Overloaded
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
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

            <div
              className={`p-2 rounded-lg ${
                member.isOverloaded ? 'bg-warning/10' : 'bg-secondary'
              }`}
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Weekly Avg</span>
                <span
                  className={`font-medium ${member.isOverloaded ? 'text-warning' : ''}`}
                >
                  {member.avgHoursPerWeek.toFixed(1)}h/week
                </span>
              </div>
              {member.isOverloaded && (
                <p className="text-xs text-warning mt-1">
                  Exceeds {OVERLOAD_THRESHOLD_HOURS}h/week threshold
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Completion</span>
                <span>{member.completionRate}%</span>
              </div>
              <Progress value={member.completionRate} className="h-2" />
            </div>

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
                {member.taskCount - member.completedCount - member.blockedCount} In
                Progress
              </Badge>
            </div>

            {/* Compact leave chips */}
            <EmployeeLeavePanel
              leaveDates={user.leave_dates}
              sprint={selectedSprint}
              compact
            />
          </CardContent>
        </Card>

        {/* Previous sprint card */}
        {previousWorkload?.member && (
          <Card
            className={previousWorkload.member.isOverloaded ? 'border-warning' : ''}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                    {previousWorkload.member.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[11px] text-muted-foreground">
                        {previousWorkload.sprint.sprint_name}
                      </p>
                      <Badge variant="secondary" className="text-[10px]">
                        Previous Sprint
                      </Badge>
                    </div>
                    <CardTitle className="text-base">
                      {previousWorkload.member.name}
                    </CardTitle>
                    {previousWorkload.member.role === 'QA' ? (
                      <p className="text-xs text-muted-foreground">
                        Assigned {previousWorkload.member.taskCount} · QA{' '}
                        {previousWorkload.member.qaTasks.length}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {previousWorkload.member.taskCount} tasks
                      </p>
                    )}
                  </div>
                </div>
                {previousWorkload.member.isOverloaded && (
                  <Badge variant="warning" className="text-xs px-2 py-1">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Overloaded
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Estimated (hrs)</p>
                  <p className="font-semibold">
                    {previousWorkload.member.estimatedHours}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Worked (hrs)</p>
                  <p className="font-semibold">{previousWorkload.member.workedHours}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Blocked (hrs)</p>
                  <p className="font-semibold">
                    {previousWorkload.member.blockedHours}
                  </p>
                </div>
              </div>

              <div
                className={`p-2 rounded-lg ${
                  previousWorkload.member.isOverloaded ? 'bg-warning/10' : 'bg-secondary'
                }`}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Weekly Avg</span>
                  <span
                    className={`font-medium ${
                      previousWorkload.member.isOverloaded ? 'text-warning' : ''
                    }`}
                  >
                    {previousWorkload.member.avgHoursPerWeek.toFixed(1)}h/week
                  </span>
                </div>
                {previousWorkload.member.isOverloaded && (
                  <p className="text-xs text-warning mt-1">
                    Exceeds {OVERLOAD_THRESHOLD_HOURS}h/week threshold
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Completion</span>
                  <span>{previousWorkload.member.completionRate}%</span>
                </div>
                <Progress value={previousWorkload.member.completionRate} className="h-2" />
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="success" className="text-xs">
                  {previousWorkload.member.completedCount} Done
                </Badge>
                {previousWorkload.member.blockedCount > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {previousWorkload.member.blockedCount} Blocked
                  </Badge>
                )}
                <Badge variant="secondary" className="text-xs">
                  {previousWorkload.member.taskCount -
                    previousWorkload.member.completedCount -
                    previousWorkload.member.blockedCount}{' '}
                  In Progress
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Leave Schedule Card ── */}
      {(user.leave_dates ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              My Leave Schedule
              {selectedSprint && (
                <Badge variant="secondary" className="text-[10px] ml-1">
                  {selectedSprint.sprint_name}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmployeeLeavePanel
              leaveDates={user.leave_dates}
              sprint={selectedSprint}
              compact={false}
              showCalendar={false}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Last 2 Sprints ── */}
      {lastTwoWorkloads.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Last 2 Sprints</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lastTwoWorkloads.map(({ sprint: sprintItem, member: sprintMember }) => (
                <div
                  key={sprintItem.id}
                  className="rounded-lg border bg-secondary/40 p-4 space-y-3"
                >
                  <div>
                    <p className="text-sm font-semibold">{sprintItem.sprint_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatLocalDate(sprintItem.start_date)} -{' '}
                      {formatLocalDate(sprintItem.end_date)}
                    </p>
                  </div>
                  {sprintMember ? (
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Estimated</p>
                        <p className="font-semibold">{sprintMember.estimatedHours}h</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Worked</p>
                        <p className="font-semibold">{sprintMember.workedHours}h</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Blocked</p>
                        <p className="font-semibold">{sprintMember.blockedHours}h</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No workload recorded.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Workload Details ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Workload Details</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkloadDetailsSection member={member} />
        </CardContent>
      </Card>

      {/* ── Leave Dialog ── */}
      <Dialog
        open={leaveOpen}
        onOpenChange={(open) => {
          setLeaveOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[560px]" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>My Leave Dates</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground font-medium">Legend:</span>
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-blue-500/15 text-blue-400 border-blue-500/30">
                <CalendarDays className="h-2.5 w-2.5" /> Full Day
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-amber-500/15 text-amber-400 border-amber-500/30">
                <Sun className="h-2.5 w-2.5" /> Morning Half
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-orange-500/15 text-orange-400 border-orange-500/30">
                <Sunset className="h-2.5 w-2.5" /> Afternoon Half
              </span>
            </div>

            {/* Calendar — click to toggle dates */}
            <LeaveCalendar leaveEntries={leaveEntries} onToggle={handleDateToggle} />

            {/* Per-date type selector list */}
            {leaveEntries.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {leaveEntries
                  .slice()
                  .sort((a, b) => a.date.getTime() - b.date.getTime())
                  .map((entry) => {
                    const dateStr = format(entry.date, 'yyyy-MM-dd');
                    const isHalf = entry.type === 'half';
                    return (
                      <div
                        key={dateStr}
                        className="rounded-lg border bg-secondary/40 px-3 py-2 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium flex items-center gap-2">
                            {isHalf ? (
                              entry.period === 'morning' ? (
                                <Sun className="h-3.5 w-3.5 text-amber-400" />
                              ) : (
                                <Sunset className="h-3.5 w-3.5 text-orange-400" />
                              )
                            ) : (
                              <CalendarDays className="h-3.5 w-3.5 text-blue-400" />
                            )}
                            {format(entry.date, 'MMM d, yyyy')}
                          </span>
                          <div className="flex items-center gap-1 rounded-full border bg-background p-0.5 text-xs">
                            <button
                              type="button"
                              onClick={() => setLeaveType(dateStr, 'full')}
                              className={`px-3 py-1 rounded-full transition-colors ${
                                !isHalf
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              Full Day
                            </button>
                            <button
                              type="button"
                              onClick={() => setLeaveType(dateStr, 'half')}
                              className={`px-3 py-1 rounded-full transition-colors ${
                                isHalf
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              Half Day
                            </button>
                          </div>
                        </div>

                        {isHalf && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              Period:
                            </span>
                            <div className="flex items-center gap-1 rounded-full border bg-background p-0.5 text-xs">
                              <button
                                type="button"
                                onClick={() => setHalfPeriod(dateStr, 'morning')}
                                className={`px-3 py-1 rounded-full transition-colors ${
                                  entry.period === 'morning'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                🌅 Morning
                              </button>
                              <button
                                type="button"
                                onClick={() => setHalfPeriod(dateStr, 'afternoon')}
                                className={`px-3 py-1 rounded-full transition-colors ${
                                  entry.period === 'afternoon'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                🌇 Afternoon
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Click on dates in the calendar to add leave.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setLeaveOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleLeaveSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

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
                  {item.task.type} - {item.task.status}
                </div>
              </div>
              <div className="text-sm font-semibold">{item.effortHours}h</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkloadDetailsSection({ member }: { member: WorkloadMemberData }) {
  const longTaskIds = new Set(member.longTasks.map((item) => item.task.id));
  const lowTaskIds = new Set(member.lowTasks.map((item) => item.task.id));
  const detailTasks = [...member.assignedDetailTasks].sort(
    (a, b) => b.effortHours - a.effortHours,
  );
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
    { label: 'Assigned', value: String(member.assignedTasks.length) },
  ];

  const hoursItems = [
    { label: 'Worked', value: `${member.workedHours}h` },
    { label: 'Estimated', value: `${member.estimatedHours}h` },
    { label: 'Blocked', value: `${member.blockedHours}h` },
    ...(member.fixingHours > 0
      ? [{ label: 'Fixing', value: `${member.fixingHours}h` }]
      : []),
  ];

  const qaItems = [
    { label: 'QA Items', value: String(member.qaTasks.length) },
    { label: 'Testing', value: `${member.qaTestingHours}h` },
  ];

  return (
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
                      {item.qaFixingHours > 0
                        ? ` · Fixing ${item.qaFixingHours}h`
                        : ''}
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
  );
}