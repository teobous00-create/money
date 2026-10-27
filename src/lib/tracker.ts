import { useMemo } from 'react';
import { useStore, getState, put, remove } from './store';
import { alive } from './calc';
import { addDays, fromISO, round2, toISO, todayISO, uuid } from './format';
import type { Job, JobRate, Payout, Pnl, Shift, Strategy, Tx } from './types';

// ================================================================ work

export const shiftId = (jobId: string, date: string) => `${jobId}:${date}`;
export const payoutId = (jobId: string, periodStart: string) => `${jobId}:${periodStart}`;

export function rateAt(job: Job, date: string): JobRate {
  const sorted = (job.rates ?? []).slice().sort((a, b) => a.from.localeCompare(b.from));
  let r: JobRate = sorted[0] ?? { from: '0000-01-01' };
  for (const x of sorted) if (x.from <= date) r = x;
  return r;
}

const firstOf = (d: string) => d.slice(0, 8) + '01';
const lastOf = (d: string) => { const x = fromISO(d); return toISO(new Date(x.getFullYear(), x.getMonth() + 1, 0)); };

/** Monthly contacts target (morning job): the bonus is € per contact for ALL contacts, but only if the month's average per worked day reaches `min`; otherwise 0. */
export function contactRule(job: Job, date: string): { min: number; per: number } | null {
  if (job.kind !== 'daily') return null;
  const r = rateAt(job, firstOf(date));
  return (r.min ?? 0) > 0 ? { min: r.min!, per: r.bonus || 1 } : null;
}
/** Contacts that day (older entries kept the bonus in €: with 1 €/contact it's the same number). */
export function contactsOf(job: Job, s: Shift): number {
  if ((s.sales ?? 0) > 0) return s.sales;
  const rule = contactRule(job, s.date);
  return s.bonus ? Math.round(s.bonus / (rule?.per || 1)) : 0;
}

export interface MonthBonus {
  min: number; per: number; worked: number; planned: number; contacts: number; avg: number;
  met: boolean; bonus: number;            // what it pays as things stand (month over → final)
  target: number;                         // contacts needed over worked + planned days
  needPerDay: number | null;              // on each planned day still to come
  projected: number; projectedBonus: number; over: boolean;
}

/** Where the month's contacts target stands. */
export function monthBonus(job: Job, shifts: Shift[], anyDate: string, today = todayISO()): MonthBonus | null {
  const rule = contactRule(job, anyDate);
  if (!rule) return null;
  const a = firstOf(anyDate), b = lastOf(anyDate);
  const inM = shifts.filter(s => s.job_id === job.id && !s.deleted_at && s.date >= a && s.date <= b);
  const done = inM.filter(s => s.date <= today), todo = inM.filter(s => s.date > today);
  const contacts = done.reduce((x, s) => x + contactsOf(job, s), 0);
  const worked = done.length, planned = todo.length;
  const avg = worked ? contacts / worked : 0;
  const met = worked > 0 && avg >= rule.min;
  const target = rule.min * (worked + planned);
  const needPerDay = planned ? Math.max(0, (target - contacts) / planned) : null;
  const projected = Math.round(contacts + avg * planned);
  return {
    ...rule, worked, planned, contacts, avg: round2(avg), met, bonus: met ? round2(contacts * rule.per) : 0,
    target, needPerDay: needPerDay == null ? null : round2(needPerDay), projected, projectedBonus: met ? round2(projected * rule.per) : 0, over: today > b,
  };
}

/** Pay for one shift, split into the base (day rate / hours) and the sales bonus (0 for a monthly contacts target — see monthBonus). */
export function shiftParts(job: Job, s: Shift): { base: number; bonus: number } {
  const r = rateAt(job, s.date);
  if (job.kind === 'daily') return { base: round2(s.base ?? r.day ?? 0), bonus: contactRule(job, s.date) ? 0 : round2(s.bonus ?? (r.bonus ?? 0) * (s.sales ?? 0)) };
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
  pendingBonus?: number;                                     // contacts target: this month's bonus, not owed until the month ends
  target?: MonthBonus;
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
export function payPeriods(job: Job, shifts: Shift[], payouts: Record<string, Payout>, txs: Record<string, Tx>) {
  // a payment linked to an income entry counts what that entry says now — deleted entry = not paid
  const part = (txId: string | null, stored: number) => {
    if (!txId) return stored;
    const t = txs[txId];
    return t && !t.deleted_at ? t.amount : 0;
  };
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
    if (s.job_id !== job.id || s.deleted_at || s.date > today) continue;
    const [a, b] = periodOf(job, s.date);
    const p = get(a, b);
    const parts = shiftParts(job, s);
    p.base += parts.base;
    p.bonus += parts.bonus;
    p.shifts += 1;
    p.hours += s.hours ?? 0;
  }
  // contacts target: a finished month owes its bonus (or 0); the running month shows it as pending
  if (contactRule(job, today) || job.rates?.some(r => (r.min ?? 0) > 0)) {
    for (const p of map.values()) {
      const mb = monthBonus(job, shifts, p.start, today);
      if (!mb) continue;
      p.target = mb;
      if (mb.over) p.bonus += mb.bonus; else p.pendingBonus = mb.bonus;
    }
  }
  const settled = new Set<string>();
  for (const po of alive(payouts)) {
    if (po.job_id !== job.id) continue;
    const p = get(po.period_start, po.period_end);
    p.paidBase += part(po.tx_id, po.amount);
    p.paidBonus += part(po.bonus_tx_id, po.bonus ?? 0);
    if (po.settled) settled.add(po.period_start);
  }
  for (const st of settled) { const p = map.get(st); if (p) { p.paidBase = Math.max(p.paidBase, p.base); p.paidBonus = Math.max(p.paidBonus, p.bonus); } }
  const list = [...map.values()].map(p => {
    const earned = round2(p.base + p.bonus), paid = round2(p.paidBase + p.paidBonus);
    return { ...p, base: round2(p.base), bonus: round2(p.bonus), paidBase: round2(p.paidBase), paidBonus: round2(p.paidBonus), earned, paid, owed: round2(earned - paid), hours: round2(p.hours) };
  })
    .sort((a, b) => b.start.localeCompare(a.start));
  const owed = round2(list.reduce((s, p) => s + p.owed, 0));
  const owedBase = round2(list.reduce((s, p) => s + p.base - p.paidBase, 0));
  const owedBonus = round2(list.reduce((s, p) => s + p.bonus - p.paidBonus, 0));
  return { list, owed, owedBase, owedBonus, current: list.find(p => p.current)! };
}

export function usePayPeriods(job: Job) {
  const shifts = useJobShifts(job.id);
  const payouts = useStore(s => s.payouts);
  const txs = useStore(s => s.transactions);
  return useMemo(() => payPeriods(job, shifts, payouts, txs), [job, shifts, payouts, txs]);
}

/** The period a "got paid" is most likely for: the oldest finished one still owed, else the current one. */
export function periodToPay(list: PayPeriod[]): PayPeriod | null {
  const owed = list.filter(p => p.owed > 0.004);
  return owed.filter(p => !p.current).pop() ?? owed[0] ?? null;
}

export interface ShiftInput { hours: number; base: number | null; bonus: number | null; tips: number; tipsAccount: string | null; worked: boolean; contacts?: number | null }

/** Saves one job's shift for a day (with its tips as an income entry). Returns what to put back for an undo. */
export function writeShift(job: Job, date: string, f: ShiftInput) {
  const st = getState();
  const id = shiftId(job.id, date);
  const existing = st.shifts[id] && !st.shifts[id].deleted_at ? st.shifts[id] : null;
  const prevTip = existing?.tips_tx_id ? st.transactions[existing.tips_tx_id] ?? null : null;
  const active = job.kind === 'daily' ? f.worked : f.hours > 0;
  let tipsTx = existing?.tips_tx_id ?? null;
  if (job.kind === 'hourly' && job.tips_category_id && active && f.tips > 0 && f.tipsAccount) {
    tipsTx = tipsTx ?? uuid();
    put('transactions', {
      id: tipsTx, owner_id: '', type: 'income', date, amount: round2(f.tips), account_id: f.tipsAccount, to_account_id: null,
      category_id: job.tips_category_id, note: null, recurring_id: null, seq: st.transactions[tipsTx]?.seq ?? Date.now() % 100000,
    });
  } else if (tipsTx && st.transactions[tipsTx] && !st.transactions[tipsTx].deleted_at) {
    remove('transactions', tipsTx);
    tipsTx = null;
  }
  if (active) put('shifts', {
    id, owner_id: '', job_id: job.id, date, hours: job.kind === 'hourly' ? f.hours : 1,
    // contacts target: the day's contacts are stored, the bonus is worked out per month
    sales: contactRule(job, date) ? Math.max(0, Math.round(f.contacts ?? 0)) : 0,
    base: job.kind === 'daily' ? f.base : null, bonus: job.kind === 'daily' && !contactRule(job, date) ? (f.bonus ?? 0) : null, tips_tx_id: tipsTx,
  });
  else if (existing) remove('shifts', id);
  return () => {
    if (existing) put('shifts', existing); else remove('shifts', id);
    if (prevTip) put('transactions', prevTip);
    else if (tipsTx) remove('transactions', tipsTx);
  };
}

/** Records a payment for a pay period, adding the salary and bonus to your income. Returns an undo. */
export function writePayout(job: Job, period: { start: string; end: string }, amt: number, bon: number, account: string | null, date: string) {
  const label = periodLabel(period);
  const income = (category: string, a: number, what: string) => {
    const id = uuid();
    put('transactions', {
      id, owner_id: '', type: 'income', date, amount: a, account_id: account!, to_account_id: null,
      category_id: category, note: `${job.name} ${what}${label}`, recurring_id: null, seq: Date.now() % 100000,
    });
    return id;
  };
  let txId: string | null = null, bonusTx: string | null = null;
  if (account) {
    if (amt > 0 && job.salary_category_id) txId = income(job.salary_category_id, amt, '');
    if (bon > 0 && job.bonus_category_id) bonusTx = income(job.bonus_category_id, bon, 'bonus ');
  }
  // one row per payment, each linked to its own income entries (delete the entry → it's owed again)
  const id = `${payoutId(job.id, period.start)}:${uuid().slice(0, 8)}`;
  put('payouts', { id, owner_id: '', job_id: job.id, period_start: period.start, period_end: period.end, amount: round2(amt), bonus: round2(bon), tx_id: txId, bonus_tx_id: bonusTx, date });
  return { txId, bonusTx, undo: () => { remove('payouts', id); if (txId) remove('transactions', txId); if (bonusTx) remove('transactions', bonusTx); } };
}

const pShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
/** "16–31 Oct" */
export const periodLabel = (p: { start: string; end: string }) => `${fromISO(p.start).getDate()}–${pShort.format(fromISO(p.end))}`;

/** Saves a strategy's P&L for a day (null clears it). Returns the previous value for an undo. */
export function savePnl(sid: string, date: string, value: number | null) {
  const id = pnlId(sid, date);
  const existing = getState().pnl[id];
  const prev = existing && !existing.deleted_at ? existing : null;
  if (value == null) { if (prev) remove('pnl', id); return prev; }
  put('pnl', { id, owner_id: '', strategy_id: sid, date, pnl: round2(value) });
  return prev;
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
