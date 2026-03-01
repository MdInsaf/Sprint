import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSprints, useTeamMembers, useTasksBySprint, useApprovals } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TeamSelect } from '@/components/TeamSelect';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

export default function AdditionalWork() {
  const { user } = useAuth();
  const { teams, selectedTeam, setSelectedTeam } = useTeamSelection(user?.team);

  // React Query hooks
  const { data: sprints = [], isLoading: sprintsLoading } = useSprints();
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers();
  const { data: approvals = [], isLoading: approvalsLoading } = useApprovals();

  const sprint = sprints.find(s => s.is_active && (s.team || 'Developers') === selectedTeam) || null;
  const { data: tasks = [], isLoading: tasksLoading } = useTasksBySprint(sprint?.id || null);
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const hideTeamSelect = ['GRC', 'Ascenders'].includes(user?.team || '') && !isSuperAdmin;
  const isLoading = sprintsLoading || membersLoading || tasksLoading || approvalsLoading;

  const additionalTasks = useMemo(() => {
    return tasks.filter(t => t.type === 'Additional');
  }, [tasks]);

  const stats = useMemo(() => {
    const totalTasks = tasks.length;
    const additionalCount = additionalTasks.length;
    const additionalPercent = totalTasks > 0 ? Math.round((additionalCount / totalTasks) * 100) : 0;
    const totalAdditionalDays = additionalTasks.reduce((sum, t) => sum + t.estimated_hours, 0);
    const completedAdditional = additionalTasks.filter(t => t.status === 'Done').length;

    return {
      count: additionalCount,
      percent: additionalPercent,
      days: totalAdditionalDays,
      completed: completedAdditional,
      isWarning: additionalPercent > 25,
    };
  }, [tasks, additionalTasks]);

  if (isLoading) return null;

  if (!sprint) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Additional Work Log</h1>
            <p className="text-muted-foreground">Select a team to view sprint details.</p>
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
          <h1 className="text-2xl font-semibold">Additional Work Log</h1>
          <p className="text-muted-foreground">Unplanned work added to {sprint.sprint_name}</p>
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

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Additional Tasks</p>
            <p className="text-2xl font-semibold">{stats.count}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Completed</p>
            <p className="text-2xl font-semibold">{stats.completed}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Days</p>
            <p className="text-2xl font-semibold">{stats.days}d</p>
          </CardContent>
        </Card>

        <Card className={stats.isWarning ? 'border-warning' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">% of Sprint</p>
              {stats.isWarning && <AlertTriangle className="h-4 w-4 text-warning" />}
            </div>
            <p className={`text-2xl font-semibold ${stats.isWarning ? 'text-warning' : ''}`}>
              {stats.percent}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Warning Banner */}
      {stats.isWarning && (
        <Card className="bg-warning/10 border-warning">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <div>
              <p className="font-medium text-warning">Sprint Risk: High Additional Work</p>
              <p className="text-sm text-muted-foreground">
                Additional work exceeds 25% of sprint capacity. Consider reviewing scope.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Additional Work Threshold</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Current: {stats.percent}%</span>
              <span className="text-muted-foreground">Threshold: 25%</span>
            </div>
            <Progress 
              value={Math.min(stats.percent, 100)} 
              className={`h-2 ${stats.isWarning ? '[&>div]:bg-warning' : ''}`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Tasks Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Additional Tasks</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Impact</TableHead>
                <TableHead>Approved By</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {additionalTasks.map(task => {
                const owner = teamMembers.find(m => m.id === task.owner_id);
                const approval = approvals.find(a => a.task_id === task.id);
                const approver = approval?.approved_by 
                  ? teamMembers.find(m => m.id === approval.approved_by)
                  : null;

                return (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{task.title}</p>
                        <p className="text-xs text-muted-foreground">{task.module}</p>
                      </div>
                    </TableCell>
                    <TableCell>{owner?.name}</TableCell>
                    <TableCell className="max-w-xs">
                      <p className="text-sm text-muted-foreground truncate">
                        {approval?.reason || 'No reason provided'}
                      </p>
                    </TableCell>
                    <TableCell>
                      {approval && (
                        <Badge variant={
                          approval.impact === 'High' ? 'destructive' :
                          approval.impact === 'Medium' ? 'warning' : 'secondary'
                        }>
                          {approval.impact}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {approver ? (
                        <div className="flex items-center gap-1 text-sm">
                          <CheckCircle2 className="h-3 w-3 text-success" />
                          {approver.name}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Pending
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        task.status === 'Done' ? 'success' :
                        task.status === 'Blocked' ? 'destructive' :
                        task.status === 'In Progress' ? 'default' : 'secondary'
                      }>
                        {task.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {additionalTasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No additional work logged
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
