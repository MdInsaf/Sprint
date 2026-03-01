import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSprints, useTeamMembers, useTasksBySprint } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TeamSelect } from '@/components/TeamSelect';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { AlertTriangle, Clock } from 'lucide-react';
import { toHours } from '@/lib/time';

export default function Blockers() {
  const { user } = useAuth();
  const { teams, selectedTeam, setSelectedTeam } = useTeamSelection(user?.team);

  // React Query hooks
  const { data: sprints = [], isLoading: sprintsLoading } = useSprints();
  const { data: teamMembers = [] } = useTeamMembers();

  const sprint = sprints.find(s => s.is_active && (s.team || 'Developers') === selectedTeam) || null;
  const { data: tasks = [], isLoading: tasksLoading } = useTasksBySprint(sprint?.id || null);
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const hideTeamSelect = ['GRC', 'Ascenders'].includes(user?.team || '') && !isSuperAdmin;

  const blockedTasks = useMemo(() => {
    return tasks.filter(t => t.status === 'Blocked');
  }, [tasks]);

  const getBlockedDuration = (blockerDate?: string) => {
    if (!blockerDate) return 0;
    const blocked = new Date(blockerDate);
    const now = new Date();
    const hours = Math.floor((now.getTime() - blocked.getTime()) / (1000 * 60 * 60));
    return hours;
  };

  if (!sprint) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Blocked Tasks</h1>
            <p className="text-muted-foreground">Select a team to view blockers.</p>
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
          <h1 className="text-2xl font-semibold">Blocked Tasks</h1>
          <p className="text-muted-foreground">{blockedTasks.length} tasks blocked in {sprint.sprint_name}</p>
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
          {blockedTasks.length > 0 && (
            <Badge variant="destructive" className="text-sm px-3 py-1">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {blockedTasks.length} Blocked
            </Badge>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Blocked</p>
            <p className="text-2xl font-semibold">{blockedTasks.length}</p>
          </CardContent>
        </Card>

        <Card className={blockedTasks.some(t => getBlockedDuration(t.blocker_date) > 24) ? 'border-destructive' : ''}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Blocked &gt;24 Hours</p>
            <p className="text-2xl font-semibold text-destructive">
              {blockedTasks.filter(t => getBlockedDuration(t.blocker_date) > 24).length}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Hours at Risk</p>
            <p className="text-2xl font-semibold">
              {toHours(
                blockedTasks.reduce((sum, t) => sum + (t.estimated_hours - t.actual_hours), 0)
              )}
              h
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Blockers Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Blocker Details</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Blocker Reason</TableHead>
                <TableHead>Time Blocked</TableHead>
                <TableHead>Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blockedTasks.map(task => {
                const owner = teamMembers.find(m => m.id === task.owner_id);
                const blockedHours = getBlockedDuration(task.blocker_date);
                const isOldBlocker = blockedHours > 24;

                return (
                  <TableRow key={task.id} className={isOldBlocker ? 'bg-destructive/5' : ''}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{task.title}</p>
                        <p className="text-xs text-muted-foreground">{task.module}</p>
                      </div>
                    </TableCell>
                    <TableCell>{owner?.name}</TableCell>
                    <TableCell className="max-w-sm">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        <p className={`text-sm ${task.blocker ? '' : 'text-muted-foreground'}`}>
                          {task.blocker || 'No blocker reason provided.'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className={`flex items-center gap-1 ${isOldBlocker ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                        <Clock className="h-3 w-3" />
                        {blockedHours > 48 ? `${Math.floor(blockedHours / 24)}d` : `${blockedHours}h`}
                        {isOldBlocker && (
                          <Badge variant="destructive" className="ml-2 text-[10px]">
                            Overdue
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        task.priority === 'Blocker' ? 'destructive' :
                        task.priority === 'High' ? 'destructive' :
                        task.priority === 'Medium' ? 'warning' : 'secondary'
                      }>
                        {task.priority}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {blockedTasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12">
                    <div className="text-muted-foreground">
                      <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No blocked tasks</p>
                      <p className="text-sm">Great! Your sprint is running smoothly.</p>
                    </div>
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
