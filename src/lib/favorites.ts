/** Favorite entries: one tap saves it for today (with Undo); a double tap opens it filled in. */
import { getState, put, remove, setPrefs, useStore } from './store';
import { setUi } from './ui';
import { catName } from './calc';
import { money, round2, todayISO, uuid } from './format';
import { toast } from '../components/ui';
import type { Favorite, TxType } from './types';

type Shape = { type: TxType; amount: number; account_id: string; to_account_id: string | null; category_id: string | null; note: string | null };
const same = (f: Shape, v: Shape) =>
  f.type === v.type && round2(f.amount) === round2(v.amount) && f.account_id === v.account_id &&
  (f.to_account_id ?? null) === (v.to_account_id ?? null) && (f.category_id ?? null) === (v.category_id ?? null) && (f.note ?? '') === (v.note ?? '');

const NONE: Favorite[] = [];
export const useFavorites = () => useStore(s => s.prefs.favorites ?? NONE);
export const findFavorite = (v: Shape) => (getState().prefs.favorites ?? []).find(f => same(f, v)) ?? null;

export function toggleFavorite(v: Shape): boolean {
  const list = getState().prefs.favorites ?? [];
  const hit = list.find(f => same(f, v));
  if (hit) { setPrefs({ favorites: list.filter(f => f.id !== hit.id) }); return false; }
  setPrefs({ favorites: [...list, { id: uuid(), ...v, amount: round2(v.amount) }] });
  return true;
}

export function favoriteLabel(f: Favorite) {
  const st = getState();
  if (f.type === 'transfer') return `${st.accounts[f.account_id]?.name ?? '?'} → ${st.accounts[f.to_account_id ?? '']?.name ?? '?'}`;
  return f.note || catName(f.category_id, st.categories, false);
}

/** Usable only while its account and category still exist and are visible. */
export function favoriteAlive(f: Favorite) {
  const st = getState();
  const acc = st.accounts[f.account_id];
  if (!acc || acc.deleted_at || acc.archived) return false;
  if (f.type === 'transfer') { const to = st.accounts[f.to_account_id ?? '']; return !!to && !to.deleted_at && !to.archived; }
  const c = st.categories[f.category_id ?? ''];
  const parent = c?.parent_id ? st.categories[c.parent_id] : null;
  return !!c && !c.deleted_at && !c.archived && !(parent && (parent.deleted_at || parent.archived));
}

export function addFromFavorite(f: Favorite) {
  const st = getState();
  const date = todayISO();
  const seq = Math.max(0, ...Object.values(st.transactions).filter(t => t.date === date && !t.deleted_at).map(t => t.seq)) + 1;
  const id = uuid();
  put('transactions', { id, owner_id: st.user!.id, type: f.type, date, amount: f.amount, account_id: f.account_id, to_account_id: f.to_account_id, category_id: f.category_id, note: f.note, recurring_id: null, seq });
  toast(`✓ ${favoriteLabel(f)} ${money(f.amount)} · ${st.accounts[f.account_id]?.name ?? ''}`, { label: 'Undo', run: () => remove('transactions', id) },
    { onTap: () => setUi({ addTx: { editId: id } }), ms: 5000 });
}

export function openFavorite(f: Favorite) {
  setUi({ addTx: { prefill: { p: { type: f.type, amount: f.amount, accountId: f.account_id, toAccountId: f.to_account_id, categoryId: f.category_id, date: null, note: f.note ?? '', words: [] }, repeat: null, until: null } } });
}
