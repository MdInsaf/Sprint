// src/components/EmployeeLeavePanel.tsx
//
// Reusable leave-visibility component for manager-level users.
// Accepts a TeamMember (or any object with leave_dates) plus an optional
// Sprint for date-range filtering, and renders:
//   • A compact inline chip summary  (compact={true})
//   • A full section with calendar tiles + badge list  (compact={false}, default)
//
// Usage — inside WorkloadDetailsDialog (full):
//   <EmployeeLeavePanel leaveDates={member.leave_dates} sprint={selectedSprint} />
//
// Usage — inside a workload card (compact):
//   <EmployeeLeavePanel leaveDates={member.leave_dates} sprint={selectedSprint} compact />

import { useMemo, useState } from 'react';
import { format, isSameDay, addMonths } from 'date-fns';
import { CalendarDays, Sun, Sunset, ChevronLeft, ChevronRight } from 'lucide-react';
import { Sprint } from '@/types';
import {
  LeaveEntry,
  parseLeaveEntries,
  filterLeaveForRange,
  summariseLeave,
  getLeaveEntryMeta,
} from '@/lib/leave-utils';

// ─── Icon helper ──────────────────────────────────────────────────────────────

function LeaveIcon({
  name,
  className = 'h-3 w-3',
}: {
  name: 'CalendarDays' | 'Sun' | 'Sunset';
  className?: string;
}) {
  if (name === 'CalendarDays') return <CalendarDays className={className} />;
  if (name === 'Sun') return <Sun className={className} />;
  return <Sunset className={className} />;
}

// ─── Mini calendar tile grid ──────────────────────────────────────────────────
// Renders a single read-only month with leave highlights.
// Supports previous/next navigation when leave entries span multiple months.

function LeaveCalendarView({
  entries,
  sprint,
}: {
  entries: LeaveEntry[];
  sprint: Sprint | null;
}) {
  // Determine the best default month to show:
  // 1. First month that has a leave entry (most relevant)
  // 2. Sprint start month
  // 3. Current month
  const defaultAnchor = useMemo(() => {
    if (entries.length > 0) {
      const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());
      return new Date(sorted[0].date.getFullYear(), sorted[0].date.getMonth(), 1);
    }
    if (sprint) {
      const d = new Date(sprint.start_date);
      return new Date(d.getFullYear(), d.getMonth(), 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, [entries, sprint]);

  const [currentMonth, setCurrentMonth] = useState<Date>(defaultAnchor);

  // Re-anchor when entries change (e.g. different employee opened)
  useMemo(() => {
    setCurrentMonth(defaultAnchor);
  }, [defaultAnchor]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // Sunday of the week containing first of month
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  // 42-cell grid (6 weeks × 7 days)
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }

  const entryMap = useMemo(() => {
    const map = new Map<string, LeaveEntry>();
    for (const e of entries) {
      map.set(format(e.date, 'yyyy-MM-dd'), e);
    }
    return map;
  }, [entries]);

  const today = new Date();
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  // Determine if there are leave entries in prev/next months for navigation hints
  const hasLeaveInPrevMonth = entries.some((e) => {
    const prev = addMonths(currentMonth, -1);
    return e.date.getFullYear() === prev.getFullYear() && e.date.getMonth() === prev.getMonth();
  });
  const hasLeaveInNextMonth = entries.some((e) => {
    const next = addMonths(currentMonth, 1);
    return e.date.getFullYear() === next.getFullYear() && e.date.getMonth() === next.getMonth();
  });

  return (
    <div className="rounded-lg border bg-secondary/30 p-3">
      {/* Month header with navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setCurrentMonth((m) => addMonths(m, -1))}
          className={`h-6 w-6 flex items-center justify-center rounded hover:bg-accent transition-colors ${
            hasLeaveInPrevMonth ? 'text-foreground' : 'text-muted-foreground opacity-40'
          }`}
          title="Previous month"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        <p className="text-xs font-semibold text-center text-muted-foreground">
          {format(firstOfMonth, 'MMMM yyyy')}
        </p>

        <button
          type="button"
          onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          className={`h-6 w-6 flex items-center justify-center rounded hover:bg-accent transition-colors ${
            hasLeaveInNextMonth ? 'text-foreground' : 'text-muted-foreground opacity-40'
          }`}
          title="Next month"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Day-name row */}
      <div className="grid grid-cols-7 mb-1">
        {dayNames.map((d) => (
          <div key={d} className="text-center text-[10px] text-muted-foreground pb-1">
            {d}
          </div>
        ))}
      </div>

      {/* Date cells */}
      <div className="grid grid-cols-7 gap-px">
        {cells.map((date) => {
          const dateStr = format(date, 'yyyy-MM-dd');
          const entry = entryMap.get(dateStr);
          const isCurrentMonth = date.getMonth() === month;
          const isToday = isSameDay(date, today);

          // Sprint range highlight
          const inSprint =
            sprint &&
            date >= new Date(sprint.start_date) &&
            date <= new Date(sprint.end_date);

          let cellBg = '';
          let cellText = '';
          let overlay: React.ReactNode = null;

          if (entry) {
            if (entry.type === 'full') {
              cellBg = 'bg-blue-500/80';
              cellText = 'text-white font-semibold';
            } else if (entry.type === 'half' && entry.period === 'morning') {
              overlay = (
                <span className="absolute inset-x-0 top-0 h-1/2 bg-amber-400/80 rounded-t-sm z-0" />
              );
              cellText = 'font-semibold';
            } else {
              // afternoon
              overlay = (
                <span className="absolute inset-x-0 bottom-0 h-1/2 bg-orange-400/80 rounded-b-sm z-0" />
              );
              cellText = 'font-semibold';
            }
          } else if (inSprint && isCurrentMonth) {
            cellBg = 'bg-primary/5';
          }

          return (
            <div
              key={dateStr}
              className={[
                'relative h-7 flex items-center justify-center rounded-sm text-[11px] overflow-hidden',
                isCurrentMonth ? '' : 'opacity-30',
                isToday && !entry ? 'ring-1 ring-primary/40' : '',
                cellBg,
                cellText || (isCurrentMonth ? 'text-foreground' : 'text-muted-foreground'),
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {overlay}
              <span className="relative z-10">{date.getDate()}</span>
            </div>
          );
        })}
      </div>

      {/* Multi-month indicator */}
      {entries.length > 0 && (
        <div className="flex justify-center gap-1 mt-2">
          {Array.from(
            new Set(entries.map((e) => format(e.date, 'yyyy-MM')))
          ).sort().map((ym) => {
            const [y, m] = ym.split('-').map(Number);
            const isActive = y === year && m - 1 === month;
            return (
              <button
                key={ym}
                type="button"
                onClick={() => setCurrentMonth(new Date(y, m - 1, 1))}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  isActive ? 'bg-primary' : 'bg-muted-foreground/30 hover:bg-muted-foreground/60'
                }`}
                title={format(new Date(y, m - 1, 1), 'MMMM yyyy')}
              />
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-border/50">
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="w-3 h-3 rounded-sm bg-blue-500/80 inline-block" />
          Full day
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="w-3 h-3 rounded-sm bg-amber-400/80 inline-block" />
          Morning half
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="w-3 h-3 rounded-sm bg-orange-400/80 inline-block" />
          Afternoon half
        </span>
        {sprint && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="w-3 h-3 rounded-sm bg-primary/10 ring-1 ring-primary/20 inline-block" />
            Sprint days
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Compact chip summary (for workload cards) ────────────────────────────────

function LeaveCompactChips({ entries }: { entries: LeaveEntry[] }) {
  const { fullCount, halfCount } = summariseLeave(entries);
  if (fullCount === 0 && halfCount === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {fullCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium bg-blue-500/15 text-blue-400 border-blue-500/30">
          <CalendarDays className="h-2.5 w-2.5" />
          {fullCount}d off
        </span>
      )}
      {halfCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400 border-amber-500/30">
          <Sun className="h-2.5 w-2.5" />
          {halfCount} half
        </span>
      )}
    </div>
  );
}

// ─── Full leave badge list ────────────────────────────────────────────────────

function LeaveBadgeList({ entries }: { entries: LeaveEntry[] }) {
  const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());
  return (
    <div className="flex flex-wrap gap-1.5">
      {sorted.map((entry) => {
        const { label, badgeClassName, iconName } = getLeaveEntryMeta(entry);
        return (
          <span
            key={format(entry.date, 'yyyy-MM-dd')}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${badgeClassName}`}
          >
            <LeaveIcon name={iconName} />
            {format(entry.date, 'MMM d, yyyy')} · {label}
          </span>
        );
      })}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

interface EmployeeLeavePanelProps {
  /** Raw leave_dates strings from TeamMember.leave_dates */
  leaveDates?: string[];
  /** Sprint used to filter leave to the active range */
  sprint: Sprint | null;
  /** Render compact chip row (for cards) vs full section (for dialogs) */
  compact?: boolean;
  /** Show the mini calendar view in full mode (default: true) */
  showCalendar?: boolean;
}

export function EmployeeLeavePanel({
  leaveDates,
  sprint,
  compact = false,
  showCalendar = true,
}: EmployeeLeavePanelProps) {
  // Parse all entries — guard against undefined/null
  const allEntries = useMemo(
    () => parseLeaveEntries(leaveDates ?? []),
    [leaveDates],
  );

  // Entries within the sprint range (or all if no sprint)
  const sprintEntries = useMemo(
    () =>
      sprint
        ? filterLeaveForRange(allEntries, sprint.start_date, sprint.end_date)
        : allEntries,
    [allEntries, sprint],
  );

  // Entries outside the sprint (shown as "other scheduled leave" in full mode)
  const outsideEntries = useMemo(
    () =>
      sprint
        ? allEntries.filter(
            (e) =>
              !sprintEntries.some(
                (s) =>
                  format(s.date, 'yyyy-MM-dd') === format(e.date, 'yyyy-MM-dd'),
              ),
          )
        : [],
    [allEntries, sprintEntries, sprint],
  );

  // ── Compact mode (card chip row) ──────────────────────────────────────────
  if (compact) {
    if (sprintEntries.length === 0) return null;
    return (
      <div className="pt-2 border-t border-border/50">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
          <CalendarDays className="h-3 w-3" /> Leave this sprint
        </p>
        <LeaveCompactChips entries={sprintEntries} />
      </div>
    );
  }

  // ── Full mode ─────────────────────────────────────────────────────────────

  // No leave at all → friendly empty state
  if (allEntries.length === 0) {
    return (
      <div className="rounded-lg border bg-secondary/30 p-4 text-center">
        <CalendarDays className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">No leave scheduled</p>
      </div>
    );
  }

  const { fullCount, halfCount, totalDays } = summariseLeave(sprintEntries);

  return (
    <div className="space-y-3">

      {/* ── Sprint leave ── */}
      {sprintEntries.length > 0 ? (
        <>
          {/* Summary legend row */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-blue-500/15 text-blue-400 border-blue-500/30">
              <CalendarDays className="h-2.5 w-2.5" /> Full Day
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-amber-500/15 text-amber-400 border-amber-500/30">
              <Sun className="h-2.5 w-2.5" /> Morning Half
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-orange-500/15 text-orange-400 border-orange-500/30">
              <Sunset className="h-2.5 w-2.5" /> Afternoon Half
            </span>
            <span className="ml-auto font-medium text-foreground">
              {totalDays} day{totalDays !== 1 ? 's' : ''} off
            </span>
          </div>

          {/* Stat chips */}
          <div className="flex gap-2">
            {fullCount > 0 && (
              <div className="flex-1 rounded-lg bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                <p className="text-lg font-semibold text-blue-400">{fullCount}</p>
                <p className="text-[10px] text-blue-400/70">
                  Full day{fullCount !== 1 ? 's' : ''}
                </p>
              </div>
            )}
            {halfCount > 0 && (
              <div className="flex-1 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-center">
                <p className="text-lg font-semibold text-amber-400">{halfCount}</p>
                <p className="text-[10px] text-amber-400/70">
                  Half day{halfCount !== 1 ? 's' : ''}
                </p>
              </div>
            )}
            <div className="flex-1 rounded-lg bg-secondary border border-border p-2 text-center">
              <p className="text-lg font-semibold">{totalDays}</p>
              <p className="text-[10px] text-muted-foreground">Total days</p>
            </div>
          </div>

          {/* Calendar view — shows the month with leave; navigable if multi-month */}
          {showCalendar && (
            <LeaveCalendarView entries={sprintEntries} sprint={sprint} />
          )}

          {/* Badge list */}
          <LeaveBadgeList entries={sprintEntries} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No leave during {sprint ? sprint.sprint_name : 'this period'}.
        </p>
      )}

      {/* ── Leave outside the sprint ── */}
      {outsideEntries.length > 0 && (
        <div className="pt-3 border-t border-border/50 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Other scheduled leave
          </p>
          <LeaveBadgeList entries={outsideEntries} />
        </div>
      )}
    </div>
  );
}