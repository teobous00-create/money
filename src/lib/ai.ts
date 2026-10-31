/**
 * Claude inside the app: a chat that knows your numbers, and a written review per month.
 * The phone builds a summary (never every transaction); when Claude needs a specific number it asks the
 * phone to compute it (query tool), so the figures always come from your data.
 */
import { getState, type State } from './store';
import { supabase, REMOTE } from './supabase';
import { alive, computeBalances, catName } from './calc';
import { addDays, fromISO, round2, toISO, todayISO } from './format';
import { norm, sameWord } from './quickparse';
import { isQuestion } from './voice';
import { payPeriods, rateAt, shiftParts, shiftPay, monthBonus, contactRule, contactsOf } from './tracker';
import { chatDetail } from './aiFacts';
import { CHANGES_TOOL, resolveChanges, type Proposal } from './aiActions';
import type { Category, Tx } from './types';

// ---------------------------------------------------------------- transport

export type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: 'tool_result'; tool_use_id: string; content: string };
export interface ApiMsg { role: 'user' | 'assistant'; content: string | Block[] }
interface ApiReply { content: Block[]; stop_reason: string; remaining?: number }

export class AiError extends Error {
  constructor(public code: 'not_setup' | 'no_function' | 'no_key' | 'jwt' | 'unreachable' | 'limit' | 'not_allowed' | 'offline' | 'claude' | 'other', msg = '') { super(msg || code); }
}

type Mock = (body: unknown) => Promise<ApiReply>;
let lastRemaining: number | null = null;
export const aiRemaining = () => lastRemaining;

/** Your account has no daily limit: the app zeroes your own usage counter so the server's 60 never kicks in. */
const isTeo = () => !!getState().prefs.analytics;
async function resetUsage() {
  const st = getState();
  if (!supabase || !st.user) return;
  const { data } = await supabase.from('user_prefs').select('prefs').eq('user_id', st.user.id).maybeSingle();
  const prefs = (data?.prefs ?? {}) as Record<string, unknown>;
  const u = prefs.aiUsage as { count?: number } | undefined;
  if (!u || (u.count ?? 0) === 0) return;
  await supabase.from('user_prefs').update({ prefs: { ...prefs, aiUsage: { day: todayISO(), count: 0 } } }).eq('user_id', st.user.id);
}

type Tier = 'ask' | 'act';   // the server answers questions with Opus, everything else with Sonnet
async function callAI(body: { system: unknown; messages: ApiMsg[]; tools?: unknown; tier?: Tier }, retry = true): Promise<ApiReply> {
  try {
    const r = await callOnce(body);
    if (isTeo()) { lastRemaining = null; if (r.remaining != null && r.remaining <= 20) void resetUsage().catch(() => {}); }
    return r;
  } catch (e) {
    if (retry && isTeo() && e instanceof AiError && e.code === 'limit') { await resetUsage(); lastRemaining = null; return callAI(body, false); }
    throw e;
  }
}

async function callOnce(body: { system: unknown; messages: ApiMsg[]; tools?: unknown; tier?: Tier }): Promise<ApiReply> {
  const mock = (window as unknown as { __aiMock?: Mock }).__aiMock;
  if (mock) { const r = await mock(body); if (typeof r.remaining === 'number') lastRemaining = r.remaining; return r; }
  if (!REMOTE || !supabase) throw new AiError('not_setup');
  if (!navigator.onLine) throw new AiError('offline');
  const { data, error } = await supabase.functions.invoke('ai', { body });
  if (error) {
    // say exactly which setup step is missing
    const ctxRes = (error as { context?: Response }).context;
    const status = ctxRes?.status ?? 0;
    let info: { error?: string; message?: string; msg?: string; code?: string } = {};
    try { info = await ctxRes?.clone().json(); } catch { /* not json */ }
    if (info.error === 'limit') { lastRemaining = 0; throw new AiError('limit'); }
    if (info.error === 'not_allowed') throw new AiError('not_allowed');
    if (info.error === 'claude') throw new AiError('claude', info.message);
    if (info.error === 'no_key') throw new AiError('no_key');
    if (info.error === 'auth' || status === 401) throw new AiError('jwt', info.message ?? info.msg ?? '');
    if (status === 404) throw new AiError('no_function');
    if (error.name === 'FunctionsFetchError' || /Failed to send/i.test(String(error.message))) throw new AiError('unreachable');
    throw new AiError('other', `${status || ''} ${info.message ?? info.msg ?? info.error ?? error.message}`.trim());
  }
  const r = data as ApiReply;
  if (typeof r.remaining === 'number') lastRemaining = r.remaining;
  return r;
}

export function aiErrorText(e: unknown): string {
  const code = e instanceof AiError ? e.code : 'other';
  if (code === 'not_setup') return 'The AI isn’t set up yet (Edge Function + key in Supabase).';
  if (code === 'no_function') return 'Supabase has no Edge Function named “ai” yet — deploy it (step 2).';
  if (code === 'no_key') return 'The “ai” function is there, but the key is missing: add ANTHROPIC_API_KEY in Edge Function Secrets (step 3).';
  if (code === 'jwt') return 'The “ai” function refused the login: turn OFF “Verify JWT” in its settings, then try again.';
  if (code === 'unreachable') return 'Can’t reach the “ai” function — it may not be deployed, or the pasted code has an error. Deploy it again (step 2).';
  if (code === 'limit') return 'You’ve used today’s AI messages. It resets tomorrow.';
  if (code === 'not_allowed') return 'The AI isn’t on for this account.';
  if (code === 'offline') return 'No connection right now.';
  if (code === 'claude') return `Claude couldn’t answer: ${(e as AiError).message || 'try again'}`;
  return `Something went wrong${(e as Error)?.message ? ` (${(e as Error).message})` : ''} — try again.`;
}

// ---------------------------------------------------------------- summary of your money (what Claude sees)

const ym = (d: string) => d.slice(0, 7);
const monthStart = (d: string) => d.slice(0, 7) + '-01';
const monthEnd = (d: string) => { const x = fromISO(monthStart(d)); return toISO(new Date(x.getFullYear(), x.getMonth() + 1, 0)); };
const addMonths = (d: string, n: number) => { const x = fromISO(monthStart(d)); return toISO(new Date(x.getFullYear(), x.getMonth() + n, 1)); };
const r2 = (n: number) => round2(n);
const topOf = (id: string | null, cats: Record<string, Category>) => (id ? cats[id]?.parent_id ?? id : 'none');

/** My live transactions (and my partner's in shared categories), not planned. */
function liveTxs(s: State) {
  return alive(s.transactions).filter(t => !s.accounts[t.account_id]?.deleted_at);
}

export function buildSnapshot(s: State = getState(), today = todayISO()): string {
  const me = s.user?.id ?? '';
  const cats = s.categories;
  const txs = liveTxs(s);
  const mine = txs.filter(t => t.owner_id === me);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(today, -5 + i));   // work + trading detail
  const L: string[] = [];
  const name = s.profiles[me]?.display_name || 'Teo';
  L.push(`Today: ${today} (${new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(fromISO(today))}). User: ${name}. Currency EUR.`);

  const accs = alive(s.accounts).filter(a => a.owner_id === me && !a.archived);
  const bal = computeBalances(accs, mine, today);
  L.push('', 'ACCOUNTS (balance now): ' + accs.map(a => `${a.name}${a.kind === 'savings' ? ' [savings]' : ''} ${r2(bal.get(a.id) ?? 0)}`).join(' | '));

  L.push('', chatDetail(s, today));

  // budgets this month
  const budgets = s.prefs.budgets ?? {};
  const shared = new Set([...s.members.map(m => m.category_id), ...Object.values(cats).filter(c => !c.parent_id && c.owner_id !== me).map(c => c.id)]);
  const mStart = monthStart(today);
  const spentIn = (id: string, everyone: boolean) => r2(txs.filter(t => t.type === 'expense' && t.date >= mStart && t.date <= today && (t.category_id === id || cats[t.category_id ?? '']?.parent_id === id) && (everyone || t.owner_id === me)).reduce((x, t) => x + t.amount, 0));
  const bl = Object.entries(budgets).filter(([id]) => cats[id] && !cats[id].deleted_at).map(([id, lim]) => {
    const joint = shared.has(cats[id].parent_id ?? id);
    return `${catName(id, cats)} ${spentIn(id, joint)}/${lim}${joint ? ' (joint: both people count)' : ''}`;
  });
  if (bl.length) L.push('', `BUDGETS this month (spent/limit): ${bl.join(' | ')}`);

  // shared categories: partner's part this month
  if (shared.size) {
    const parts = [...shared].filter(id => cats[id] && !cats[id].deleted_at).map(id => {
      const theirs = r2(txs.filter(t => t.owner_id !== me && t.type === 'expense' && t.date >= mStart && t.date <= today && topOf(t.category_id, cats) === id).reduce((x, t) => x + t.amount, 0));
      return `${cats[id].name}: partner paid ${theirs} this month`;
    });
    L.push('', `SHARED CATEGORIES (with the partner; the user's totals above are only their own part): ${parts.join(' | ')}`);
  }

  // recurring
  const rec = alive(s.recurring).filter(r => r.owner_id === me && r.active && (!r.end_date || r.end_date >= today));
  if (rec.length) L.push('', 'RECURRING: ' + rec.map(r => `${r.note || catName(r.category_id, cats)} ${r.amount} ${r.freq}${r.type === 'income' ? ' (income)' : ''}`).join(' | '));

  // work
  const jobs = alive(s.jobs).filter(j => !j.archived);
  if (jobs.length && s.prefs.analytics) {
    L.push('', 'WORK (logged shifts; earned = pay before tips):');
    const shifts = alive(s.shifts);
    for (const j of jobs) {
      const r = rateAt(j, today);
      L.push(`${j.name}: ${j.kind === 'daily' ? `day rate ${r.day ?? '?'} + sales bonus` : `hourly ${r.hour ?? '?'}/h + tips`}, paid ${j.pay === 'monthly' ? 'monthly' : '1–15 and 16–end'}`);
      for (const m of months) {
        const e = monthEnd(m);
        const sh = shifts.filter(x => x.job_id === j.id && x.date >= m && x.date <= e && x.date <= today);
        if (!sh.length) continue;
        const hours = r2(sh.reduce((x, y) => x + (y.hours ?? 0), 0));
        const earned = r2(sh.reduce((x, y) => x + shiftPay(j, y), 0));
        const bonus = r2(sh.reduce((x, y) => x + shiftParts(j, y).bonus, 0));
        const tips = j.tips_category_id ? r2(mine.filter(t => t.type === 'income' && t.category_id === j.tips_category_id && t.date >= m && t.date <= e && t.date <= today).reduce((x, t) => x + t.amount, 0)) : 0;
        const mb = monthBonus(j, shifts, m, today);
        if (mb) L.push(`  ${ym(m)}: contacts ${mb.contacts} over ${mb.worked} days (avg ${mb.avg}; target ${mb.min}/day → ${mb.over ? `bonus ${mb.bonus}` : mb.met ? `on track, bonus ${mb.bonus} so far` : `below target, bonus 0 so far`}${mb.planned ? `; ${mb.planned} days planned, need ${mb.needPerDay}/day` : ''})`);
        L.push(`  ${ym(m)}: ${sh.length} ${j.kind === 'daily' ? 'days' : 'shifts'}, ${j.kind === 'hourly' ? `${hours}h, ` : ''}earned ${earned}${bonus ? ` (bonus ${bonus})` : ''}${tips ? `, tips ${tips} (${r2(tips / sh.length)}/shift)` : ''}${j.kind === 'hourly' && hours ? `, ${r2((earned + tips) / hours)}/h with tips` : ''}`);
      }
      const fut = shifts.filter(x => x.job_id === j.id && x.date > today).sort((a, b) => a.date.localeCompare(b.date));
      if (fut.length) {
        const byM = new Map<string, { n: number; hours: number; pay: number }>();
        for (const x of fut) { const k = ym(x.date); const v = byM.get(k) ?? { n: 0, hours: 0, pay: 0 }; v.n++; v.hours += x.hours ?? 0; v.pay += shiftParts(j, x).base; byM.set(k, v); }
        L.push(`  PLANNED (future shifts already entered; bonus/tips not known yet): ${[...byM.entries()].map(([k, v]) => `${k}: ${v.n} ${j.kind === 'daily' ? 'days' : `shifts, ${r2(v.hours)}h`}, pay ${r2(v.pay)}`).join('; ')}`);
      }
      const owed = payPeriods(j, shifts, s.payouts, s.transactions);
      L.push(`  owed now: ${owed.owed}${j.kind === 'daily' ? ` (salary ${owed.owedBase} + bonus ${owed.owedBonus})` : ''}`);
    }
  }

  // trading
  const strategies = alive(s.strategies).filter(x => !x.archived);
  if (strategies.length && s.prefs.analytics) {
    L.push('', 'TRADING (daily P&L the user logs per strategy; it is NOT included in account balances):');
    const pnl = alive(s.pnl);
    for (const st of strategies) {
      const per = months.map(m => { const e = monthEnd(m); const v = pnl.filter(p => p.strategy_id === st.id && p.date >= m && p.date <= e); return v.length ? `${ym(m)} ${r2(v.reduce((x, p) => x + p.pnl, 0))} (${v.length} days)` : null; }).filter(Boolean);
      const all = r2(pnl.filter(p => p.strategy_id === st.id).reduce((x, p) => x + p.pnl, 0));
      L.push(`${st.name}${st.goal ? ` (goal ${st.goal}/month)` : ''}: ${per.join(', ') || 'no data'}; all time ${all}`);
    }
  }
  return L.join('\n');
}

// ---------------------------------------------------------------- the query tool (computed on the phone)

export interface QueryInput {
  type?: 'expense' | 'income' | 'transfer' | 'any'; category?: string; account?: string; text?: string;
  from?: string; to?: string; weekdays?: number[]; group_by?: 'none' | 'day' | 'month' | 'week' | 'weekday' | 'category' | 'subcategory'; who?: 'me' | 'partner' | 'both';
}
export interface QueryResult {
  input: QueryInput; label: string; count: number; total: number; from: string; to: string;
  groups: Array<{ key: string; total: number; count: number }>; rows: Array<{ id: string; date: string; amount: number; type: string; what: string; account: string; note: string | null }>;
}

export const QUERY_TOOL = {
  name: 'query_transactions',
  description: 'Exact sums, counts and lists over all of the user\'s transactions, computed on the phone. Use it for any figure that is not in DATA, and to test an explanation before giving it (compare two periods, group by weekday to find a pattern, filter by note text). Returns total, count, average per entry, groups, and the 12 latest matching entries. Dates are YYYY-MM-DD; weekdays 0=Sunday…6=Saturday. who: me (default), partner, or both.',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['expense', 'income', 'transfer', 'any'], description: 'default expense' },
      category: { type: 'string', description: 'category or subcategory name, e.g. "Delivery" or "Σπίτι"' },
      account: { type: 'string', description: 'account name' },
      text: { type: 'string', description: 'words to find in notes' },
      from: { type: 'string' }, to: { type: 'string' },
      weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } },
      group_by: { type: 'string', enum: ['none', 'day', 'month', 'week', 'weekday', 'category', 'subcategory'] },
      who: { type: 'string', enum: ['me', 'partner', 'both'], description: 'default me' },
    },
  },
};

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];   // also used by the work tool

export function runQuery(q: QueryInput, s: State = getState(), today = todayISO()): QueryResult {
  const me = s.user?.id ?? '';
  const cats = s.categories;
  const type = q.type ?? 'expense';
  const from = q.from ?? '0000-01-01', to = q.to ?? today;
  const words = (x: string) => norm(x).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2);
  const catMatch = (() => {
    if (!q.category) return null;
    const want = words(q.category);
    const ids = new Set(Object.values(cats).filter(c => !c.deleted_at && want.every(w => words(c.name).some(x => sameWord(x, w) || x === w))).map(c => c.id));
    // a parent includes its subcategories
    for (const c of Object.values(cats)) if (c.parent_id && ids.has(c.parent_id)) ids.add(c.id);
    return ids;
  })();
  const accMatch = q.account ? new Set(alive(s.accounts).filter(a => words(a.name).some(x => words(q.account!).some(w => sameWord(x, w)))).map(a => a.id)) : null;
  const text = q.text ? words(q.text) : null;
  const list = liveTxs(s).filter(t =>
    (type === 'any' || t.type === type) && t.date >= from && t.date <= to &&
    (q.who === 'both' ? true : q.who === 'partner' ? t.owner_id !== me : t.owner_id === me) &&
    (!catMatch || (t.category_id && catMatch.has(t.category_id))) &&
    (!accMatch || accMatch.has(t.account_id) || (!!t.to_account_id && accMatch.has(t.to_account_id))) &&
    (!text || text.every(w => words(t.note ?? '').some(x => sameWord(x, w)))) &&
    (!q.weekdays?.length || q.weekdays.includes(fromISO(t.date).getDay())),
  ).sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
  const keyOf = (t: Tx): string => {
    switch (q.group_by) {
      case 'day': return t.date;
      case 'month': return ym(t.date);
      case 'week': { const d = fromISO(t.date); return addDays(t.date, -((d.getDay() + 6) % 7)); }
      case 'weekday': return WD[fromISO(t.date).getDay()];
      case 'category': return cats[topOf(t.category_id, cats)]?.name ?? 'Other';
      case 'subcategory': return catName(t.category_id, cats);
      default: return '';
    }
  };
  const g = new Map<string, { total: number; count: number }>();
  if (q.group_by && q.group_by !== 'none') for (const t of list) { const k = keyOf(t); const x = g.get(k) ?? { total: 0, count: 0 }; x.total += t.amount; x.count++; g.set(k, x); }
  const groups = [...g.entries()].map(([key, v]) => ({ key, total: r2(v.total), count: v.count }))
    .sort((a, b) => (q.group_by === 'day' || q.group_by === 'month' || q.group_by === 'week' ? a.key.localeCompare(b.key) : q.group_by === 'weekday' ? WD.indexOf(a.key) - WD.indexOf(b.key) : b.total - a.total));
  const label = [q.category ?? (type === 'income' ? 'Income' : type === 'transfer' ? 'Transfers' : 'Expenses'), q.account, q.text && `“${q.text}”`, q.who === 'partner' ? 'partner' : q.who === 'both' ? 'both of you' : null].filter(Boolean).join(' · ');
  return {
    input: q, label, count: list.length, total: r2(list.reduce((x, t) => x + t.amount, 0)),
    from: list.length ? list[list.length - 1].date : from, to,
    groups,
    rows: list.slice(0, 30).map(t => ({ id: t.id, date: t.date, amount: t.amount, type: t.type, what: t.type === 'transfer' ? `${s.accounts[t.account_id]?.name} → ${s.accounts[t.to_account_id ?? '']?.name}` : catName(t.category_id, cats), account: s.accounts[t.account_id]?.name ?? '', note: t.note })),
  };
}

const forClaude = (r: QueryResult) => JSON.stringify({ count: r.count, total: r.total, average: r.count ? r2(r.total / r.count) : 0, first_date: r.from, last_date: r.to, groups: r.groups.slice(0, 40).map(g => ({ ...g, average: g.count ? r2(g.total / g.count) : 0 })), latest: r.rows.slice(0, 12).map(x => `id ${x.id}: ${x.date} ${x.amount} ${x.what} (${x.account})${x.note ? ` "${x.note}"` : ''}`) });

// ---------------------------------------------------------------- work and trading tools

export interface WorkInput { from?: string; to?: string; job?: string }
export const WORK_TOOL = {
  name: 'query_work',
  description: 'His logged work shifts, day by day, computed on his phone: for each day which jobs he worked, hours, pay, sales bonus and tips, plus totals per job, the days he worked both jobs, and pay with tips per hour by weekday. Use it for any question about shifts, hours, days worked, tips or what a job pays.',
  input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD, default first day of this month' }, to: { type: 'string', description: 'YYYY-MM-DD, default today' }, job: { type: 'string', description: 'job name, default all' } } },
};
export function runWork(q: WorkInput, s: State = getState(), today = todayISO()): string {
  const from = q.from ?? monthStart(today), to = q.to ?? today;
  const jobs = alive(s.jobs).filter(j => !j.archived && (!q.job || norm(j.name).includes(norm(q.job)) || norm(q.job).includes(norm(j.name))));
  const days = new Map<string, string[]>();
  const tot = new Map<string, { n: number; hours: number; pay: number; bonus: number; tips: number }>();
  const wd = new Map<string, { pay: number; hours: number; n: number }>();
  for (const sh of alive(s.shifts).filter(x => x.date >= from && x.date <= to && x.date <= today).sort((a, b) => a.date.localeCompare(b.date))) {
    const j = jobs.find(x => x.id === sh.job_id);
    if (!j) continue;
    const tip = sh.tips_tx_id ? s.transactions[sh.tips_tx_id] : null;
    const tips = tip && !tip.deleted_at ? tip.amount : 0;
    const pay = shiftPay(j, sh), bonus = shiftParts(j, sh).bonus;
    const line = `${j.name}${j.kind === 'hourly' ? ` ${sh.hours}h` : ''} pay ${r2(pay)}${bonus ? ` (bonus ${r2(bonus)})` : ''}${contactRule(j, sh.date) ? ` contacts ${contactsOf(j, sh)}` : ''}${tips ? ` tips ${r2(tips)}` : ''}`;
    days.set(sh.date, [...(days.get(sh.date) ?? []), line]);
    const t = tot.get(j.name) ?? { n: 0, hours: 0, pay: 0, bonus: 0, tips: 0 };
    t.n++; t.hours += j.kind === 'hourly' ? sh.hours ?? 0 : 0; t.pay += pay; t.bonus += bonus; t.tips += tips; tot.set(j.name, t);
    if (j.kind === 'hourly' && sh.hours) { const k = `${j.name} ${WD[fromISO(sh.date).getDay()]}`; const w = wd.get(k) ?? { pay: 0, hours: 0, n: 0 }; w.pay += pay + tips; w.hours += sh.hours; w.n++; wd.set(k, w); }
  }
  const both = [...days.entries()].filter(([, l]) => l.length >= 2).map(([d]) => d);
  return JSON.stringify({
    from, to,
    totals: Object.fromEntries([...tot.entries()].map(([k, v]) => [k, { shifts: v.n, hours: r2(v.hours), pay: r2(v.pay), bonus: r2(v.bonus), tips: r2(v.tips), per_hour_with_tips: v.hours ? r2((v.pay + v.tips) / v.hours) : null }])),
    days_with_both_jobs: both, count_both: both.length,
    per_hour_with_tips_by_weekday: Object.fromEntries([...wd.entries()].map(([k, v]) => [k, { per_hour: r2(v.pay / v.hours), shifts: v.n }])),
    by_day: Object.fromEntries([...days.entries()].map(([d, l]) => [`${d} ${WD[fromISO(d).getDay()]}`, l.join('; ')])),
  });
}

export interface TradingInput { from?: string; to?: string; strategy?: string }
export const TRADING_TOOL = {
  name: 'query_trading',
  description: 'His logged daily trading P&L per strategy, computed on his phone: daily values, totals, winning/losing days, best and worst day, longest losing streak. Not part of account balances. Use it for any trading question.',
  input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, strategy: { type: 'string', description: 'strategy name or initials, default all' } } },
};
export function runTrading(q: TradingInput, s: State = getState(), today = todayISO()): string {
  const from = q.from ?? '0000-01-01', to = q.to ?? today;
  const want = q.strategy ? norm(q.strategy) : null;
  const strategies = alive(s.strategies).filter(st => !want || norm(st.name).includes(want) || norm(st.name).split(/\s+/).map(w => w[0]).join('') === want);
  const ids = new Set(strategies.map(x => x.id));
  const rows = alive(s.pnl).filter(p => ids.has(p.strategy_id) && p.date >= from && p.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const byDay = new Map<string, number>(); for (const p of rows) byDay.set(p.date, (byDay.get(p.date) ?? 0) + p.pnl);
  const vals = [...byDay.entries()];
  let streak = 0, worstStreak = 0; for (const [, v] of vals) { streak = v < 0 ? streak + 1 : 0; worstStreak = Math.max(worstStreak, streak); }
  return JSON.stringify({
    from: vals[0]?.[0] ?? from, to, strategies: strategies.map(x => x.name),
    total: r2(rows.reduce((x, p) => x + p.pnl, 0)), days: vals.length, winning_days: vals.filter(([, v]) => v > 0).length, losing_days: vals.filter(([, v]) => v < 0).length,
    best_day: vals.sort((a, b) => b[1] - a[1])[0] ?? null, worst_day: [...vals].sort((a, b) => a[1] - b[1])[0] ?? null, longest_losing_streak_days: worstStreak,
    per_strategy: Object.fromEntries(strategies.map(st => [st.name, r2(rows.filter(p => p.strategy_id === st.id).reduce((x, p) => x + p.pnl, 0))])),
    daily: Object.fromEntries([...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-60).map(([d, v]) => [d, r2(v)])),
  });
}

// ---------------------------------------------------------------- chat

const CHAT_RULES = `You are the money assistant inside Teo's personal budgeting app. You see his finances through DATA (a summary the app computes), three tools computed on his phone — query_transactions (every transaction), query_work (every shift: days, hours, pay, tips) and query_trading (daily P&L per strategy) — and ABOUT ME (his own description of his goals and situation; it may be empty).

Language: always answer in English, even when he writes in Greek. Keep category names, account names and notes exactly as they are (often Greek).

How to answer
- Put the answer in the first sentence. Then the evidence: the 2–4 numbers that support it.
- As short as the question allows: a number question gets 1–3 sentences; an advice question gets at most about 8 short lines or bullets.
- No greetings, no filler, no motivational language, no generic tips that would fit anyone.

Numbers
- Use only DATA, tool results, or tool results from earlier in this conversation. Never estimate, round or invent a figure. If something is not in the data, say so and say what would answer it.
- Before stating any figure that is not literally in DATA, call the matching tool (query_transactions, query_work or query_trading). Call it as many times as you need (other periods, filters, group_by) to check an explanation before you give it.
- Simple arithmetic on known numbers is fine (differences, per month, hours = € ÷ hourly pay); show it plainly.
- Money format: 1.234,56 €.

Advice (what to cut, how to earn more, is X worth it)
- Find the drivers: how often × average amount, which subcategories, which days of the week, and what changed against his own 3- and 12-month averages.
- Rank options by impact in € per month and translate each into hours of his work at his real hourly pay with tips (in DATA).
- Check against ABOUT ME: say whether he is on track for his goals and how big the gap is.
- Be direct when something is a problem. If he is doing fine, say so in one line and stop.
- Trading: report results and trade-offs from his data (P&L against hours of work, consistency, worst stretches). Do not tell him to buy, sell, or change position size.

Changes
- When he asks to add, change or remove shifts, entries (also repeating ones), budgets or P&L, call propose_changes. For existing entries find their ids with query_transactions first.
- Nothing is saved until he taps Apply on the card. After proposing, say in one line what the card contains and that he needs to tap Apply. Never say it is done.
- If the tool reports problems, fix them (another call) or ask him one short question.

Context
- Shared categories (with his girlfriend): his totals are only his part. For questions about joint spending use who "partner" or "both" in the tool.
- Future-dated (planned) entries do not count until their date.
- The current month is not over: compare by pace, not by totals.`;

/** Her account: the top mic only — commands, and one short answer to a question. No conversation. */
export const LITE_RULES = `You are the voice assistant inside a shared budgeting app. The user speaks one command or one question into the microphone. You see her finances through DATA (a summary the app computes) and query_transactions (every transaction). There is no conversation: answer this one message and stop.

Language: answer in the language she used (usually Greek). Keep category names, account names and notes exactly as they are.

Commands (add, change or remove entries — also repeating ones — or budgets)
- Call propose_changes. For existing entries find their ids with query_transactions first.
- Nothing is saved until she taps Apply on the card. After proposing, say in one short line what the card contains. Never say it is done.
- If something essential is missing or ambiguous, ask for it in one short line instead of guessing.
- If the tool reports problems, fix them with another call, or say in one line what is wrong.

Questions
- Answer in 1–3 short sentences: the answer first, then at most two supporting numbers.
- Use only DATA or tool results. Never estimate or invent a figure; before stating any figure that is not literally in DATA, call query_transactions. If the data cannot answer it, say so in one line.
- No advice unless she asks for it, no greetings, no filler, no follow-up questions or offers.
- Money format: 1.234,56 €.

Context
- Shared categories: her totals are only her part. For joint spending use who "partner" or "both" in the tool.
- She can only change her own entries, not her partner's.
- Future-dated (planned) entries do not count until their date. The current month is not over.`;

export interface ChatItem { role: 'user' | 'assistant'; text: string; results?: QueryResult[]; proposal?: Proposal; error?: boolean; at: string }

const CHAT_KEY = 'money:chat';
export function loadChat(): ChatItem[] { try { return JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]'); } catch { return []; } }
export function saveChat(items: ChatItem[]) { try { localStorage.setItem(CHAT_KEY, JSON.stringify(items.slice(-60))); } catch { /* full */ } }

const CONTINUE = 'Continue exactly where you stopped. Do not repeat anything.';
const textOf = (r: ApiReply) => r.content.filter((x): x is Extract<Block, { type: 'text' }> => x.type === 'text').map(x => x.text).join('');
const aboutMe = () => (getState().prefs.aboutMe ?? '').trim() || '(empty)';

/** Asks; if the answer hits the length limit, asks for the rest (twice at most) and joins it. */
async function complete(system: unknown, msgs: ApiMsg[], tools?: unknown, tier: Tier = 'act'): Promise<ApiReply> {
  let r = await callAI({ system, messages: msgs, tools, tier });
  if (r.stop_reason !== 'max_tokens' || !textOf(r).trim()) return r;
  let text = textOf(r);
  for (let i = 0; i < 2 && r.stop_reason === 'max_tokens'; i++) {
    const more = [...msgs, { role: 'assistant' as const, content: text }, { role: 'user' as const, content: CONTINUE }];
    r = await callAI({ system, messages: more, tools, tier });
    text += textOf(r);
  }
  return { ...r, content: [{ type: 'text', text }, ...r.content.filter(x => x.type !== 'text')] };
}

/** the API refuses empty text blocks, e.g. a tool call with no words before it */
const clean = (content: Block[]) => content.filter(x => x.type !== 'text' || x.text.trim());

/** What it looked up in a turn, kept in the conversation so follow-up questions can build on it. */
const memo = (r: QueryResult) => `${r.label} ${r.from}–${r.to}: total ${r.total}, ${r.count} entries${r.groups.length ? `; by ${r.input.group_by}: ${r.groups.slice(0, 14).map(g => `${g.key} ${g.total}`).join(', ')}` : ''}`;

/** One turn: question in, answer (and any numbers it looked up) out. */
export async function askClaude(history: ChatItem[], question: string, lite = false): Promise<ChatItem> {
  const tier: Tier = isQuestion(question) ? 'ask' : 'act';   // "πόσα / γιατί / τι …" → Opus; "σβήσε / άλλαξε …" → Sonnet
  const system = [
    { type: 'text', text: lite ? LITE_RULES : CHAT_RULES },
    ...(lite ? [] : [{ type: 'text', text: 'ABOUT ME\n' + aboutMe() }]),
    { type: 'text', text: 'DATA\n' + buildSnapshot(), cache_control: { type: 'ephemeral' } },
  ];
  const past: ApiMsg[] = (lite ? [] : history).filter(h => !h.error).slice(-16).map(h => ({
    role: h.role,
    content: (h.text || '…') + (h.role === 'assistant' && h.results?.length ? `\n[Looked up: ${h.results.map(memo).join(' | ')}]` : '')
      + (h.proposal ? `\n[Card: ${h.proposal.items.map(i => i.label).join(' | ')} — ${h.proposal.status === 'applied' ? 'he applied it' : h.proposal.status === 'pending' ? 'not applied yet' : 'not applied'}]` : ''),
  }));
  // the API wants turns to alternate, starting with the user
  const msgs: ApiMsg[] = [];
  for (const m of [...past, { role: 'user' as const, content: question }]) {
    if (msgs.length && msgs[msgs.length - 1].role === m.role) msgs[msgs.length - 1] = { role: m.role, content: `${msgs[msgs.length - 1].content}\n${m.content}` };
    else if (msgs.length || m.role === 'user') msgs.push(m);
  }
  const results: QueryResult[] = [];
  let proposal: Proposal | null = null;
  const tools = lite ? [QUERY_TOOL, CHANGES_TOOL] : [QUERY_TOOL, WORK_TOOL, TRADING_TOOL, CHANGES_TOOL];
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await complete(system, msgs, tools, tier);
    const uses = r.content.filter((x): x is Extract<Block, { type: 'tool_use' }> => x.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !uses.length) return { role: 'assistant', text: textOf(r).trim(), results, proposal: proposal ?? undefined, at: new Date().toISOString() };
    msgs.push({ role: 'assistant', content: clean(r.content) });
    msgs.push({
      role: 'user', content: uses.map(u => {
        if (u.name === WORK_TOOL.name) return { type: 'tool_result' as const, tool_use_id: u.id, content: runWork(u.input as WorkInput) };
        if (u.name === TRADING_TOOL.name) return { type: 'tool_result' as const, tool_use_id: u.id, content: runTrading(u.input as TradingInput) };
        if (u.name === CHANGES_TOOL.name) {
          const { proposal: p, errors } = resolveChanges(u.input as { summary?: string; changes?: Record<string, unknown>[] });
          if (p.items.length) proposal = p;   // a corrected call replaces the earlier card
          return { type: 'tool_result' as const, tool_use_id: u.id, content: JSON.stringify({ card_shown: p.items.map(i => i.label), problems: errors, saved: false, note: 'Nothing is saved until the user taps Apply on the card.' }) };
        }
        const res = runQuery(u.input as QueryInput);
        results.push(res);
        return { type: 'tool_result' as const, tool_use_id: u.id, content: forClaude(res) };
      }),
    });
  }
  // out of lookups: answer with what it has instead of giving up
  const last = msgs[msgs.length - 1];
  if (Array.isArray(last.content)) last.content = [...last.content, { type: 'text', text: OUT_OF_STEPS } as Block];
  const r = await complete(system, msgs, tools, tier);
  const text = textOf(r).trim();
  if (text) return { role: 'assistant', text, results, proposal: proposal ?? undefined, at: new Date().toISOString() };
  return { role: 'assistant', text: 'I couldn’t finish that one — try asking it more simply.', results, error: true, at: new Date().toISOString() };
}

const MAX_STEPS = 12;
const OUT_OF_STEPS = 'You have no more lookups. Answer now with what you found so far, and say in one line what you could not check.';
