import { useMemo } from 'react';
import { useStore, type State } from './store';
import { alive, computeBalances } from './calc';
import { addDays, fromISO, round2, toISO, todayISO } from './format';
import { goalIds } from './goals';
import type { Account } from './types';

/**
 * Levels are a ladder you define (prefs.levelDefs; these are the defaults). Each level needs ALL its
 * rules AND every level below it. A rule = a measure, ≥ or ≤, and a value in €, in "× a month of
 * expenses", or in % (coverage).
 *   cash      cash after card debt, today (trading capital not counted)
 *   passive   P&L per month, average of the last 3 full months
 *   expenses  your expenses per month, same 3 months, without goals and transfers
 *   trading   trading capital today       savings   savings accounts today
 *   networth  every account today          coverage  passive ÷ expenses, in %
 */
export type Metric = 'cash' | 'passive' | 'expenses' | 'trading' | 'savings' | 'networth' | 'coverage';
export type Unit = 'eur' | 'x' | 'pct';
export interface Rule { metric: Metric; op: '>=' | '<='; value: number; unit: Unit }
export interface LevelDef { id: string; name: string; rule: string; rules: Rule[] }

export const METRICS: Record<Metric, string> = {
  cash: 'Cash after card debt', passive: 'Passive income / month', expenses: 'Expenses / month',
  trading: 'Trading capital', savings: 'Savings', networth: 'Net worth', coverage: 'Passive covers',
};

const r = (metric: Metric, value: number, unit: Unit = 'x', op: Rule['op'] = '>='): Rule => ({ metric, op, value, unit });
export const DEFAULT_LEVELS: LevelDef[] = [
  { id: 'l0', name: 'Underwater', rule: 'Less than ½ month of expenses once the card is paid', rules: [] },
  { id: 'l1', name: 'Afloat', rule: '½ month of expenses left after paying the card', rules: [r('cash', 0.5)] },
  { id: 'l2', name: 'Steady', rule: '1 month of expenses put by', rules: [r('cash', 1)] },
  { id: 'l3', name: 'Secure', rule: '3 months of expenses put by', rules: [r('cash', 3)] },
  { id: 'l4', name: 'Half free', rule: 'Passive income covers half your expenses', rules: [r('passive', 0.5)] },
  { id: 'l5', name: 'Self-funded', rule: 'Passive income covers all your expenses', rules: [r('passive', 1)] },
  { id: 'l6', name: 'Free', rule: 'Passive income 3× your expenses', rules: [r('passive', 3)] },
  { id: 'l7', name: 'Freedom', rule: '10.000 € a month and a year of expenses put by', rules: [r('passive', 10000, 'eur'), r('cash', 12)] },
];
export const levelDefs = (s: Pick<State, 'prefs'>): LevelDef[] => (s.prefs.levelDefs?.length ? s.prefs.levelDefs : DEFAULT_LEVELS);

export interface Need { label: string; have: number; need: number; met: boolean; op: Rule['op']; pct: boolean }
export interface Measures { cash: number; passive: number; expenses: number; trading: number; savings: number; networth: number; coverage: number }
export interface LevelState extends Measures {
  level: number;
  defs: LevelDef[];
  next: Need[];         // the next level's rules and where you are on each (the XP)
  ready: number[];      // higher levels whose own rules already hold ("unlocked, waiting")
}

const monthStart = (d: string) => d.slice(0, 8) + '01';
const lastDayOf = (d: string) => { const x = fromISO(d); return toISO(new Date(x.getFullYear(), x.getMonth() + 1, 0)); };
const monthsBack = (d: string, k: number) => { const x = fromISO(d); return toISO(new Date(x.getFullYear(), x.getMonth() - k, 1)); };

function needOf(rule: Rule, m: Measures): Need | null {
  const have = m[rule.metric];
  let need = rule.value;
  if (rule.unit === 'x') { if (m.expenses <= 0) return null; need = rule.value * m.expenses; }   // no expenses on record yet → can't be measured
  const met = rule.op === '>=' ? have >= need - 0.004 : have <= need + 0.004;
  return { label: METRICS[rule.metric], have: round2(have), need: round2(need), met, op: rule.op, pct: rule.metric === 'coverage' };
}
const holds = (def: LevelDef, m: Measures) => def.rules.every(x => needOf(x, m)?.met ?? false);

/** Measures as they were on `day` (end of a past month, or today). */
export function measuresAt(s: State, day: string): Measures {
  const me = s.user?.id;
  const trading = new Set(s.prefs.tradingAccounts ?? []);
  const all: Account[] = alive(s.accounts).filter(a => a.owner_id === me);
  const txs = alive(s.transactions);
  const bal = computeBalances(all, txs, day);
  const sum = (l: Account[]) => round2(l.reduce((x, a) => x + (bal.get(a.id) ?? 0), 0));
  const cash = sum(all.filter(a => !trading.has(a.id)));   // credit cards are negative while you owe
  const tradingCap = sum(all.filter(a => trading.has(a.id)));
  const savings = sum(all.filter(a => a.kind === 'savings' && !trading.has(a.id)));

  // the 3 full months before `day`'s month (the current one isn't over)
  const to = addDays(monthStart(day), -1), from = monthsBack(day, 3);
  const goals = goalIds(s.prefs.goals, s.categories);
  const spent = txs.filter(t => t.owner_id === me && t.type === 'expense' && t.date >= from && t.date <= to && !(t.category_id && goals.has(t.category_id)))
    .reduce((x, t) => x + t.amount, 0);
  const firstAny = txs.reduce((m, t) => (t.owner_id === me && t.date < m ? t.date : m), day);
  const months = [1, 2, 3].map(k => monthsBack(day, k)).filter(m => lastDayOf(m) >= firstAny).length || 1;   // a new app has fewer than 3
  const expenses = round2(spent / months);
  const passive = round2(alive(s.pnl).filter(p => p.date >= from && p.date <= to).reduce((x, p) => x + p.pnl, 0) / 3);
  return { cash, passive, expenses, trading: tradingCap, savings, networth: round2(cash + tradingCap), coverage: expenses > 0 ? round2((passive / expenses) * 100) : 0 };
}

export function levelAt(s: State, day: string): LevelState {
  const defs = levelDefs(s);
  const m = measuresAt(s, day);
  const met = defs.map((d, i) => i === 0 || holds(d, m));
  let level = 0;
  while (level < defs.length - 1 && met[level + 1]) level++;
  const ready = met.map((x, n) => (x && n > level + 1 ? n : -1)).filter(n => n > 0);
  const next = level < defs.length - 1 ? defs[level + 1].rules.map(x => needOf(x, m)).filter((x): x is Need => !!x) : [];
  return { ...m, level, defs, next, ready };
}

export function useLevel(): LevelState | null {
  const s = useStore(x => x);
  return useMemo(() => (s.user && s.prefs.analytics ? levelAt(s, todayISO()) : null),
    [s.accounts, s.transactions, s.pnl, s.prefs.tradingAccounts, s.prefs.goals, s.prefs.levelDefs, s.prefs.analytics, s.categories, s.user]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The level at the end of each of the last 12 months, and today. */
export function useLevelHistory(): Array<{ month: string; level: number }> {
  const s = useStore(x => x);
  return useMemo(() => {
    if (!s.user) return [];
    const today = todayISO();
    const first = alive(s.transactions).reduce((m, t) => (t.date < m ? t.date : m), today);
    const out: Array<{ month: string; level: number }> = [];
    for (let k = 11; k >= 1; k--) {
      const m = monthsBack(today, k);
      if (lastDayOf(m) < first) continue;
      out.push({ month: m, level: levelAt(s, lastDayOf(m)).level });
    }
    out.push({ month: monthStart(today), level: levelAt(s, today).level });
    return out;
  }, [s.accounts, s.transactions, s.pnl, s.prefs.tradingAccounts, s.prefs.goals, s.prefs.levelDefs, s.categories, s.user]); // eslint-disable-line react-hooks/exhaustive-deps
}
