// src/lib/leave-utils.ts
// Shared leave parsing, formatting, and display helpers.
// Used by MyWorkspace, TeamWorkload, and EmployeeLeavePanel.

import { format } from 'date-fns';

export type HalfDayPeriod = 'morning' | 'afternoon';

export type LeaveEntry =
  | { date: Date; type: 'full' }
  | { date: Date; type: 'half'; period: HalfDayPeriod };

/** One day in milliseconds — used for inclusive end-date range checks. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parses raw leave_dates strings (e.g. "2026-05-04", "2026-05-05:morning",
 * "2026-05-06:afternoon", legacy "2026-05-07:half") into typed LeaveEntry objects.
 */
export const parseLeaveEntries = (dates?: string[]): LeaveEntry[] => {
  const result: LeaveEntry[] = [];
  for (const value of dates ?? []) {
    const [datePart, modifier] = value.split(':');
    // Parse as local midnight using explicit year/month/day components
    // to avoid UTC shift (new Date("yyyy-MM-dd") parses as UTC midnight
    // which shifts the date in UTC+ timezones like IST)
    const [year, month, day] = datePart.split('-').map(Number);
    const date = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (Number.isNaN(date.getTime())) continue;
    if (modifier === 'morning') {
      result.push({ date, type: 'half', period: 'morning' });
    } else if (modifier === 'afternoon') {
      result.push({ date, type: 'half', period: 'afternoon' });
    } else if (modifier === 'half') {
      // legacy format — treat as morning half
      result.push({ date, type: 'half', period: 'morning' });
    } else {
      result.push({ date, type: 'full' });
    }
  }
  return result;
};

/**
 * Serialises LeaveEntry[] back to the string[] format stored on the backend.
 * Deduplicates by date (last write wins) and sorts ascending.
 */
export const formatLeaveEntries = (entries: LeaveEntry[]): string[] => {
  const result: Record<string, string> = {};

  for (const e of entries) {
    const dateStr = format(e.date, 'yyyy-MM-dd');

    if (e.type === 'half' && e.period) {
      result[dateStr] = `${dateStr}:${e.period}`;
    } else if (e.type === 'full') {
      result[dateStr] = dateStr;
    }
  }

  return Object.values(result).sort();
};

/**
 * Returns the display label, Tailwind className, and lucide icon name for a
 * given LeaveEntry.  The caller is responsible for rendering the icon — we
 * return a string name so this file stays icon-library-agnostic.
 */
export const getLeaveEntryMeta = (
  entry: LeaveEntry,
): { label: string; badgeClassName: string; iconName: 'CalendarDays' | 'Sun' | 'Sunset' } => {
  if (entry.type === 'full') {
    return {
      label: 'Full Day',
      badgeClassName: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      iconName: 'CalendarDays',
    };
  }
  if (entry.period === 'morning') {
    return {
      label: 'Morning Half',
      badgeClassName: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      iconName: 'Sun',
    };
  }
  return {
    label: 'Afternoon Half',
    badgeClassName: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    iconName: 'Sunset',
  };
};

/**
 * Filters a LeaveEntry[] to only those that fall within [startDate, endDate]
 * (both inclusive).
 *
 * Both sprint boundary dates and leave entry dates are parsed with an explicit
 * T00:00:00 suffix so they are treated as LOCAL midnight — not UTC midnight.
 * Without this, users in UTC+ timezones (e.g. IST = UTC+5:30) would see
 * entries incorrectly excluded because new Date("yyyy-MM-dd") parses as UTC.
 */
export const filterLeaveForRange = (
  entries: LeaveEntry[],
  startDate: string,
  endDate: string,
): LeaveEntry[] => {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T00:00:00`).getTime() + DAY_MS - 1;
  return entries.filter((e) => {
    const t = e.date.getTime();
    return t >= start && t <= end;
  });
};

/** Counts full-day and half-day entries and computes a total-days float. */
export const summariseLeave = (
  entries: LeaveEntry[],
): { fullCount: number; halfCount: number; totalDays: number } => {
  const fullCount = entries.filter((e) => e.type === 'full').length;
  const halfCount = entries.filter((e) => e.type === 'half').length;
  return { fullCount, halfCount, totalDays: fullCount + halfCount * 0.5 };
};