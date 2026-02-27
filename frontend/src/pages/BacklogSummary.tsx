import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTasks, useTeamMembers } from '@/hooks';
import { useTeamSelection } from '@/hooks/use-team-selection';

const DEFAULT_TEAM = 'Developers';
import { TaskStatus } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const DONE_STATUSES: TaskStatus[] = ['Done', 'Closed', 'Fixed'];

interface TeamBacklogSummary {
  team: string;
  total: number;
}

export default function BacklogSummary() {
  const { user } = useAuth();
  const { teams } = useTeamSelection(user?.team);
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers();
  const { data: allTasks = [], isLoading: tasksLoading } = useTasks();
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const allowedTeams = useMemo(() => {
    if (isSuperAdmin) {
      return new Set(teams);
    }
    return new Set([user?.team || DEFAULT_TEAM]);
  }, [isSuperAdmin, teams, user?.team]);
  const visibleTeams = useMemo(
    () => teams.filter((team) => allowedTeams.has(team)),
    [teams, allowedTeams]
  );
  const teamMembersScoped = useMemo(
    () => teamMembers.filter((member) => allowedTeams.has(member.team || DEFAULT_TEAM)),
    [teamMembers, allowedTeams]
  );
  const ownerTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    teamMembers.forEach((member) => {
      map.set(member.id, (member.team || DEFAULT_TEAM) as string);
    });
    return map;
  }, [teamMembers]);

  const backlogTasks = useMemo(() => {
    return allTasks.filter(
      (task) =>
        !task.sprint_id &&
        !DONE_STATUSES.includes(task.status as TaskStatus) &&
        task.type !== 'Bug' &&
        task.type !== 'Change'
    );
  }, [allTasks]);
  const scopedBacklogTasks = useMemo(() => {
    if (isSuperAdmin) return backlogTasks;
    return backlogTasks.filter((task) => {
      const team = ownerTeamMap.get(task.owner_id);
      if (!team) return false;
      return allowedTeams.has(team);
    });
  }, [allowedTeams, backlogTasks, isSuperAdmin, ownerTeamMap]);

  const backlogByTeam = useMemo(() => {
    const summaryMap = new Map<string, TeamBacklogSummary>();

    const ensureTeam = (team: string) => {
      if (!summaryMap.has(team)) {
        summaryMap.set(team, {
          team,
          total: 0,
        });
      }
      return summaryMap.get(team) as TeamBacklogSummary;
    };

    scopedBacklogTasks.forEach((task) => {
      const team = ownerTeamMap.get(task.owner_id) || DEFAULT_TEAM;
      const entry = ensureTeam(team);
      entry.total += 1;
    });

    visibleTeams.forEach((team) => ensureTeam(team));
    if (allowedTeams.has(DEFAULT_TEAM) && !summaryMap.has(DEFAULT_TEAM)) {
      ensureTeam(DEFAULT_TEAM);
    }

    return Array.from(summaryMap.values()).sort((a, b) => a.team.localeCompare(b.team));
  }, [allowedTeams, scopedBacklogTasks, ownerTeamMap, visibleTeams]);

  const totals = backlogByTeam.reduce(
    (acc, item) => {
      acc.total += item.total;
      return acc;
    },
    { total: 0 }
  );

  const teamMembersForSelected = useMemo(() => {
    if (!selectedTeam) return [];
    return teamMembersScoped.filter(
      (member) => (member.team || DEFAULT_TEAM) === selectedTeam
    );
  }, [selectedTeam, teamMembersScoped]);

  const memberBacklogCounts = useMemo(() => {
    const counts = new Map<string, number>();
    teamMembersForSelected.forEach((member) => counts.set(member.id, 0));
    scopedBacklogTasks.forEach((task) => {
      if (!selectedTeam) return;
      const team = ownerTeamMap.get(task.owner_id) || DEFAULT_TEAM;
      if (team !== selectedTeam) return;
      counts.set(task.owner_id, (counts.get(task.owner_id) || 0) + 1);
    });
    return counts;
  }, [scopedBacklogTasks, ownerTeamMap, selectedTeam, teamMembersForSelected]);

  const selectedUserTasks = useMemo(() => {
    if (!selectedUserId) return [];
    return scopedBacklogTasks.filter((task) => task.owner_id === selectedUserId);
  }, [scopedBacklogTasks, selectedUserId]);

  useEffect(() => {
    if (selectedTeam && !allowedTeams.has(selectedTeam)) {
      setSelectedTeam(null);
      setSelectedUserId(null);
    }
  }, [allowedTeams, selectedTeam]);

  if (membersLoading || tasksLoading) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Backlog Summary</h1>
        <p className="text-muted-foreground">Team-level backlog totals</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All Teams</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-center">
            <div className="p-3 rounded-lg bg-secondary">
              <p className="text-2xl font-semibold">{totals.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Teams</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Team</th>
                  <th className="text-center p-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {backlogByTeam.map((item) => (
                  <tr
                    key={item.team}
                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                    onClick={() => {
                      setSelectedTeam(item.team);
                      setSelectedUserId(null);
                    }}
                  >
                    <td className="p-3 font-medium">
                      {item.team}
                      {selectedTeam === item.team && (
                        <span className="ml-2 text-xs text-muted-foreground">(selected)</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <Badge variant="secondary">{item.total}</Badge>
                    </td>
                  </tr>
                ))}
                {backlogByTeam.length === 0 && (
                  <tr>
                    <td colSpan={2} className="p-6 text-center text-muted-foreground">
                      No backlog data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selectedTeam && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Team Backlog: {selectedTeam}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {teamMembersForSelected.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members found for this team.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {teamMembersForSelected.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => setSelectedUserId(member.id)}
                    className={`flex items-center justify-between rounded-lg border p-3 text-left ${
                      selectedUserId === member.id ? 'border-primary bg-primary/5' : 'bg-background'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.role}</p>
                    </div>
                    <Badge variant="secondary">{memberBacklogCounts.get(member.id) || 0}</Badge>
                  </button>
                ))}
              </div>
            )}

            {selectedUserId && (
              <div className="rounded-lg border bg-secondary/20 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">User Backlog</p>
                  <Badge variant="outline">{selectedUserTasks.length}</Badge>
                </div>
                {selectedUserTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No backlog tasks for this user.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedUserTasks.map((task) => (
                      <div key={task.id} className="rounded-md border bg-background p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{task.title}</p>
                          <Badge variant="outline" className="text-[10px]">
                            {task.type}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {task.status} · {task.id}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
