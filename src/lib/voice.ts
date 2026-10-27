/**
 * Voice/typed commands (no AI). One phrase can be:
 *  - a shift:     "απογευματινή 6 ώρες tips 25", "πρωινή bonus 18", "χθες βράδυ 7 και μισή ώρες"
 *  - a P&L:       "deep dip gold μείον 12,40", "DDG συν 8"
 *  - a payment:   "πληρώθηκα από την απογευματινή 320", "πρωινή μισθός 500 bonus 206"
 *  - entries:     "netflix 12,49 κάθε μήνα", "καφές 3, supermarket 20 και τσιγάρα 5,5"
 */
import { fromISO, round2, toISO } from './format';
import { NUMWORDS, MONTHS, clean, norm, parseNumber, parseQuick, sameWord, type ParseCtx, type Parsed } from './quickparse';
import type { Freq, Job, Strategy } from './types';

export interface VoiceCtx extends ParseCtx { jobs: Job[]; strategies: Strategy[]; hasShift?: (jobId: string, date: string) => boolean }

export type Cmd =
  | { kind: 'tx'; p: Parsed; repeat: Freq | null; until: string | null }
  | { kind: 'shift'; job: Job; date: string; hours: number | null; tips: number | null; bonus: number | null; base: number | null }
  | { kind: 'pnl'; strategy: Strategy; date: string; value: number | null }
  | { kind: 'payout'; job: Job; date: string; amount: number | null; bonus: number | null };

const words = (text: string) => text.split(/\s+/).filter(Boolean).map(raw => ({ raw, n: clean(raw) }));

// how you call each job ("πρωινή" → the day-rate job, "απογευματινή / βράδυ" → the hourly one)
export const DAY_ALIASES = ['πρωινη', 'πρωινο', 'πρωι', 'morning'];
export const EVE_ALIASES = ['απογευματινη', 'απογευματινο', 'απογευμα', 'βραδινη', 'βραδινο', 'βραδυ', 'evening', 'night'];
const PAY_WORDS = ['πληρωθηκα', 'πληρωθηκε', 'πληρωμη', 'μισθοσ', 'μισθο', 'μισθου', 'salary', 'payday', 'πληρωσαν'];
const SHIFT_WORDS = ['βαρδια', 'βαρδιεσ', 'δουλεψα', 'shift', 'worked'];
const HOURS = /^(ωρα|ωρεσ|ωρων|h|hours?|ωρ)$/;
const TIPS = /^(tips?|φιλοδωρ\p{L}*|τιπσ)$/u;
const BONUS = /^(bonus|μπονουσ|μπονου|επαφεσ|επαφη|επαφων|contacts?)$/;   // contacts count as the morning bonus
const BASE = /^(μεροκαματο|βασικο|day)$/;
const SALARY = /^(μισθοσ|μισθο|μισθου|salary)$/;
const NEG = /^(μειον|πλην|minus|χασαμε|εχασα|χασα|χασιμο|ζημια|loss|lost)$/;
const POS = /^(συν|plus|κερδοσ|κερδισα|κερδισε|profit|won)$/;

function jobRef(ws: Array<{ n: string }>, jobs: Job[]): { job: Job; at: number } | null {
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i].n;
    for (const j of jobs) {
      const name = norm(j.name).split(/\s+/);
      const aliases = j.kind === 'daily' ? DAY_ALIASES : EVE_ALIASES;
      if (name.some(x => x.length >= 3 && sameWord(w, x)) || aliases.some(a => sameWord(w, a))) return { job: j, at: i };
    }
  }
  return null;
}

/** numbers in the phrase, each with the label right before or after it ("6 ώρες", "tips 25", "έξι και μισή ώρες") */
function labelled(ws: Array<{ n: string }>) {
  const nums: Array<{ i: number; end: number; v: number; sign: number }> = [];
  for (let i = 0; i < ws.length; i++) {
    let v = parseNumber(ws[i].n.replace(/^[+-]/, ''));
    let end = i;
    if (v === null && NUMWORDS[ws[i].n] !== undefined) {
      v = 0;
      while (end < ws.length && NUMWORDS[ws[end].n] !== undefined) v += NUMWORDS[ws[end++].n];
      end--;
    }
    if (v === null) continue;
    // "6 και μισή", "12 και 50" (cents)
    if (ws[end + 1]?.n === 'και' && (ws[end + 2]?.n === 'μιση' || ws[end + 2]?.n === 'μισο')) { v += 0.5; end += 2; }
    else if (ws[end + 1]?.n === 'και' && /^\d{2}$/.test(ws[end + 2]?.n ?? '') && Number.isInteger(v)) { v += Number(ws[end + 2].n) / 100; end += 2; }
    const sign = ws[i].n.startsWith('-') || NEG.test(ws[i - 1]?.n ?? '') ? -1 : 1;
    nums.push({ i, end, v: round2(v), sign });
    i = end;
  }
  // a label right before the number wins ("μισθός 500 bonus 206", "tips 25"); then one right after ("6 ώρες", "25 tips")
  const kindOf = (w: string) => HOURS.test(w) ? 'hours' : TIPS.test(w) ? 'tips' : BONUS.test(w) ? 'bonus' : BASE.test(w) ? 'base' : SALARY.test(w) ? 'salary' : null;
  const skipEuro = (k: number, dir: number) => (/^(ευρω|€)$/.test(ws[k]?.n ?? '') ? k + dir : k);
  const labels = new Map<number, string>();
  const usedWord = new Set<number>();
  for (const n of nums) {
    const b = skipEuro(n.i - 1, -1);
    const k = kindOf(ws[b]?.n ?? '');
    if (k) { labels.set(n.i, k); usedWord.add(b); }
  }
  for (const n of nums) {
    if (labels.has(n.i)) continue;
    const a = skipEuro(n.end + 1, 1);
    const k = kindOf(ws[a]?.n ?? '');
    if (k && !usedWord.has(a)) { labels.set(n.i, k); usedWord.add(a); }
  }
  const label = (n: { i: number }) => labels.get(n.i) ?? null;
  return nums.map(n => ({ ...n, label: label(n) }));
}

const has = (ws: Array<{ n: string }>, list: string[]) => ws.some(w => list.includes(w.n));
const dateOf = (text: string, ctx: VoiceCtx) => parseQuick(text, ctx).date ?? ctx.today;

/** strip "κάθε μήνα", "μέχρι Ιούνιο" etc.; returns the rest and the repeat */
function takeRepeat(text: string, today: string): { rest: string; repeat: Freq | null; until: string | null } {
  const ws = words(text);
  const drop = new Set<number>();
  let repeat: Freq | null = null, until: string | null = null;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i].n, nx = ws[i + 1]?.n ?? '';
    const freqOf = (x: string): Freq | null => /^(μηνα|μηνασ|month)$/.test(x) ? 'monthly' : /^(εβδομαδα|βδομαδα|week)$/.test(x) ? 'weekly' : /^(χρονο|ετοσ|χρονια|year)$/.test(x) ? 'yearly' : null;
    if ((w === 'καθε' || w === 'every') && freqOf(nx)) { repeat = freqOf(nx); drop.add(i); drop.add(i + 1); }
    else if (/^(μηνιαια|μηνιαιο|μηνιαιωσ|monthly)$/.test(w)) { repeat = 'monthly'; drop.add(i); }
    else if (/^(εβδομαδιαια|εβδομαδιαιο|weekly)$/.test(w)) { repeat = 'weekly'; drop.add(i); }
    else if (/^(ετησια|ετησιο|yearly)$/.test(w)) { repeat = 'yearly'; drop.add(i); }
    else if (/^(μεχρι|εωσ|until)$/.test(w)) {
      const T = fromISO(today);
      if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(nx)) {
        const [d, m, y] = nx.split('/').map(Number);
        until = toISO(new Date(y ? (y < 100 ? 2000 + y : y) : T.getFullYear(), m - 1, d));
        drop.add(i); drop.add(i + 1);
      } else {
        const mon = MONTHS.find(([names]) => names.some(n => nx.startsWith(n)));
        if (mon) {
          const yr = /^\d{4}$/.test(ws[i + 2]?.n ?? '') ? Number(ws[i + 2].n) : null;
          let end = new Date(yr ?? T.getFullYear(), mon[1] + 1, 0);
          if (!yr && toISO(end) < today) end = new Date(T.getFullYear() + 1, mon[1] + 1, 0);   // "μέχρι Ιούνιο" in October → next June
          until = toISO(end);
          drop.add(i); drop.add(i + 1); if (yr) drop.add(i + 2);
        }
      }
    }
  }
  return { rest: ws.filter((_, i) => !drop.has(i)).map(w => w.raw).join(' '), repeat: until && !repeat ? 'monthly' : repeat, until };
}

/** "καφές 3, supermarket 20 και τσιγάρα 5,5" → three phrases. "πέντε και πενήντα" stays one. */
function splitEntries(text: string, ctx: VoiceCtx): string[] {
  const parts = text.split(/\s*;\s*|(?<!\d),\s*|,(?!\d)\s*|\s+και μετά\s+|\s+(?=και\s)/i).filter(Boolean);
  // re-join the "και …" pieces that don't start a new entry
  const out: string[] = [];
  for (const part of parts) {
    const isAnd = /^και\s/i.test(part);
    const body = isAnd ? part.replace(/^και\s+/i, '') : part;
    if (isAnd && out.length) {
      const q = parseQuick(body, ctx);
      const prev = parseQuick(out[out.length - 1], ctx);
      if (!(q.amount !== null && q.categoryId && prev.amount !== null)) { out[out.length - 1] += ' ' + part; continue; }
    }
    out.push(body);
  }
  return out.filter(s => s.trim());
}

export function interpret(text: string, ctx: VoiceCtx): Cmd[] {
  const ws = words(text);
  const date = () => dateOf(text, ctx);

  // ---- payment: "πληρώθηκα … απογευματινή 320" (also by the job's salary category name, e.g. "cake & roll")
  if (has(ws, PAY_WORDS)) {
    let ref = jobRef(ws, ctx.jobs);
    if (!ref) {
      const byCat = ctx.jobs.find(j => {
        const c = ctx.categories.find(x => x.id === j.salary_category_id);
        const cw = c ? norm(c.name).split(/[^\p{L}\p{N}]+/u).filter(x => x.length >= 3) : [];
        return cw.length > 0 && cw.every(x => ws.some(w => sameWord(w.n, x)));
      });
      if (byCat) ref = { job: byCat, at: -1 };
    }
    if (ref) {
      const nums = labelled(ws);
      const bonus = nums.find(n => n.label === 'bonus')?.v ?? null;
      const amount = nums.find(n => n.label === 'salary')?.v ?? nums.find(n => n.label === null)?.v ?? null;
      return [{ kind: 'payout', job: ref.job, date: date(), amount, bonus }];
    }
  }

  // ---- shift: a job is named, or shift words with hours/tips/bonus
  const ref = jobRef(ws, ctx.jobs);
  const nums = labelled(ws);
  const labelledNum = nums.some(n => n.label !== null);
  // "καφές το πρωί 2" is a coffee, not a shift: a job word only counts with shift words, labelled numbers, or no category
  // "3€ bonus σήμερα", "6 ώρες": work words alone are enough; "tips 25" alone only adds to a shift already logged that day
  const onlyOf = (kind: Job['kind']) => { const of = ctx.jobs.filter(j => j.kind === kind); return of.length === 1 ? of[0] : null; };
  const workLabel = nums.some(n => n.label === 'bonus' || n.label === 'hours' || n.label === 'base');
  const eve = onlyOf('hourly');
  const tipsToShift = nums.some(n => n.label === 'tips') && !!eve && !!ctx.hasShift?.(eve.id, date());
  const shiftish = (ref && (has(ws, SHIFT_WORDS) || labelledNum || !parseQuick(text, ctx).categoryId))
    || (has(ws, SHIFT_WORDS) && labelledNum) || workLabel || tipsToShift;
  if (shiftish) {
    let job = ref?.job ?? null;
    if (!job) job = onlyOf(nums.some(n => n.label === 'bonus' || n.label === 'base') ? 'daily' : 'hourly');
    if (job) {
      const hours = nums.find(n => n.label === 'hours')?.v ?? (job.kind === 'hourly' ? nums.find(n => n.label === null)?.v ?? null : null);
      return [{
        kind: 'shift', job, date: date(), hours,
        tips: nums.find(n => n.label === 'tips')?.v ?? null,
        bonus: nums.find(n => n.label === 'bonus')?.v ?? null,
        base: nums.find(n => n.label === 'base')?.v ?? null,
      }];
    }
  }

  // ---- P&L: a strategy's name or initials ("DDG")
  for (const s of ctx.strategies) {
    const nw = norm(s.name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const initials = nw.map(x => x[0]).join('');
    const compact = norm(s.name).replace(/[^\p{L}\p{N}]/gu, '');
    let hit = -1, len = 0;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i].n.replace(/[^\p{L}\p{N}]/gu, '');
      if (!w) continue;
      if ((initials.length >= 2 && w === initials) || (compact.length >= 3 && (w === compact || compact.startsWith(w) && w.length >= 4 && nw.length === 1))) { hit = i; len = 1; break; }
      if (nw.length > 1 && nw.every((x, k) => sameWord(ws[i + k]?.n ?? '', x) || (ws[i + k]?.n ?? '') === x)) { hit = i; len = nw.length; break; }
    }
    if (hit < 0) continue;
    const rest = ws.filter((_, i) => i < hit || i >= hit + len);
    const n = labelled(rest).find(x => x.label === null);
    let sign = n?.sign ?? 1;
    if (rest.some(w => NEG.test(w.n))) sign = -1;
    else if (rest.some(w => POS.test(w.n))) sign = 1;
    return [{ kind: 'pnl', strategy: s, date: date(), value: n ? round2(n.v * sign) : null }];
  }

  // ---- entries (one or more), each possibly repeating
  const { rest, repeat, until } = takeRepeat(text, ctx.today);
  const pieces = repeat ? [rest] : splitEntries(rest, ctx);
  const parsed = pieces.map(t => parseQuick(t, ctx));
  // one date for all ("χθες καφές 3, supermarket 20")
  const dates = [...new Set(parsed.map(p => p.date).filter(Boolean))];
  if (dates.length === 1) for (const p of parsed) p.date = p.date ?? dates[0];
  return parsed.map(p => ({ kind: 'tx', p, repeat, until }));
}

/** Can it be saved as it is, without asking? */
export function complete(c: Cmd): boolean {
  if (c.kind === 'tx') return (c.p.amount ?? 0) > 0 && (c.p.type === 'transfer' ? !!c.p.toAccountId : !!c.p.categoryId);
  if (c.kind === 'shift') return c.job.kind === 'daily' || (c.hours ?? 0) > 0 || (c.tips ?? 0) > 0;
  if (c.kind === 'pnl') return c.value !== null;
  return true; // payout: no amount = what's owed for that period
}

