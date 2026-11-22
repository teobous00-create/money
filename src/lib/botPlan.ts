import { useMemo } from 'react';
import { useStore, getState, setPrefs, put, remove, type State } from './store';
import { alive } from './calc';
import { addDays, fromISO, round2, toISO, todayISO, uuid } from './format';
import type { BotOut, BotPlan, BotWeekly, Pnl } from './types';

/**
 * The bot plan (v3, Nov 2026): account 1 grows `pct` every trading day (Mon–Fri, not 25 Dec / 1 Jan) up to the goal.
 * On the last trading day of each week you withdraw down to the highest step the balance has passed
 * (1.100, 1.500, 2.000 … 10.000 €), never to a lower step than the week before; once at the goal it's withdrawn back to the goal.
 * The withdrawals pay for the spend list, in order; each one reaches the bank about a week later.
 *
 * Without a linked strategy (or before the start) everything comes from the plan. Once it runs, the real balance is
 * capital + the linked strategy's P&L since the start − the withdrawals you logged, and the rest is projected from there.
 * Purely a picture: nothing here writes entries.
 */

export const isTradingDay = (iso: string) => { const d = fromISO(iso).getDay(); return d !== 0 && d !== 6 && !iso.endsWith('-12-25') && !iso.endsWith('-01-01'); };
export const nextTradingDay = (iso: string) => { let d = addDays(iso, 1); while (!isTradingDay(d)) d = addDays(d, 1); return d; };
const onOrAfter = (iso: string) => (isTradingDay(iso) ? iso : nextTradingDay(iso));
/** Next Monday (or today if it's Monday). */
export function nextMonday(today = todayISO()) { const d = fromISO(today); const k = (8 - d.getDay()) % 7; return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + k)); }
/** The week's withdrawal day: its last trading day (Friday, or Thursday when Friday is closed). */
export const isWithdrawDay = (iso: string) => {
  if (!isTradingDay(iso)) return false;
  const n = nextTradingDay(iso);
  return fromISO(n).getDay() <= fromISO(iso).getDay() || (fromISO(n).getTime() - fromISO(iso).getTime()) / 864e5 >= 7;
};
export const ARRIVE_DAYS = 7;

export const PLAN_V = 4;
export const DEFAULT_WEEKLY: BotWeekly = { steps: [1100, 1500, 2000, 3000, 4000, 5000, 7000, 10000], goal: 10000, spendFrom: '2026-11-23' };
export const DEFAULT_SPEND = [
  { id: 's1', name: 'Δόσεις πιστωτικής', amount: 350 },
  { id: 's2', name: 'Σιδεράκια', amount: 900 },
  { id: 's3', name: 'Μαξιλάρι ασφαλείας', amount: 3000 },
  { id: 's4', name: 'Μικρά έξοδα', amount: 1000 },
  { id: 's5', name: 'Crypto bot', amount: 1000 },
  { id: 's6', name: 'Copy trading', amount: 1000 },
];
export function defaultPlan(today = todayISO()): BotPlan {
  return {
    bought: null, pct: 10, v: PLAN_V, lotPer: 300,
    a1: { capital: 800, start: nextMonday(today), strategy: null, boost: null },
    a2: { capital: 0, start: null, strategy: null, boost: null },
    milestones: [], weekly: DEFAULT_WEEKLY, outs: [], spend: DEFAULT_SPEND,
  };
}
export const getPlan = (s: State): BotPlan => s.prefs.botPlan ?? defaultPlan();
export function savePlan(patch: Partial<BotPlan>) { setPrefs({ botPlan: { ...getPlan(getState()), ...patch } }); }

/** The step to withdraw down to on a withdrawal day: the highest step ≤ the balance, if it's not below last week's. */
export function stepFor(bal: number, last: number, steps: number[]) {
  const s = [...steps].sort((a, b) => a - b).filter(x => x <= bal + 1e-9).pop() ?? 0;
  return s > 0 && s >= last ? s : null;
}

export interface WOut { date: string; amount: number; step: number; real: boolean; id?: string; received?: string | null; to?: string | null }
export interface SpendView { id: string; name: string; amount: number; cum: number; date: string | null; arrives: string | null; done: boolean }
export interface WeekView {
  plan: BotPlan; weekly: BotWeekly; started: boolean; linked: boolean;
  actual: number | null;                       // real balance now (null = not linked / not started)
  daysAhead: number | null;                    // + ahead of plan, − behind (trading days at the plan's pace)
  goalDate: string | null;                     // the withdrawal day the account is first left at the goal
  next: WOut | null;                           // the next withdrawal (projected, or today's from the real balance)
  outs: WOut[];                                // logged and projected withdrawals, in date order
  curve: Array<{ date: string; bal: number; real: boolean }>;
  todayIdx: number;
  spend: SpendView[]; spendTotal: number; spendOut: number;   // withdrawn so far towards the spend list
  today: { day: string; bal: number; pct: number; lot: number; real: boolean } | null;
}

export function weekView(s: State, today = todayISO()): WeekView {
  const plan = getPlan(s);
  const weekly = plan.weekly ?? DEFAULT_WEEKLY;
  const cfg = plan.a1;
  const start = cfg.start;
  const pct = plan.pct;
  const outsLogged = [...(plan.outs ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const started = today >= start;
  const days = cfg.strategy && started
    ? (alive(s.pnl) as Pnl[]).filter(p => p.strategy_id === cfg.strategy && p.date >= start).sort((a, b) => a.date.localeCompare(b.date))
    : null;

  // the real part: balance day by day from the P&L and the withdrawals you logged
  const curve: WeekView['curve'] = [];
  let bal = cfg.capital, growth = 0, lastDay: string | null = null;
  let actual: number | null = null, daysAhead: number | null = null;
  if (days) {
    const byDate = new Map<string, number>();
    for (const p of days) byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.pnl);
    const dates = [...new Set([...byDate.keys(), ...outsLogged.map(o => o.date).filter(d => d >= start && d <= today)])].sort();
    curve.push({ date: addDays(start, -1), bal: round2(bal), real: true });
    for (const d of dates) {
      const p = byDate.get(d) ?? 0;
      if (p && bal > 0 && 1 + p / bal > 0) growth += Math.log(1 + p / bal);
      bal += p;
      for (const o of outsLogged) if (o.date === d) bal -= o.amount;
      curve.push({ date: d, bal: round2(bal), real: true });
      if (byDate.has(d)) lastDay = d;
    }
    for (const o of outsLogged) if (o.date < start || o.date > today) bal -= o.amount;
    actual = round2(bal);
    let n = 0;
    if (lastDay) for (let d = start; d <= lastDay; d = addDays(d, 1)) if (isTradingDay(d)) n++;
    daysAhead = Math.round(growth / Math.log(1 + pct / 100) - n);
  }

  // the projection: from where you are (or the plan's start), the same pace and the same weekly rule
  let lastStep = outsLogged.length ? Math.max(...outsLogged.map(o => o.step)) : 0;
  let d: string;
  if (days) {
    d = lastDay ? nextTradingDay(lastDay) : onOrAfter(start);
    if (d < today) d = onOrAfter(today);
  } else {
    d = onOrAfter(started && !cfg.strategy ? today : start);
    if (!started) curve.push({ date: addDays(start, -1), bal: round2(bal), real: false });
  }
  const loggedDays = new Set(outsLogged.map(o => o.date));
  const proj: WOut[] = [];
  const spendTotal = (plan.spend ?? []).reduce((a, x) => a + x.amount, 0);
  const outToSpend = () => [...outsLogged.map(o => ({ date: o.date, amount: o.amount })), ...proj].filter(o => o.date >= weekly.spendFrom).reduce((a, o) => a + o.amount, 0);
  let goalDate: string | null = outsLogged.find(o => o.step >= weekly.goal)?.date ?? null;
  let todayBal: { day: string; bal: number; real: boolean } | null = null;
  // the week's withdrawal day already has its P&L (today, or a day you haven't logged yet): it's due now, from the real balance
  if (days && lastDay && isWithdrawDay(lastDay) && !loggedDays.has(lastDay) && addDays(lastDay, 4) >= today && !outsLogged.some(o => o.date >= lastDay!)) {
    const st = stepFor(bal, lastStep, weekly.steps);
    if (st != null && bal - st >= 0.01) {
      const due = lastDay < today ? today : lastDay;
      proj.push({ date: due, amount: round2(bal - st), step: st, real: false });
      bal = st; lastStep = st;
      if (st >= weekly.goal && !goalDate) goalDate = due;
      curve.push({ date: due, bal: round2(bal), real: false });
      loggedDays.add(due);
    }
  }
  for (let i = 0; i < 400; i++) {
    if (d >= today && !todayBal) todayBal = { day: d, bal: round2(bal), real: !!days };   // what the day opens with
    bal *= 1 + pct / 100;
    if (isWithdrawDay(d) && !loggedDays.has(d)) {
      const st = stepFor(bal, lastStep, weekly.steps);
      if (st != null && bal - st >= 0.01) {
        proj.push({ date: d, amount: round2(bal - st), step: st, real: false });
        bal = st; lastStep = st;
        if (st >= weekly.goal && !goalDate) goalDate = d;
      }
    }
    curve.push({ date: d, bal: round2(bal), real: false });
    const doneSpend = outToSpend() >= spendTotal - 0.005;
    if (goalDate && doneSpend && isWithdrawDay(d)) break;
    d = nextTradingDay(d);
  }

  const outs: WOut[] = [...outsLogged.map(o => ({ date: o.date, amount: o.amount, step: o.step, real: true, id: o.id, received: o.received ?? null, to: o.to ?? null })), ...proj].sort((a, b) => a.date.localeCompare(b.date));
  const next = proj.find(o => o.date >= today) ?? null;

  // the spend list against the withdrawals (from spendFrom), each covered on the day the running total passes it
  const toSpend = outs.filter(o => o.date >= weekly.spendFrom);
  let cum = 0;
  const spend: SpendView[] = (plan.spend ?? []).map(x => {
    cum += x.amount;
    let run = 0, date: string | null = null, done = false;
    for (const o of toSpend) { run += o.amount; if (run >= cum - 0.005) { date = o.date; done = o.real; break; } }
    return { ...x, cum, date, arrives: date ? addDays(date, ARRIVE_DAYS) : null, done };
  });
  const spendOut = round2(outsLogged.filter(o => o.date >= weekly.spendFrom).reduce((a, o) => a + o.amount, 0));

  const tb = todayBal ?? { day: onOrAfter(today), bal: round2(actual ?? cfg.capital), real: !!days };
  const todayIdx = curve.findIndex(c => c.date >= today);
  return {
    plan, weekly, started, linked: !!cfg.strategy, actual, daysAhead, goalDate, next, outs, curve, todayIdx,
    spend, spendTotal, spendOut,
    today: { day: tb.day, bal: tb.bal, pct, lot: lotFor(tb.bal, pct, plan), real: tb.real },
  };
}

/** 0.01 lot per `lotPer` € at the plan's % — a higher % a day takes proportionally more lot; rounded down, at least 0.01. */
export function lotFor(bal: number, pct: number, plan: BotPlan) {
  const per = (plan.lotPer ?? 300) * plan.pct / pct;
  return Math.max(0.01, Math.floor((bal / per) + 1e-9) / 100);
}

export function logOut(o: Omit<BotOut, 'id'> & { id?: string }) {
  const p = getPlan(getState());
  const id = o.id ?? Math.random().toString(36).slice(2, 10);
  savePlan({ outs: [...(p.outs ?? []).filter(x => x.id !== id), { ...o, id }] });
  return id;
}
export function removeOut(id: string) {
  const p = getPlan(getState());
  const o = (p.outs ?? []).find(x => x.id === id);
  if (o?.tx) remove('transactions', o.tx);
  savePlan({ outs: (p.outs ?? []).filter(x => x.id !== id) });
}

/** The trading account linked to the plan's strategy (its balance follows the bot), if any. */
export function planAccount(s: State = getState()): string | null {
  const strat = getPlan(s).a1.strategy;
  if (!strat) return null;
  const hit = Object.entries(s.prefs.accountLinks ?? {}).find(([id, l]) => l.strategy === strat && s.accounts[id] && !s.accounts[id].deleted_at);
  return hit ? hit[0] : null;
}

/** A withdrawal reached the bank: write the transfer from the bot's account to `to` on `date`, and mark it received. */
export function receiveOut(id: string, to: string, date: string) {
  const s = getState();
  const p = getPlan(s);
  const o = (p.outs ?? []).find(x => x.id === id);
  if (!o) return;
  const from = planAccount(s);
  let tx: string | null = null;
  if (from && from !== to) {
    tx = uuid();
    put('transactions', { id: tx, owner_id: '', type: 'transfer', date, amount: o.amount, account_id: from, to_account_id: to,
      category_id: null, note: 'Bot withdrawal', recurring_id: null, seq: Date.now() % 100000 });
  }
  savePlan({ outs: (p.outs ?? []).map(x => (x.id === id ? { ...x, received: date, to, tx } : x)), lastTo: to });
}
export function unreceiveOut(id: string) {
  const p = getPlan(getState());
  const o = (p.outs ?? []).find(x => x.id === id);
  if (!o) return;
  if (o.tx) remove('transactions', o.tx);
  savePlan({ outs: (p.outs ?? []).map(x => (x.id === id ? { ...x, received: null, to: null, tx: null } : x)) });
}

export function useWeekView(): WeekView {
  const prefs = useStore(s => s.prefs.botPlan);
  const pnl = useStore(s => s.pnl);
  const today = todayISO();
  return useMemo(() => weekView(getState(), today), [prefs, pnl, today]); // eslint-disable-line react-hooks/exhaustive-deps
}
