import { useMemo } from 'react';
import { useStore, getState, setPrefs, put, remove, type State } from './store';
import { alive, computeBalances, ruleDates, ruleToTx } from './calc';
import { goalIds, goalRows } from './goals';
import { tipsCategoryIds } from './insights';
import { isPending, useTimesVersion } from './txTime';
import { addDays, fromISO, round2, toISO, todayISO, uuid } from './format';
import type { Account, Category, PaySplitPrefs, Tx } from './types';

/**
 * Pay split, worked out on the phone (no AI).
 *
 * When a pay comes in (a job's salary or bonus category; tips never), the card works out:
 *   needs      what the rest of this month + the first 5 days of the next still need:
 *              · every top category with a budget: what's left of it (its subcategories pooled), never less than its
 *                planned/recurring entries still to come; shared categories count only your usual share
 *              · categories without a budget: your average of the last 3 months (without repeating entries), for the
 *                days left, plus their planned and repeating entries
 *              · what the credit card owes · a safety margin
 *   available  every everyday account (not trading, investments, savings or debts), the new pay included
 *   spare      available − needs, at most the pay itself
 * and splits the spare: the matched goal (what your partner put in), the reserve, fixed goals, then what's left to the
 * active goals by their share (or to the reserve when there are none). Accepting writes the entries.
 */

export interface NeedLine { id: string; label: string; amount: number; kind: 'budget' | 'free' | 'card' | 'margin' }
export interface Move { key: string; kind: 'match' | 'reserve' | 'goal'; label: string; to: string; amount: number }
export interface Split {
  pays: Tx[]; payTotal: number;
  needs: NeedLine[]; needTotal: number;
  available: number; spare: number;           // spare can be negative (the month isn't covered yet)
  toSplit: number;                            // what this pay frees: min(spare, pay), whole euros
  source: string | null; sourceBalance: number;
  moves: Move[];
  notes: string[];
}

export const DEFAULT_MARGIN = 100;
const MAX_DONE = 80;

const daysIn = (iso: string) => { const d = fromISO(iso); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };
const monthStart = (iso: string) => iso.slice(0, 8) + '01';
const monthEnd = (iso: string) => { const d = fromISO(iso); return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const nextMonth = (iso: string) => { const d = fromISO(iso); return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 1)); };
const monthsBack = (iso: string, k: number) => { const d = fromISO(iso); return toISO(new Date(d.getFullYear(), d.getMonth() - k, 1)); };
const dayDiff = (a: string, b: string) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 864e5);

/** Guesses for the settings nobody filled in yet (by account / category name). */
function guessSources(regular: Account[]) { return regular.filter(a => /eurobank|πειραι|πειραί|piraeus/i.test(a.name)).map(a => a.id); }
function guessReserve(accs: Account[]) {
  const sav = accs.filter(a => a.kind === 'savings');
  return (sav.find(a => /αποθεμ|reserve|emergency|έκτακτ|εκτακτ|ασφαλ/i.test(a.name)) ?? sav.find(a => /revolut/i.test(a.name)) ?? sav[0])?.id ?? null;
}
function guessMatch(goals: Set<string>, cats: Record<string, Category>) {
  return [...goals].find(id => /οδοντ|dentist/i.test(cats[id]?.name ?? '')) ?? null;
}

/** The settings with defaults filled in (50 € reserve per pay, 150 €/month matching, 100 € margin). */
export function splitSettings(s: State): Required<Omit<PaySplitPrefs, 'done'>> & { done: string[] } {
  const me = s.user?.id;
  const p = s.prefs.paySplit ?? {};
  const trading = new Set(s.prefs.tradingAccounts ?? []), invest = new Set(s.prefs.investmentAccounts ?? []);
  const mine = alive(s.accounts).filter(a => a.owner_id === me && !a.archived);
  const regular = mine.filter(a => a.kind === 'regular' && !trading.has(a.id) && !invest.has(a.id));
  const goals = goalIds(s.prefs.goals, s.categories);
  return {
    margin: p.margin ?? DEFAULT_MARGIN,
    sources: (p.sources ?? guessSources(regular)).filter(id => regular.some(a => a.id === id)),
    reserve: p.reserve ?? { account: guessReserve(mine.filter(a => !trading.has(a.id) && !invest.has(a.id))), mode: 'eur', value: 50 },
    match: p.match ?? { goal: guessMatch(goals, s.categories), monthly: 150 },
    goals: p.goals ?? [],
    done: p.done ?? [],
  };
}

/** Top-level categories that are shared (I'm a member, or someone else owns them). */
function sharedRoots(s: State) {
  const set = new Set(s.members.map(m => m.category_id));
  for (const c of Object.values(s.categories)) if (!c.parent_id && c.owner_id !== s.user?.id) set.add(c.id);
  return set;
}

/** Pays that still wait for a split: salary/bonus entries of your jobs from the last 3 days (tips never). */
export function waitingPays(s: State, today = todayISO()): Tx[] {
  const me = s.user?.id;
  const tips = new Set(tipsCategoryIds(s.categories, me ?? '', s.prefs.tipsCats));
  const payCats = new Set<string>();
  for (const j of alive(s.jobs)) {
    if (j.archived) continue;
    if (j.tips_category_id) tips.add(j.tips_category_id);
    for (const id of [j.salary_category_id, j.bonus_category_id]) if (id) payCats.add(id);
  }
  const done = new Set(s.prefs.paySplit?.done ?? []);
  const from = addDays(today, -2);
  return alive(s.transactions).filter(t => t.owner_id === me && t.type === 'income' && !!t.category_id && payCats.has(t.category_id) && !tips.has(t.category_id)
    && t.date >= from && t.date <= today && !isPending(t, today) && !done.has(t.id));
}

export function computeSplit(s: State, pays: Tx[], today = todayISO()): Split {
  const me = s.user?.id;
  const cfg = splitSettings(s);
  const notes: string[] = [];
  const cats = s.categories;
  const trading = new Set(s.prefs.tradingAccounts ?? []), invest = new Set(s.prefs.investmentAccounts ?? []);
  const mineAccs = alive(s.accounts).filter(a => a.owner_id === me && !a.archived);
  const txs = alive(s.transactions);
  const bal = computeBalances(mineAccs, txs, today);
  const regular = mineAccs.filter(a => a.kind === 'regular' && !trading.has(a.id) && !invest.has(a.id));
  const credit = mineAccs.filter(a => a.kind === 'credit' && !trading.has(a.id));
  const notCash = new Set(mineAccs.filter(a => trading.has(a.id) || invest.has(a.id)).map(a => a.id));
  const goals = goalIds(s.prefs.goals, cats);
  const shared = sharedRoots(s);
  const budgets = s.prefs.budgets ?? {};

  // ---- the window: rest of this month + days 1–5 of the next
  const mEnd = monthEnd(today), nStart = nextMonth(today), n5 = addDays(nStart, 4), nEnd = monthEnd(nStart);
  const dim = daysIn(today), dimNext = daysIn(nStart);
  const daysLeft = dayDiff(today, mEnd) + 1;             // today included: it's not over yet
  const [p3a, p3b] = [monthsBack(today, 3), addDays(monthStart(today), -1)];
  const firstMine = txs.reduce((m, t) => (t.owner_id === me && t.date < m ? t.date : m), today);
  const nMonths = [1, 2, 3].map(k => monthsBack(today, k)).filter(m => monthEnd(m) >= firstMine).length || 1;

  // spending I count: expenses with a category, not goals, not on trading/investment accounts
  const counts = (t: Tx) => t.type === 'expense' && !!t.category_id && !goals.has(t.category_id) && !notCash.has(t.account_id);
  const done = txs.filter(t => counts(t) && !isPending(t, today));
  // what's still to come up to the 5th of next month: future-dated entries + repeating ones
  const scheduled: Tx[] = [
    ...txs.filter(t => t.owner_id === me && counts(t) && isPending(t, today) && t.date <= nEnd),
    ...Object.values(s.recurring).filter(r => r.owner_id === me && r.type === 'expense').flatMap(r => ruleDates(r, addDays(today, 1), nEnd).map(d => ruleToTx(r, d))).filter(counts),
  ];
  const sum = (l: Tx[]) => l.reduce((x, t) => x + t.amount, 0);
  const inSet = (ids: Set<string>) => (t: Tx) => ids.has(t.category_id!);

  const needs: NeedLine[] = [];
  let freeTotal = 0;
  const roots = alive(cats).filter(c => c.type === 'expense' && !c.parent_id && !goals.has(c.id));
  for (const root of roots) {
    const subs = alive(cats).filter(c => c.parent_id === root.id && !goals.has(c.id));
    let B = 0; const budgeted = new Set<string>(), free = new Set<string>();
    if ((budgets[root.id] ?? 0) > 0) { B = budgets[root.id]; budgeted.add(root.id); subs.forEach(c => budgeted.add(c.id)); }
    else {
      const bs = subs.filter(c => (budgets[c.id] ?? 0) > 0);
      B = bs.reduce((x, c) => x + budgets[c.id], 0);
      bs.forEach(c => budgeted.add(c.id));
      [root, ...subs].forEach(c => { if (!budgeted.has(c.id)) free.add(c.id); });
    }
    if (B > 0) {
      // shared: only the part you usually pay (last 3 months; all of it when there's no history yet)
      let share = 1;
      if (shared.has(root.id)) {
        const past = done.filter(t => inSet(budgeted)(t) && t.date >= p3a && t.date <= p3b);
        const all = sum(past), mine = sum(past.filter(t => t.owner_id === me));
        if (all > 0.004) share = mine / all;
      }
      const myBudget = B * share;
      const spent = sum(done.filter(t => t.owner_id === me && inSet(budgeted)(t) && t.date >= monthStart(today) && t.date <= today));
      const sch = scheduled.filter(inSet(budgeted));
      const cur = Math.max(myBudget - spent, sum(sch.filter(t => t.date <= mEnd)));
      const nextAll = sum(sch.filter(t => t.date >= nStart));
      const next5 = sum(sch.filter(t => t.date >= nStart && t.date <= n5)) + Math.max(0, myBudget - nextAll) * (5 / dimNext);
      const amount = round2(Math.max(0, cur) + next5);
      if (amount > 0.004) needs.push({ id: root.id, label: root.name + (share < 0.995 ? ` · your ${Math.round(share * 100)}%` : ''), amount, kind: 'budget' });
    }
    if (free.size) {
      const isIn = inSet(free);
      const avgVar = sum(done.filter(t => t.owner_id === me && isIn(t) && !t.recurring_id && t.date >= p3a && t.date <= p3b)) / nMonths;
      const sch = scheduled.filter(t => isIn(t) && t.date <= n5);
      const repeating = sum(sch.filter(t => t.virtual || t.recurring_id));
      const oneOff = sum(sch.filter(t => !t.virtual && !t.recurring_id));
      freeTotal += Math.max(avgVar * (daysLeft / dim) + avgVar * (5 / dimNext), oneOff) + repeating;
    }
  }
  needs.sort((a, b) => b.amount - a.amount);
  if (freeTotal > 0.004) needs.push({ id: 'free', label: 'No budget · usual spending + planned', amount: round2(freeTotal), kind: 'free' });
  const owed = round2(credit.reduce((x, a) => x + Math.max(0, -(bal.get(a.id) ?? 0)), 0));
  if (owed > 0.004) needs.push({ id: 'card', label: 'Credit card owed', amount: owed, kind: 'card' });
  if (cfg.margin > 0) needs.push({ id: 'margin', label: 'Safety margin', amount: cfg.margin, kind: 'margin' });
  const needTotal = round2(needs.reduce((x, n) => x + n.amount, 0));
  const available = round2(regular.reduce((x, a) => x + (bal.get(a.id) ?? 0), 0));
  const spare = round2(available - needTotal);
  const payTotal = round2(sum(pays));
  let toSplit = Math.max(0, Math.floor(Math.min(spare, payTotal)));

  // ---- where it's moved from: the account the pay came into, if money can leave it; else the biggest such account
  const biggest = [...pays].sort((a, b) => b.amount - a.amount)[0];
  const srcs = cfg.sources;
  let source: string | null = biggest?.account_id ?? null;
  if (srcs.length && (!source || !srcs.includes(source))) source = srcs.slice().sort((a, b) => (bal.get(b) ?? 0) - (bal.get(a) ?? 0))[0];
  const sourceBalance = round2(source ? bal.get(source) ?? 0 : 0);
  if (source && toSplit > Math.floor(sourceBalance)) {
    const fits = Math.max(0, Math.floor(sourceBalance));
    notes.push(`Only ${fits} € fits in ${s.accounts[source]?.name ?? 'the account'} now; the rest comes back with the next pay.`);
    toSplit = fits;
  }

  // ---- the split, in order
  const moves: Move[] = [];
  let left = toSplit;
  const take = (want: number) => { const v = Math.max(0, Math.min(left, Math.round(want))); left -= v; return v; };
  const rows = goalRows(s, today);
  const goalLeft = (id: string) => { const g = rows.find(r => r.id === id); return g ? (g.doneOn ? 0 : Math.max(0, g.target - g.saved)) : Infinity; };   // a goal without a target never fills up
  const goalName = (id: string) => cats[id]?.name ?? 'Goal';

  // 1. matching: what your partner put in that you haven't yet; else the monthly amount minus what you put in this month
  const mg = cfg.match.goal;
  if (mg && cats[mg] && !cats[mg].deleted_at && goalLeft(mg) > 0) {
    const ids = new Set([mg, ...alive(cats).filter(c => c.parent_id === mg).map(c => c.id)]);
    const g = txs.filter(t => t.type === 'expense' && t.category_id && ids.has(t.category_id) && !isPending(t, today));
    const partner = sum(g.filter(t => t.owner_id !== me)), mine = sum(g.filter(t => t.owner_id === me));
    const thisMonth = sum(g.filter(t => t.owner_id === me && t.date >= monthStart(today)));
    const want = partner - mine > 0.5 ? partner - mine : Math.max(0, cfg.match.monthly - thisMonth);
    const v = take(Math.min(want, goalLeft(mg)));
    if (v > 0) moves.push({ key: 'match', kind: 'match', label: `${goalName(mg)} · matching`, to: mg, amount: v });
  }
  // 2. the reserve
  const resAcc = cfg.reserve.account && s.accounts[cfg.reserve.account] && !s.accounts[cfg.reserve.account].deleted_at ? cfg.reserve.account : null;
  if (resAcc) {
    const v = take(cfg.reserve.mode === 'pct' ? (toSplit * cfg.reserve.value) / 100 : cfg.reserve.value);
    if (v > 0) moves.push({ key: 'reserve', kind: 'reserve', label: s.accounts[resAcc].name, to: resAcc, amount: v });
  } else notes.push('Pick a reserve account in the rules.');
  // 3. goals with a fixed € or %
  const active = cfg.goals.filter(g => cats[g.id] && !cats[g.id].deleted_at && goalLeft(g.id) > 0 && g.id !== mg);
  for (const g of active.filter(x => x.mode !== 'share')) {
    const v = take(Math.min(goalLeft(g.id), g.mode === 'pct' ? (toSplit * g.value) / 100 : g.value));
    if (v > 0) moves.push({ key: 'g:' + g.id, kind: 'goal', label: goalName(g.id), to: g.id, amount: v });
  }
  // 4. what's left: to the goals by their share (a full one passes its part on), else to the reserve
  let shareGoals = active.filter(x => x.mode === 'share' && x.value > 0);
  while (left > 0 && shareGoals.length) {
    const w = shareGoals.reduce((x, g) => x + g.value, 0);
    const pot = left;
    let gave = 0;
    for (const g of shareGoals) {
      const have = moves.find(m => m.key === 'g:' + g.id);
      const room = goalLeft(g.id) - (have?.amount ?? 0);
      const v = Math.max(0, Math.min(room, Math.floor((pot * g.value) / w), left));
      if (v <= 0) continue;
      left -= v; gave += v;
      if (have) have.amount += v; else moves.push({ key: 'g:' + g.id, kind: 'goal', label: goalName(g.id), to: g.id, amount: v });
    }
    shareGoals = shareGoals.filter(g => goalLeft(g.id) - (moves.find(m => m.key === 'g:' + g.id)?.amount ?? 0) > 0);
    if (gave === 0) {   // rounding crumbs: to the biggest share
      const g = shareGoals.sort((a, b) => b.value - a.value)[0];
      if (!g) break;
      const m = moves.find(x => x.key === 'g:' + g.id);
      if (m) m.amount += left; else moves.push({ key: 'g:' + g.id, kind: 'goal', label: goalName(g.id), to: g.id, amount: left });
      left = 0;
    }
  }
  if (left > 0 && resAcc) {
    const r = moves.find(m => m.key === 'reserve');
    if (r) r.amount += left; else moves.push({ key: 'reserve', kind: 'reserve', label: s.accounts[resAcc].name, to: resAcc, amount: left });
    if (!active.some(g => g.mode === 'share')) notes.push('No active goal: what\'s left goes to the reserve.');
    left = 0;
  }

  return { pays, payTotal, needs, needTotal, available, spare, toSplit, source, sourceBalance, moves: moves.filter(m => m.amount > 0), notes };
}

export function usePaySplit(): Split | null {
  const s = useStore(x => x);
  const tv = useTimesVersion();
  const today = todayISO();
  return useMemo(() => {
    if (!s.user || !s.prefs.analytics) return null;
    const pays = waitingPays(s, today);
    return pays.length ? computeSplit(s, pays, today) : null;
  }, [s.accounts, s.transactions, s.recurring, s.categories, s.prefs, s.jobs, s.members, s.user, today, tv]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The pays are handled (split or dismissed): the card goes away until the next pay. */
export function markDone(ids: string[]) {
  const p = getState().prefs.paySplit ?? {};
  setPrefs({ paySplit: { ...p, done: [...(p.done ?? []), ...ids].slice(-MAX_DONE) } });
}
function unmarkDone(ids: string[]) {
  const p = getState().prefs.paySplit ?? {};
  setPrefs({ paySplit: { ...p, done: (p.done ?? []).filter(id => !ids.includes(id)) } });
}

export function setSplitPrefs(patch: Partial<PaySplitPrefs>) {
  setPrefs({ paySplit: { ...(getState().prefs.paySplit ?? {}), ...patch } });
}

/** Writes the split: a transfer to the reserve, an entry in each goal. Returns an undo. */
export function applySplit(split: Split, moves: Move[], today = todayISO()): () => void {
  const from = split.source;
  const ids: string[] = [];
  const st = getState();
  let seq = Math.max(0, ...Object.values(st.transactions).filter(t => t.date === today && !t.deleted_at).map(t => t.seq)) + 1;
  if (from) for (const m of moves) {
    if (m.amount <= 0) continue;
    const id = uuid();
    ids.push(id);
    put('transactions', m.kind === 'reserve'
      ? { id, owner_id: '', type: 'transfer', date: today, amount: round2(m.amount), account_id: from, to_account_id: m.to, category_id: null, note: 'Pay split', recurring_id: null, seq: seq++ }
      : { id, owner_id: '', type: 'expense', date: today, amount: round2(m.amount), account_id: from, to_account_id: null, category_id: m.to, note: m.kind === 'match' ? 'Pay split · matching' : 'Pay split', recurring_id: null, seq: seq++ });
  }
  const payIds = split.pays.map(p => p.id);
  markDone(payIds);
  return () => { ids.forEach(id => remove('transactions', id)); unmarkDone(payIds); };
}
