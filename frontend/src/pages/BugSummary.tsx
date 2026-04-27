import { useMemo, useState } from 'react';
import { useTasks, useTeamMembers, useDebounce } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bug, CheckCircle2, AlertCircle, RefreshCcw } from 'lucide-react';
import { formatLocalDate } from '@/lib/utils';

export default function BugSummary() {
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers();
  const { data: allTasks = [], isLoading: tasksLoading } = useTasks();
  const [filterOwner, setFilterOwner] = useState<string[]>([]);
  const [filterSeverity, setFilterSeverity] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const debouncedSearch = useDebounce(searchQuery, 250);

  const bugs = useMemo(() => {
    let items = allTasks.filter((t) => t.type === 'Bug' || t.type === 'Change');
    if (filterOwner.length > 0) {
      items = items.filter((b) => filterOwner.includes(b.owner_id || ''));
    }
    if (filterSeverity.length > 0) {
      items = items.filter((b) => filterSeverity.includes(b.priority || ''));
    }
    if (filterStatus.length > 0) {
      items = items.filter((b) => filterStatus.includes(b.status || ''));
    }
    if (filterType.length > 0) {
      items = items.filter((b) => filterType.includes(b.type || ''));
    }
    if (filterStartDate || filterEndDate) {
      items = items.filter((b) => {
        const created = b.created_date || '';
        if (!created) return false;
        if (filterStartDate && created < filterStartDate) return false;
        if (filterEndDate && created > filterEndDate) return false;
        return true;
      });
    }
    if (debouncedSearch.trim()) {
      const term = debouncedSearch.toLowerCase();
      items = items.filter(
        (b) =>
          (b.title || '').toLowerCase().includes(term) ||
          (b.module || '').toLowerCase().includes(term) ||
          (b.description || '').toLowerCase().includes(term) ||
          (b.steps_to_reproduce || '').toLowerCase().includes(term)
      );
    }
    return items;
  }, [allTasks, filterOwner, filterSeverity, filterStatus, filterType, filterStartDate, filterEndDate, debouncedSearch]);

  const bugOnly = bugs.filter((b) => b.type === 'Bug');
  const changeOnly = bugs.filter((b) => b.type === 'Change');
  const openBugCount = bugOnly.filter((b) => b.status !== 'Closed' && b.status !== 'Done').length;
  const openChangeCount = changeOnly.filter((b) => b.status !== 'Closed' && b.status !== 'Done').length;
  const closedBugCount = bugOnly.filter((b) => b.status === 'Closed' || b.status === 'Done').length;
  const closedChangeCount = changeOnly.filter((b) => b.status === 'Closed' || b.status === 'Done').length;
  const bySeverity: Record<string, number> = {};
  bugs.forEach((b) => {
    const key = b.priority || 'Unspecified';
    bySeverity[key] = (bySeverity[key] || 0) + 1;
  });

  const recent = bugs
    .slice()
    .sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''))
    .slice(0, 10);

  if (membersLoading || tasksLoading) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold">Bugs Summary</h1>
          <p className="text-muted-foreground">Overview of bugs and changes across sprints</p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
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
                    options={teamMembers
                      .filter((m) =>
                        m.role === 'Developer' ||
                        m.role === 'Associate' ||
                        m.role === 'Security' ||
                        m.role === 'QA' ||
                        m.role === 'Manager'
                      )
                      .map((m) => ({ label: m.name, value: m.id }))}
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
                    label="Status"
                    allLabel="All Statuses"
                    options={[
                      { label: 'To Do', value: 'To Do' },
                      { label: 'In Progress', value: 'In Progress' },
                      { label: 'Fixed', value: 'Fixed' },
                      { label: 'Reopen', value: 'Reopen' },
                      { label: 'Closed', value: 'Closed' },
                      { label: 'Done', value: 'Done' },
                    ]}
                    value={filterStatus}
                    onChange={setFilterStatus}
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

                  <div className="space-y-2">
                    <Label htmlFor="bug-summary-start">Created from</Label>
                    <Input
                      id="bug-summary-start"
                      type="date"
                      value={filterStartDate}
                      onChange={(e) => setFilterStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bug-summary-end">Created to</Label>
                    <Input
                      id="bug-summary-end"
                      type="date"
                      value={filterEndDate}
                      onChange={(e) => setFilterEndDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search bugs..."
          className="w-full md:w-52"
          aria-label="Search bugs"
        />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <Bug className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Bugs</p>
                <p className="text-2xl font-semibold">{bugOnly.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <RefreshCcw className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Changes</p>
                <p className="text-2xl font-semibold">{changeOnly.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <Bug className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Bugs Opened</p>
                <p className="text-2xl font-semibold">{openBugCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <RefreshCcw className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Changes Opened</p>
                <p className="text-2xl font-semibold">{openChangeCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <AlertCircle className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Bugs Closed</p>
                <p className="text-2xl font-semibold">{closedBugCount}</p>
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
                <p className="text-sm text-muted-foreground">Changes Closed</p>
                <p className="text-2xl font-semibold">{closedChangeCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">By Severity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.entries(bySeverity).length === 0 ? (
            <span className="text-sm text-muted-foreground">No data</span>
          ) : (
            Object.entries(bySeverity).map(([sev, count]) => (
              <Badge key={sev} variant="outline" className="text-sm">
                {sev}: {count}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Bugs/Changes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recent.length === 0 ? (
            <div className="text-sm text-muted-foreground">No bugs or changes recorded.</div>
          ) : (
            recent.map((bug) => (
              <div
                key={bug.id}
                className="flex items-center justify-between p-3 rounded-lg bg-secondary/50"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">{bug.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {bug.module || 'Unspecified'} | {formatLocalDate(bug.created_date)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {bug.type || 'Bug'}
                  </Badge>
                  <Badge variant="outline">{bug.priority || 'Priority'}</Badge>
                  <Badge variant={bug.status === 'Closed' || bug.status === 'Done' ? 'success' : 'secondary'}>
                    {bug.status}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
