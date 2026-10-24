import Papa from 'papaparse';
import type { Account, Category, CatType, Tx } from './types';
import { guessStyle } from './icons';
import { round2, uuid } from './format';
import { computeBalances, alive } from './calc';
import { getState, putMany } from './store';

const TYPE: Record<string, Tx['type']> = {
  'Έξοδο': 'expense', 'Έσοδο': 'income', 'Μεταφορά': 'transfer',
  Expense: 'expense', Income: 'income', Transfer: 'transfer',
};

export interface ImportPreview {
  txCount: number;
  accounts: Array<{ name: string; balance: number | null; archived: boolean }>;
  expenseCats: number;
  incomeCats: number;
  from: string;
  to: string;
  commit: () => void;
}

const clean = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim();

function parseDate(s: string): string {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) throw new Error('Unexpected date: ' + s);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function splitCategory(s: string): [string, string | null] {
  const m = s.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!m) return [clean(s), null];
  return [clean(m[1]), clean(m[2]) || null];
}

const kindFor = (name: string): Account['kind'] =>
  /πιστωτ|credit/i.test(name) ? 'credit' : /savings|οικονομ|ταμιευ|σιδεράκ|μηχαν/i.test(name) ? 'savings' : 'regular';

/** Parses a 1Money CSV export. Nothing is saved until commit() is called. */
export function parse1Money(text: string): ImportPreview {
  const rows = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false }).data;
  if (!rows.length || rows[0].length < 5) throw new Error('This does not look like a 1Money export.');

  const txRows: string[][] = [];
  const balances: Array<[string, number]> = [];
  let section: 'tx' | 'gap' | 'bal' = 'tx';
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const empty = !r || r.every(c => !c || !c.trim());
    if (section === 'tx') {
      if (empty || r.length < 5) { section = 'gap'; continue; }
      txRows.push(r);
    } else if (section === 'gap') {
      if (!empty && /ΟΝΟΜΑ|NAME/i.test(r[0] ?? '')) section = 'bal';
    } else {
      if (empty) break;
      balances.push([clean(r[0]), Number(r[1])]);
    }
  }
  if (!txRows.length) throw new Error('No transactions found in the file.');

  const me = getState().user!.id;
  const accounts = new Map<string, Account>();
  let sort = 0;
  const addAccount = (name: string, archived: boolean) => {
    const key = clean(name);
    if (!key || accounts.has(key)) return;
    const st = guessStyle(key, accounts.size);
    accounts.set(key, {
      id: uuid(), owner_id: me, name: key, kind: kindFor(key), icon: st.icon === 'circle' ? 'bank' : st.icon, color: st.color,
      opening_balance: 0, credit_limit: null, goal: null, archived, sort: sort++,
    });
  };
  balances.forEach(([n]) => addAccount(n, false));
  const activeNames = new Set(balances.map(([n]) => n));

  const cats = new Map<string, Category>();
  let catSort = 0;
  const getCat = (type: CatType, main: string, sub: string | null): string => {
    const pk = `${type}|${main}`;
    let parent = cats.get(pk);
    if (!parent) {
      const st = guessStyle(main, cats.size);
      parent = { id: uuid(), owner_id: me, type, name: main, parent_id: null, icon: st.icon, color: st.color, sort: catSort++, archived: false };
      cats.set(pk, parent);
    }
    if (!sub) return parent.id;
    const sk = `${pk}|${sub}`;
    let child = cats.get(sk);
    if (!child) {
      const st = guessStyle(sub);
      child = { id: uuid(), owner_id: me, type, name: sub, parent_id: parent.id, icon: st.icon, color: parent.color, sort: catSort++, archived: false };
      cats.set(sk, child);
    }
    return child.id;
  };

  const txs: Tx[] = [];
  const n = txRows.length;
  txRows.forEach((r, i) => {
    const type = TYPE[clean(r[1])];
    if (!type) throw new Error(`Row ${i + 2}: unknown type "${r[1]}"`);
    const from = clean(r[2]);
    const target = clean(r[3]);
    addAccount(from, !activeNames.has(from));
    let to: string | null = null;
    let category: string | null = null;
    if (type === 'transfer') { addAccount(target, !activeNames.has(target)); to = accounts.get(target)!.id; }
    else { const [main, sub] = splitCategory(r[3]); category = getCat(type, main, sub); }
    txs.push({
      id: uuid(), owner_id: me, type, date: parseDate(r[0]), amount: round2(Math.abs(Number(r[4]))),
      account_id: accounts.get(from)!.id, to_account_id: to, category_id: category,
      note: clean(r[9] ?? '') || null, recurring_id: null, seq: n - i, // file is newest-first
    });
  });

  // opening balance = 1Money's final balance − what the imported history adds up to
  const accList = [...accounts.values()];
  const computed = computeBalances(accList, txs);
  for (const [name, bal] of balances) {
    const a = accounts.get(name)!;
    a.opening_balance = round2(bal - (computed.get(a.id) ?? 0));
  }
  // credit cards: suggest the limit later in the account editor
  const dates = txs.map(t => t.date).sort();
  const catList = [...cats.values()];

  return {
    txCount: txs.length,
    accounts: accList.map(a => ({ name: a.name, balance: activeNames.has(a.name) ? balances.find(b => b[0] === a.name)![1] : null, archived: a.archived })),
    expenseCats: catList.filter(c => c.type === 'expense' && !c.parent_id).length,
    incomeCats: catList.filter(c => c.type === 'income' && !c.parent_id).length,
    from: dates[0],
    to: dates[dates.length - 1],
    commit: () => {
      // reuse existing accounts/categories with the same name so a second import doesn't duplicate them
      const s = getState();
      const existingAcc = new Map(alive(s.accounts).filter(a => a.owner_id === me).map(a => [a.name, a]));
      const accMap = new Map<string, string>();
      const newAccs: Account[] = [];
      for (const a of accList) {
        const ex = existingAcc.get(a.name);
        if (ex) accMap.set(a.id, ex.id); else { accMap.set(a.id, a.id); newAccs.push(a); }
      }
      const liveCats = alive(s.categories).filter(c => c.owner_id === me);
      const catMap = new Map<string, string>();
      const newCats: Category[] = [];
      for (const c of catList.filter(c => !c.parent_id)) {
        const ex = liveCats.find(x => !x.parent_id && x.type === c.type && x.name === c.name);
        if (ex) catMap.set(c.id, ex.id); else { catMap.set(c.id, c.id); newCats.push(c); }
      }
      for (const c of catList.filter(c => c.parent_id)) {
        const pid = catMap.get(c.parent_id!)!;
        const ex = liveCats.find(x => x.parent_id === pid && x.name === c.name);
        if (ex) catMap.set(c.id, ex.id); else { catMap.set(c.id, c.id); newCats.push({ ...c, parent_id: pid }); }
      }
      putMany('accounts', newAccs);
      putMany('categories', newCats);
      putMany('transactions', txs.map(t => ({
        ...t,
        account_id: accMap.get(t.account_id)!,
        to_account_id: t.to_account_id ? accMap.get(t.to_account_id)! : null,
        category_id: t.category_id ? catMap.get(t.category_id)! : null,
      })));
    },
  };
}

/** Exports in the same CSV layout as 1Money so the file can be re-imported. */
export function exportCsv(): string {
  const s = getState();
  const me = s.user!.id;
  const accs = alive(s.accounts).filter(a => a.owner_id === me);
  const txs = alive(s.transactions).filter(t => t.owner_id === me && accs.some(a => a.id === t.account_id))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq));
  const accName = (id: string | null) => (id && s.accounts[id]?.name) || '';
  const catLabel = (id: string | null) => {
    const c = id ? s.categories[id] : null;
    if (!c) return '';
    const p = c.parent_id ? s.categories[c.parent_id] : null;
    return p ? `${p.name} (${c.name})` : c.name;
  };
  const T = { expense: 'Έξοδο', income: 'Έσοδο', transfer: 'Μεταφορά' };
  const d = (iso: string) => { const [y, m, day] = iso.split('-'); return `${Number(day)}/${Number(m)}/${y.slice(2)}`; };
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = ['ΗΜΕΡΟΜΗΝΙΑ,ΤΥΠΟΣ,ΑΠΟ ΤΟ ΛΟΓΑΡΙΑΣΜΟ,ΣΤΟΝ ΛΟΓΑΡΙΑΣΜΟ/ΣΕ ΚΑΤΗΓΟΡΙΑ,ΠΟΣΟ,NΟΜΙΣΜΑ,ΠΟΣΟ 2,NΟΜΙΣΜΑ 2,ΕΤΙΚΕΤΕΣ,ΣΗΜΕΙΩΣΕΙΣ'.split(',').map(q).join(',')];
  for (const t of txs) {
    const target = t.type === 'transfer' ? accName(t.to_account_id) : catLabel(t.category_id);
    lines.push([d(t.date), T[t.type], accName(t.account_id), target, t.amount, 'EUR', t.amount, 'EUR', '', t.note ?? ''].map(q).join(','));
  }
  lines.push(',', ',', ['ΟΝΟΜΑ', 'ΥΠΟΛΟΙΠΟ', 'NΟΜΙΣΜΑ'].map(q).join(','));
  const bal = computeBalances(accs, alive(s.transactions));
  for (const a of accs.filter(a => !a.archived)) lines.push([a.name, bal.get(a.id) ?? 0, 'EUR'].map(q).join(','));
  return '﻿' + lines.join('\n');
}
