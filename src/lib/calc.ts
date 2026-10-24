import { useMemo } from 'react';
import { useStore, type State } from './store';
import { range, type Period } from './period';
import type { Account, Category, Recurring, Tx } from './types';
import { round2, todayISO, addDays } from './format';
import { nextOccurrence } from './store';

export const alive = <T extends { deleted_at?: string | null }>(rec: Record<string, T>) =>
  Object.values(rec).filter(r => !r.deleted_at);

export function sortAccounts(a: Account[]) {
  return a.slice().sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name));
}
export function sortCats(c: Category[]) {
  return c.slice().sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name));
}
/** newest first */
export function sortTxs(t: Tx[]) {
  return t.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq || ((b.created_at ?? b.updated_at ?? '') > (a.created_at ?? a.updated_at ?? '') ? 1 : -1)));
}

export function useAccounts() {
  const rec = useStore(s => s.accounts);
  return useMemo(() => sortAccounts(alive(rec)), [rec]);
}
export function useCategories() {
  const rec = useStore(s => s.categories);
  return useMemo(() => sortCats(alive(rec)), [rec]);
}
/** live transactions whose account still exists (or is unknown to us, e.g. a partner's account) */
export function useTxs() {
  const rec = useStore(s => s.transactions);
  const accRec = useStore(s => s.accounts);
  return useMemo(() => alive(rec).filter(t => !accRec[t.account_id]?.deleted_at), [rec, accRec]);
}

/** A transaction dated after today is "planned": it doesn't touch balances or totals until its day. */
export const isPlanned = (t: Tx, today = todayISO()) => t.date > today;

export function computeBalances(accounts: Account[], txs: Tx[], today = todayISO()): Map<string, number> {
  const b = new Map<string, number>();
  for (const a of accounts) b.set(a.id, a.opening_balance);
  for (const t of txs) {
    if (t.date > today) continue; // planned

    if (t.type === 'expense') b.has(t.account_id) && b.set(t.account_id, b.get(t.account_id)! - t.amount);
    else if (t.type === 'income') b.has(t.account_id) && b.set(t.account_id, b.get(t.account_id)! + t.amount);
    else {
      if (b.has(t.account_id)) b.set(t.account_id, b.get(t.account_id)! - t.amount);
      if (t.to_account_id && b.has(t.to_account_id)) b.set(t.to_account_id, b.get(t.to_account_id)! + t.amount);
    }
  }
  for (const [k, v] of b) b.set(k, round2(v));
  return b;
}

export function useBalances() {
  const accounts = useAccounts();
  const txs = useTxs();
  const today = todayISO();
  return useMemo(() => computeBalances(accounts, txs, today), [accounts, txs, today]);
}

export function defaultSelection(accounts: Account[]) {
  return accounts.filter(a => !a.archived && a.kind !== 'savings').map(a => a.id);
}

/** Account ids included in totals and statistics. */
export function useSelection() {
  const accounts = useAccounts();
  const filter = useStore(s => s.accountFilter);
  return useMemo(() => {
    const ids = filter ? filter.filter(id => accounts.some(a => a.id === id)) : defaultSelection(accounts);
    return new Set(ids.length ? ids : defaultSelection(accounts));
  }, [accounts, filter]);
}

export function useHeaderTotalBase() {
  const sel = useSelection();
  const bal = useBalances();
  return useMemo(() => {
    let total = 0;
    sel.forEach(id => { total += bal.get(id) ?? 0; });
    return { total: round2(total), count: sel.size };
  }, [sel, bal]);
}

export function useHeaderTotal() {
  const sel = useSelection();
  const bal = useBalances();
  const txs = useTxs();
  const today = todayISO();
  return useMemo(() => {
    let total = 0;
    sel.forEach(id => { total += bal.get(id) ?? 0; });
    // net effect of planned (future-dated) transactions on the selected accounts
    let planned = 0;
    for (const t of txs) {
      if (t.date <= today) continue;
      const fromIn = sel.has(t.account_id), toIn = t.to_account_id != null && sel.has(t.to_account_id);
      if (t.type === 'expense' && fromIn) planned -= t.amount;
      else if (t.type === 'income' && fromIn) planned += t.amount;
      else if (t.type === 'transfer') { if (fromIn && !toIn) planned -= t.amount; if (toIn && !fromIn) planned += t.amount; }
    }
    return { total: round2(total), count: sel.size, planned: round2(planned) };
  }, [sel, bal, txs, today]);
}

export interface PeriodStats {
  txs: Tx[];          // expenses + incomes in period on selected accounts
  all: Tx[];          // everything in period touching selected accounts (incl. transfers)
  expense: number;
  income: number;
  byCat: Map<string, number>;    // top-level category id -> total
  bySub: Map<string, number>;    // category id (sub or top when no sub) -> total
  byDay: Map<string, Map<string, number>>; // date -> top category id -> expense total
}

export function topCategoryId(catId: string | null, cats: Record<string, Category>): string {
  if (!catId) return 'none';
  const c = cats[catId];
  return c?.parent_id ?? catId;
}

export function periodStats(txs: Tx[], period: Period, sel: Set<string>, cats: Record<string, Category>): PeriodStats {
  const [a, b0] = range(period);
  const today = todayISO();
  const b = b0 > today ? today : b0; // planned transactions don't count yet
  const res: PeriodStats = { txs: [], all: [], expense: 0, income: 0, byCat: new Map(), bySub: new Map(), byDay: new Map() };
  for (const t of txs) {
    if (t.date < a || t.date > b) continue;
    const touches = sel.has(t.account_id) || (t.to_account_id != null && sel.has(t.to_account_id));
    if (!touches) continue;
    res.all.push(t);
    if (t.type === 'transfer' || !sel.has(t.account_id)) continue;
    res.txs.push(t);
    const top = topCategoryId(t.category_id, cats);
    if (t.type === 'expense') res.expense += t.amount; else res.income += t.amount;
    res.byCat.set(top, (res.byCat.get(top) ?? 0) + t.amount);
    const sub = t.category_id ?? 'none';
    res.bySub.set(sub, (res.bySub.get(sub) ?? 0) + t.amount);
    if (t.type === 'expense') {
      let day = res.byDay.get(t.date);
      if (!day) res.byDay.set(t.date, (day = new Map()));
      day.set(top, (day.get(top) ?? 0) + t.amount);
    }
  }
  res.expense = round2(res.expense);
  res.income = round2(res.income);
  return res;
}

export function usePeriodStats(override?: Period) {
  const txs = useTxs();
  const period = useStore(s => s.period);
  const cats = useStore(s => s.categories);
  const sel = useSelection();
  const p = override ?? period;
  const today = todayISO();
  return useMemo(() => periodStats(txs, p, sel, cats), [txs, p, sel, cats, today]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function catName(id: string | null, cats: Record<string, Category>, withParent = true): string {
  if (!id) return 'Uncategorized';
  const c = cats[id];
  if (!c) return 'Shared category';
  if (c.parent_id && withParent) {
    const p = cats[c.parent_id];
    return p ? `${p.name} · ${c.name}` : c.name;
  }
  return c.name;
}

export function catStyle(id: string | null, cats: Record<string, Category>) {
  if (!id) return { icon: 'circle', color: '#64748B' };
  const c = cats[id];
  if (!c) return { icon: 'circle', color: '#64748B' };
  const parent = c.parent_id ? cats[c.parent_id] : null;
  // subcategories use their own icon but inherit the parent's color
  return { icon: c.icon !== 'circle' ? c.icon : parent?.icon ?? 'circle', color: parent?.color ?? c.color };
}

export const selectMe = (s: State) => s.user?.id ?? '';

/** Top-level category ids that are shared (I'm a member of someone's, or I shared mine). */
export function useSharedRoots() {
  const members = useStore(s => s.members);
  const cats = useStore(s => s.categories);
  const me = useStore(s => s.user?.id);
  return useMemo(() => {
    const set = new Set(members.map(m => m.category_id));
    for (const c of Object.values(cats)) if (!c.parent_id && c.owner_id !== me) set.add(c.id);
    return set;
  }, [members, cats, me]);
}

/** Everyone involved in a shared top-level category, except me. */
export function partnersOf(rootId: string, s: State): string[] {
  const me = s.user?.id;
  const ids = new Set<string>();
  const owner = s.categories[rootId]?.owner_id;
  if (owner && owner !== me) ids.add(owner);
  for (const m of s.members) if (m.category_id === rootId && m.user_id !== me) ids.add(m.user_id);
  return [...ids];
}

// ---------------------------------------------------------------- recurring projections

/** Occurrence dates of a rule between from and to (inclusive), not yet posted, minus skipped ones. */
export function ruleDates(r: Recurring, from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  if (!r.active || r.deleted_at) return out;
  const end = r.end_date && r.end_date < to ? r.end_date : to;
  const skips = r.skip_dates ?? [];
  let d = r.next_date;
  for (let i = 0; d <= end && i < max; i++) {
    if (d >= from && !skips.includes(d)) out.push(d);
    d = nextOccurrence(d, r.freq, r.anchor_day);
  }
  return out;
}

export const virtualId = (ruleId: string, date: string) => `rec:${ruleId}:${date}`;
export function parseVirtualId(id: string): { ruleId: string; date: string } | null {
  const m = id.match(/^rec:(.+):(\d{4}-\d{2}-\d{2})$/);
  return m ? { ruleId: m[1], date: m[2] } : null;
}

export function ruleToTx(r: Recurring, date: string): Tx {
  return {
    id: virtualId(r.id, date), owner_id: r.owner_id, type: r.type, date, amount: r.amount, account_id: r.account_id,
    to_account_id: r.to_account_id, category_id: r.category_id, note: r.note, recurring_id: r.id, seq: -1, virtual: true,
  };
}

/** Future occurrences of my recurring rules as planned (virtual) transactions, after today and up to `to`. */
export function useProjected(from: string, to: string): Tx[] {
  const rec = useStore(s => s.recurring);
  const me = useStore(s => s.user?.id);
  const today = todayISO();
  return useMemo(() => {
    const start = from > today ? from : addDays(today, 1);
    const out: Tx[] = [];
    for (const r of Object.values(rec)) {
      if (r.owner_id !== me) continue;
      for (const d of ruleDates(r, start, to)) out.push(ruleToTx(r, d));
    }
    return out;
  }, [rec, me, from, to, today]);
}

/** The visible period clipped to at most a year ahead (for "All time"). */
export function viewWindow(p: Period): [string, string] {
  const [a, b] = range(p);
  const cap = addDays(todayISO(), 366);
  return [a, b > cap ? cap : b];
}

/** Planned money for the visible period, plus the expected balance at its end. */
export function usePlanned(p: Period) {
  const txs = useTxs();
  const sel = useSelection();
  const { total } = useHeaderTotalBase();
  const today = todayISO();
  const [a, b] = viewWindow(p);
  const projected = useProjected(addDays(today, 1), b);
  return useMemo(() => {
    const effect = (t: Tx) => {
      const fromIn = sel.has(t.account_id), toIn = t.to_account_id != null && sel.has(t.to_account_id);
      if (t.type === 'expense') return fromIn ? -t.amount : 0;
      if (t.type === 'income') return fromIn ? t.amount : 0;
      return (toIn ? t.amount : 0) - (fromIn ? t.amount : 0);
    };
    let inPeriod = 0, untilEnd = 0;
    for (const t of [...txs.filter(t => t.date > today && t.date <= b), ...projected]) {
      const e = effect(t);
      untilEnd += e;
      if (t.date >= a) inPeriod += e;
    }
    return { show: b > today, inPeriod: round2(inPeriod), endBalance: round2(total + untilEnd), end: b };
  }, [txs, projected, sel, total, today, a, b]);
}
