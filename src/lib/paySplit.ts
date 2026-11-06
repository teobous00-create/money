import { useMemo } from 'react';
import { useStore, getState, setPrefs, put, remove, type State } from './store';
import { alive, computeBalances, ruleDates, ruleToTx } from './calc';
import { goalIds, goalRows } from './goals';
import { tipsCategoryIds } from './insights';
import { payPeriods, periodLabel, shiftDone, shiftPay } from './tracker';
import { isPending, useTimesVersion } from './txTime';
import { addDays, fromISO, round2, toISO, todayISO, uuid } from './format';
import type { Account, Category, PaySplitPrefs, Tx } from './types';

/**
 * Pay split, worked out on the phone (no AI).
 *
 * When a pay comes in (a job's salary or bonus category; tips never), the card works out:
 *   needs      what the rest of this month still needs, plus anything planned for the 1st–5th of the next:
 *              · every top category with a budget: what's left of it (its subcategories pooled), never less than its
 *                planned/recurring entries still to come this month; shared categories count only your usual share
 *              · categories without a budget: your average of the last 3 months (without repeating entries), for the
 *                days left, plus their planned and repeating entries
 *              · planned and repeating entries on the 1st–5th of next month (only those, no budget share)
 *              · what the credit card owes, less planned payments to it from accounts not counted here (savings…)
 *              · a safety margin
 *   available  every everyday account (not trading, investments, savings or debts), the new pay included
 *   expected   pay still to come this month, from the Tracker: every pay period that ends before the month does and
 *              isn't paid yet (last month's day pay + contacts bonus, the evening job's 1–15 with its planned shifts…)
 *   spare      available + expected − needs, at most the pay itself
 * and splits the spare: the matched goal (what your partner put in), the reserve, fixed goals, then what's left to the
 * active goals by their share (or to the reserve when there are none). Accepting writes the entries.
 */

export interface NeedLine { id: string; label: string; amount: number; kind: 'budget' | 'free' | 'card' | 'margin' }
export interface Expected { id: string; label: string; amount: number; worked: number; planned: number }
export interface Move { key: string; kind: 'match' | 'reserve' | 'goal'; label: string; to: string; amount: number }
export interface Split {
  pays: Tx[]; payTotal: number;
  needs: NeedLine[]; needTotal: number;
  available: number; expected: Expected[]; expectedTotal: number;
  spare: number;                              // spare can be negative (the month isn't covered yet)
  toSplit: number;                            // what this pay frees: min(spare, pay), whole euros
  source: string | null; sourceBalance: number;
  moves: Move[];
  notes: string[];
  monthly: number;                            // a typical full month's needs (budgets at your share + usual spending + repeating)
  nextReserved: number;                       // what's kept for the 1st–5th of next month
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
export function splitSettings(s: State): Required<Omit<PaySplitPrefs, 'done' | 'forecast'>> & { done: string[] } {
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

  // ---- the window: rest of this month; of the next month only what's planned for days 1–5
  const mEnd = monthEnd(today), nStart = nextMonth(today), n5 = addDays(nStart, 4);
  const dim = daysIn(today);
  const daysLeft = dayDiff(today, mEnd) + 1;             // today included: it's not over yet
  const [p3a, p3b] = [monthsBack(today, 3), addDays(monthStart(today), -1)];
  const firstMine = txs.reduce((m, t) => (t.owner_id === me && t.date < m ? t.date : m), today);
  const nMonths = [1, 2, 3].map(k => monthsBack(today, k)).filter(m => monthEnd(m) >= firstMine).length || 1;

  // spending I count: expenses with a category, not goals, not on trading/investment accounts
  const counts = (t: Tx) => t.type === 'expense' && !!t.category_id && !goals.has(t.category_id) && !notCash.has(t.account_id);
  const done = txs.filter(t => counts(t) && !isPending(t, today));
  // what's still to come up to the 5th of next month: future-dated entries + repeating ones
  const scheduled: Tx[] = [
    ...txs.filter(t => t.owner_id === me && counts(t) && isPending(t, today) && t.date <= n5),
    ...Object.values(s.recurring).filter(r => r.owner_id === me && r.type === 'expense').flatMap(r => ruleDates(r, addDays(today, 1), n5).map(d => ruleToTx(r, d))).filter(counts),
  ];
  const nextPlanned = scheduled.filter(t => t.date >= nStart);   // days 1–5 of next month
  const sum = (l: Tx[]) => l.reduce((x, t) => x + t.amount, 0);
  const inSet = (ids: Set<string>) => (t: Tx) => ids.has(t.category_id!);

  const needs: NeedLine[] = [];
  let freeTotal = 0, monthly = 0;
  // repeating expenses per month (weekly ×52/12, yearly ÷12), rules still running
  const PER = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 } as const;
  const rules = Object.values(s.recurring).filter(r => r.owner_id === me && r.type === 'expense' && r.active && !r.deleted_at && (!r.end_date || r.end_date >= today) && r.category_id && !goals.has(r.category_id));
  const ruleMonthly = (ids: Set<string>) => rules.filter(r => ids.has(r.category_id!)).reduce((x, r) => x + r.amount * PER[r.freq], 0);
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
      const amount = round2(Math.max(0, cur));
      monthly += Math.max(myBudget, ruleMonthly(budgeted));
      if (amount > 0.004) needs.push({ id: root.id, label: root.name + (share < 0.995 ? ` · your ${Math.round(share * 100)}%` : ''), amount, kind: 'budget' });
    }
    if (free.size) {
      const isIn = inSet(free);
      const avgVar = sum(done.filter(t => t.owner_id === me && isIn(t) && !t.recurring_id && t.date >= p3a && t.date <= p3b)) / nMonths;
      const sch = scheduled.filter(t => isIn(t) && t.date <= mEnd);
      const repeating = sum(sch.filter(t => t.virtual || t.recurring_id));
      const oneOff = sum(sch.filter(t => !t.virtual && !t.recurring_id));
      freeTotal += Math.max(avgVar * (daysLeft / dim), oneOff) + repeating;
      monthly += avgVar + ruleMonthly(free);
    }
  }
  needs.sort((a, b) => b.amount - a.amount);
  const next = round2(sum(nextPlanned));
  if (freeTotal > 0.004) needs.push({ id: 'free', label: 'No budget · usual spending + planned', amount: round2(freeTotal), kind: 'free' });
  if (next > 0.004) needs.push({ id: 'next', label: 'Planned for the 1st–5th next month', amount: next, kind: 'free' });
  // the card's debt, less what's already planned to pay it from money not counted here (e.g. savings kept for it until a date)
  const regularIds = new Set(regular.map(a => a.id)), creditIds = new Set(credit.map(a => a.id));
  const toCard = [
    ...txs.filter(t => t.owner_id === me && t.type === 'transfer' && isPending(t, today) && t.date <= n5),
    ...Object.values(s.recurring).filter(r => r.owner_id === me && r.type === 'transfer').flatMap(r => ruleDates(r, addDays(today, 1), n5).map(d => ruleToTx(r, d))),
  ].filter(t => t.to_account_id && creditIds.has(t.to_account_id) && !regularIds.has(t.account_id));
  const owedAll = credit.reduce((x, a) => x + Math.max(0, -(bal.get(a.id) ?? 0)), 0);
  const covered = Math.min(owedAll, sum(toCard));
  const owed = round2(owedAll - covered);
  const from = [...new Set(toCard.map(t => s.accounts[t.account_id]?.name).filter(Boolean))].join(', ');
  if (owed > 0.004) needs.push({ id: 'card', label: covered > 0.004 ? `Credit card owed · ${round2(covered)} € planned from ${from}` : 'Credit card owed', amount: owed, kind: 'card' });
  else if (covered > 0.004) notes.push(`The credit card is covered by what's planned from ${from}.`);
  if (cfg.margin > 0) needs.push({ id: 'margin', label: 'Safety margin', amount: cfg.margin, kind: 'margin' });
  const needTotal = round2(needs.reduce((x, n) => x + n.amount, 0));
  const available = round2(regular.reduce((x, a) => x + (bal.get(a.id) ?? 0), 0));
  const expected = expectedPay(s, today);
  const expectedTotal = round2(expected.reduce((x, e) => x + e.amount, 0));
  const spare = round2(available + expectedTotal - needTotal);
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
  const left0 = goalLeftNow(s, today);
  let matchWant = 0;
  const mg = cfg.match.goal;
  if (mg && cats[mg] && !cats[mg].deleted_at) {
    // what your partner put in that you haven't yet; else the monthly amount minus what you put in this month
    const ids = new Set([mg, ...alive(cats).filter(c => c.parent_id === mg).map(c => c.id)]);
    const g = txs.filter(t => t.type === 'expense' && t.category_id && ids.has(t.category_id) && !isPending(t, today));
    const partner = sum(g.filter(t => t.owner_id !== me)), mine = sum(g.filter(t => t.owner_id === me));
    const thisMonth = sum(g.filter(t => t.owner_id === me && t.date >= monthStart(today)));
    matchWant = partner - mine > 0.5 ? partner - mine : Math.max(0, cfg.match.monthly - thisMonth);
  }
  const al = allocate(s, cfg, toSplit, matchWant, left0);
  notes.push(...al.notes);

  return { pays, payTotal, needs, needTotal, available, expected, expectedTotal, spare, toSplit, source, sourceBalance, moves: al.moves, notes, monthly: round2(monthly), nextReserved: next };
}

/** How much each goal with a target still needs (a goal without a target never fills up). */
export function goalLeftNow(s: State, today = todayISO()): Map<string, number> {
  return new Map(goalRows(s, today).map(g => [g.id, g.doneOn ? 0 : Math.max(0, g.target - g.saved)]));
}

/** The rules, in order: matching (up to `matchWant`) → reserve → fixed goals → the rest to goals by share, else the reserve. */
export function allocate(s: State, cfg: ReturnType<typeof splitSettings>, toSplit: number, matchWant: number, goalLeftMap: Map<string, number>): { moves: Move[]; notes: string[] } {
  const cats = s.categories;
  const notes: string[] = [];
  const moves: Move[] = [];
  let left = toSplit;
  const take = (want: number) => { const v = Math.max(0, Math.min(left, Math.round(want))); left -= v; return v; };
  const goalLeft = (id: string) => goalLeftMap.get(id) ?? Infinity;
  const goalName = (id: string) => cats[id]?.name ?? 'Goal';
  // 1. matching
  const mg = cfg.match.goal;
  if (mg && cats[mg] && !cats[mg].deleted_at && goalLeft(mg) > 0) {
    const v = take(Math.min(matchWant, goalLeft(mg)));
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
  return { moves: moves.filter(m => m.amount > 0), notes };
}

/**
 * Pay still to come before the month ends, from the Tracker: every pay period that ends before the last day of this
 * month, from last month on, not paid in full — what it owes now (worked shifts, a finished month's contacts bonus)
 * plus its planned shifts. The month's own period of a monthly job, and the 16th–end of a twice-monthly one, are paid
 * next month: not counted. Paying it (the "got paid" entry) moves it from here to the accounts.
 */
export function expectedPay(s: State, today = todayISO()): Expected[] {
  const out: Expected[] = [];
  const end = monthEnd(today), from = monthsBack(today, 1), me = s.user?.id;
  const shifts = alive(s.shifts);
  // pay entered by hand (not through "got paid") isn't linked to a period: it still counts against this month's expected
  const linked = new Set(alive(s.payouts).flatMap(p => [p.tx_id, p.bonus_tx_id]).filter(Boolean) as string[]);
  for (const job of alive(s.jobs).filter(j => !j.archived).sort((a, b) => a.sort - b.sort)) {
    const { list } = payPeriods(job, shifts, s.payouts, s.transactions);
    const cats = new Set([job.salary_category_id, job.bonus_category_id].filter(Boolean) as string[]);
    let loose = alive(s.transactions).filter(t => t.owner_id === me && t.type === 'income' && t.category_id && cats.has(t.category_id) && !linked.has(t.id)
      && t.date >= monthStart(today) && !isPending(t, today)).reduce((v, t) => v + t.amount, 0);
    for (const p of list.slice().sort((a, b) => a.start.localeCompare(b.start))) {
      if (p.start < from || p.end >= end) continue;
      const planned = round2(shifts.filter(x => x.job_id === job.id && x.date >= p.start && x.date <= p.end && !shiftDone(job, x, today)).reduce((v, x) => v + shiftPay(job, x), 0));
      let worked = Math.max(0, p.owed);
      const off = Math.min(loose, worked); worked -= off; loose -= off;
      worked = round2(worked);
      const amount = round2(worked + planned);
      if (amount <= 0.004) continue;
      const bonus = round2(Math.max(0, p.bonus - p.paidBonus));
      out.push({ id: `${job.id}:${p.start}`, label: `${job.name} ${periodLabel(p)}${bonus > 0.004 ? ` · incl. ${bonus} € bonus` : ''}`, amount, worked, planned });
    }
  }
  return out;
}

export function usePaySplit(): Split | null {
  const s = useStore(x => x);
  const tv = useTimesVersion();
  const today = todayISO();
  return useMemo(() => {
    if (!s.user || !s.prefs.analytics) return null;
    const pays = waitingPays(s, today);
    return pays.length ? computeSplit(s, pays, today) : null;
  }, [s.accounts, s.transactions, s.recurring, s.categories, s.prefs, s.jobs, s.shifts, s.payouts, s.members, s.user, today, tv]); // eslint-disable-line react-hooks/exhaustive-deps
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
