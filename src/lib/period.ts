import { addDays, fromISO, toISO, todayISO } from './format';

export type PeriodMode = 'day' | 'week' | 'month' | 'year' | 'all';
export interface Period { mode: PeriodMode; anchor: string }

export function range(p: Period): [string, string] {
  const d = fromISO(p.anchor);
  switch (p.mode) {
    case 'day': return [p.anchor, p.anchor];
    case 'week': {
      const dow = (d.getDay() + 6) % 7; // Monday = 0
      const start = addDays(p.anchor, -dow);
      return [start, addDays(start, 6)];
    }
    case 'month':
      return [toISO(new Date(d.getFullYear(), d.getMonth(), 1)), toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
    case 'year':
      return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
    case 'all':
      return ['0000-01-01', '9999-12-31'];
  }
}

export function shift(p: Period, dir: 1 | -1): Period {
  const d = fromISO(p.anchor);
  switch (p.mode) {
    case 'day': return { ...p, anchor: addDays(p.anchor, dir) };
    case 'week': return { ...p, anchor: addDays(p.anchor, 7 * dir) };
    case 'month': return { ...p, anchor: toISO(new Date(d.getFullYear(), d.getMonth() + dir, 1)) };
    case 'year': return { ...p, anchor: toISO(new Date(d.getFullYear() + dir, 0, 1)) };
    case 'all': return p;
  }
}

const mFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const dFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const sFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function label(p: Period): string {
  const d = fromISO(p.anchor);
  switch (p.mode) {
    case 'day': return dFmt.format(d);
    case 'week': {
      const [a, b] = range(p);
      return `${sFmt.format(fromISO(a))} – ${sFmt.format(fromISO(b))}`;
    }
    case 'month': return mFmt.format(d);
    case 'year': return String(d.getFullYear());
    case 'all': return 'All time';
  }
}

export function containsToday(p: Period): boolean {
  const [a, b] = range(p);
  const t = todayISO();
  return t >= a && t <= b;
}

/** Number of days in the period that have already started (for daily average). */
export function elapsedDays(p: Period, firstTxDate?: string): number {
  let [a, b] = range(p);
  if (p.mode === 'all') { if (!firstTxDate) return 1; a = firstTxDate; b = todayISO(); }
  const t = todayISO();
  const end = b < t ? b : t;
  if (end < a) return 0;
  return Math.round((fromISO(end).getTime() - fromISO(a).getTime()) / 86400000) + 1;
}
