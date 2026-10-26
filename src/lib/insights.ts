import { useMemo } from 'react';
import { useStore } from './store';
import { useTxs, useSelection, periodStats } from './calc';
import { fromISO, round2, toISO, todayISO } from './format';
import type { Category, Tx } from './types';

export const monthStart = (iso: string) => { const d = fromISO(iso); return toISO(new Date(d.getFullYear(), d.getMonth(), 1)); };
export const monthEnd = (iso: string) => { const d = fromISO(iso); return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
export function addMonths(iso: string, n: number) { const d = fromISO(iso); return toISO(new Date(d.getFullYear(), d.getMonth() + n, 1)); }

/** The 3 full months before the month of `anchor`: [first day, last day]. */
export function prev3(anchor: string): [string, string] {
  const m = monthStart(anchor);
  return [addMonths(m, -3), monthEnd(addMonths(m, -1))];
}

// ---------------------------------------------------------------- budgets

export type BudgetLevel = 'ok' | 'near' | 'over';
export function budgetLevel(spent: number, limit: number): BudgetLevel {
  const r = limit > 0 ? spent / limit : 0;
  return r > 1 ? 'over' : r >= 0.75 ? 'near' : 'ok';
}
export const LEVEL_COLOR: Record<BudgetLevel, string> = { ok: 'var(--income)', near: 'var(--warn)', over: 'var(--expense)' };

/** What I spent per category this month (top-level ids include their subcategories). */
export function useMonthSpend(anchor: string) {
  const txs = useTxs();
  const sel = useSelection();
  const cats = useStore(s => s.categories);
  return useMemo(() => {
    const st = periodStats(txs, { mode: 'month', anchor }, sel, cats);
    const out = new Map<string, number>();
    for (const t of st.txs) {
      if (t.type !== 'expense' || !t.category_id) continue;
      out.set(t.category_id, round2((out.get(t.category_id) ?? 0) + t.amount));
      const parent = cats[t.category_id]?.parent_id;
      if (parent) out.set(parent, round2((out.get(parent) ?? 0) + t.amount));
    }
    return out;
  }, [txs, sel, cats, anchor]);
}

// ---------------------------------------------------------------- tips

const TIPS_RE = /tips|tip\b|φιλοδ/i;
const visible = (c: Category | undefined, cats: Record<string, Category>) =>
  !!c && !c.deleted_at && !c.archived && !(c.parent_id && (cats[c.parent_id]?.archived || cats[c.parent_id]?.deleted_at));

/** Categories counted as tips: your choice, or automatically anything named "tips". Hidden ones never count. */
export function tipsCategoryIds(cats: Record<string, Category>, me: string, chosen?: string[]): string[] {
  const all = Object.values(cats).filter(c => c.type === 'income' && c.owner_id === me && visible(c, cats));
  if (chosen && chosen.length) return chosen.filter(id => visible(cats[id], cats));
  return all.filter(c => TIPS_RE.test(c.name) || (c.parent_id && TIPS_RE.test(cats[c.parent_id]?.name ?? ''))).map(c => c.id);
}

export interface Avg { total: number; count: number; avg: number }
const avgOf = (list: Tx[]): Avg => {
  const total = round2(list.reduce((s, t) => s + t.amount, 0));
  return { total, count: list.length, avg: list.length ? round2(total / list.length) : 0 };
};

export function useTips(anchor: string) {
  const txs = useTxs();
  const cats = useStore(s => s.categories);
  const me = useStore(s => s.user?.id ?? '');
  const chosen = useStore(s => s.prefs.tipsCats);
  return useMemo(() => {
    const [a0, b0] = [prev3(anchor)[0], monthEnd(anchor)];
    let ids = new Set(tipsCategoryIds(cats, me, chosen));
    if (!chosen || !chosen.length) {
      // automatic: only "tips" categories actually used in these 4 months (old shops drop out by themselves)
      const used = new Set(txs.filter(t => t.type === 'income' && t.owner_id === me && t.date >= a0 && t.date <= b0 && t.category_id).map(t => t.category_id!));
      ids = new Set([...ids].filter(id => used.has(id)));
    }
    // a parent category also counts entries filed directly under it
    const isTip = (t: Tx) => t.type === 'income' && t.owner_id === me && !!t.category_id && ids.has(t.category_id);
    const today = todayISO();
    const [a, b] = [monthStart(anchor), monthEnd(anchor)];
    const [pa, pb] = prev3(anchor);
    const mine = txs.filter(isTip);
    return {
      ids: [...ids],
      current: avgOf(mine.filter(t => t.date >= a && t.date <= b && t.date <= today)),
      previous: avgOf(mine.filter(t => t.date >= pa && t.date <= pb)),
    };
  }, [txs, cats, me, chosen, anchor]);
}

// ---------------------------------------------------------------- month vs 3-month average

export interface CatCompare { id: string; now: number; avg: number; subs: CatCompare[] }

export function useCategoryCompare(anchor: string) {
  const txs = useTxs();
  const cats = useStore(s => s.categories);
  const me = useStore(s => s.user?.id ?? '');
  return useMemo(() => {
    const today = todayISO();
    const [a, b] = [monthStart(anchor), monthEnd(anchor)];
    const [pa, pb] = prev3(anchor);
    const now = new Map<string, number>(), past = new Map<string, number>();
    const add = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v);
    for (const t of txs) {
      if (t.type !== 'expense' || t.owner_id !== me || !t.category_id || t.date > today) continue;
      const inNow = t.date >= a && t.date <= b, inPast = t.date >= pa && t.date <= pb;
      if (!inNow && !inPast) continue;
      const m = inNow ? now : past;
      const parent = cats[t.category_id]?.parent_id;
      add(m, parent ?? t.category_id, t.amount);
      if (parent) add(m, t.category_id, t.amount); else add(m, 'general:' + t.category_id, t.amount);
    }
    const row = (id: string, key = id): CatCompare => ({ id, now: round2(now.get(key) ?? 0), avg: round2((past.get(key) ?? 0) / 3), subs: [] });
    const tops = Object.values(cats).filter(c => c.type === 'expense' && !c.parent_id && !c.deleted_at && (now.has(c.id) || past.has(c.id)));
    return tops.map(c => {
      const r = row(c.id);
      const subs = Object.values(cats).filter(s => s.parent_id === c.id && !s.deleted_at && (now.has(s.id) || past.has(s.id))).map(s => row(s.id));
      if (now.has('general:' + c.id) || past.has('general:' + c.id)) subs.push(row('general:' + c.id));
      r.subs = subs.sort((x, y) => y.now - x.now || y.avg - x.avg);
      return r;
    }).sort((x, y) => y.now - x.now || y.avg - x.avg);
  }, [txs, cats, me, anchor]);
}

// ---------------------------------------------------------------- savings

export function useSavings(anchor: string) {
  const txs = useTxs();
  const me = useStore(s => s.user?.id ?? '');
  return useMemo(() => {
    const today = todayISO();
    const [a, b] = [monthStart(anchor), monthEnd(anchor)];
    const [pa, pb] = prev3(anchor);
    let inc = 0, exp = 0, pInc = 0, pExp = 0;
    for (const t of txs) {
      if (t.owner_id !== me || t.type === 'transfer' || t.date > today) continue;
      const v = t.type === 'income' ? t.amount : -t.amount;
      if (t.date >= a && t.date <= b) { if (v > 0) inc += v; else exp -= v; }
      else if (t.date >= pa && t.date <= pb) { if (v > 0) pInc += v; else pExp -= v; }
    }
    return {
      income: round2(inc), expense: round2(exp), saved: round2(inc - exp),
      avgSaved: round2((pInc - pExp) / 3), avgIncome: round2(pInc / 3),
    };
  }, [txs, me, anchor]);
}
