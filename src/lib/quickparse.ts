/**
 * Turns a short phrase ("delivery 12,50 χθες revolut", "tips 15", "από revolut σε μετρητά 50")
 * into the fields of a new transaction. No AI: it matches against your own accounts and categories.
 */
import { addDays, fromISO, round2, toISO } from './format';
import type { Account, Category, TxType } from './types';

export interface Parsed {
  type: TxType | null;
  amount: number | null;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  date: string | null;
  note: string;
  words: string[];          // descriptive words, used to learn corrections
}

export interface ParseCtx {
  accounts: Account[];                   // my visible accounts
  categories: Category[];                // visible categories (mine + shared)
  usage: Map<string, number>;            // category id → how often I used it lately
  learned: Record<string, string>;       // word → category id (from earlier corrections)
  today: string;
}

/** lower case, no accents, no punctuation around */
export const norm = (s: string) => s.toLocaleLowerCase('el').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ');
export const clean = (s: string) => norm(s).replace(/[^\p{L}\p{N}.,/+-]/gu, '');

const STOP = new Set(['το', 'τα', 'τον', 'την', 'τη', 'της', 'του', 'των', 'ο', 'η', 'οι', 'ενα', 'μια', 'για', 'σε', 'στο', 'στη', 'στην', 'στα', 'στον', 'στις', 'στουσ',
  'απο', 'απ', 'και', 'με', 'μεσω', 'ευρω', 'ευρο', 'euro', 'euros', 'eur', '€', 'λεπτα', 'σημερα', 'the', 'for', 'on', 'from', 'to', 'at', 'in', 'a']);
const PREP = new Set(['απο', 'απ', 'σε', 'στο', 'στη', 'στην', 'στον', 'με', 'μεσω', 'from', 'to', 'with']);
// exact words only (no stemming): "μεταφορά" must not catch "Μεταφορικά"
const INCOME = ['μπηκαν', 'μπηκε', 'εσοδο', 'εσοδα', 'πληρωθηκα', 'κερδισα', 'income', 'earned'];
const EXPENSE = ['εδωσα', 'πληρωσα', 'ξοδεψα', 'αγορασα', 'εξοδο', 'εξοδα', 'expense', 'spent', 'bought'];
const TRANSFER = ['μεταφορα', 'μεταφερα', 'μετεφερα', 'transfer', 'αναληψη', 'καταθεση'];
const FILLER = ['πηρα', 'got', 'paid', 'πληρωμη'];

export const NUMWORDS: Record<string, number> = {
  μηδεν: 0, δυο: 2, τρια: 3, τρεισ: 3, τεσσερα: 4, τεσσερισ: 4, πεντε: 5, εξι: 6, επτα: 7, εφτα: 7, οκτω: 8, οχτω: 8,
  εννια: 9, εννεα: 9, δεκα: 10, εντεκα: 11, δωδεκα: 12, δεκατρια: 13, δεκατεσσερα: 14, δεκαπεντε: 15, δεκαεξι: 16, δεκαεπτα: 17, δεκαεφτα: 17,
  δεκαοκτω: 18, δεκαοχτω: 18, δεκαεννια: 19, δεκαεννεα: 19, εικοσι: 20, τριαντα: 30, σαραντα: 40, πενηντα: 50, εξηντα: 60, εβδομηντα: 70,
  ογδοντα: 80, ενενηντα: 90, εκατο: 100, εκατον: 100, διακοσια: 200, τριακοσια: 300, τετρακοσια: 400, πεντακοσια: 500, χιλια: 1000, μισο: 0.5, μιση: 0.5,
};
export const MONTHS: Array<[string[], number]> = [
  [['ιαν', 'jan'], 0], [['φεβ', 'feb'], 1], [['μαρ', 'mar'], 2], [['απρ', 'apr'], 3], [['μαι', 'may'], 4], [['ιουν', 'jun'], 5],
  [['ιουλ', 'jul'], 6], [['αυγ', 'aug'], 7], [['σεπ', 'sep'], 8], [['οκτ', 'oct'], 9], [['νοε', 'nov'], 10], [['δεκ', 'dec'], 11],
];
const DAYS: Array<[string[], number]> = [
  [['κυριακη', 'sunday'], 0], [['δευτερα', 'monday'], 1], [['τριτη', 'tuesday'], 2], [['τεταρτη', 'wednesday'], 3],
  [['πεμπτη', 'thursday'], 4], [['παρασκευη', 'friday'], 5], [['σαββατο', 'saturday'], 6],
];

/** "καφεσ" ~ "καφε", "τσιγαρα" ~ "τσιγαρο": same word with a different Greek ending ("μετρο" is not "μετρητα") */
const ENDINGS = new Set(['', 'α', 'ε', 'η', 'ι', 'ο', 'υ', 'ω', 'ασ', 'εσ', 'ησ', 'ισ', 'οσ', 'υσ', 'ου', 'ων', 'ια', 'ιο', 'ιου', 'ιεσ', 'ιων', 'ουσ', 's', 'es']);
export function sameWord(a: string, b: string) {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 3) return false;
  for (let k = 0; k <= 2; k++) {
    const stem = s.slice(0, s.length - k);
    if (stem.length < 3) break;
    if (l.startsWith(stem) && ENDINGS.has(s.slice(stem.length)) && ENDINGS.has(l.slice(stem.length))) return true;
  }
  return false;
}

interface Tok { raw: string; n: string; used: boolean }

export function parseNumber(t: string): number | null {
  const s = t.replace(/€|ευρω|eur/g, '');
  if (!/^\d+([.,]\d+)*$/.test(s)) return null;
  // 1.200 / 1.200,50 → thousands; 3.5 / 3,5 → decimals
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return parseFloat(s.replace(',', '.'));
}

export function parseQuick(text: string, ctx: ParseCtx): Parsed {
  const toks: Tok[] = text.replace(/(\d)\s*€/g, '$1 €').replace(/(\d)([^\d\s.,/€-])/g, '$1 $2').split(/\s+/).filter(Boolean)
    .map(raw => ({ raw, n: clean(raw), used: false })).filter(t => t.n || t.raw === '€');
  const out: Parsed = { type: null, amount: null, accountId: null, toAccountId: null, categoryId: null, date: null, note: '', words: [] };
  const nt = (i: number) => toks[i]?.n ?? '';
  const phrase = (list: string[]) => {
    for (const p of list) {
      const w = p.split(' ');
      for (let i = 0; i + w.length <= toks.length; i++) {
        if (w.every((x, k) => nt(i + k) === x && !toks[i + k].used)) { for (let k = 0; k < w.length; k++) toks[i + k].used = true; return true; }
      }
    }
    return false;
  };

  // ---- type words
  if (phrase(TRANSFER)) out.type = 'transfer';
  else if (phrase(INCOME)) out.type = 'income';
  else if (phrase(EXPENSE)) out.type = 'expense';
  while (phrase(FILLER)) { /* consumed */ }

  // ---- date
  const today = ctx.today;
  const T = fromISO(today);
  for (let i = 0; i < toks.length && !out.date; i++) {
    const w = nt(i);
    if (toks[i].used) continue;
    const take = (d: string, n = 1) => { out.date = d; for (let k = 0; k < n; k++) toks[i + k].used = true; };
    if (w === 'σημερα' || w === 'today') take(today);
    else if (w === 'χθεσ' || w === 'yesterday') take(addDays(today, -1));
    else if (w === 'προχθεσ' || w === 'προχτεσ') take(addDays(today, -2));
    else if (w === 'αυριο' || w === 'tomorrow') take(addDays(today, 1));
    else if ((w === 'πριν' || w === 'before') && /^\d+$/.test(nt(i + 1)) && /^(μερ|ημερ|day)/.test(nt(i + 2))) take(addDays(today, -Number(nt(i + 1))), 3);
    else if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(w)) {
      const [d, m, y] = w.split('/').map(Number);
      take(toISO(new Date(y ? (y < 100 ? 2000 + y : y) : T.getFullYear(), m - 1, d)));
    } else {
      const day = DAYS.find(([names]) => names.some(n => sameWord(w, n)));
      if (day) { let d = today; for (let k = 0; k < 7 && fromISO(d).getDay() !== day[1]; k++) d = addDays(d, -1); take(d); continue; }
      // "15 οκτωβρίου" / "στις 15"
      if (/^\d{1,2}$/.test(w)) {
        const mon = MONTHS.find(([names]) => names.some(n => nt(i + 1).startsWith(n)));
        if (mon) { take(toISO(new Date(T.getFullYear(), mon[1], Number(w))), 2); continue; }
        if (nt(i - 1) === 'στισ' || nt(i - 1) === 'on') {
          const n = Number(w);
          let d = new Date(T.getFullYear(), T.getMonth(), n);
          if (toISO(d) > today) d = new Date(T.getFullYear(), T.getMonth() - 1, n);   // "στις 28" on the 3rd → last month
          toks[i - 1].used = true; take(toISO(d));
        }
      }
    }
  }

  // ---- amount
  const nums: Array<{ i: number; v: number; dec: boolean }> = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used) continue;
    const v = parseNumber(toks[i].n);
    if (v !== null) { nums.push({ i, v, dec: /[.,]/.test(toks[i].n) }); continue; }
    // number words: "είκοσι πέντε", "εκατόν είκοσι"
    if (NUMWORDS[toks[i].n] !== undefined) {
      let total = 0, j = i;
      while (j < toks.length && NUMWORDS[toks[j].n] !== undefined && !toks[j].used) { total += NUMWORDS[toks[j].n]; j++; }
      nums.push({ i, v: total, dec: total % 1 !== 0 });
      for (let k = i + 1; k < j; k++) toks[k].used = true, toks[k].n = '';
      i = j - 1;
    }
  }
  if (nums.length) {
    let amount = nums[0].v;
    toks[nums[0].i].used = true;
    for (let k = 1; k < nums.length; k++) {
      const prev = nums[k - 1], cur = nums[k];
      const between = toks.slice(prev.i + 1, cur.i).map(t => t.n).filter(Boolean);
      const isEuro = between.some(w => /^(ευρω|ευρο|euro|€)$/.test(w));
      const joined = between.filter(w => !/^(ευρω|ευρο|euro|€)$/.test(w));
      if (joined.length === 1 && (joined[0] === 'και' || joined[0] === 'and') || joined.length === 0 && isEuro) {
        // "3 και 50" / "12 ευρώ και 50 (λεπτά)" → decimals; "12 και 3,5" / "12 συν 3" → sum
        if (!prev.dec && !cur.dec && Number.isInteger(cur.v) && cur.v >= 1 && cur.v <= 99 && (isEuro || /^\d{2}$/.test(toks[cur.i].n) || cur.v >= 10) && k === 1)
          amount = amount + cur.v / 100;
        else amount += cur.v;
        toks.slice(prev.i + 1, cur.i).forEach(t => (t.used = true));
        toks[cur.i].used = true;
      } else if (joined.length === 1 && /^(συν|\+|plus)$/.test(joined[0])) {
        amount += cur.v; toks[cur.i].used = true; toks.slice(prev.i + 1, cur.i).forEach(t => (t.used = true));
      } else if (toks[prev.i].n.endsWith('+') || toks[cur.i].n.startsWith('+')) {
        amount += cur.v; toks[cur.i].used = true;
      } else break;
    }
    // "12+3" in one token
    out.amount = round2(amount);
  }
  for (const t of toks) if (/^(ευρω|ευρο|euro|eur|€|λεπτα)$/.test(t.n) || t.raw === '€') t.used = true;

  // ---- accounts and categories
  const accTokens = (a: Account) => norm(a.name).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
  const matchAt = (words: string[], from = 0, onlyAfterPrep = false): number => {
    if (!words.length) return -1;
    for (let i = from; i <= toks.length - 1; i++) {
      if (toks[i].used) continue;
      if (onlyAfterPrep && !PREP.has(nt(i - 1))) continue;
      if (sameWord(toks[i].n, words[0]) && words.every((w, k) => k === 0 || toks.slice(i + 1, i + 4).some(t => !t.used && sameWord(t.n, w)))) return i;
    }
    return -1;
  };
  const useWords = (start: number, words: string[]) => {
    toks[start].used = true;
    for (const w of words.slice(1)) { const t = toks.slice(start + 1, start + 4).find(x => !x.used && sameWord(x.n, w)); if (t) t.used = true; }
  };
  const findAccounts = (onlyAfterPrep: boolean) => {
    const hits: Array<{ a: Account; i: number }> = [];
    for (const a of ctx.accounts) {
      const w = accTokens(a);
      const i = matchAt(w, 0, onlyAfterPrep);
      if (i >= 0) hits.push({ a, i });
    }
    hits.sort((x, y) => x.i - y.i || accTokens(y.a).length - accTokens(x.a).length);
    const got: Array<{ a: Account; i: number }> = [];
    for (const h of hits) { if (got.some(g => g.a.id === h.a.id) || toks[h.i].used) continue; useWords(h.i, accTokens(h.a)); got.push(h); }
    return got;
  };
  const accHits = findAccounts(true);   // "από revolut", "σε μετρητά" — clearly accounts

  // categories: a word you corrected before wins; then the longest name match; usage breaks ties
  const byId = new Map(ctx.categories.map(c => [c.id, c]));
  const catWords = (c: Category) => norm(c.name).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
  const fits = (c: Category) => out.type !== 'transfer' && (!out.type || c.type === out.type);
  let cat: Category | null = null;
  for (const t of toks) {
    if (t.used || t.n.length < 3) continue;
    const c = byId.get(ctx.learned[t.n] ?? '');
    if (c && fits(c)) { cat = c; out.words.push(t.n); break; }
  }
  if (!cat) {
    const scored: Array<{ c: Category; score: number; use: number; at: number }> = [];
    // a word that is also one of your account names counts for the account
    const accountish = (n: string) => ctx.accounts.some(a => accTokens(a).some(w => sameWord(n, w)));
    for (const c of ctx.categories) {
      if (!fits(c)) continue;
      const words = catWords(c);
      const hits = words.map(w => toks.findIndex(t => !t.used && sameWord(t.n, w)));
      const matched = words.filter((_, k) => hits[k] >= 0);
      if (!matched.length) continue;
      const parent = c.parent_id ? byId.get(c.parent_id) : null;
      let score = matched.join('').length + (matched.length === words.length ? 10 : 0);    // "delivery" still finds "Delivery καφές"
      if (parent && catWords(parent).some(w => toks.some(t => !t.used && sameWord(t.n, w)))) score += 40;   // "σπίτι delivery" → that subcategory
      if (matched.every((_, k) => accountish(toks[hits.filter(h => h >= 0)[k]].n))) continue;   // "revolut" is the account, not Εφαρμογές › Revolut
      scored.push({ c, score, use: ctx.usage.get(c.id) ?? 0, at: Math.min(...hits.filter(h => h >= 0)) });
    }
    scored.sort((a, b) => b.score - a.score || b.use - a.use || Number(!!b.c.parent_id) - Number(!!a.c.parent_id));
    cat = scored[0]?.c ?? null;
    if (cat) {
      const parent = cat.parent_id ? byId.get(cat.parent_id) : null;
      for (const w of [...catWords(cat), ...(parent ? catWords(parent) : [])]) {
        const t = toks.find(x => !x.used && sameWord(x.n, w));
        if (t) { t.used = true; out.words.push(t.n); }
      }
    }
  }
  accHits.push(...findAccounts(false));
  accHits.sort((x, y) => x.i - y.i);

  if (accHits.length >= 2 && out.type !== 'income' && !cat) out.type = 'transfer';
  if (out.type === 'transfer') {
    const toIdx = accHits.findIndex(h => ['σε', 'στο', 'στη', 'στην', 'στον', 'to'].includes(nt(h.i - 1)));
    if (toIdx >= 0) { out.toAccountId = accHits[toIdx].a.id; out.accountId = accHits.find((_, k) => k !== toIdx)?.a.id ?? null; }
    else { out.accountId = accHits[0]?.a.id ?? null; out.toAccountId = accHits[1]?.a.id ?? null; }
  } else {
    out.accountId = accHits[0]?.a.id ?? null;
    if (cat) { out.categoryId = cat.id; out.type = out.type ?? cat.type; }
  }

  // ---- note: what's left, without filler words at the edges
  const rest = toks.filter(t => !t.used && t.n);
  // words to learn from a correction: the ones that picked the category, else the descriptive leftovers
  if (!out.words.length) out.words = [...new Set(rest.map(t => t.n).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w)))].slice(0, 2);
  const keep = rest.map(t => t.raw);
  while (keep.length && STOP.has(clean(keep[0])) && clean(keep[0]) !== 'με') keep.shift();
  while (keep.length && STOP.has(clean(keep[keep.length - 1]))) keep.pop();
  out.note = keep.join(' ');
  return out;
}

// ---------------------------------------------------------------- learning (per device)

const LEARN = 'money:learn';
export function loadLearned(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LEARN) ?? '{}'); } catch { return {}; }
}
export function learn(words: string[], categoryId: string) {
  if (!words.length) return;
  const m = loadLearned();
  for (const w of words) m[w] = categoryId;
  try { localStorage.setItem(LEARN, JSON.stringify(m)); } catch { /* ignore */ }
}
