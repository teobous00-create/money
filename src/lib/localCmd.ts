/**
 * Phrases the top mic handles on the phone, without the AI:
 *  - fixes to the last entry:  "σβήσε το τελευταίο", "το τελευταίο 5 όχι 3", "άλλαξε το τελευταίο σε delivery"
 *  - simple sums:              "πόσα καφέ αυτόν τον μήνα", "πόσα tips χθες", "πόσα έχω στο revolut"
 * Anything it isn't sure about returns false and goes to the AI as before.
 */
import { getState, put, remove, restore } from './store';
import { alive, catName, computeBalances } from './calc';
import { addDays, fromISO, money, shortDate, toISO, todayISO } from './format';
import { MONTHS, norm, parseQuick } from './quickparse';
import { isPending } from './txTime';
import { voiceCtxNow } from './voiceRun';
import { toast } from '../components/ui';
import type { Tx } from './types';

const toks = (text: string) => norm(text).split(/[^\p{L}\p{N},.]+/u).map(w => w.replace(/^[.,]+|[.,]+$/g, '')).filter(Boolean);
const LEAD = new Set(['ε', 'λοιπον', 'καλα', 'οκ', 'ok', 'ρε', 'και', 'πεσ', 'μου']);
// words that say nothing on their own
const FILLER = new Set(['το', 'τα', 'τον', 'την', 'τη', 'του', 'τησ', 'των', 'μου', 'μασ', 'αυτο', 'αυτον', 'αυτη', 'αυτην', 'εκεινο', 'ενα', 'μια', 'για', 'σε', 'στο', 'στη', 'στην', 'στον', 'στα',
  'απο', 'με', 'και', 'λεφτα', 'χρηματα', 'ευρω', 'συνολο', 'συνολικα', 'εχω', 'εχουμε', 'εγω', 'ηταν', 'ειναι', 'να', 'θα', 'ειχα', 'μεχρι', 'τωρα', 'ολα', 'ολο']);

/** my newest entry (added most recently, not by date) */
function lastTx(): Tx | null {
  const s = getState();
  const me = s.user?.id;
  let best: Tx | null = null, at = '';
  for (const t of alive(s.transactions)) {
    if (t.owner_id !== me || t.virtual) continue;
    const k = t.created_at ?? t.updated_at ?? '';
    if (k > at) { at = k; best = t; }
  }
  return best;
}
const describe = (t: Tx) => {
  const s = getState();
  const what = t.type === 'transfer' ? `${s.accounts[t.account_id]?.name} → ${s.accounts[t.to_account_id ?? '']?.name}` : catName(t.category_id, s.categories, false);
  return `${what} ${money(t.amount)}${t.date === todayISO() ? '' : ` · ${shortDate(t.date)}`}`;
};

// ---------------------------------------------------------------- 4. fix the last entry

const LAST = /^(τελευται\p{L}*|last)$/u;
const DEL = /^(σβησ\p{L}*|σβηνε|διεγραψ\p{L}*|διαγραψ\p{L}*|αφαιρεσ\p{L}*|ακυρωσ\p{L}*|delete|remove|undo)$/u;
const CHG = /^(αλλαξ\p{L}*|αλλαζε|διορθωσ\p{L}*|fix|change)$/u;
const NOT = /^(οχι|αντι|not)$/;

export function tryLocalEdit(text: string): boolean {
  const w = toks(text);
  let i = 0;
  while (i < w.length - 1 && LEAD.has(w[i])) i++;
  const ws = w.slice(i);
  const hasLast = ws.some(x => LAST.test(x));
  const del = ws.some(x => DEL.test(x));
  if (!hasLast && !(del && ws.every(x => DEL.test(x) || FILLER.has(x)))) return false;   // "σβήσε" alone = the last one too
  const t = lastTx();
  if (!t) { toast('Nothing to change yet'); return true; }

  if (del) {
    if (!ws.every(x => DEL.test(x) || LAST.test(x) || FILLER.has(x))) return false;   // "σβήσε τον καφέ των 3" → the AI
    remove('transactions', t.id);
    toast(`Deleted ${describe(t)}`, { label: 'Undo', run: () => restore('transactions', t.id) }, { ms: 6000 });
    return true;
  }

  // the rest says what changes; "όχι 3" / "αντί για 3" names the old value and is dropped
  const raw = text.split(/\s+/);
  const keep: string[] = [];
  for (let k = 0; k < raw.length; k++) {
    const n = norm(raw[k]).replace(/[^\p{L}\p{N}]/gu, '');
    if (NOT.test(n)) { k++; if (norm(raw[k] ?? '').replace(/[^\p{L}]/gu, '') === 'για') k++; continue; }
    if (LAST.test(n) || CHG.test(n) || LEAD.has(n) && keep.length === 0) continue;
    keep.push(raw[k]);
  }
  const p = parseQuick(keep.join(' '), voiceCtxNow());
  const next: Tx = { ...t };
  if (p.amount !== null && p.amount > 0) next.amount = p.amount;
  if (p.date) next.date = p.date;
  if (t.type !== 'transfer' && p.categoryId) {
    const c = getState().categories[p.categoryId];
    if (c) { next.category_id = c.id; next.type = c.type; }
  }
  if (p.accountId && t.type !== 'transfer') next.account_id = p.accountId;
  const changed = next.amount !== t.amount || next.date !== t.date || next.category_id !== t.category_id || next.account_id !== t.account_id;
  if (!changed) return false;   // nothing we could read → the AI
  put('transactions', next);
  toast(`Changed: ${describe(next)}`, { label: 'Undo', run: () => put('transactions', t) }, { ms: 6000 });
  return true;
}

// ---------------------------------------------------------------- 5. simple sums

const ASK = new Set(['ποσα', 'ποσο', 'ποσεσ', 'ποσουσ']);
const SPENT = /^(ξοδεψ\p{L}*|εδωσ\p{L}*|πληρωσ\p{L}*|χαλασ\p{L}*|spent)$/u;
const EARNED = /^(μπηκαν|μπηκε|εβγαλ\p{L}*|κερδισ\p{L}*|πηρα|εσοδα|earned)$/u;
const BAL = /^(εχω|μενουν|εμειναν|υπολοιπο|balance)$/;
const FULL_MONTHS = [/^(ιανουαρ|jan)/, /^(φεβρουαρ|feb)/, /^(μαρτ|mar)/, /^(απριλ|apr)/, /^(μαιο|μαιου|may)/, /^(ιουνι|jun)/, /^(ιουλι|jul)/, /^(αυγουστ|aug)/, /^(σεπτεμβρ|sep)/, /^(οκτωβρ|oct)/, /^(νοεμβρ|nov)/, /^(δεκεμβρ|dec)/];
const PAST = /^(προηγουμεν\p{L}*|περασμεν\p{L}*|last)$/u;

function period(ws: string[], used: Set<number>): { from: string; to: string; label: string } | null {
  const today = todayISO(), T = fromISO(today);
  const mark = (...ix: number[]) => ix.forEach(i => used.add(i));
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], past = PAST.test(ws[i - 1] ?? '');
    const pi = past ? [i - 1] : [];
    if (/^(εβδομαδα|βδομαδα|week)$/.test(w)) {
      const mon = addDays(today, -((T.getDay() + 6) % 7));
      mark(i, ...pi);
      return past ? { from: addDays(mon, -7), to: addDays(mon, -1), label: 'last week' } : { from: mon, to: today, label: 'this week' };
    }
    if (/^(μηνα|μηνασ|month)$/.test(w)) {
      mark(i, ...pi);
      if (past) { const a = new Date(T.getFullYear(), T.getMonth() - 1, 1); return { from: toISO(a), to: toISO(new Date(T.getFullYear(), T.getMonth(), 0)), label: 'last month' }; }
      return { from: toISO(new Date(T.getFullYear(), T.getMonth(), 1)), to: today, label: 'this month' };
    }
    if (/^(φετοσ|χρονο|χρονια|year)$/.test(w)) { mark(i, ...pi); return { from: `${T.getFullYear()}-01-01`, to: today, label: String(T.getFullYear()) }; }
    const m = FULL_MONTHS.findIndex(re => re.test(w));
    const mon = m >= 0 ? MONTHS[m] : undefined;
    if (mon) {
      mark(i);
      let y = T.getFullYear();
      if (mon[1] > T.getMonth()) y--;
      const a = new Date(y, mon[1], 1), b = new Date(y, mon[1] + 1, 0);
      return { from: toISO(a), to: toISO(b) < today ? toISO(b) : today, label: new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(a) };
    }
  }
  return null;
}

export function tryLocalAsk(text: string): boolean {
  const w = toks(text);
  let i = 0;
  while (i < w.length - 1 && LEAD.has(w[i])) i++;
  if (!ASK.has(w[i] ?? '')) return false;
  const ws = w.slice(i + 1);
  const used = new Set<number>();
  const spent = ws.findIndex(x => SPENT.test(x)), earned = ws.findIndex(x => EARNED.test(x));
  if (spent >= 0) used.add(spent);
  if (earned >= 0) used.add(earned);
  const per = period(ws, used);
  const rest = ws.filter((_, k) => !used.has(k)).join(' ');
  const ctx = voiceCtxNow();
  const p = parseQuick(rest, ctx);
  // words we didn't understand → a real question for the AI
  const left = p.note ? norm(p.note).split(/[^\p{L}\p{N}]+/u).filter(x => x && !FILLER.has(x) && !BAL.test(x)) : [];
  if (left.length || p.amount !== null) return false;

  const s = getState();
  const me = s.user?.id;
  const today = todayISO();
  const mine = alive(s.transactions).filter(t => t.owner_id === me);

  // "πόσα έχω (στο revolut)" → balance
  if (spent < 0 && earned < 0 && !p.categoryId && ws.some(x => BAL.test(x))) {
    const accs = alive(s.accounts).filter(a => a.owner_id === me && !a.archived);
    const bal = computeBalances(accs, alive(s.transactions), today);
    if (p.accountId) { toast(`${s.accounts[p.accountId]?.name}: ${money(bal.get(p.accountId) ?? 0)}`, undefined, { ms: 8000 }); return true; }
    const sel = accs.filter(a => a.kind !== 'savings');
    toast(`${sel.length} accounts: ${money(sel.reduce((x, a) => x + (bal.get(a.id) ?? 0), 0))}`, undefined, { ms: 8000 });
    return true;
  }

  const cat = p.categoryId ? s.categories[p.categoryId] : null;
  const type = earned >= 0 ? 'income' : spent >= 0 ? 'expense' : cat?.type ?? 'expense';
  const ids = cat ? new Set([cat.id, ...Object.values(s.categories).filter(c => c.parent_id === cat.id).map(c => c.id)]) : null;
  const range = per ?? (p.date ? { from: p.date, to: p.date, label: p.date === today ? 'today' : p.date === addDays(today, -1) ? 'yesterday' : shortDate(p.date) }
    : { from: toISO(new Date(fromISO(today).getFullYear(), fromISO(today).getMonth(), 1)), to: today, label: 'this month' });
  const list = mine.filter(t => t.type === type && t.date >= range.from && t.date <= range.to && !isPending(t, today)
    && (!ids || (t.category_id && ids.has(t.category_id))) && (!p.accountId || t.account_id === p.accountId));
  const total = list.reduce((x, t) => x + t.amount, 0);
  const what = cat ? catName(cat.id, s.categories, false) : type === 'income' ? 'Income' : 'Spent';
  const acc = p.accountId ? ` · ${s.accounts[p.accountId]?.name}` : '';
  toast(`${what}${acc} · ${range.label}: ${money(total)}${list.length ? ` · ${list.length}×` : ''}`, undefined, { ms: 9000 });
  return true;
}
