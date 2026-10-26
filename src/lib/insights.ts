import { useMemo } from 'react';
import { useStore } from './store';
import { useTxs, useSelection, useSharedRoots } from './calc';
import { fromISO, round2, toISO, todayISO } from './format';
import type { Category, Job, Tx } from './types';
import { shiftPay, shiftParts } from './tracker';
import { alive } from './calc';

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

/** Spending per category this month for budgets (top-level ids include their subcategories).
 *  Shared categories have a joint budget: everyone's entries count. Private ones: only mine. */
export function useBudgetSpend(anchor: string) {
  const txs = useTxs();
  const sel = useSelection();
  const cats = useStore(s => s.categories);
  const me = useStore(s => s.user?.id ?? '');
  const shared = useSharedRoots();
  return useMemo(() => {
    const today = todayISO();
    const [a, b] = [monthStart(anchor), monthEnd(anchor)];
    const total = new Map<string, number>(), mine = new Map<string, number>();
    const add = (m: Map<string, number>, id: string, v: number) => m.set(id, round2((m.get(id) ?? 0) + v));
    for (const t of txs) {
      if (t.type !== 'expense' || !t.category_id || t.date < a || t.date > b || t.date > today) continue;
      const parent = cats[t.category_id]?.parent_id ?? null;
      const root = parent ?? t.category_id;
      const own = t.owner_id === me;
      if (own ? !sel.has(t.account_id) : !shared.has(root)) continue;
      for (const id of parent ? [t.category_id, parent] : [t.category_id]) { add(total, id, t.amount); if (own) add(mine, id, t.amount); }
    }
    const joint = (id: string) => shared.has(cats[id]?.parent_id ?? id);
    return { total, mine, joint };
  }, [txs, sel, cats, me, shared, anchor]);
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

// ---------------------------------------------------------------- work

export interface WorkMonth { shifts: number; hours: number; bonus: number; earned: number; tips: number }
export interface WorkRow { job: Job; now: WorkMonth; avg: WorkMonth | null; perHourNow: number | null; perHourAvg: number | null }

/** This month vs the average of the previous 3 months that have logged shifts. */
export function useWorkStats(anchor: string): WorkRow[] {
  const jobs = useStore(s => s.jobs);
  const shifts = useStore(s => s.shifts);
  const txs = useStore(s => s.transactions);
  const me = useStore(s => s.user?.id ?? '');
  return useMemo(() => {
    const today = todayISO();
    const months = [addMonths(monthStart(anchor), -3), addMonths(monthStart(anchor), -2), addMonths(monthStart(anchor), -1), monthStart(anchor)];
    const live = alive(jobs).filter(j => !j.archived).sort((a, b) => a.sort - b.sort);
    return live.map(job => {
      const per = months.map(m => {
        const e = monthEnd(m);
        const w: WorkMonth = { shifts: 0, hours: 0, bonus: 0, earned: 0, tips: 0 };
        for (const s of alive(shifts)) {
          if (s.job_id !== job.id || s.date < m || s.date > e || s.date > today) continue;
          w.shifts++; w.hours += s.hours; w.bonus += shiftParts(job, s).bonus; w.earned += shiftPay(job, s);
        }
        // tips: everything in the job's tips category that month (also tips logged before the Tracker existed)
        if (job.tips_category_id && w.shifts) {
          for (const t of Object.values(txs)) {
            if (!t.deleted_at && t.owner_id === me && t.type === 'income' && t.category_id === job.tips_category_id && t.date >= m && t.date <= e && t.date <= today) w.tips += t.amount;
          }
        }
        w.hours = round2(w.hours); w.bonus = round2(w.bonus); w.earned = round2(w.earned); w.tips = round2(w.tips);
        return w;
      });
      const now = per[3];
      const tracked = per.slice(0, 3).filter(w => w.shifts > 0);
      const avg = tracked.length ? {
        shifts: round2(tracked.reduce((x, w) => x + w.shifts, 0) / tracked.length),
        hours: round2(tracked.reduce((x, w) => x + w.hours, 0) / tracked.length),
        bonus: round2(tracked.reduce((x, w) => x + w.bonus, 0) / tracked.length),
        earned: round2(tracked.reduce((x, w) => x + w.earned, 0) / tracked.length),
        tips: round2(tracked.reduce((x, w) => x + w.tips, 0) / tracked.length),
      } : null;
      const ph = (w: WorkMonth | null) => (w && w.hours > 0 ? round2((w.earned + w.tips) / w.hours) : null);
      return { job, now, avg, perHourNow: ph(now), perHourAvg: ph(avg) };
    });
  }, [jobs, shifts, txs, me, anchor]);
}
