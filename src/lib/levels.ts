import { useMemo } from 'react';
import { useStore, type State } from './store';
import { alive, computeBalances } from './calc';
import { addDays, fromISO, round2, toISO, todayISO } from './format';
import { goalIds } from './goals';
import type { Account } from './types';

/**
 * Levels (each one needs all the ones below it):
 *   0  below level 1
 *   1  cash − card debt ≥ ½ month of expenses        ┐ safety: today's balances,
 *   2  … ≥ 1 month                                     │ trading capital not counted
 *   3  … ≥ 3 months                                    ┘
 *   4  passive income ≥ 50% of expenses               ┐ freedom: average of the last
 *   5  … ≥ 100%                                        │ 3 full months (P&L from the Tracker)
 *   6  … ≥ 3× expenses                                 │
 *   7  ≥ 10.000 € a month and ≥ 12 months of expenses ┘
 * Expenses = your own, average of the last 3 full months, without goals and transfers.
 */
export const LEVELS = [
  { n: 0, name: 'Underwater', rule: 'Less than ½ month of expenses once the card is paid' },
  { n: 1, name: 'Afloat', rule: '½ month of expenses left after paying the card' },
  { n: 2, name: 'Steady', rule: '1 month of expenses put by' },
  { n: 3, name: 'Secure', rule: '3 months of expenses put by' },
  { n: 4, name: 'Half free', rule: 'Passive income covers half your expenses' },
  { n: 5, name: 'Self-funded', rule: 'Passive income covers all your expenses' },
  { n: 6, name: 'Free', rule: 'Passive income 3× your expenses' },
  { n: 7, name: 'Freedom', rule: '10.000 € a month and a year of expenses put by' },
] as const;
export const TOP = 7;

export interface Need { label: string; have: number; need: number; met: boolean }
export interface LevelState {
  level: number;
  expenses: number;     // a month of expenses
  cash: number;         // cash − card debt, no trading capital
  passive: number;      // average monthly P&L
  next: Need[];         // what the next level asks, and where you are
  ready: number[];      // higher levels whose own condition is already met ("unlocked, waiting")
  met: boolean[];       // each level's own condition, on its own
}

const monthStart = (d: string) => d.slice(0, 8) + '01';
const lastDayOf = (d: string) => { const x = fromISO(d); return toISO(new Date(x.getFullYear(), x.getMonth() + 1, 0)); };
const monthsBack = (d: string, k: number) => { const x = fromISO(d); return toISO(new Date(x.getFullYear(), x.getMonth() - k, 1)); };

/** Each level's own test (without the ones below). */
function own(n: number, cash: number, E: number, P: number): boolean {
  if (n > 0 && E <= 0) return false;   // no expenses on record yet → nothing to measure against
  switch (n) {
    case 1: return cash >= 0.5 * E;
    case 2: return cash >= E;
    case 3: return cash >= 3 * E;
    case 4: return P >= 0.5 * E;
    case 5: return P >= E;
    case 6: return P >= 3 * E;
    case 7: return P >= 10000 && cash >= 12 * E;
    default: return true;
  }
}
function needs(n: number, cash: number, E: number, P: number): Need[] {
  const c = (label: string, need: number): Need => ({ label, have: round2(cash), need: round2(need), met: cash >= need });
  const p = (label: string, need: number): Need => ({ label, have: round2(P), need: round2(need), met: P >= need });
  switch (n) {
    case 1: return [c('Cash after card debt', 0.5 * E)];
    case 2: return [c('Cash after card debt', E)];
    case 3: return [c('Cash after card debt', 3 * E)];
    case 4: return [p('Passive income / month', 0.5 * E)];
    case 5: return [p('Passive income / month', E)];
    case 6: return [p('Passive income / month', 3 * E)];
    case 7: return [p('Passive income / month', 10000), c('Cash after card debt', 12 * E)];
    default: return [];
  }
}

/** The state as it was on `day` (end of a past month, or today). */
export function levelAt(s: State, day: string): LevelState {
  const me = s.user?.id;
  const trading = new Set(s.prefs.tradingAccounts ?? []);
  const accounts: Account[] = alive(s.accounts).filter(a => a.owner_id === me && !trading.has(a.id));
  const txs = alive(s.transactions);
  const bal = computeBalances(accounts, txs, day);
  const cash = round2(accounts.reduce((x, a) => x + (bal.get(a.id) ?? 0), 0));   // credit cards are negative while you owe

  // the 3 full months before `day`'s month (the current one isn't over)
  const to = addDays(monthStart(day), -1), from = monthsBack(day, 3);
  const goals = goalIds(s.prefs.goals, s.categories);
  const mine = txs.filter(t => t.owner_id === me && t.type === 'expense' && t.date >= from && t.date <= to && !(t.category_id && goals.has(t.category_id)));
  const firstAny = txs.reduce((m, t) => (t.owner_id === me && t.date < m ? t.date : m), day);
  // only months that have data count (a new app has fewer than 3)
  const months = [0, 1, 2].map(k => monthsBack(day, k + 1)).filter(m => lastDayOf(m) >= firstAny).length || 1;
  const expenses = round2(mine.reduce((x, t) => x + t.amount, 0) / months);
  const pnl = alive(s.pnl).filter(p => p.date >= from && p.date <= to).reduce((x, p) => x + p.pnl, 0);
  const passive = round2(pnl / 3);

  const met = [true, ...[1, 2, 3, 4, 5, 6, 7].map(n => own(n, cash, expenses, passive))];
  let level = 0;
  while (level < TOP && met[level + 1]) level++;
  const ready = met.map((m, n) => (m && n > level + 1 ? n : -1)).filter(n => n > 0);
  return { level, expenses, cash, passive, met, ready, next: level < TOP ? needs(level + 1, cash, expenses, passive) : [] };
}

export function useLevel(): LevelState | null {
  const s = useStore(x => x);
  return useMemo(() => (s.user && s.prefs.analytics ? levelAt(s, todayISO()) : null),
    [s.accounts, s.transactions, s.pnl, s.prefs.tradingAccounts, s.prefs.goals, s.prefs.analytics, s.categories, s.user]); // eslint-disable-line react-hooks/exhaustive-deps
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
  }, [s.accounts, s.transactions, s.pnl, s.prefs.tradingAccounts, s.prefs.goals, s.categories, s.user]); // eslint-disable-line react-hooks/exhaustive-deps
}
