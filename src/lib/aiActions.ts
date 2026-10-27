/**
 * Changes the AI may propose. Nothing is saved until you tap Apply on the card; then everything can be undone at once.
 * The AI names things in words ("Evening", "Σπίτι › Ενοίκιο", "Revolut"); the phone turns them into the real records.
 */
import { getState, put, remove, restore, setBudget, nextOccurrence } from './store';
import { alive, catName } from './calc';
import { fromISO, money, num, round2, todayISO, uuid } from './format';
import { norm, sameWord } from './quickparse';
import { rateAt, savePnl, shiftId, writeShift } from './tracker';
import { DAY_ALIASES, EVE_ALIASES } from './voice';
import { defaultAccount } from './voiceRun';
import type { Category, Freq, Job, Recurring, Strategy, Tx, TxType } from './types';

export const CHANGES_TOOL = {
  name: 'propose_changes',
  description: 'Prepare changes to his data. Nothing is saved until he taps Apply on the card the app shows, so never say it is done. Each change: '
    + 'add_shift / update_shift {job, dates[], hours?, bonus?, tips?, day_pay?} (update keeps what you do not give); remove_shift {job, dates[]}; '
    + 'add_transaction {type expense|income|transfer, amount, category ("Parent › Sub" or a name), account?, to_account? (transfer), date, note?, repeat? weekly|monthly|yearly, until?}; '
    + 'update_transaction {id, amount?, date?, category?, account?, note?}; delete_transaction {id} (ids come from query_transactions); '
    + 'set_budget {category, amount (null removes it)}; set_pnl {strategy, dates[], value (null clears)}. '
    + 'Work out the exact dates yourself (YYYY-MM-DD). If something cannot be matched the result says so — fix it or ask him.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'one short line describing the change' },
      changes: { type: 'array', items: { type: 'object' } },
    },
    required: ['changes'],
  },
};

type Raw = Record<string, unknown>;
export type Item =
  | { kind: 'shift'; jobId: string; date: string; hours: number | null; bonus: number | null; tips: number | null; base: number | null; label: string }
  | { kind: 'unshift'; jobId: string; date: string; label: string }
  | { kind: 'add_tx'; tx: Omit<Tx, 'id' | 'owner_id' | 'seq'>; repeat: Freq | null; until: string | null; label: string }
  | { kind: 'edit_tx'; id: string; patch: Partial<Tx>; label: string }
  | { kind: 'del_tx'; id: string; label: string }
  | { kind: 'budget'; categoryId: string; amount: number | null; label: string }
  | { kind: 'pnl'; strategyId: string; date: string; value: number | null; label: string };
export interface Proposal { summary: string; items: Item[]; status: 'pending' | 'applied' | 'cancelled' | 'undone' }

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const day = (d: string) => dayFmt.format(fromISO(d));
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(fromISO(d).getTime());
const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? round2(Number(v)) : null);
const words = (x: string) => norm(x).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v));

function findJob(name: unknown, jobs: Job[]): Job | null {
  const n = norm(String(name ?? ''));
  if (!n) return jobs.length === 1 ? jobs[0] : null;
  return jobs.find(j => norm(j.name) === n) ?? jobs.find(j => norm(j.name).includes(n) || n.includes(norm(j.name)))
    ?? jobs.find(j => (j.kind === 'daily' ? DAY_ALIASES : EVE_ALIASES).some(a => words(n).some(w => sameWord(w, a)))) ?? null;
}

/** "Σπίτι › Ενοίκιο", "Ενοίκιο", "Delivery" → one category, or an error naming the choices */
function findCategory(name: unknown, type: 'expense' | 'income' | null): { c: Category | null; err?: string } {
  const st = getState();
  const cats = alive(st.categories).filter(c => !c.archived && (!type || c.type === type));
  const raw = String(name ?? '').trim();
  if (!raw) return { c: null, err: 'no category given' };
  const [p, sub] = raw.split(/\s*(?:›|>|\/|·)\s*/);
  const eq = (c: Category, x: string) => norm(c.name).trim() === norm(x).trim();
  const near = (c: Category, x: string) => { const w = words(x); return w.length > 0 && w.every(a => words(c.name).some(b => sameWord(a, b))); };
  if (sub) {
    const parents = cats.filter(c => !c.parent_id && (eq(c, p) || near(c, p)));
    const hit = cats.filter(c => c.parent_id && parents.some(x => x.id === c.parent_id) && (eq(c, sub) || near(c, sub)));
    if (hit.length === 1) return { c: hit[0] };
    if (!hit.length && parents.length === 1) return { c: null, err: `no subcategory "${sub}" in ${parents[0].name}` };
  }
  let list = cats.filter(c => eq(c, raw));
  if (!list.length) list = cats.filter(c => near(c, raw));
  if (list.length === 1) return { c: list[0] };
  if (list.length > 1) {
    const tops = list.filter(c => !c.parent_id);
    if (tops.length === 1) return { c: tops[0] };
    return { c: null, err: `"${raw}" matches ${list.map(c => catName(c.id, st.categories)).join(' / ')} — say which` };
  }
  return { c: null, err: `no category "${raw}"` };
}

function findAccount(name: unknown): { id: string | null; err?: string } {
  const st = getState();
  const mine = alive(st.accounts).filter(a => a.owner_id === st.user?.id && !a.archived);
  const n = String(name ?? '').trim();
  if (!n) return { id: null };
  const hit = mine.filter(a => norm(a.name).trim() === norm(n)) .concat(mine.filter(a => words(n).every(w => words(a.name).some(x => sameWord(w, x)))));
  return hit[0] ? { id: hit[0].id } : { id: null, err: `no account "${n}"` };
}

function findStrategy(name: unknown, list: Strategy[]): Strategy | null {
  const n = norm(String(name ?? '')).replace(/[^\p{L}\p{N}]/gu, '');
  return list.find(s => norm(s.name).replace(/[^\p{L}\p{N}]/gu, '') === n)
    ?? list.find(s => norm(s.name).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(w => w[0]).join('') === n)
    ?? list.find(s => norm(s.name).replace(/[^\p{L}\p{N}]/gu, '').includes(n) && n.length >= 3) ?? null;
}

/** Turns what the AI asked for into exact records; anything it can't match comes back as an error for the AI to fix. */
export function resolveChanges(input: { summary?: string; changes?: Raw[] }): { proposal: Proposal; errors: string[] } {
  const st = getState();
  const jobs = alive(st.jobs).filter(j => !j.archived);
  const strategies = alive(st.strategies).filter(s => !s.archived);
  const items: Item[] = [];
  const errors: string[] = [];
  const dates = (c: Raw) => (Array.isArray(c.dates) ? c.dates : c.date ? [c.date] : []).filter(isDate) as string[];
  (input.changes ?? []).forEach((c, i) => {
    const where = `change ${i + 1} (${String(c.op)})`;
    switch (c.op) {
      case 'add_shift': case 'update_shift': {
        const job = findJob(c.job, jobs);
        if (!job) { errors.push(`${where}: no job "${String(c.job)}" (jobs: ${jobs.map(j => j.name).join(', ')})`); break; }
        const ds = dates(c);
        if (!ds.length) { errors.push(`${where}: no valid dates`); break; }
        for (const d of ds) {
          const prev = st.shifts[shiftId(job.id, d)];
          const has = prev && !prev.deleted_at;
          const hours = numOrNull(c.hours), bonus = numOrNull(c.bonus), tips = numOrNull(c.tips), base = numOrNull(c.day_pay);
          if (job.kind === 'hourly' && !hours && !has) { errors.push(`${where}: ${d} needs hours for ${job.name}`); continue; }
          const bits = job.kind === 'hourly'
            ? [hours != null ? `${num(hours)} h` : null, tips != null ? `tips ${money(tips)}` : null]
            : [base != null ? `day pay ${money(base)}` : null, bonus != null ? `bonus ${money(bonus)}` : null];
          items.push({ kind: 'shift', jobId: job.id, date: d, hours, bonus, tips, base, label: `${has ? 'Change' : 'Add'} shift · ${job.name} · ${day(d)}${bits.filter(Boolean).length ? ' · ' + bits.filter(Boolean).join(', ') : ''}` });
        }
        break;
      }
      case 'remove_shift': {
        const job = findJob(c.job, jobs);
        if (!job) { errors.push(`${where}: no job "${String(c.job)}"`); break; }
        for (const d of dates(c)) {
          const prev = st.shifts[shiftId(job.id, d)];
          if (!prev || prev.deleted_at) { errors.push(`${where}: no ${job.name} shift on ${d}`); continue; }
          items.push({ kind: 'unshift', jobId: job.id, date: d, label: `Remove shift · ${job.name} · ${day(d)}` });
        }
        break;
      }
      case 'add_transaction': {
        const type = (['expense', 'income', 'transfer'].includes(String(c.type)) ? c.type : 'expense') as TxType;
        const amount = numOrNull(c.amount);
        if (!amount || amount <= 0) { errors.push(`${where}: amount missing`); break; }
        const date = isDate(c.date) ? c.date : todayISO();
        const acc = findAccount(c.account);
        if (acc.err) { errors.push(`${where}: ${acc.err}`); break; }
        let category_id: string | null = null, to: string | null = null;
        if (type === 'transfer') {
          const t = findAccount(c.to_account);
          if (!t.id) { errors.push(`${where}: ${t.err ?? 'to_account missing'}`); break; }
          to = t.id;
        } else {
          const f = findCategory(c.category, type);
          if (!f.c) { errors.push(`${where}: ${f.err}`); break; }
          category_id = f.c.id;
        }
        const account_id = acc.id ?? defaultAccount(type, to);
        if (!account_id) { errors.push(`${where}: no account`); break; }
        const repeat = (['weekly', 'monthly', 'yearly'].includes(String(c.repeat)) ? c.repeat : null) as Freq | null;
        const until = isDate(c.until) ? c.until : null;
        const note = typeof c.note === 'string' && c.note.trim() ? c.note.trim() : null;
        const what = type === 'transfer' ? `${st.accounts[account_id]?.name} → ${st.accounts[to!]?.name}` : `${catName(category_id, st.categories)} · ${st.accounts[account_id]?.name}`;
        items.push({
          kind: 'add_tx', repeat, until,
          tx: { type, amount, date, account_id, to_account_id: to, category_id, note, recurring_id: null },
          label: `Add ${type} · ${what} · ${money(amount)} · ${day(date)}${note ? ` · "${note}"` : ''}${repeat ? ` · every ${repeat === 'monthly' ? 'month' : repeat === 'weekly' ? 'week' : 'year'}${until ? ` until ${day(until)}` : ''}` : ''}`,
        });
        break;
      }
      case 'update_transaction': {
        const t = st.transactions[String(c.id)];
        if (!t || t.deleted_at) { errors.push(`${where}: no transaction with id ${String(c.id)} — look it up first`); break; }
        if (t.owner_id !== st.user?.id) { errors.push(`${where}: that entry is his partner's; he can't change it`); break; }
        const patch: Partial<Tx> = {};
        const amount = numOrNull(c.amount); if (amount && amount > 0) patch.amount = amount;
        if (isDate(c.date)) patch.date = c.date;
        if (c.category && t.type !== 'transfer') { const f = findCategory(c.category, t.type as 'expense' | 'income'); if (!f.c) { errors.push(`${where}: ${f.err}`); break; } patch.category_id = f.c.id; }
        if (c.account) { const a = findAccount(c.account); if (!a.id) { errors.push(`${where}: ${a.err}`); break; } patch.account_id = a.id; }
        if (typeof c.note === 'string') patch.note = c.note.trim() || null;
        if (!Object.keys(patch).length) { errors.push(`${where}: nothing to change`); break; }
        const changes = [
          patch.amount != null ? `${money(t.amount)} → ${money(patch.amount)}` : null,
          patch.date ? `${day(t.date)} → ${day(patch.date)}` : null,
          patch.category_id ? `→ ${catName(patch.category_id, st.categories)}` : null,
          patch.account_id ? `→ ${st.accounts[patch.account_id]?.name}` : null,
          'note' in patch ? `note "${patch.note ?? ''}"` : null,
        ].filter(Boolean).join(', ');
        items.push({ kind: 'edit_tx', id: t.id, patch, label: `Change · ${catName(t.category_id, st.categories)} ${money(t.amount)} (${day(t.date)}): ${changes}` });
        break;
      }
      case 'delete_transaction': {
        const t = st.transactions[String(c.id)];
        if (!t || t.deleted_at) { errors.push(`${where}: no transaction with id ${String(c.id)} — look it up first`); break; }
        if (t.owner_id !== st.user?.id) { errors.push(`${where}: that entry is his partner's; he can't delete it`); break; }
        items.push({ kind: 'del_tx', id: t.id, label: `Delete · ${t.type === 'transfer' ? 'Transfer' : catName(t.category_id, st.categories)} ${money(t.amount)} · ${day(t.date)}${t.note ? ` · "${t.note}"` : ''}` });
        break;
      }
      case 'set_budget': {
        const f = findCategory(c.category, 'expense');
        if (!f.c) { errors.push(`${where}: ${f.err}`); break; }
        const amount = numOrNull(c.amount);
        items.push({ kind: 'budget', categoryId: f.c.id, amount: amount && amount > 0 ? amount : null, label: `Budget · ${catName(f.c.id, st.categories)} → ${amount && amount > 0 ? money(amount) + ' a month' : 'none'}` });
        break;
      }
      case 'set_pnl': {
        const s = findStrategy(c.strategy, strategies);
        if (!s) { errors.push(`${where}: no strategy "${String(c.strategy)}" (strategies: ${strategies.map(x => x.name).join(', ')})`); break; }
        const value = c.value === null ? null : numOrNull(c.value);
        for (const d of dates(c)) items.push({ kind: 'pnl', strategyId: s.id, date: d, value, label: `P&L · ${s.name} · ${day(d)} · ${value == null ? 'clear' : signed(value) + ' €'}` });
        break;
      }
      default: errors.push(`${where}: unknown change`);
    }
  });
  return { proposal: { summary: String(input.summary ?? ''), items, status: 'pending' }, errors };
}

/** Saves everything on the card. Returns one undo for all of it. */
export function applyProposal(p: Proposal): () => void {
  const st = getState();
  const undos: Array<() => void> = [];
  const me = st.user!.id;
  for (const it of p.items) {
    switch (it.kind) {
      case 'shift': {
        const job = getState().jobs[it.jobId];
        const prev = getState().shifts[shiftId(it.jobId, it.date)];
        const has = prev && !prev.deleted_at ? prev : null;
        const tipTx = has?.tips_tx_id ? getState().transactions[has.tips_tx_id] : null;
        const mine = alive(getState().accounts).filter(a => a.owner_id === me && !a.archived);
        undos.push(writeShift(job, it.date, {
          worked: true, hours: it.hours ?? has?.hours ?? 0,
          base: job.kind === 'daily' ? it.base ?? has?.base ?? rateAt(job, it.date).day ?? 0 : null,
          bonus: job.kind === 'daily' ? it.bonus ?? has?.bonus ?? 0 : null,
          tips: it.tips ?? (tipTx && !tipTx.deleted_at ? tipTx.amount : 0),
          tipsAccount: tipTx?.account_id ?? job.tips_account_id ?? mine.find(a => /μετρητ|cash/i.test(a.name))?.id ?? mine[0]?.id ?? null,
        }));
        break;
      }
      case 'unshift': {
        const job = getState().jobs[it.jobId];
        undos.push(writeShift(job, it.date, { worked: false, hours: 0, base: null, bonus: null, tips: 0, tipsAccount: null }));
        break;
      }
      case 'add_tx': {
        const id = uuid();
        const seq = Math.max(0, ...Object.values(getState().transactions).filter(t => t.date === it.tx.date && !t.deleted_at).map(t => t.seq)) + 1;
        let rule: Recurring | null = null;
        if (it.repeat) {
          const anchor = fromISO(it.tx.date).getDate();
          let next = nextOccurrence(it.tx.date, it.repeat, anchor);
          for (let i = 0; next <= todayISO() && i < 1000; i++) next = nextOccurrence(next, it.repeat, anchor);
          rule = { id: uuid(), owner_id: me, type: it.tx.type, amount: it.tx.amount, account_id: it.tx.account_id, to_account_id: it.tx.to_account_id, category_id: it.tx.category_id, note: it.tx.note, freq: it.repeat, anchor_day: anchor, next_date: next, active: true, end_date: it.until, skip_dates: [] };
          put('recurring', rule);
        }
        put('transactions', { ...it.tx, id, owner_id: me, seq, recurring_id: rule?.id ?? null });
        undos.push(() => { remove('transactions', id); if (rule) remove('recurring', rule.id); });
        break;
      }
      case 'edit_tx': {
        const before = getState().transactions[it.id];
        if (!before) break;
        put('transactions', { ...before, ...it.patch });
        undos.push(() => put('transactions', before));
        break;
      }
      case 'del_tx': {
        remove('transactions', it.id);
        undos.push(() => restore('transactions', it.id));
        break;
      }
      case 'budget': {
        const before = getState().prefs.budgets?.[it.categoryId] ?? null;
        setBudget(it.categoryId, it.amount);
        undos.push(() => setBudget(it.categoryId, before));
        break;
      }
      case 'pnl': {
        const prev = savePnl(it.strategyId, it.date, it.value);
        undos.push(() => { if (prev) put('pnl', prev); else savePnl(it.strategyId, it.date, null); });
        break;
      }
    }
  }
  return () => { for (const u of undos.reverse()) u(); };
}

