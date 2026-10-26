import { useSyncExternalStore } from 'react';
import type { CatType, Freq, TxType } from './types';
import type { Parsed } from './quickparse';

export interface AddTxArgs {
  editId?: string;
  type?: TxType;
  categoryId?: string;
  accountId?: string;
  date?: string;
  voice?: boolean;   // start listening right away (app-icon shortcut)
  prefill?: { p: Parsed; repeat: Freq | null; until: string | null };   // a spoken entry that still needs you
}

export interface UiState {
  tab: 'accounts' | 'categories' | 'transactions' | 'overview' | 'tracker';
  tabDir: number;
  addTx: AddTxArgs | null;
  account: { id?: string } | null;
  category: { id?: string; type?: CatType; parentId?: string } | null;
  catDetail: { id: string; type: CatType } | null;
  settings: boolean;
  filter: boolean;
  periodPicker: boolean;
  recurring: boolean;
  importer: boolean;
  search: boolean;
  hidden: boolean;
  shiftDay?: string | null;   // open this day's shift (shortcut, voice)
  payJob?: string | null;     // open "got paid" for this job (voice)
}

const TABS: UiState['tab'][] = ['accounts', 'categories', 'transactions', 'overview', 'tracker'];

let ui: UiState = {
  tab: 'categories', tabDir: 0, addTx: null, account: null, category: null, catDetail: null,
  settings: false, filter: false, periodPicker: false, recurring: false, importer: false, search: false, hidden: false,
};
try {
  const t = localStorage.getItem('money:tab') as UiState['tab'] | null;
  if (t && TABS.includes(t)) ui.tab = t;
} catch { /* ignore */ }

const ls = new Set<() => void>();
export function setUi(p: Partial<UiState>) {
  if (p.tab && p.tab !== ui.tab) {
    p.tabDir = TABS.indexOf(p.tab) > TABS.indexOf(ui.tab) ? 1 : -1;
    try { localStorage.setItem('money:tab', p.tab); } catch { /* ignore */ }
  }
  ui = { ...ui, ...p };
  ls.forEach(l => l());
}
export function useUi<T>(sel: (u: UiState) => T): T {
  return useSyncExternalStore(cb => { ls.add(cb); return () => { ls.delete(cb); }; }, () => sel(ui));
}
export const getUi = () => ui;
