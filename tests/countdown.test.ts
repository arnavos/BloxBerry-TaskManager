import { describe, expect, it } from 'vitest';
import {
  formatTaskCountdown,
  isDueTodayInTimezone,
  parseDeadlineInput,
} from '../src/domain/countdown.js';

describe('Countdown & Timezone Calculations', () => {
  it('returns COMPLETED when task status is Completed regardless of deadline', () => {
    const past = new Date('2026-11-10T10:00:00Z');
    const now = new Date('2026-11-17T10:00:00Z');
    const res = formatTaskCountdown({ status: 'Completed', deadlineAt: past }, now);
    expect(res.label).toBe('COMPLETED');
    expect(res.isCompleted).toBe(true);
    expect(res.isOverdue).toBe(false);
  });

  it('formats days and hours remaining dynamically', () => {
    const now = new Date('2026-11-17T00:00:00Z');
    const deadline = new Date(now.getTime() + (2 * 24 + 4) * 3600_000 + 15_000);
    const res = formatTaskCountdown({ status: 'In Progress', deadlineAt: deadline }, now);
    expect(res.label).toBe('2 days, 4 hours remaining');
    expect(res.isOverdue).toBe(false);
  });

  it('formats hours and minutes remaining dynamically', () => {
    const now = new Date('2026-11-17T00:00:00Z');
    const deadline = new Date(now.getTime() + (5 * 60 + 20) * 60_000);
    const res = formatTaskCountdown({ status: 'Not Started', deadlineAt: deadline }, now);
    expect(res.label).toBe('5 hours, 20 minutes remaining');
  });

  it('formats OVERDUE by hours dynamically', () => {
    const now = new Date('2026-11-17T15:00:00Z');
    const deadline = new Date('2026-11-17T12:00:00Z');
    const res = formatTaskCountdown({ status: 'In Progress', deadlineAt: deadline }, now);
    expect(res.label).toBe('OVERDUE by 3 hours');
    expect(res.isOverdue).toBe(true);
  });

  it('parses human timestamps in Asia/Kolkata (UTC+05:30) accurately', () => {
    const parsed = parseDeadlineInput('2026-11-20 18:00', 'Asia/Kolkata');
    // 18:00 IST == 12:30 UTC
    expect(parsed.date.toISOString()).toBe('2026-11-20T12:30:00.000Z');
    expect(parsed.timezone).toBe('Asia/Kolkata');
  });

  it('parses relative durations accurately', () => {
    const base = new Date('2026-11-17T10:00:00.000Z');
    const parsed = parseDeadlineInput('in 4 hours', 'Asia/Kolkata', base);
    expect(parsed.date.toISOString()).toBe('2026-11-17T14:00:00.000Z');
  });

  it('checks due-today using Asia/Kolkata calendar day rather than UTC day', () => {
    // 2026-11-17 20:00 UTC is 2026-11-18 01:30 IST (already Nov 18 in Kolkata!)
    const nowUtc = new Date('2026-11-17T20:00:00.000Z');
    const deadlineNov18IstMorning = new Date('2026-11-18T05:00:00.000Z'); // 10:30 IST Nov 18
    const deadlineNov17IstAfternoon = new Date('2026-11-17T10:00:00.000Z'); // 15:30 IST Nov 17
    expect(isDueTodayInTimezone(deadlineNov18IstMorning, 'Asia/Kolkata', nowUtc)).toBe(true);
    expect(isDueTodayInTimezone(deadlineNov17IstAfternoon, 'Asia/Kolkata', nowUtc)).toBe(false);
  });
});
