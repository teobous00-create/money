import { useMemo } from 'react';
import { useStore } from './store';
import { alive } from './calc';
import { addDays, fromISO, round2, toISO, todayISO } from './format';
import type { Job, JobRate, Pnl, Shift, Strategy } from './types';

// ================================================================ work

export const shiftId = (jobId: string, date: string) => `${jobId}:${date}`;
export const payoutId = (jobId: string, periodStart: string) => `${jobId}:${periodStart}`;

export function rateAt(job: Job, date: string): JobRate {
  const sorted = (job.rates ?? []).slice().sort((a, b) => a.from.localeCompare(b.from));
  let r: JobRate = sorted[0] ?? { from: '0000-01-01' };
  for (const x of sorted) if (x.from <= date) r = x;
  return r;
}

/** Pay for one shift, split into the base (day rate / hours) and the sales bonus. */
export function shiftParts(job: Job, s: Shift): { base: number; bonus: number } {
  const r = rateAt(job, s.date);
  if (job.kind === 'daily') return { base: round2(r.day ?? 0), bonus: round2((r.bonus ?? 0) * (s.sales ?? 0)) };
  return { base: round2((r.hour ?? 0) * (s.hours ?? 0)), bonus: 0 };
}
export function shiftPay(job: Job, s: Shift): number {
  const p = shiftParts(job, s);
  return round2(p.base + p.bonus);
}

/** Pay period that contains `date`: the month, or 1–15 / 16–end. */
export function periodOf(job: Job, date: string): [string, string] {
  const d = fromISO(date);
  const y = d.getFullYear(), m = d.getMonth();
  const first = toISO(new Date(y, m, 1)), last = toISO(new Date(y, m + 1, 0));
  if (job.pay === 'monthly') return [first, last];
  return d.getDate() <= 15 ? [first, toISO(new Date(y, m, 15))] : [toISO(new Date(y, m, 16)), last];
}

export interface PayPeriod {
  start: string; end: string; current: boolean; shifts: number; hours: number;
  earned: number; paid: number; owed: number;              // totals
  base: number; bonus: number; paidBase: number; paidBonus: number;
}

export function useJobs() {
  const rec = useStore(s => s.jobs);
  return useMemo(() => alive(rec).filter(j => !j.archived).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)), [rec]);
}

export function useJobShifts(jobId?: string) {
  const rec = useStore(s => s.shifts);
  return useMemo(() => alive(rec).filter(s => !jobId || s.job_id === jobId), [rec, jobId]);
}

/** Every pay period from the first logged shift until today, with what you earned and what was paid. */
export function usePayPeriods(job: Job) {
  const shifts = useJobShifts(job.id);
  const payouts = useStore(s => s.payouts);
  return useMemo(() => {
    const map = new Map<string, PayPeriod>();
    const today = todayISO();
    const [cs, ce] = periodOf(job, today);
    const get = (start: string, end: string) => {
      let p = map.get(start);
      if (!p) map.set(start, (p = { start, end, earned: 0, paid: 0, owed: 0, shifts: 0, hours: 0, current: start === cs, base: 0, bonus: 0, paidBase: 0, paidBonus: 0 }));
      return p;
    };
    get(cs, ce);
    for (const s of shifts) {
      if (s.date > today) continue;
      const [a, b] = periodOf(job, s.date);
      const p = get(a, b);
      const parts = shiftParts(job, s);
      p.base += parts.base;
      p.bonus += parts.bonus;
      p.shifts += 1;
      p.hours += s.hours ?? 0;
    }
    for (const po of alive(payouts)) {
      if (po.job_id !== job.id) continue;
      const p = get(po.period_start, po.period_end);
      p.paidBase += po.amount;
      p.paidBonus += po.bonus ?? 0;
    }
    const list = [...map.values()].map(p => {
      const earned = round2(p.base + p.bonus), paid = round2(p.paidBase + p.paidBonus);
      return { ...p, base: round2(p.base), bonus: round2(p.bonus), paidBase: round2(p.paidBase), paidBonus: round2(p.paidBonus), earned, paid, owed: round2(earned - paid), hours: round2(p.hours) };
    })
      .sort((a, b) => b.start.localeCompare(a.start));
    const owed = round2(list.reduce((s, p) => s + p.owed, 0));
    return { list, owed, current: list.find(p => p.current)! };
  }, [job, shifts, payouts]);
}

// ================================================================ trading

export type TMode = 'week' | 'month' | 'year' | 'all';
export const pnlId = (strategyId: string, date: string) => `${strategyId}:${date}`;

export function useStrategies() {
  const rec = useStore(s => s.strategies);
  return useMemo(() => alive(rec).filter(s => !s.archived).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)), [rec]);
}

export function tRange(mode: TMode, anchor: string): [string, string] {
  const d = fromISO(anchor);
  if (mode === 'week') { const start = addDays(anchor, -((d.getDay() + 6) % 7)); return [start, addDays(start, 6)]; }
  if (mode === 'month') return [toISO(new Date(d.getFullYear(), d.getMonth(), 1)), toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  if (mode === 'year') return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
  return ['0000-01-01', '9999-12-31'];
}

export function tShift(mode: TMode, anchor: string, dir: number): string {
  const d = fromISO(anchor);
  if (mode === 'week') return addDays(anchor, 7 * dir);
  if (mode === 'month') return toISO(new Date(d.getFullYear(), d.getMonth() + dir, 1));
  if (mode === 'year') return toISO(new Date(d.getFullYear() + dir, 0, 1));
  return anchor;
}

/** P&L per day for one strategy (or all), as date → value. */
export function usePnlByDay(strategy: string | 'all') {
  const rec = useStore(s => s.pnl);
  const strategies = useStrategies();
  return useMemo(() => {
    const live = new Set(strategies.map(s => s.id));
    const m = new Map<string, number>();
    for (const p of alive(rec) as Pnl[]) {
      if (!live.has(p.strategy_id)) continue;
      if (strategy !== 'all' && p.strategy_id !== strategy) continue;
      m.set(p.date, round2((m.get(p.date) ?? 0) + p.pnl));
    }
    return m;
  }, [rec, strategy, strategies]);
}

export interface TStats {
  net: number; days: number; winDays: number; lossDays: number; avgWin: number; avgLoss: number;
  profitFactor: number | null; maxDD: number; best: number; worst: number; curve: Array<{ date: string; v: number }>;
}

export function statsFor(byDay: Map<string, number>, from: string, to: string): TStats {
  const days = [...byDay.entries()].filter(([d]) => d >= from && d <= to).sort((a, b) => a[0].localeCompare(b[0]));
  let net = 0, wins = 0, losses = 0, sumW = 0, sumL = 0, peak = 0, maxDD = 0, best = 0, worst = 0;
  const curve: TStats['curve'] = [];
  for (const [date, v] of days) {
    net += v;
    if (v > 0) { wins++; sumW += v; } else if (v < 0) { losses++; sumL += v; }
    best = Math.max(best, v); worst = Math.min(worst, v);
    peak = Math.max(peak, net);
    maxDD = Math.max(maxDD, peak - net);
    curve.push({ date, v: round2(net) });
  }
  return {
    net: round2(net), days: days.length, winDays: wins, lossDays: losses,
    avgWin: wins ? round2(sumW / wins) : 0, avgLoss: losses ? round2(sumL / losses) : 0,
    profitFactor: sumL ? round2(sumW / -sumL) : null, maxDD: round2(maxDD), best: round2(best), worst: round2(worst), curve,
  };
}

export const goalOf = (strategy: string | 'all', strategies: Strategy[]) =>
  strategy === 'all' ? round2(strategies.reduce((s, x) => s + (x.goal ?? 0), 0)) : strategies.find(s => s.id === strategy)?.goal ?? 0;
