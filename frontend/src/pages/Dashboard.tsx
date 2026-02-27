import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSprints, useTeamMembers, useTasksBySprint } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CreateSprintDialog } from '@/components/CreateSprintDialog';
import { CompleteSprintDialog } from '@/components/CompleteSprintDialog';
import { TeamSelect } from '@/components/TeamSelect';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { 
  Target, 
  CheckCircle2, 
  ClipboardPlus, 
  TrendingUp,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import { SprintHealth } from '@/types';

const isPlannedType = (type?: string) => type === 'Sprint' || type === 'Backlog';

function getHealthBadgeVariant(health: SprintHealth) {
  switch (health) {
    case 'Healthy': return 'success';
    case 'At Risk': return 'warning';
    case 'Critical': return 'destructive';
  }
}

export default function Dashboard() {
  const { user } = useAuth();
  const { teams, selectedTeam, setSelectedTeam } = useTeamSelection(user?.team);

  // React Query hooks
  const { data: sprints = [], isLoading: sprintsLoading } = useSprints();
  const { data: teamMembers = [] } = useTeamMembers();

  // Find active sprint for selected team
  const sprint = sprints.find(s => s.is_active && (s.team || 'Developers') === selectedTeam) || null;

  // Fetch tasks for active sprint
  const { data: tasks = [], isLoading: tasksLoading } = useTasksBySprint(sprint?.id || null);

  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const hideTeamSelect = (user?.team || '') === 'GRC' && !isSuperAdmin;

  const stats = useMemo(() => {
    const sprintTasks = tasks.filter(t => isPlannedType(t.type));
    const additionalTasks = tasks.filter(t => t.type === 'Additional');
    const completedTasks = tasks.filter(t => t.status === 'Done');
    const blockedTasks = tasks.filter(t => t.status === 'Blocked');

    const plannedCount = sprintTasks.length;
    const completedCount = completedTasks.filter(t => isPlannedType(t.type)).length;
    const successRate = plannedCount > 0 ? Math.round((completedCount / plannedCount) * 100) : 0;
    const additionalWorkPercent = tasks.length > 0
      ? Math.round((additionalTasks.length / tasks.length) * 100)
      : 0;

    let health: SprintHealth = 'Healthy';
    if (blockedTasks.length > 2 || additionalWorkPercent > 25) {
      health = 'At Risk';
    }
    if (blockedTasks.length > 4 || additionalWorkPercent > 40 || successRate < 50) {
      health = 'Critical';
    }

    return {
      planned: plannedCount,
      completed: completedCount,
      additional: additionalTasks.length,
      blocked: blockedTasks.length,
      successRate,
      additionalWorkPercent,
      health,
    };
  }, [tasks]);

  if (sprintsLoading || tasksLoading) return null;

  if (!sprint) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="text-muted-foreground">Select a team to view sprint progress.</p>
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
            {user?.role === 'Manager' && (
              <CreateSprintDialog />
            )}
          </div>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No active sprint for {selectedTeam}. Create a sprint to get started.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, {user?.name}</p>
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
          {user?.role === 'Manager' && (
            <>
              <CompleteSprintDialog sprint={sprint} />
              <CreateSprintDialog />
            </>
          )}
          <Badge variant={getHealthBadgeVariant(stats.health)} className="text-sm px-3 py-1">
            {stats.health}
          </Badge>
        </div>
      </div>

      {/* Sprint Info */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{sprint.sprint_name}</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              {sprint.start_date} — {sprint.end_date}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{sprint.sprint_goal}</p>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Planned Tasks</p>
                <p className="text-2xl font-semibold">{stats.planned}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-semibold">{stats.completed}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <ClipboardPlus className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Additional Work</p>
                <p className="text-2xl font-semibold">{stats.additional}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Sprint Progress</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Success Rate</span>
                <span className="font-medium">{stats.successRate}%</span>
              </div>
              <Progress value={stats.successRate} className="h-2" />
            </div>
            <div className="text-sm text-muted-foreground">
              {stats.completed} of {stats.planned} sprint tasks completed
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Risk Indicators</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-2 rounded-lg bg-secondary">
              <span className="text-sm">Blocked Tasks</span>
              <Badge variant={stats.blocked > 2 ? 'destructive' : 'secondary'}>
                {stats.blocked}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-secondary">
              <span className="text-sm">Additional Work %</span>
              <Badge variant={stats.additionalWorkPercent > 25 ? 'warning' : 'secondary'}>
                {stats.additionalWorkPercent}%
              </Badge>
            </div>
            {stats.additionalWorkPercent > 25 && (
              <p className="text-xs text-warning flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Additional work exceeds 25% threshold
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {tasks.slice(0, 5).map(task => {
              const owner = teamMembers.find(m => m.id === task.owner_id);
              return (
                <div key={task.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      task.status === 'Done' ? 'bg-success' :
                      task.status === 'Blocked' ? 'bg-destructive' :
                      task.status === 'In Progress' ? 'bg-primary' : 'bg-muted-foreground'
                    }`} />
                    <div>
                      <p className="text-sm font-medium">{task.title}</p>
                      <p className="text-xs text-muted-foreground">{owner?.name} • {task.module}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {task.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
