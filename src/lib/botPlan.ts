import { useMemo } from 'react';
import { useStore, getState, setPrefs, type State } from './store';
import { alive } from './calc';
import { addDays, fromISO, round2, toISO, todayISO } from './format';
import type { BotMilestone, BotPlan, Pnl } from './types';

/**
 * The bot plan: a balance that grows `pct` every trading day (Mon–Fri, not 25 Dec / 1 Jan), with milestones:
 *   once   when the balance reaches `at`, withdraw `amount` that day
 *   daily  when the balance reaches `at`, withdraw `amount` every trading day from the next one
 * Account 2 starts with its own capital, by default the trading day after account 1's first withdrawal.
 *
 * Before the start (or without a linked strategy) the dates come from the plan. Once it runs, they come from the real
 * balance — capital + the linked strategy's P&L since the start − the withdrawals you marked — grown at the same pace
 * from today, so they move with reality. Purely a picture: nothing here writes entries.
 */

export const isTradingDay = (iso: string) => { const d = fromISO(iso).getDay(); return d !== 0 && d !== 6 && !iso.endsWith('-12-25') && !iso.endsWith('-01-01'); };
export const nextTradingDay = (iso: string) => { let d = addDays(iso, 1); while (!isTradingDay(d)) d = addDays(d, 1); return d; };
const onOrAfter = (iso: string) => (isTradingDay(iso) ? iso : nextTradingDay(iso));
/** Next Monday (or today if it's Monday). */
export function nextMonday(today = todayISO()) { const d = fromISO(today); const k = (8 - d.getDay()) % 7; return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + k)); }

export function defaultPlan(today = todayISO()): BotPlan {
  return {
    bought: null, pct: 10,
    a1: { capital: 630, start: nextMonday(today), strategy: null },
    a2: { capital: 1000, start: null, strategy: null },
    milestones: [
      { id: 'm1', acc: 1, at: 4000, kind: 'once', amount: 3000 },
      { id: 'm2', acc: 1, at: 10000, kind: 'daily', amount: 1000 },
      { id: 'm3', acc: 2, at: 100000, kind: 'daily', amount: 10000 },
    ],
  };
}
export const getPlan = (s: State): BotPlan => s.prefs.botPlan ?? defaultPlan();
export function savePlan(patch: Partial<BotPlan>) { setPrefs({ botPlan: { ...getPlan(getState()), ...patch } }); }

export interface Hit { id: string; date: string | null; logged?: string }
interface Sim { curve: Array<{ date: string; bal: number }>; hits: Map<string, string> }

/** Grow from `bal` on the trading days from `from` on; milestones in `done` are treated as already reached. */
function simulate(bal: number, from: string, pct: number, ms: BotMilestone[], done: Set<string>, maxDays = 1500): Sim {
  const curve: Sim['curve'] = [];
  const hits = new Map<string, string>();
  const live = new Set(ms.filter(m => m.kind === 'daily' && done.has(m.id)).map(m => m.id));   // daily withdrawals already running
  const pending = ms.filter(m => !done.has(m.id)).sort((a, b) => a.at - b.at);
  let d = onOrAfter(from), n = 0;
  const r = 1 + pct / 100;
  while (n < maxDays) {
    bal *= r;
    for (const id of live) bal -= ms.find(m => m.id === id)!.amount;                         // started on an earlier day
    for (const m of pending) {
      if (hits.has(m.id) || bal < m.at) continue;
      hits.set(m.id, d);
      if (m.kind === 'once') bal -= m.amount; else live.add(m.id);                         // a daily one starts tomorrow
    }
    curve.push({ date: d, bal: round2(Math.max(0, bal)) });
    if (bal <= 0) break;
    n++;
    if (hits.size === pending.length && n > 10 && curve.length > 30) break;
    d = nextTradingDay(d);
  }
  return { curve, hits };
}

export interface AccView {
  acc: 1 | 2; start: string; capital: number; started: boolean;
  actual: number | null;           // the real balance now (linked strategy), null if not linked / not started
  planNow: number | null;          // where the plan says it should be today
  daysAhead: number | null;        // + ahead of plan, − behind (trading days at the plan's pace)
  curvePlan: Sim['curve']; curveReal: Array<{ date: string; bal: number }>;
}
export interface PlanView { plan: BotPlan; hits: Hit[]; accs: AccView[]; next: (BotMilestone & { date: string | null }) | null }

export function planView(s: State, today = todayISO()): PlanView {
  const plan = getPlan(s);
  const logged = plan.logged ?? {};
  const ms = plan.milestones;
  const pnl = alive(s.pnl) as Pnl[];
  const hits = new Map<string, string | null>();
  const accs: AccView[] = [];

  const real = (strategy: string | null, start: string) => {
    if (!strategy || today < start) return null;
    const days = pnl.filter(p => p.strategy_id === strategy && p.date >= start).sort((a, b) => a.date.localeCompare(b.date));
    return days;
  };

  for (const acc of [1, 2] as const) {
    const cfg = acc === 1 ? plan.a1 : plan.a2;
    const mine = ms.filter(m => m.acc === acc);
    let start = acc === 1 ? plan.a1.start : plan.a2.start;
    if (acc === 2 && !start) {
      const first = ms.filter(m => m.acc === 1 && m.kind === 'once').sort((a, b) => a.at - b.at)[0];
      const when = first ? (logged[first.id] ?? hits.get(first.id)) : null;
      start = when ? nextTradingDay(when) : null;
    }
    if (!start) { mine.forEach(m => hits.set(m.id, null)); continue; }
    const planSim = simulate(cfg.capital, start, plan.pct, mine, new Set());
    const days = real(cfg.strategy, start);
    let actual: number | null = null, planNow: number | null = null, daysAhead: number | null = null;
    const curveReal: AccView['curveReal'] = [];
    let sim = planSim;
    if (days) {
      // real balance: capital + P&L − the one-off withdrawals you marked − the daily ones once their milestone is reached
      let b = cfg.capital, growth = 0;
      const outs = mine.filter(m => m.kind === 'once' && logged[m.id]).map(m => ({ date: logged[m.id], amount: m.amount }));
      const dailies = mine.filter(m => m.kind === 'daily');
      const on = new Set<string>(); const reached = new Map<string, string>();
      for (const p of days) {
        if (b > 0 && 1 + p.pnl / b > 0) growth += Math.log(1 + p.pnl / b);
        b += p.pnl;
        for (const o of outs) if (o.date === p.date) b -= o.amount;
        for (const m of dailies) if (on.has(m.id)) b -= m.amount;
        for (const m of dailies) if (b >= m.at && !on.has(m.id)) { on.add(m.id); reached.set(m.id, p.date); }
        curveReal.push({ date: p.date, bal: round2(b) });
      }
      for (const o of outs) if (!days.some(p => p.date === o.date)) b -= o.amount;
      actual = round2(b);
      const last = days.length ? days[days.length - 1].date : null;
      planNow = last ? [...planSim.curve].reverse().find(c => c.date <= last)?.bal ?? cfg.capital : cfg.capital;
      // pace: the real compounding vs the plan's, in trading days (withdrawals don't count against it)
      let n = 0;
      if (last) for (let d = start; d <= last; d = addDays(d, 1)) if (isTradingDay(d)) n++;
      daysAhead = Math.round(growth / Math.log(1 + plan.pct / 100) - n);
      // from here on: the same pace from where you really are; a reached one-off you haven't marked is due today
      const due = mine.filter(m => m.kind === 'once' && !logged[m.id] && actual! >= m.at);
      for (const m of due) { hits.set(m.id, today); actual -= m.amount; }
      const done = new Set([...mine.filter(m => logged[m.id] || on.has(m.id)).map(m => m.id), ...due.map(m => m.id)]);
      let s0 = last ? nextTradingDay(last) : start;
      if (s0 < today) s0 = isTradingDay(today) ? today : nextTradingDay(today);
      for (const [id, d] of reached) hits.set(id, d);
      sim = simulate(Math.max(0, actual), s0, plan.pct, mine, done);
      actual = round2(b);
      for (const m of mine) if (done.has(m.id) && !hits.has(m.id)) hits.set(m.id, logged[m.id] ?? planSim.hits.get(m.id) ?? today);
    }
    for (const m of mine) if (!hits.has(m.id)) hits.set(m.id, sim.hits.get(m.id) ?? null);
    accs.push({ acc, start, capital: cfg.capital, started: today >= start, actual, planNow, daysAhead, curvePlan: planSim.curve, curveReal });
  }

  const list: Hit[] = ms.map(m => ({ id: m.id, date: hits.get(m.id) ?? null, logged: logged[m.id] }));
  const upcoming = ms.map(m => ({ ...m, date: hits.get(m.id) ?? null })).filter(m => !logged[m.id] && m.date && m.date >= today).sort((a, b) => a.date!.localeCompare(b.date!));
  return { plan, hits: list, accs, next: upcoming[0] ?? null };
}

export function usePlanView(): PlanView {
  const prefs = useStore(s => s.prefs.botPlan);
  const pnl = useStore(s => s.pnl);
  const today = todayISO();
  return useMemo(() => planView(getState(), today), [prefs, pnl, today]); // eslint-disable-line react-hooks/exhaustive-deps
}
