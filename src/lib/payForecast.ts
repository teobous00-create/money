import { useMemo } from 'react';
import { useStore, type State } from './store';
import { alive } from './calc';
import { addDays, fromISO, round2, toISO, todayISO } from './format';
import { allocate, computeSplit, goalLeftNow, splitSettings, waitingPays, type Move } from './paySplit';
import { payPeriods, periodLabel, periodOf, shiftDone, shiftPay } from './tracker';
import { isPending, useTimesVersion } from './txTime';
import type { Job } from './types';

/**
 * The pay split run forward over the pays your declared shifts will bring (no AI).
 *
 *   pays      every pay period from last month on with worked-and-unpaid or planned shifts; paid on the 10th of the next
 *             month (monthly jobs) or the 16th / the 1st (twice-monthly); a monthly job with a bonus category gets
 *             `bonusPerShift` per shift for months not closed yet (closed months: the Tracker's real bonus)
 *   tips      `tipsPerShift` on each planned shift of a job with tips, on the day
 *   spending  as planned: each month needs a typical month (budgets at your share + usual spending + repeating)
 *   card      what the credit card owes now is paid from today's money once; no new card debt after that
 *   each pay  spare = money not needed by the month + this month's pays still to come; at most the pay itself;
 *             split with your rules (matching once a month, reserve per pay, goals) — goals fill up and close;
 *             the matched goal gets as much again from your partner
 */

export const DEFAULT_BONUS_PER_SHIFT = 15;
export const DEFAULT_TIPS_PER_SHIFT = 9;

export interface FcPay { date: string; job: string; label: string; amount: number; bonus: number; planned: number }
export interface FcEvent { date: string; label: string; amount: number; spare: number; toSplit: number; moves: Move[]; today?: boolean }
export interface FcGoal { id: string; name: string; left: number; closes: string | null }
export interface Forecast { until: string; events: FcEvent[]; goals: FcGoal[]; tips: number; lastShift: string | null }

const monthEnd = (iso: string) => { const d = fromISO(iso); return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const monthStart = (iso: string) => iso.slice(0, 8) + '01';
const nextMonth = (iso: string) => { const d = fromISO(iso); return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 1)); };
const monthsBack = (iso: string, k: number) => { const d = fromISO(iso); return toISO(new Date(d.getFullYear(), d.getMonth() - k, 1)); };

/** When a period is paid: monthly → the 10th of the next month; twice-monthly → the 16th (1–15) or the 1st (16–end). */
export function payday(job: Job, start: string, end: string): string {
  if (job.pay === 'monthly') return nextMonth(start).slice(0, 8) + '10';
  return Number(start.slice(8)) === 1 ? start.slice(0, 8) + '16' : nextMonth(end);
}

/** The pays still to come from your shifts (worked and not paid yet, or planned), with the date each is expected. */
export function futurePays(s: State, today = todayISO(), bonusPerShift = DEFAULT_BONUS_PER_SHIFT): FcPay[] {
  const me = s.user?.id;
  const from = monthsBack(today, 1);
  const shifts = alive(s.shifts);
  const linked = new Set(alive(s.payouts).flatMap(p => [p.tx_id, p.bonus_tx_id]).filter(Boolean) as string[]);
  const out: FcPay[] = [];
  for (const job of alive(s.jobs).filter(j => !j.archived).sort((a, b) => a.sort - b.sort)) {
    const mine = shifts.filter(x => x.job_id === job.id && x.date >= from);
    const { list } = payPeriods(job, shifts, s.payouts, s.transactions);
    const owedBy = new Map(list.filter(p => p.start >= from).map(p => [p.start, p]));
    const periods = new Map<string, [string, string]>();
    for (const p of owedBy.values()) periods.set(p.start, [p.start, p.end]);
    for (const x of mine) { const [a, b] = periodOf(job, x.date); periods.set(a, [a, b]); }
    // pay entered by hand this month (not through "got paid") counts against the oldest owed period
    const cats = new Set([job.salary_category_id, job.bonus_category_id].filter(Boolean) as string[]);
    let loose = alive(s.transactions).filter(t => t.owner_id === me && t.type === 'income' && t.category_id && cats.has(t.category_id) && !linked.has(t.id)
      && t.date >= monthStart(today) && !isPending(t, today)).reduce((v, t) => v + t.amount, 0);
    const withBonus = job.kind === 'daily' && monthBonusJob(job);
    for (const [a, b] of [...periods.values()].sort((x, y) => x[0].localeCompare(y[0]))) {
      const p = owedBy.get(a);
      let worked = Math.max(0, p?.owed ?? 0);
      if (payday(job, a, b) <= monthEnd(today)) { const off = Math.min(loose, worked); worked -= off; loose -= off; }   // only pays due this month
      const inP = mine.filter(x => x.date >= a && x.date <= b);
      const planned = inP.filter(x => !shiftDone(job, x, today)).reduce((v, x) => v + shiftPay(job, x), 0);
      // a month not closed yet: the bonus estimated per shift (worked + planned)
      const bonus = withBonus && b >= today ? inP.length * bonusPerShift : 0;
      const amount = round2(worked + planned + bonus);
      if (amount <= 0.004) continue;
      let date = payday(job, a, b);
      if (date <= today) date = addDays(today, 1);   // late: any day now
      out.push({ date, job: job.id, label: `${job.name} ${periodLabel({ start: a, end: b })}`, amount, bonus: round2(bonus), planned: round2(planned) });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}
/** A job paid a monthly bonus (contacts target or a bonus category). */
const monthBonusJob = (job: Job) => !!job.bonus_category_id || (job.rates ?? []).some(r => (r.min ?? 0) > 0);

export function forecast(s: State, today = todayISO()): Forecast {
  const me = s.user?.id;
  const cfg = splitSettings(s);
  const fc = s.prefs.paySplit?.forecast ?? {};
  const bonusPerShift = fc.bonusPerShift ?? DEFAULT_BONUS_PER_SHIFT, tipsPerShift = fc.tipsPerShift ?? DEFAULT_TIPS_PER_SHIFT;
  const waiting = waitingPays(s, today);
  const now = computeSplit(s, waiting, today);
  const pays = futurePays(s, today, bonusPerShift);
  const lastShift = alive(s.shifts).filter(x => s.jobs[x.job_id] && !s.jobs[x.job_id].deleted_at).reduce<string | null>((m, x) => (!m || x.date > m ? x.date : m), null);
  const auto = pays.length ? pays[pays.length - 1].date : today;
  const until = fc.until && fc.until > today ? fc.until : auto;

  // the state carried along: money not needed by the month (cash − what the month still needs), goals' room
  let free = now.available - now.needTotal;
  const left = goalLeftNow(s, today);
  const events: FcEvent[] = [];
  const mg = cfg.match.goal;
  const matched = new Map<string, number>();   // month → matched so far
  if (mg) {
    const ids = new Set([mg, ...alive(s.categories).filter(c => c.parent_id === mg).map(c => c.id)]);
    matched.set(today.slice(0, 7), alive(s.transactions).filter(t => t.owner_id === me && t.type === 'expense' && t.category_id && ids.has(t.category_id) && t.date >= monthStart(today) && !isPending(t, today)).reduce((v, t) => v + t.amount, 0));
  }
  // the matched goal fills from both sides: your partner puts in what you do, so you need only half of what's left
  const apply = (moves: Move[], month: string, partnerToo: boolean) => {
    for (const m of moves) {
      free -= m.amount;
      const both = m.kind === 'match' && partnerToo ? 2 : 1;
      if (m.kind !== 'reserve' && left.has(m.to)) left.set(m.to, Math.max(0, left.get(m.to)! - m.amount * both));
      if (m.kind === 'match') matched.set(month, (matched.get(month) ?? 0) + m.amount);
    }
  };
  const myRoom = () => { const r = new Map(left); if (mg && r.has(mg)) r.set(mg, Math.ceil(r.get(mg)! / 2)); return r; };
  const closes = new Map<string, string>();
  const markClosed = (date: string) => { for (const [id, v] of left) if (v <= 0.004 && !closes.has(id)) closes.set(id, date); };
  for (const [id, v] of left) if (v <= 0.004) closes.set(id, '');   // already reached: not shown as a forecast

  // today's pay, as the card proposes it
  if (waiting.length) {
    events.push({ date: today, label: 'Today', amount: now.payTotal, spare: now.spare, toSplit: now.toSplit, moves: now.moves, today: true });
    apply(now.moves, today.slice(0, 7), false);   // today's matching follows what your partner already put in
    markClosed(today);
  }

  // tips on planned shifts of jobs with tips
  const tipDays: string[] = [];
  for (const x of alive(s.shifts)) {
    const job = s.jobs[x.job_id];
    if (!job || job.deleted_at || job.archived || !job.tips_category_id || x.date > until || shiftDone(job, x, today)) continue;
    tipDays.push(x.date);
  }

  // walk the days: month starts, tips, pays
  type Ev = { date: string; order: number; run: () => void };
  const evs: Ev[] = [];
  let first = true;
  for (let m = nextMonth(today); m <= until; m = nextMonth(m)) {
    evs.push({ date: m, order: 0, run: () => { free += first ? now.nextReserved : 0; first = false; free -= now.monthly; } });
  }
  for (const d of tipDays) evs.push({ date: d, order: 1, run: () => { free += tipsPerShift; } });
  const upcoming = pays.filter(p => p.date <= until);
  upcoming.forEach((p, i) => evs.push({
    date: p.date, order: 2, run: () => {
      free += p.amount;
      const month = p.date.slice(0, 7);
      const still = upcoming.slice(i + 1).filter(q => q.date <= monthEnd(p.date)).reduce((v, q) => v + q.amount, 0);
      const spare = round2(free + still);
      const toSplit = Math.max(0, Math.floor(Math.min(spare, p.amount)));
      const want = Math.max(0, cfg.match.monthly - (matched.get(month) ?? 0));
      const { moves } = allocate(s, cfg, toSplit, want, myRoom());
      apply(moves, month, true);
      markClosed(p.date);
      events.push({ date: p.date, label: p.label, amount: p.amount, spare, toSplit, moves });
    },
  }));
  evs.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order).forEach(e => e.run());

  const ids = new Set([...(mg ? [mg] : []), ...cfg.goals.map(g => g.id)]);
  const rows = goalLeftNow(s, today);
  const goals: FcGoal[] = [...ids].filter(id => s.categories[id] && !s.categories[id].deleted_at && (rows.get(id) ?? 1) > 0.004)
    .map(id => ({ id, name: s.categories[id].name, left: round2(rows.get(id) ?? 0), closes: closes.get(id) || null }));
  return { until, events, goals, tips: tipsPerShift, lastShift };
}

export function useForecast(on: boolean): Forecast | null {
  const s = useStore(x => x);
  const tv = useTimesVersion();
  const today = todayISO();
  return useMemo(() => (on && s.user ? forecast(s, today) : null),
    [on, s.accounts, s.transactions, s.recurring, s.categories, s.prefs, s.jobs, s.shifts, s.payouts, s.members, s.user, today, tv]); // eslint-disable-line react-hooks/exhaustive-deps
}
