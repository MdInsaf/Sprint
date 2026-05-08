import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { DEFAULT_TEAM } from '@/lib/store';
import { useSprints, useTasksBySprint, useSprintSummaries, useUpdateSprint, useTeamMembers } from '@/hooks';
import { exportSprintToCSV, exportSprintToPDF } from '@/lib/exportUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TeamSelect } from '@/components/TeamSelect';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { CheckCircle2, XCircle, ArrowRight, ClipboardPlus, TrendingUp, TrendingDown, Minus, History, Download, FileText, FileSpreadsheet } from 'lucide-react';
import { formatLocalDate } from '@/lib/utils';

const isPlannedType = (type?: string) => type === 'Sprint' || type === 'Backlog';

export default function SprintSummary() {
  const { user } = useAuth();
  const { data: sprints = [], isLoading: sprintsLoading } = useSprints();
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers();
  const { teams, selectedTeam, setSelectedTeam } = useTeamSelection(user?.team);
  const teamSprints = sprints.filter((s) => (s.team || DEFAULT_TEAM) === selectedTeam);
  const { data: sprintSummaries = [], isLoading: summariesLoading } = useSprintSummaries();
  const activeSprint = sprints.find(s => s.is_active && (s.team || DEFAULT_TEAM) === selectedTeam) || null;
  const [selectedSprintId, setSelectedSprintId] = useState<string>(
    activeSprint?.id || teamSprints[0]?.id || ''
  );
  const selectedSprint = teamSprints.find(s => s.id === selectedSprintId);
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const hideTeamSelect = ['GRC', 'Ascenders'].includes(user?.team || '') && !isSuperAdmin;
  const moduleLabel = ['GRC', 'Ascenders'].includes(selectedTeam) ? 'Client' : 'Module';
  const updateSprintMutation = useUpdateSprint();

  // Get saved summary for completed sprints, or calculate live for active sprint
  const savedSummary = selectedSprint ? sprintSummaries.find(s => s.sprint_id === selectedSprint.id) || null : null;
  const { data: tasks = [], isLoading: tasksLoading } = useTasksBySprint(selectedSprintId || null);

  const isLoading = sprintsLoading || membersLoading || summariesLoading || tasksLoading;

  const stats = useMemo(() => {
    if (savedSummary) {
      const totalPlanned = savedSummary.planned_tasks + savedSummary.carry_forward;
      const carryForwardCompletion =
        totalPlanned > 0
          ? Math.round((savedSummary.completed_tasks / totalPlanned) * 100)
          : 0;
      return {
        planned: savedSummary.planned_tasks,
        completed: savedSummary.completed_tasks,
        carryForward: savedSummary.carry_forward,
        additional: savedSummary.additional_tasks,
        successRate: savedSummary.success_percentage,
        blocked: tasks.filter(t => t.status === 'Blocked').length,
        carryForwardCompletion,
        whatWentWell: savedSummary.what_went_well,
        issues: savedSummary.issues,
        improvements: savedSummary.improvements,
        completedDate: savedSummary.completed_date,
      };
    }

    const isCreatedInSprint = (createdDate?: string) => {
      if (!createdDate || !selectedSprint) return false;
      return createdDate >= selectedSprint.start_date && createdDate <= selectedSprint.end_date;
    };
    const isCarryForwardTask = (createdDate?: string) => {
      if (!createdDate || !selectedSprint) return false;
      return createdDate < selectedSprint.start_date;
    };

    const sprintCreatedTasks = tasks.filter((t) => isCreatedInSprint(t.created_date));
    const carryForwardTasks = tasks.filter((t) => isCarryForwardTask(t.created_date));
    const sprintTasks = tasks.filter(t => isPlannedType(t.type));
    const additionalTasks = tasks.filter(t => t.type === 'Additional');
    const completed = sprintCreatedTasks.filter(t => t.status === 'Done');
    const blocked = tasks.filter(t => t.status === 'Blocked');

    const plannedCount = sprintTasks.filter(t => isCreatedInSprint(t.created_date)).length;
    const completedSprintTasks = completed.filter(t => isPlannedType(t.type)).length;
    const successRate = plannedCount > 0 ? Math.round((completedSprintTasks / plannedCount) * 100) : 0;
    const totalPlanned = plannedCount + carryForwardTasks.length;
    const carryForwardCompletion =
      totalPlanned > 0 ? Math.round((completedSprintTasks / totalPlanned) * 100) : 0;

    return {
      planned: plannedCount,
      completed: completedSprintTasks,
      carryForward: carryForwardTasks.length,
      additional: additionalTasks.length,
      successRate,
      blocked: blocked.length,
      carryForwardCompletion,
      whatWentWell: '',
      issues: '',
      improvements: '',
      completedDate: undefined,
    };
  }, [tasks, savedSummary, selectedSprint]);

  useEffect(() => {
    if (teamSprints.length === 0) {
      if (selectedSprintId) setSelectedSprintId('');
      return;
    }
    if (!teamSprints.some((s) => s.id === selectedSprintId)) {
      setSelectedSprintId(activeSprint?.id || teamSprints[0]?.id || '');
    }
  }, [teamSprints, activeSprint?.id, selectedSprintId]);

  // Comparison data for completed sprints (uses saved summaries only)
  const comparisonData = useMemo(() => {
    const completedSprints = teamSprints.filter(s => !s.is_active);
    return completedSprints.map(sprint => {
      const summary = sprintSummaries.find(s => s.sprint_id === sprint.id);
      if (summary) {
        return {
          sprint,
          ...summary,
        };
      }
      // No saved summary - show defaults
      return {
        sprint,
        sprint_id: sprint.id,
        planned_tasks: 0,
        completed_tasks: 0,
        success_percentage: 0,
        additional_tasks: 0,
        carry_forward: 0,
      };
    }).sort((a, b) => new Date(b.sprint.end_date).getTime() - new Date(a.sprint.end_date).getTime());
  }, [teamSprints, sprintSummaries]);

  const handleSetActiveSprint = () => {
    if (!selectedSprint || selectedSprint.is_active) return;
    updateSprintMutation.mutate({ ...selectedSprint, is_active: true });
  };

  // Calculate trend compared to previous sprint
  const getTrend = (current: number, previous: number | undefined) => {
    if (previous === undefined) return null;
    if (current > previous) return 'up';
    if (current < previous) return 'down';
    return 'same';
  };

  const previousSummary = comparisonData.length > 1 ? comparisonData[1] : undefined;

  if (isLoading) return null;

  if (sprints.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Sprint Summary</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No sprints available.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (teamSprints.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Sprint Summary</h1>
            <p className="text-muted-foreground">Select a team to view sprint summaries.</p>
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
            No sprints for {selectedTeam}.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sprint Summary</h1>
          <p className="text-muted-foreground">
            {selectedSprint?.sprint_name} • {formatLocalDate(selectedSprint?.start_date)} — {formatLocalDate(selectedSprint?.end_date)}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {!hideTeamSelect && (
            <TeamSelect
              teams={teams}
              value={selectedTeam}
              onChange={setSelectedTeam
              }
              triggerClassName="w-40"
              placeholder="Team"
            />
          )}
          <Select value={selectedSprintId} onValueChange={setSelectedSprintId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select Sprint" />
            </SelectTrigger>
            <SelectContent>
              {teamSprints.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  {s.sprint_name} {s.is_active && '(Active)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedSprint && (
            <>
              {!selectedSprint.is_active && (
                <Button variant="outline" size="sm" onClick={handleSetActiveSprint}>
                  Set as Active
                </Button>
              )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    exportSprintToCSV({
                      sprint: selectedSprint,
                      tasks,
                      teamMembers,
                      summary: savedSummary,
                      moduleLabel,
                    })
                  }
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    exportSprintToPDF({
                      sprint: selectedSprint,
                      tasks,
                      teamMembers,
                      summary: savedSummary,
                    })
                  }
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Export as PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList>
          <TabsTrigger value="summary">Current Summary</TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-4 w-4 mr-2" />
            Sprint History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-6">
          {/* Success Rate */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Sprint Success</CardTitle>
                {stats.completedDate && (
                  <Badge variant="secondary">Completed {formatLocalDate(stats.completedDate)}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-4xl font-bold">{stats.successRate}%</span>
                <Badge variant={
                  stats.successRate >= 80 ? 'success' :
                  stats.successRate >= 60 ? 'warning' : 'destructive'
                } className="text-sm px-3 py-1">
                  {stats.successRate >= 80 ? 'Excellent' :
                   stats.successRate >= 60 ? 'Good' : 'Needs Improvement'}
                </Badge>
              </div>
              <Progress value={stats.successRate} className="h-3" />
              <p className="text-sm text-muted-foreground">
                {stats.completed} of {stats.planned} planned sprint tasks completed
              </p>
            </CardContent>
          </Card>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <CheckCircle2 className="h-5 w-5 text-success mx-auto mb-2" />
                <p className="text-2xl font-semibold">{stats.completed}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 text-center">
                <ArrowRight className="h-5 w-5 text-warning mx-auto mb-2" />
                <p className="text-2xl font-semibold">{stats.carryForward}</p>
                <p className="text-xs text-muted-foreground">Carry Forward</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 text-center">
                <ClipboardPlus className="h-5 w-5 text-primary mx-auto mb-2" />
                <p className="text-2xl font-semibold">{stats.additional}</p>
                <p className="text-xs text-muted-foreground">Additional</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 text-center">
                <XCircle className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
                <p className="text-2xl font-semibold">{stats.blocked}</p>
                <p className="text-xs text-muted-foreground">Blocked</p>
              </CardContent>
            </Card>
          </div>

          {/* Breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Task Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <span>Planned Sprint Tasks</span>
                  <span className="font-semibold">{stats.planned}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-success/10">
                  <span>Completed Sprint Tasks</span>
                  <span className="font-semibold text-success">{stats.completed}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-warning/10">
                  <span>Additional Tasks Added</span>
                  <span className="font-semibold text-warning">{stats.additional}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <span>Carry Forward Tasks</span>
                  <span className="font-semibold">{stats.carryForward}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <span>Carry Forward Completion</span>
                  <span className="font-semibold">{stats.carryForwardCompletion}%</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/10">
                  <span>Blocked Tasks</span>
                  <span className="font-semibold text-destructive">{stats.blocked}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Retrospective Notes (if saved) */}
          {(stats.whatWentWell || stats.issues || stats.improvements) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Retrospective Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {stats.whatWentWell && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-success">What went well</p>
                    <p className="text-sm text-muted-foreground">{stats.whatWentWell}</p>
                  </div>
                )}
                {stats.issues && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-destructive">Issues encountered</p>
                    <p className="text-sm text-muted-foreground">{stats.issues}</p>
                  </div>
                )}
                {stats.improvements && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-primary">Improvements for next sprint</p>
                    <p className="text-sm text-muted-foreground">{stats.improvements}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          {comparisonData.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No completed sprints yet. Complete a sprint to see history.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Comparison Chart */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Sprint Performance Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {comparisonData.slice(0, 5).map((data, index) => {
                      const prevData = comparisonData[index + 1];
                      const trend = getTrend(data.success_percentage, prevData?.success_percentage);
                      
                      return (
                        <div key={data.sprint_id} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{data.sprint.sprint_name}</span>
                              {index === 0 && <Badge variant="secondary" className="text-[10px]">Latest</Badge>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-lg font-semibold">{data.success_percentage}%</span>
                              {trend === 'up' && <TrendingUp className="h-4 w-4 text-success" />}
                              {trend === 'down' && <TrendingDown className="h-4 w-4 text-destructive" />}
                              {trend === 'same' && <Minus className="h-4 w-4 text-muted-foreground" />}
                            </div>
                          </div>
                          <Progress value={data.success_percentage} className="h-2" />
                          <div className="flex gap-4 text-xs text-muted-foreground">
                            <span>Planned: {data.planned_tasks}</span>
                            <span>Completed: {data.completed_tasks}</span>
                            <span>Additional: {data.additional_tasks}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Sprint History Table */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">All Sprints</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border max-h-[60vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">Sprint</th>
                          <th className="text-center p-3 font-medium">Dates</th>
                          <th className="text-center p-3 font-medium">Success</th>
                          <th className="text-center p-3 font-medium">Planned</th>
                          <th className="text-center p-3 font-medium">Completed</th>
                          <th className="text-center p-3 font-medium">Additional</th>
                          <th className="text-center p-3 font-medium">Carry Forward</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparisonData.map(data => (
                          <tr key={data.sprint_id} className="border-b last:border-0">
                            <td className="p-3 font-medium">{data.sprint.sprint_name}</td>
                            <td className="p-3 text-center text-muted-foreground">
                              {formatLocalDate(data.sprint.start_date)} - {formatLocalDate(data.sprint.end_date)}
                            </td>
                            <td className="p-3 text-center">
                              <Badge variant={
                                data.success_percentage >= 80 ? 'success' :
                                data.success_percentage >= 60 ? 'warning' : 'destructive'
                              }>
                                {data.success_percentage}%
                              </Badge>
                            </td>
                            <td className="p-3 text-center">{data.planned_tasks}</td>
                            <td className="p-3 text-center text-success">{data.completed_tasks}</td>
                            <td className="p-3 text-center text-warning">{data.additional_tasks}</td>
                            <td className="p-3 text-center text-muted-foreground">{data.carry_forward}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}