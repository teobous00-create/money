import { useMemo } from 'react';
import { useStore, getState, setPrefs } from './store';
import { alive } from './calc';
import { round2, todayISO } from './format';
import { isPending, useTimesVersion } from './txTime';
import type { Category, Tx } from './types';

/**
 * Goal categories: entries in them still count as expenses; the goal adds a target, progress and the day it was reached.
 * prefs.goals = category id → target € (0 = a goal without a target, e.g. a "Στόχοι" folder).
 * A goal's subcategories are goals too. Entries count from everyone who shares the category.
 */
export function goalIds(goals: Record<string, number> | undefined, cats: Record<string, Category>): Set<string> {
  const ids = new Set(Object.keys(goals ?? {}).filter(id => cats[id] && !cats[id].deleted_at));
  for (const c of Object.values(cats)) if (c.parent_id && ids.has(c.parent_id) && !c.deleted_at) ids.add(c.id);
  return ids;
}
export const isGoalTx = (t: Pick<Tx, 'type' | 'category_id'>, ids: Set<string>) => t.type === 'expense' && !!t.category_id && ids.has(t.category_id);

export function useGoalIds() {
  const goals = useStore(s => s.prefs.goals);
  const cats = useStore(s => s.categories);
  return useMemo(() => goalIds(goals, cats), [goals, cats]);
}
export const goalIdsNow = () => { const s = getState(); return goalIds(s.prefs.goals, s.categories); };

export function setGoal(categoryId: string, target: number | null) {
  const goals = { ...(getState().prefs.goals ?? {}) };
  if (target === null) delete goals[categoryId]; else goals[categoryId] = Math.max(0, target);
  setPrefs({ goals });
}

export interface GoalRow { id: string; name: string; parent: string | null; target: number; saved: number; doneOn: string | null; last: string | null }

/** Each goal with a target: how much is in it (all time) and the day it was reached. */
export function useGoals(): GoalRow[] {
  const goals = useStore(s => s.prefs.goals);
  const cats = useStore(s => s.categories);
  const txs = useStore(s => s.transactions);
  const tv = useTimesVersion();
  return useMemo(() => {
    const today = todayISO();
    const live = alive(txs).filter(t => t.type === 'expense' && t.category_id && !isPending(t, today));
    return Object.entries(goals ?? {}).filter(([id, target]) => target > 0 && cats[id] && !cats[id].deleted_at).map(([id, target]) => {
      const c = cats[id];
      const inside = new Set([id, ...Object.values(cats).filter(x => x.parent_id === id).map(x => x.id)]);
      const list = live.filter(t => inside.has(t.category_id!)).sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
      let sum = 0, doneOn: string | null = null;
      for (const t of list) { sum += t.amount; if (!doneOn && sum >= target - 0.004) doneOn = t.date; }
      return { id, name: c.name, parent: c.parent_id ? cats[c.parent_id]?.name ?? null : null, target, saved: round2(sum), doneOn, last: list.length ? list[list.length - 1].date : null };
    }).sort((a, b) => Number(!!a.doneOn) - Number(!!b.doneOn) || b.saved / b.target - a.saved / a.target);
  }, [goals, cats, txs, tv]); // eslint-disable-line react-hooks/exhaustive-deps
}
