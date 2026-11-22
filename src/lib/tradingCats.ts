import { useEffect } from 'react';
import { getState, put, remove, setPrefs, useStore } from './store';
import { alive } from './calc';
import { uuid } from './format';
import type { Account, AccountLink, Category } from './types';

/**
 * Every Tracker strategy that is in use — it has a P&L, or you opened its account early — gets, automatically:
 *  - its own account in Trading capital, with the strategy's name, whose balance follows the strategy's daily P&L
 *    (you only set the capital you put in, once);
 *  - a subcategory under Income › Trading with the same name, so money taken out of it shows as income from that strategy.
 * Strategies you've only written down (no P&L yet), or stopped before 23 Nov 2026, get nothing. Renaming a strategy renames both. Your account only.
 * The ids live in prefs.tradingCats and prefs.strategyAccounts.
 */
/** Strategies with results only before this (ones you've stopped) get nothing; a new account counts P&L from here on. */
const FROM = '2026-11-23';

export function syncTradingCats(): void {
  const s = getState();
  const me = s.user?.id;
  if (!me || !s.prefs.analytics || !s.lastSync) return;   // only once your data has loaded, so nothing is made twice
  const cats = alive(s.categories) as Category[];
  const pnlBy = new Set(alive(s.pnl).filter(p => p.date >= FROM).map(p => p.strategy_id));   // results from 23 Nov 2026 on
  const accMap: Record<string, string> = { ...(s.prefs.strategyAccounts ?? {}) };
  const strategies = alive(s.strategies).filter(x => !x.archived);
  const links: Record<string, AccountLink> = { ...(s.prefs.accountLinks ?? {}) };
  const linked = new Set(Object.entries(links).filter(([aid]) => s.accounts[aid] && !s.accounts[aid].deleted_at).map(([, l]) => l.strategy));
  const inUse = strategies.filter(x => pnlBy.has(x.id) || x.id in accMap || linked.has(x.id));
  let trading = [...(s.prefs.tradingAccounts ?? [])];
  const map = { root: s.prefs.tradingCats?.root ?? null, byStrategy: { ...(s.prefs.tradingCats?.byStrategy ?? {}) } };
  let changed = false;
  let sort = Math.max(0, ...cats.map(c => c.sort)) + 1;
  let accSort = Math.max(0, ...alive(s.accounts).map(a => a.sort)) + 1;

  // Income › Trading
  let root = map.root ? cats.find(c => c.id === map.root) : undefined;
  if (!root) root = cats.find(c => c.owner_id === me && c.type === 'income' && !c.parent_id && c.name.trim().toLowerCase() === 'trading');
  if (!root && inUse.length) {
    root = { id: uuid(), owner_id: '', type: 'income', name: 'Trading', parent_id: null, icon: 'candles', color: '#30A46C', sort: sort++, archived: false };
    put('categories', root);
  }
  if (root && map.root !== root.id) { map.root = root.id; changed = true; }

  // subcategories made for strategies that aren't in use (and never got an entry) go away
  const used = new Set(alive(s.transactions).map(t => t.category_id).filter(Boolean));
  const live = new Set(inUse.map(x => x.id));
  for (const [sid, cid] of Object.entries(map.byStrategy)) {
    if (live.has(sid)) continue;
    if (!used.has(cid) && cats.some(c => c.id === cid)) remove('categories', cid);
    if (!used.has(cid)) { delete map.byStrategy[sid]; changed = true; }
  }

  for (const st of inUse) {
    // the subcategory
    if (root) {
      const id = map.byStrategy[st.id];
      let sub = id ? cats.find(c => c.id === id) : undefined;
      if (!sub) sub = cats.find(c => c.parent_id === root!.id && c.name.trim().toLowerCase() === st.name.trim().toLowerCase());
      if (!sub) {
        sub = { id: uuid(), owner_id: '', type: 'income', name: st.name, parent_id: root.id, icon: 'candles', color: root.color, sort: sort++, archived: false };
        put('categories', sub);
      } else if (sub.name !== st.name) put('categories', { ...sub, name: st.name });
      if (map.byStrategy[st.id] !== sub.id) { map.byStrategy[st.id] = sub.id; changed = true; }
    }
    // the account: an existing one already linked to it, or a new one
    let accId = accMap[st.id];
    if (!accId) accId = Object.entries(links).find(([aid, l]) => l.strategy === st.id && s.accounts[aid] && !s.accounts[aid].deleted_at)?.[0] ?? '';
    if (!accId) {
      accId = uuid();
      const acc: Account = { id: accId, owner_id: '', name: st.name, kind: 'regular', icon: 'candles', color: st.color, opening_balance: 0,
        credit_limit: null, goal: null, archived: false, sort: accSort++ };
      put('accounts', acc);
      links[accId] = { strategy: st.id, since: FROM, adj: 0 };
      if (!trading.includes(accId)) trading = [...trading, accId];
      changed = true;
    }
    if (accMap[st.id] !== accId) { accMap[st.id] = accId; changed = true; }
    const acc = s.accounts[accId];
    if (acc && !acc.deleted_at && acc.name !== st.name) put('accounts', { ...acc, name: st.name });   // a deleted one stays deleted
  }
  if (changed) setPrefs({ tradingCats: map, strategyAccounts: accMap, accountLinks: links, tradingAccounts: trading });
}

/** Open a strategy's account before its first P&L (e.g. you've funded the broker); returns the account id. */
export function openStrategyAccount(strategy: string): string | null {
  const s = getState();
  if (s.prefs.strategyAccounts?.[strategy]) return s.prefs.strategyAccounts[strategy];
  setPrefs({ strategyAccounts: { ...(s.prefs.strategyAccounts ?? {}), [strategy]: '' } });
  syncTradingCats();
  return getState().prefs.strategyAccounts?.[strategy] || null;
}

/** The income category for money taken out of a strategy: its subcategory, or Trading itself. */
export function tradingCatFor(strategy: string | null): string | null {
  syncTradingCats();
  const t = getState().prefs.tradingCats;
  return (strategy && t?.byStrategy[strategy]) || t?.root || null;
}

export function useTradingCats() {
  const strategies = useStore(s => s.strategies);
  const pnl = useStore(s => s.pnl);
  const ready = useStore(s => !!s.lastSync && !!s.prefs.analytics);
  useEffect(() => { if (ready) syncTradingCats(); }, [strategies, pnl, ready]);
}
