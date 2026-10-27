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
import { payPeriods, rateAt, shiftParts, shiftPay } from './tracker';
import type { Category, Tx } from './types';

// ---------------------------------------------------------------- transport

export type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: 'tool_result'; tool_use_id: string; content: string };
export interface ApiMsg { role: 'user' | 'assistant'; content: string | Block[] }
interface ApiReply { content: Block[]; stop_reason: string; remaining?: number }

export class AiError extends Error {
  constructor(public code: 'not_setup' | 'limit' | 'not_allowed' | 'offline' | 'claude' | 'other', msg = '') { super(msg || code); }
}

type Mock = (body: unknown) => Promise<ApiReply>;
let lastRemaining: number | null = null;
export const aiRemaining = () => lastRemaining;

async function callAI(body: { system: unknown; messages: ApiMsg[]; tools?: unknown }): Promise<ApiReply> {
  const mock = (window as unknown as { __aiMock?: Mock }).__aiMock;
  if (mock) { const r = await mock(body); if (typeof r.remaining === 'number') lastRemaining = r.remaining; return r; }
  if (!REMOTE || !supabase) throw new AiError('not_setup');
  if (!navigator.onLine) throw new AiError('offline');
  const { data, error } = await supabase.functions.invoke('ai', { body });
  if (error) {
    let info: { error?: string; message?: string; remaining?: number } = {};
    try { info = await (error as { context?: Response }).context?.json(); } catch { /* not json */ }
    if (info.error === 'limit') { lastRemaining = 0; throw new AiError('limit'); }
    if (info.error === 'not_allowed') throw new AiError('not_allowed');
    if (info.error === 'claude') throw new AiError('claude', info.message);
    if (info.error === 'no_key' || /not found|404|Failed to send/i.test(String(error.message))) throw new AiError('not_setup');
    throw new AiError('other', error.message);
  }
  const r = data as ApiReply;
  if (typeof r.remaining === 'number') lastRemaining = r.remaining;
  return r;
}

export function aiErrorText(e: unknown): string {
  const code = e instanceof AiError ? e.code : 'other';
  if (code === 'not_setup') return 'The AI isn’t set up yet (Edge Function + key in Supabase).';
  if (code === 'limit') return 'You’ve used today’s 60 messages. It resets tomorrow.';
  if (code === 'not_allowed') return 'The AI is only on for your account.';
  if (code === 'offline') return 'No connection right now.';
  if (code === 'claude') return `Claude couldn’t answer: ${(e as AiError).message || 'try again'}`;
  return 'Something went wrong — try again.';
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
  const months = Array.from({ length: 6 }, (_, i) => addMonths(today, -5 + i));
  const L: string[] = [];
  const name = s.profiles[me]?.display_name || 'Teo';
  L.push(`Today: ${today} (${new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(fromISO(today))}). User: ${name}. Currency EUR.`);

  const accs = alive(s.accounts).filter(a => a.owner_id === me && !a.archived);
  const bal = computeBalances(accs, mine, today);
  L.push('', 'ACCOUNTS (balance now): ' + accs.map(a => `${a.name}${a.kind === 'savings' ? ' [savings]' : ''} ${r2(bal.get(a.id) ?? 0)}`).join(' | '));

  L.push('', 'MONTHS (only what the user paid/earned; transfers excluded; current month is up to today):');
  for (const m of months) {
    const a = m, b = m === monthStart(today) ? today : monthEnd(m);
    const inM = mine.filter(t => t.date >= a && t.date <= b && t.type !== 'transfer');
    const inc = r2(inM.filter(t => t.type === 'income').reduce((x, t) => x + t.amount, 0));
    const exp = r2(inM.filter(t => t.type === 'expense').reduce((x, t) => x + t.amount, 0));
    if (!inc && !exp) continue;
    const by = (type: 'income' | 'expense') => {
      const top = new Map<string, number>(), sub = new Map<string, Map<string, number>>();
      for (const t of inM) if (t.type === type) {
        const k = topOf(t.category_id, cats);
        top.set(k, (top.get(k) ?? 0) + t.amount);
        if (t.category_id && cats[t.category_id]?.parent_id) {
          const m2 = sub.get(k) ?? new Map(); m2.set(t.category_id, (m2.get(t.category_id) ?? 0) + t.amount); sub.set(k, m2);
        }
      }
      return [...top.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => {
        const subs = [...(sub.get(k) ?? new Map()).entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([sid, sv]) => `${cats[sid]?.name} ${r2(sv)}`);
        return `${cats[k]?.name ?? 'Other'} ${r2(v)}${subs.length ? ` (${subs.join(', ')})` : ''}`;
      }).join('; ');
    };
    L.push(`${ym(m)}: income ${inc}, expenses ${exp}, saved ${r2(inc - exp)}`);
    L.push(`  expenses: ${by('expense')}`);
    L.push(`  income: ${by('income')}`);
  }

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
    L.push('', `SHARED CATEGORIES (with the girlfriend; the user's totals above are only his part): ${parts.join(' | ')}`);
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
        L.push(`  ${ym(m)}: ${sh.length} ${j.kind === 'daily' ? 'days' : 'shifts'}, ${j.kind === 'hourly' ? `${hours}h, ` : ''}earned ${earned}${bonus ? ` (bonus ${bonus})` : ''}${tips ? `, tips ${tips} (${r2(tips / sh.length)}/shift)` : ''}${j.kind === 'hourly' && hours ? `, ${r2((earned + tips) / hours)}/h with tips` : ''}`);
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
  from?: string; to?: string; weekdays?: number[]; group_by?: 'none' | 'month' | 'week' | 'weekday' | 'category' | 'subcategory'; who?: 'me' | 'partner' | 'both';
}
export interface QueryResult {
  input: QueryInput; label: string; count: number; total: number; from: string; to: string;
  groups: Array<{ key: string; total: number; count: number }>; rows: Array<{ id: string; date: string; amount: number; type: string; what: string; account: string; note: string | null }>;
}

export const QUERY_TOOL = {
  name: 'query_transactions',
  description: 'Sum, count and list the user\'s transactions with filters, computed on the phone from the full data. Use it whenever you need a number that is not in DATA (a specific category, period, weekday, account, note text, or the partner\'s spending). Dates are YYYY-MM-DD; weekdays 0=Sunday…6=Saturday.',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['expense', 'income', 'transfer', 'any'], description: 'default expense' },
      category: { type: 'string', description: 'category or subcategory name, e.g. "Delivery" or "Σπίτι"' },
      account: { type: 'string', description: 'account name' },
      text: { type: 'string', description: 'words to find in notes' },
      from: { type: 'string' }, to: { type: 'string' },
      weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } },
      group_by: { type: 'string', enum: ['none', 'month', 'week', 'weekday', 'category', 'subcategory'] },
      who: { type: 'string', enum: ['me', 'partner', 'both'], description: 'default me' },
    },
  },
};

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
    .sort((a, b) => (q.group_by === 'month' || q.group_by === 'week' ? a.key.localeCompare(b.key) : q.group_by === 'weekday' ? WD.indexOf(a.key) - WD.indexOf(b.key) : b.total - a.total));
  const label = [q.category ?? (type === 'income' ? 'Income' : type === 'transfer' ? 'Transfers' : 'Expenses'), q.account, q.text && `“${q.text}”`, q.who === 'partner' ? 'partner' : q.who === 'both' ? 'both of you' : null].filter(Boolean).join(' · ');
  return {
    input: q, label, count: list.length, total: r2(list.reduce((x, t) => x + t.amount, 0)),
    from: list.length ? list[list.length - 1].date : from, to,
    groups,
    rows: list.slice(0, 30).map(t => ({ id: t.id, date: t.date, amount: t.amount, type: t.type, what: t.type === 'transfer' ? `${s.accounts[t.account_id]?.name} → ${s.accounts[t.to_account_id ?? '']?.name}` : catName(t.category_id, cats), account: s.accounts[t.account_id]?.name ?? '', note: t.note })),
  };
}

const forClaude = (r: QueryResult) => JSON.stringify({ count: r.count, total: r.total, first_date: r.from, last_date: r.to, groups: r.groups.slice(0, 40), latest: r.rows.slice(0, 12).map(x => `${x.date} ${x.amount} ${x.what}${x.note ? ` "${x.note}"` : ''}`) });

// ---------------------------------------------------------------- chat

const CHAT_RULES = `You are the assistant inside the user's personal budgeting app (his name, jobs, trading and money are in DATA).
Answer in the language of his message (usually Greek), briefly: 1–6 short sentences or a short list. No greetings, no filler, no motivational talk.
Numbers: use only DATA below or the query_transactions tool. Never estimate or invent a figure; if it is not available, say so. Format money like 1.234,56 €.
When he asks for advice (what to cut, how to earn more, is X worth it), be concrete and honest, grounded in his numbers: name categories and amounts, compare with his own averages, and translate money into hours of his work using his real hourly pay with tips from DATA when useful. Say plainly when something looks like a problem.
For trading or investing decisions give facts and trade-offs from his data, not orders. You are not a financial advisor and need not say so unless it matters.
Shared categories: his totals are only his part; the partner's spending is separate.`;

export interface ChatItem { role: 'user' | 'assistant'; text: string; results?: QueryResult[]; error?: boolean; at: string }

const CHAT_KEY = 'money:chat';
export function loadChat(): ChatItem[] { try { return JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]'); } catch { return []; } }
export function saveChat(items: ChatItem[]) { try { localStorage.setItem(CHAT_KEY, JSON.stringify(items.slice(-60))); } catch { /* full */ } }

/** One turn: question in, answer (and any numbers it looked up) out. */
export async function askClaude(history: ChatItem[], question: string): Promise<ChatItem> {
  const system = [
    { type: 'text', text: CHAT_RULES },
    { type: 'text', text: 'DATA\n' + buildSnapshot(), cache_control: { type: 'ephemeral' } },
  ];
  const past: ApiMsg[] = history.filter(h => !h.error).slice(-12).map(h => ({ role: h.role, content: h.text || '…' }));
  // the API wants turns to alternate, starting with the user
  const msgs: ApiMsg[] = [];
  for (const m of [...past, { role: 'user' as const, content: question }]) {
    if (msgs.length && msgs[msgs.length - 1].role === m.role) msgs[msgs.length - 1] = { role: m.role, content: `${msgs[msgs.length - 1].content}\n${m.content}` };
    else if (msgs.length || m.role === 'user') msgs.push(m);
  }
  const results: QueryResult[] = [];
  for (let step = 0; step < 5; step++) {
    const r = await callAI({ system, messages: msgs, tools: [QUERY_TOOL] });
    const uses = r.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !uses.length) {
      const text = r.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n').trim();
      return { role: 'assistant', text, results, at: new Date().toISOString() };
    }
    msgs.push({ role: 'assistant', content: r.content });
    msgs.push({
      role: 'user', content: uses.map(u => {
        const res = runQuery(u.input as QueryInput);
        results.push(res);
        return { type: 'tool_result' as const, tool_use_id: u.id, content: forClaude(res) };
      }),
    });
  }
  return { role: 'assistant', text: 'I couldn’t finish that one — try asking it more simply.', results, error: true, at: new Date().toISOString() };
}

// ---------------------------------------------------------------- monthly review

const REVIEW_RULES = `Write a short monthly review of the user's money for his budgeting app, in Greek.
4–6 bullet lines starting with "• ", each one fact with its number, most important first. Neutral and honest: no praise, no motivational words, no advice unless a number clearly calls for one short remark. Use only the facts given; never add numbers. Money like 1.234,56 €.
If the month is not over, the facts are "up to" a date: say "μέχρι σήμερα" where it matters.`;

export async function writeReview(facts: string): Promise<string> {
  const r = await callAI({ system: REVIEW_RULES, messages: [{ role: 'user', content: facts }] });
  return r.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n').trim();
}
