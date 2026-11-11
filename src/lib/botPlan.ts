import { useMemo } from 'react';
import { useStore, getState, setPrefs, type State } from './store';
import { alive } from './calc';
import { addDays, fromISO, round2, toISO, todayISO } from './format';
import type { BotMilestone, BotPlan, Pnl } from './types';

/**
 * The bot plan: a balance that grows `pct` every trading day (Mon–Fri, not 25 Dec / 1 Jan) — or an account's `boost` %
 * until it first reaches the boost's amount — with milestones:
 *   once   when the balance reaches `at`, withdraw `amount` that day
 *   daily  when the balance reaches `at`, withdraw `amount` every trading day from the next one
 * Account 2 starts with its own capital, by default the trading day after account 1's first withdrawal, or after account 1's
 * Nth daily withdrawal (`afterDaily`). A daily withdrawal with `until` stops once that milestone on the other account is reached.
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

/** Plan B (Nov 2026): 25% a day until account 1 first reaches 4.000 €, then 10%; account 2 starts on account 1's daily withdrawals. */
export const PLAN_V = 2;
export function defaultPlan(today = todayISO()): BotPlan {
  return {
    bought: null, pct: 10, v: PLAN_V,
    a1: { capital: 610, start: nextMonday(today), strategy: null, boost: { pct: 25, until: 4000 } },
    a2: { capital: 1000, start: null, strategy: null, afterDaily: 2, boost: null },
    milestones: [
      { id: 'm1', acc: 1, at: 4000, kind: 'once', amount: 3000 },
      { id: 'm2', acc: 1, at: 10000, kind: 'daily', amount: 1000, until: 'm3' },
      { id: 'm3', acc: 2, at: 100000, kind: 'daily', amount: 10000 },
      { id: 'm4', acc: 1, at: 100000, kind: 'daily', amount: 10000 },
    ],
  };
}
export const getPlan = (s: State): BotPlan => s.prefs.botPlan ?? defaultPlan();
export function savePlan(patch: Partial<BotPlan>) { setPrefs({ botPlan: { ...getPlan(getState()), ...patch } }); }

export interface Hit { id: string; date: string | null; logged?: string }
interface Sim { curve: Array<{ date: string; bal: number; lr: number }>; hits: Map<string, string> }
interface Rate { pct: number; boost: { pct: number; until: number } | null }   // boost null = already over (or none)

/** Grow from `bal` on the trading days from `from` on; milestones in `done` are treated as already reached.
 *  `stop`: daily withdrawal id → the last day it's taken. */
function simulate(bal: number, from: string, rate: Rate, ms: BotMilestone[], done: Set<string>, stop: Map<string, string>, maxDays = 1500): Sim {
  const curve: Sim['curve'] = [];
  const hits = new Map<string, string>();
  const live = new Set(ms.filter(m => m.kind === 'daily' && done.has(m.id)).map(m => m.id));   // daily withdrawals already running
  const pending = ms.filter(m => !done.has(m.id)).sort((a, b) => a.at - b.at);
  let d = onOrAfter(from), n = 0, boost = rate.boost;
  while (n < maxDays) {
    const pct = boost ? boost.pct : rate.pct;
    bal *= 1 + pct / 100;
    if (boost && bal >= boost.until) boost = null;                                           // the higher % ends after today
    for (const id of live) {
      const last = stop.get(id);
      if (last && d > last) { live.delete(id); continue; }
      bal -= ms.find(m => m.id === id)!.amount;                                              // started on an earlier day
    }
    for (const m of pending) {
      if (hits.has(m.id) || bal < m.at) continue;
      hits.set(m.id, d);
      if (m.kind === 'once') bal -= m.amount; else if (!(stop.get(m.id) && d >= stop.get(m.id)!)) live.add(m.id);   // a daily one starts tomorrow
    }
    curve.push({ date: d, bal: round2(Math.max(0, bal)), lr: Math.log(1 + pct / 100) });
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

  const real = (strategy: string | null, start: string) => {
    if (!strategy || today < start) return null;
    return pnl.filter(p => p.strategy_id === strategy && p.date >= start).sort((a, b) => a.date.localeCompare(b.date));
  };

  /** One account from its start: the plan, and (if linked) where it really is and what follows from there. */
  const run = (acc: 1 | 2, start: string, stop: Map<string, string>) => {
    const cfg = acc === 1 ? plan.a1 : plan.a2;
    const mine = ms.filter(m => m.acc === acc);
    const hits = new Map<string, string | null>();
    const boost = cfg.boost && cfg.boost.pct > 0 && cfg.boost.until > 0 ? cfg.boost : null;
    const planSim = simulate(cfg.capital, start, { pct: plan.pct, boost }, mine, new Set(), stop);
    const days = real(cfg.strategy, start);
    let actual: number | null = null, planNow: number | null = null, daysAhead: number | null = null;
    const curveReal: AccView['curveReal'] = [];
    let sim = planSim;
    if (days) {
      // real balance: capital + P&L − the one-off withdrawals you marked − the daily ones once their milestone is reached
      let b = cfg.capital, growth = 0, boostOver = !boost;
      const outs = mine.filter(m => m.kind === 'once' && logged[m.id]).map(m => ({ date: logged[m.id], amount: m.amount }));
      const dailies = mine.filter(m => m.kind === 'daily');
      const on = new Set<string>(); const reached = new Map<string, string>();
      for (const p of days) {
        if (b > 0 && 1 + p.pnl / b > 0) growth += Math.log(1 + p.pnl / b);
        b += p.pnl;
        if (boost && b >= boost.until) boostOver = true;
        for (const o of outs) if (o.date === p.date) b -= o.amount;
        for (const m of dailies) if (on.has(m.id) && !(stop.get(m.id) && p.date > stop.get(m.id)!)) b -= m.amount;
        for (const m of dailies) if (b >= m.at && !on.has(m.id)) { on.add(m.id); reached.set(m.id, p.date); }
        curveReal.push({ date: p.date, bal: round2(b) });
      }
      for (const o of outs) if (!days.some(p => p.date === o.date)) b -= o.amount;
      if (boost && mine.some(m => m.kind === 'once' && logged[m.id] && m.at >= boost.until)) boostOver = true;
      actual = round2(b);
      const last = days.length ? days[days.length - 1].date : null;
      planNow = last ? [...planSim.curve].reverse().find(c => c.date <= last)?.bal ?? cfg.capital : cfg.capital;
      // pace: the real compounding vs the plan's, in trading days (withdrawals don't count against it)
      let n = 0;
      if (last) for (let d = start; d <= last; d = addDays(d, 1)) if (isTradingDay(d)) n++;
      let k = 0, cum = 0;
      while (k < planSim.curve.length && cum + planSim.curve[k].lr <= growth + 1e-9) cum += planSim.curve[k++].lr;
      const frac = k < planSim.curve.length ? (growth - cum) / planSim.curve[k].lr : 0;
      daysAhead = Math.round(k + frac - n);
      // from here on: the same pace from where you really are; a reached one-off you haven't marked is due today
      const due = mine.filter(m => m.kind === 'once' && !logged[m.id] && actual! >= m.at);
      for (const m of due) { hits.set(m.id, today); actual -= m.amount; }
      const done = new Set([...mine.filter(m => logged[m.id] || on.has(m.id)).map(m => m.id), ...due.map(m => m.id)]);
      let s0 = last ? nextTradingDay(last) : start;
      if (s0 < today) s0 = isTradingDay(today) ? today : nextTradingDay(today);
      for (const [id, d] of reached) hits.set(id, d);
      sim = simulate(Math.max(0, actual), s0, { pct: plan.pct, boost: boostOver ? null : boost }, mine, done, stop);
      actual = round2(b);
      for (const m of mine) if (done.has(m.id) && !hits.has(m.id)) hits.set(m.id, logged[m.id] ?? planSim.hits.get(m.id) ?? today);
    }
    for (const m of mine) if (!hits.has(m.id)) hits.set(m.id, sim.hits.get(m.id) ?? null);
    const view: AccView = { acc, start, capital: cfg.capital, started: today >= start, actual, planNow, daysAhead, curvePlan: planSim.curve, curveReal };
    return { view, hits };
  };

  // account 1, then account 2 (its start hangs on account 1), then account 1 again if a daily withdrawal stops on account 2
  let r1 = run(1, plan.a1.start, new Map());
  let start2 = plan.a2.start;
  if (!start2) {
    const n = plan.a2.afterDaily;
    if (n != null && n >= 0) {
      const daily = ms.filter(m => m.acc === 1 && m.kind === 'daily').sort((a, b) => a.at - b.at)[0];
      let d = daily ? r1.hits.get(daily.id) ?? null : null;
      if (d) { for (let i = 0; i < n; i++) d = nextTradingDay(d); start2 = nextTradingDay(d); }
    } else {
      const first = ms.filter(m => m.acc === 1 && m.kind === 'once').sort((a, b) => a.at - b.at)[0];
      const when = first ? (logged[first.id] ?? r1.hits.get(first.id)) : null;
      start2 = when ? nextTradingDay(when) : null;
    }
  }
  const r2 = start2 ? run(2, start2, new Map()) : null;
  const stop1 = new Map<string, string>();
  for (const m of ms) if (m.acc === 1 && m.kind === 'daily' && m.until) { const d = r2?.hits.get(m.until); if (d) stop1.set(m.id, d); }
  if (stop1.size) r1 = run(1, plan.a1.start, stop1);

  const hits = new Map<string, string | null>([...r1.hits, ...(r2?.hits ?? [])]);
  const accs: AccView[] = [r1.view, ...(r2 ? [r2.view] : [])];
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
