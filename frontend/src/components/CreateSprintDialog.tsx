import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { DEFAULT_TEAM } from '@/lib/store';
import { useCreateSprint } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { TeamSelect } from '@/components/TeamSelect';
import { Sprint } from '@/types';
import { toast } from 'sonner';

interface CreateSprintDialogProps {
  onSprintCreated?: () => void;
}

export function CreateSprintDialog({ onSprintCreated }: CreateSprintDialogProps) {
  const { user } = useAuth();
  const createSprintMutation = useCreateSprint();
  const [open, setOpen] = useState(false);
  const [sprintName, setSprintName] = useState('');
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [sprintGoal, setSprintGoal] = useState('');
  const [setAsActive, setSetAsActive] = useState(true);
  const [holidayDates, setHolidayDates] = useState<Date[]>([]);
  const { teams, selectedTeam, setSelectedTeam } = useTeamSelection(user?.team);
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const hideTeamSelect = ['GRC', 'Ascenders'].includes(user?.team || '') && !isSuperAdmin;

  useEffect(() => {
    if (!startDate || !endDate) return;
    setHolidayDates((dates) => dates.filter((date) => date >= startDate && date <= endDate));
  }, [startDate, endDate]);

  const resetForm = () => {
    setSprintName('');
    setStartDate(undefined);
    setEndDate(undefined);
    setSprintGoal('');
    setSetAsActive(true);
    setHolidayDates([]);
    setSelectedTeam(user?.team || DEFAULT_TEAM);
  };

  const handleSubmit = () => {
    if (!sprintName.trim()) {
      toast.error('Sprint name is required');
      return;
    }
    if (!startDate) {
      toast.error('Start date is required');
      return;
    }
    if (!endDate) {
      toast.error('End date is required');
      return;
    }
    if (endDate < startDate) {
      toast.error('End date must be after start date');
      return;
    }

    const holidayDateValues = Array.from(
      new Set(
        holidayDates
          .filter((date) => (!startDate || date >= startDate) && (!endDate || date <= endDate))
          .map((date) => format(date, 'yyyy-MM-dd'))
      )
    ).sort();

    const newSprint: Sprint = {
      id: `sprint-${Date.now()}`,
      sprint_name: sprintName.trim(),
      start_date: format(startDate, 'yyyy-MM-dd'),
      end_date: format(endDate, 'yyyy-MM-dd'),
      sprint_goal: sprintGoal.trim(),
      holiday_dates: holidayDateValues,
      is_active: setAsActive,
      team: selectedTeam || DEFAULT_TEAM,
    };

    createSprintMutation.mutate(newSprint);
    setOpen(false);
    resetForm();
    onSprintCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Sprint
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Sprint</DialogTitle>
          <DialogDescription>
            Set up a new sprint with dates and goals for your team.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="sprint-name">Sprint Name</Label>
            <Input
              id="sprint-name"
              placeholder="e.g., Sprint 25"
              value={sprintName}
              onChange={(e) => setSprintName(e.target.value)}
            />
          </div>

          {!hideTeamSelect && (
            <div className="grid gap-2">
              <Label>Team</Label>
              <TeamSelect
                teams={teams}
                value={selectedTeam}
                onChange={setSelectedTeam}
                triggerClassName="w-full"
                placeholder="Select team"
              />
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            <div className="grid gap-2">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    disabled={(date) => startDate ? date < startDate : false}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Holidays (optional)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "justify-start text-left font-normal",
                    holidayDates.length === 0 && "text-muted-foreground"
                  )}
                  disabled={!startDate || !endDate}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {holidayDates.length > 0
                    ? `${holidayDates.length} selected`
                    : "Select holidays"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="multiple"
                  selected={holidayDates}
                  onSelect={(dates) => setHolidayDates(dates ?? [])}
                  disabled={(date) =>
                    !startDate || !endDate || date < startDate || date > endDate
                  }
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            {holidayDates.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {holidayDates
                  .slice()
                  .sort((a, b) => a.getTime() - b.getTime())
                  .map((date) => format(date, 'MMM d'))
                  .join(', ')}
              </p>
            )}
            {!startDate || !endDate ? (
              <p className="text-xs text-muted-foreground">
                Set sprint dates to enable holiday selection.
              </p>
            ) : null}
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="sprint-goal">Sprint Goal</Label>
            <Textarea
              id="sprint-goal"
              placeholder="Describe the main objectives for this sprint..."
              value={sprintGoal}
              onChange={(e) => setSprintGoal(e.target.value)}
              rows={3}
            />
          </div>
          
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="set-active"
              checked={setAsActive}
              onChange={(e) => setSetAsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <Label htmlFor="set-active" className="text-sm font-normal cursor-pointer">
              Set as active sprint
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Create Sprint</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
