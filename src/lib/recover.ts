import { getState, putMany } from './store';
import { norm } from './quickparse';
import type { Account, Category, Recurring, Tx } from './types';

/**
 * "Recently deleted": big deletions of your own rows (a 1Money re-import with "Replace my data", an
 * account deleted with all its entries…). They're only marked deleted, so they can come back.
 * Restoring brings back only what's missing: an entry that the re-import already brought back
 * (same day, amount, type and note) is skipped, and a deleted account/category that exists again
 * under the same name is matched to the live one instead of coming back twice.
 */
export interface Batch { at: string; tx: number; accounts: number; categories: number; recurring: number; names: string[] }

export function deletedBatches(days = 30): Batch[] {
  const s = getState(), me = s.user?.id;
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const by = new Map<string, Batch>();
  const add = (at: string | null | undefined, k: 'tx' | 'accounts' | 'categories' | 'recurring', name?: string) => {
    if (!at || at < since) return;
    const key = at.slice(0, 19);   // one deletion = one moment
    const b = by.get(key) ?? { at, tx: 0, accounts: 0, categories: 0, recurring: 0, names: [] };
    b[k]++;
    if (name && b.names.length < 3) b.names.push(name);
    by.set(key, b);
  };
  for (const t of Object.values(s.transactions)) if (t.owner_id === me) add(t.deleted_at, 'tx');
  for (const a of Object.values(s.accounts)) if (a.owner_id === me) add(a.deleted_at, 'accounts', a.name);
  for (const c of Object.values(s.categories)) if (c.owner_id === me) add(c.deleted_at, 'categories');
  for (const r of Object.values(s.recurring)) if (r.owner_id === me) add(r.deleted_at, 'recurring');
  return [...by.values()].filter(b => b.tx + b.recurring >= 3).sort((a, b) => b.at.localeCompare(a.at));
}

export function restoreBatch(at: string): { restored: number; skipped: number } {
  const s = getState(), me = s.user?.id;
  const key = at.slice(0, 19);
  const inBatch = (r: { owner_id: string; deleted_at?: string | null }) => r.owner_id === me && !!r.deleted_at && r.deleted_at.slice(0, 19) === key;
  const alive = <T extends { deleted_at?: string | null }>(l: T[]) => l.filter(x => !x.deleted_at);

  const accs = Object.values(s.accounts), cats = Object.values(s.categories);
  const liveAcc = alive(accs).filter(a => a.owner_id === me);
  const catKey = (c: Category) => `${c.type}|${norm(c.name)}|${c.parent_id ? norm(s.categories[c.parent_id]?.name ?? '') : ''}`;
  const liveCat = alive(cats);
  const accMap = new Map<string, string>(), catMap = new Map<string, string>();
  const backAcc: Account[] = [], backCat: Category[] = [];
  const accountFor = (id: string | null): string | null => {
    if (!id) return null;
    if (accMap.has(id)) return accMap.get(id)!;
    const a = s.accounts[id];
    if (!a || !a.deleted_at) { accMap.set(id, id); return id; }
    const same = liveAcc.find(x => norm(x.name) === norm(a.name));
    const to = same ? same.id : (backAcc.push({ ...a, deleted_at: null }), a.id);
    accMap.set(id, to);
    return to;
  };
  const categoryFor = (id: string | null): string | null => {
    if (!id) return null;
    if (catMap.has(id)) return catMap.get(id)!;
    const c = s.categories[id];
    if (!c || !c.deleted_at) { catMap.set(id, id); return id; }
    const same = liveCat.find(x => catKey(x) === catKey(c));
    let to = c.id;
    if (same) to = same.id;
    else { if (c.parent_id) { const p = categoryFor(c.parent_id); backCat.push({ ...c, parent_id: p, deleted_at: null }); } else backCat.push({ ...c, deleted_at: null }); }
    catMap.set(id, to);
    return to;
  };

  // entries already back from the re-import
  const sig = (t: Pick<Tx, 'date' | 'amount' | 'type' | 'note'>) => `${t.date}|${Math.round(t.amount * 100)}|${t.type}|${norm(t.note ?? '')}`;
  const have = new Map<string, number>();
  for (const t of alive(Object.values(s.transactions))) if (t.owner_id === me) have.set(sig(t), (have.get(sig(t)) ?? 0) + 1);

  const backTx: Tx[] = [];
  let skipped = 0;
  for (const t of Object.values(s.transactions)) {
    if (!inBatch(t)) continue;
    const k = sig(t);
    if ((have.get(k) ?? 0) > 0) { have.set(k, have.get(k)! - 1); skipped++; continue; }
    backTx.push({ ...t, deleted_at: null, account_id: accountFor(t.account_id)!, to_account_id: accountFor(t.to_account_id), category_id: categoryFor(t.category_id) });
  }
  const liveRec = alive(Object.values(s.recurring)).filter(r => r.owner_id === me);
  const backRec: Recurring[] = [];
  for (const r of Object.values(s.recurring)) {
    if (!inBatch(r)) continue;
    if (liveRec.some(x => x.amount === r.amount && x.freq === r.freq && norm(x.note ?? '') === norm(r.note ?? ''))) { skipped++; continue; }
    backRec.push({ ...r, deleted_at: null, account_id: accountFor(r.account_id)!, to_account_id: accountFor(r.to_account_id), category_id: categoryFor(r.category_id) });
  }
  // parents before children, accounts and categories before the entries that use them
  backCat.sort((a, b) => Number(!!a.parent_id) - Number(!!b.parent_id));
  if (backAcc.length) putMany('accounts', backAcc);
  if (backCat.length) putMany('categories', backCat);
  if (backTx.length) putMany('transactions', backTx);
  if (backRec.length) putMany('recurring', backRec);
  return { restored: backTx.length + backRec.length, skipped };
}
