import { DateTime } from 'luxon';
import type { TaskStatus } from './types.js';

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export interface CountdownResult {
  label: string;
  isOverdue: boolean;
  isCompleted: boolean;
  hasDeadline: boolean;
  diffMs: number | null;
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

export function formatTaskCountdown(
  params: {
    status: TaskStatus | string;
    deadlineAt: Date | string | null | undefined;
  },
  now: Date = new Date()
): CountdownResult {
  if (params.status === 'Completed') {
    return {
      label: 'COMPLETED',
      isOverdue: false,
      isCompleted: true,
      hasDeadline: Boolean(params.deadlineAt),
      diffMs: null,
    };
  }

  if (!params.deadlineAt) {
    return {
      label: 'No deadline',
      isOverdue: false,
      isCompleted: false,
      hasDeadline: false,
      diffMs: null,
    };
  }

  const deadline =
    params.deadlineAt instanceof Date ? params.deadlineAt : new Date(params.deadlineAt);
  if (Number.isNaN(deadline.getTime())) {
    return {
      label: 'Invalid deadline',
      isOverdue: false,
      isCompleted: false,
      hasDeadline: false,
      diffMs: null,
    };
  }

  const diffMs = deadline.getTime() - now.getTime();
  const absSeconds = Math.floor(Math.abs(diffMs) / 1000);
  const totalMinutes = Math.floor(absSeconds / 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (diffMs > 0) {
    let label: string;
    if (days > 0) {
      label =
        hours > 0
          ? `${plural(days, 'day')}, ${plural(hours, 'hour')} remaining`
          : `${plural(days, 'day')} remaining`;
    } else if (hours > 0) {
      label =
        minutes > 0
          ? `${plural(hours, 'hour')}, ${plural(minutes, 'minute')} remaining`
          : `${plural(hours, 'hour')} remaining`;
    } else if (minutes > 0) {
      label = `${plural(minutes, 'minute')} remaining`;
    } else {
      label = 'Less than 1 minute remaining';
    }

    return {
      label,
      isOverdue: false,
      isCompleted: false,
      hasDeadline: true,
      diffMs,
    };
  }

  let overdueText: string;
  if (days > 0) {
    overdueText =
      hours > 0
        ? `OVERDUE by ${plural(days, 'day')}, ${plural(hours, 'hour')}`
        : `OVERDUE by ${plural(days, 'day')}`;
  } else if (hours > 0) {
    overdueText =
      minutes > 0
        ? `OVERDUE by ${plural(hours, 'hour')}, ${plural(minutes, 'minute')}`
        : `OVERDUE by ${plural(hours, 'hour')}`;
  } else if (minutes > 0) {
    overdueText = `OVERDUE by ${plural(minutes, 'minute')}`;
  } else {
    overdueText = 'OVERDUE (just now)';
  }

  return {
    label: overdueText,
    isOverdue: true,
    isCompleted: false,
    hasDeadline: true,
    diffMs,
  };
}

export function isValidTimezone(tz: string): boolean {
  const dt = DateTime.now().setZone(tz);
  return dt.isValid;
}

export function parseDeadlineInput(
  rawInput: string,
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date()
): { date: Date; formatted: string; timezone: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Deadline cannot be empty.');
  }

  const zone = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const nowDt = DateTime.fromJSDate(now, { zone });

  // Relative durations: "30m", "2h", "3d", "1w", "in 2 hours", "in 3 days"
  const relMatch = trimmed.match(
    /^(?:in\s+)?(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)$/i
  );
  if (relMatch) {
    const amount = Number(relMatch[1]);
    const unitRaw = relMatch[2].toLowerCase();
    let parsedDt: DateTime;
    if (unitRaw.startsWith('m')) parsedDt = nowDt.plus({ minutes: amount });
    else if (unitRaw.startsWith('h')) parsedDt = nowDt.plus({ hours: amount });
    else if (unitRaw.startsWith('d')) parsedDt = nowDt.plus({ days: amount });
    else parsedDt = nowDt.plus({ weeks: amount });

    return {
      date: parsedDt.toUTC().toJSDate(),
      formatted: formatInTimezone(parsedDt.toJSDate(), zone),
      timezone: zone,
    };
  }

  // "today HH:mm" or "tomorrow HH:mm"
  const dayWordMatch = trimmed.match(/^(today|tomorrow)(?:\s+(\d{1,2}):(\d{2}))?$/i);
  if (dayWordMatch) {
    const isTomorrow = dayWordMatch[1].toLowerCase() === 'tomorrow';
    const hour = dayWordMatch[2] ? Number(dayWordMatch[2]) : 18;
    const minute = dayWordMatch[3] ? Number(dayWordMatch[3]) : 0;
    const target = nowDt
      .plus({ days: isTomorrow ? 1 : 0 })
      .set({ hour, minute, second: 0, millisecond: 0 });
    if (!target.isValid) {
      throw new Error('Invalid time specified for today/tomorrow.');
    }
    return {
      date: target.toUTC().toJSDate(),
      formatted: formatInTimezone(target.toJSDate(), zone),
      timezone: zone,
    };
  }

  // Try ISO 8601 first (preserves explicit offset if provided, else interprets in zone)
  const hasExplicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  if (hasExplicitOffset) {
    const iso = DateTime.fromISO(trimmed, { setZone: true });
    if (iso.isValid) {
      const inZone = iso.setZone(zone);
      return {
        date: iso.toUTC().toJSDate(),
        formatted: formatInTimezone(iso.toJSDate(), zone),
        timezone: zone,
      };
    }
  } else {
    const isoLocal = DateTime.fromISO(trimmed, { zone });
    if (isoLocal.isValid) {
      return {
        date: isoLocal.toUTC().toJSDate(),
        formatted: formatInTimezone(isoLocal.toJSDate(), zone),
        timezone: zone,
      };
    }
  }

  const candidateFormats = [
    'yyyy-MM-dd HH:mm',
    'yyyy-MM-dd H:mm',
    'yyyy-MM-dd hh:mm a',
    'yyyy-MM-dd h:mm a',
    'yyyy-MM-dd',
    'dd/MM/yyyy HH:mm',
    'dd/MM/yyyy H:mm',
    'dd/MM/yyyy',
    'dd-MM-yyyy HH:mm',
    'dd-MM-yyyy',
    'MMM d, yyyy HH:mm',
    'MMM d, yyyy h:mm a',
    'MMM d yyyy HH:mm',
  ];

  for (const fmt of candidateFormats) {
    const dt = DateTime.fromFormat(trimmed, fmt, { zone });
    if (dt.isValid) {
      const normalized =
        fmt === 'yyyy-MM-dd' || fmt === 'dd/MM/yyyy' || fmt === 'dd-MM-yyyy'
          ? dt.set({ hour: 18, minute: 0, second: 0, millisecond: 0 })
          : dt;
      return {
        date: normalized.toUTC().toJSDate(),
        formatted: formatInTimezone(normalized.toJSDate(), zone),
        timezone: zone,
      };
    }
  }

  throw new Error(
    `Could not parse deadline "${trimmed}". Try formats like "2026-11-25 18:00", "25/11/2026 14:30", "in 4 hours", "3d", or "tomorrow 18:00" (${zone}).`
  );
}

export function formatInTimezone(date: Date | string, timezone: string = DEFAULT_TIMEZONE): string {
  const jsDate = date instanceof Date ? date : new Date(date);
  const zone = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  return DateTime.fromJSDate(jsDate, { zone }).toFormat("dd LLL yyyy, hh:mm a 'IST'");
}

export function isDueTodayInTimezone(
  deadlineAt: Date | string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date()
): boolean {
  if (!deadlineAt) return false;
  const zone = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const jsDate = deadlineAt instanceof Date ? deadlineAt : new Date(deadlineAt);
  const target = DateTime.fromJSDate(jsDate, { zone });
  const today = DateTime.fromJSDate(now, { zone });
  return target.hasSame(today, 'day');
}
