import { useEffect } from 'react';
import { getState, put, setPrefs, useStore } from './store';
import { alive } from './calc';
import { uuid } from './format';
import type { Category } from './types';

/**
 * Income › Trading, with one subcategory per Tracker strategy (same name), so money taken out of trading shows as income
 * and you can see which strategy it came from. Kept in step automatically: a new strategy gets its subcategory, a renamed
 * one renames it. Your account only (the one with the Tracker). The ids live in prefs.tradingCats.
 */
export function syncTradingCats(): void {
  const s = getState();
  const me = s.user?.id;
  if (!me || !s.prefs.analytics || !s.lastSync) return;   // only once your data has loaded, so nothing is made twice
  const cats = alive(s.categories) as Category[];
  const strategies = alive(s.strategies).filter(x => !x.archived);
  const map = { root: s.prefs.tradingCats?.root ?? null, byStrategy: { ...(s.prefs.tradingCats?.byStrategy ?? {}) } };
  let changed = false;
  const nextSort = () => Math.max(0, ...alive(getState().categories).map(c => (c as Category).sort)) + 1;

  let root = map.root ? cats.find(c => c.id === map.root) : undefined;
  if (!root) root = cats.find(c => c.owner_id === me && c.type === 'income' && !c.parent_id && c.name.trim().toLowerCase() === 'trading');
  if (!root) {
    root = { id: uuid(), owner_id: '', type: 'income', name: 'Trading', parent_id: null, icon: 'candles', color: '#30A46C', sort: nextSort(), archived: false };
    put('categories', root);
  }
  if (map.root !== root.id) { map.root = root.id; changed = true; }

  for (const st of strategies) {
    const id = map.byStrategy[st.id];
    let sub = id ? cats.find(c => c.id === id) : undefined;
    if (!sub) sub = cats.find(c => c.parent_id === root!.id && c.name.trim().toLowerCase() === st.name.trim().toLowerCase());
    if (!sub) {
      sub = { id: uuid(), owner_id: '', type: 'income', name: st.name, parent_id: root.id, icon: 'candles', color: root.color, sort: nextSort(), archived: false };
      put('categories', sub);
    } else if (sub.name !== st.name) put('categories', { ...sub, name: st.name });
    if (map.byStrategy[st.id] !== sub.id) { map.byStrategy[st.id] = sub.id; changed = true; }
  }
  if (changed) setPrefs({ tradingCats: map });
}

/** The income category for money taken out of a strategy: its subcategory, or Trading itself. */
export function tradingCatFor(strategy: string | null): string | null {
  syncTradingCats();
  const t = getState().prefs.tradingCats;
  return (strategy && t?.byStrategy[strategy]) || t?.root || null;
}

export function useTradingCats() {
  const strategies = useStore(s => s.strategies);
  const ready = useStore(s => !!s.lastSync && !!s.prefs.analytics);
  useEffect(() => { if (ready) syncTradingCats(); }, [strategies, ready]);
}
