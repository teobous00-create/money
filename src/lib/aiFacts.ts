/**
 * Numbers the AI may use, computed on the phone. Explanations, not just totals:
 * how often × how much, same point of the month vs before, weekdays, one-offs, pace, budgets, work €/h.
 */
import type { State } from './store';
import { alive, catName, computeBalances, defaultSelection, ruleDates } from './calc';
import { isPending } from './txTime';
import { addDays, fromISO, num, round2, toISO } from './format';
import { shiftPay, shiftParts } from './tracker';
import type { Category, Tx } from './types';

export const monthStart = (d: string) => d.slice(0, 7) + '-01';
export const monthEnd = (d: string) => { const x = fromISO(monthStart(d)); return toISO(new Date(x.getFullYear(), x.getMonth() + 1, 0)); };
export const addMonths = (d: string, n: number) => { const x = fromISO(monthStart(d)); return toISO(new Date(x.getFullYear(), x.getMonth() + n, 1)); };
/** the same day number inside another month (clipped to its length) */
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const topOf = (id: string | null, cats: Record<string, Category>) => (id ? cats[id]?.parent_id ?? id : 'none');

interface Agg { total: number; count: number }
const add = (m: Map<string, Agg>, k: string, v: number) => { const x = m.get(k) ?? { total: 0, count: 0 }; x.total += v; x.count++; m.set(k, x); };

export interface Base { s: State; me: string; cats: Record<string, Category>; all: Tx[]; mine: Tx[]; today: string; shared: Set<string> }
export function base(s: State, today: string): Base {
  const me = s.user?.id ?? '';
  const all = alive(s.transactions).filter(t => !s.accounts[t.account_id]?.deleted_at);
  const shared = new Set([...s.members.map(m => m.category_id), ...Object.values(s.categories).filter(c => !c.parent_id && c.owner_id !== me).map(c => c.id)]);
  return { s, me, cats: s.categories, all, mine: all.filter(t => t.owner_id === me), today, shared };
}

/** my income/expenses between two dates, by top category and subcategory */
export function span(b: Base, from: string, to: string) {
  const top = new Map<string, Agg>(), sub = new Map<string, Agg>(), inc = new Map<string, Agg>();
  let income = 0, expense = 0;
  const list = b.mine.filter(t => t.date >= from && t.date <= to && t.date <= b.today && t.type !== 'transfer');
  for (const t of list) {
    if (t.type === 'income') { income += t.amount; add(inc, topOf(t.category_id, b.cats), t.amount); continue; }
    expense += t.amount;
    add(top, topOf(t.category_id, b.cats), t.amount);
    if (t.category_id && b.cats[t.category_id]?.parent_id) add(sub, t.category_id, t.amount);
  }
  return { income: round2(income), expense: round2(expense), top, sub, inc, list };
}

function workMonth(b: Base, jobId: string, from: string, to: string) {
  const s = b.s, job = s.jobs[jobId];
  let n = 0, hours = 0, pay = 0, bonus = 0, tips = 0;
  for (const sh of alive(s.shifts)) {
    if (sh.job_id !== jobId || sh.date < from || sh.date > to || sh.date > b.today) continue;
    n++; hours += sh.hours ?? 0; pay += shiftPay(job, sh); bonus += shiftParts(job, sh).bonus;
    const tip = sh.tips_tx_id ? s.transactions[sh.tips_tx_id] : null;
    if (tip && !tip.deleted_at) tips += tip.amount;
  }
  return { n, hours: round2(hours), pay: round2(pay), bonus: round2(bonus), tips: round2(tips), perHour: hours ? round2((pay + tips) / hours) : null };
}

/** evening €/h with tips over the last 3 full months (to turn money into hours of work) */
export function hourlyWithTips(b: Base, anchor: string): number | null {
  const job = alive(b.s.jobs).find(j => j.kind === 'hourly' && !j.archived);
  if (!job) return null;
  const w = workMonth(b, job.id, addMonths(anchor, -3), monthEnd(addMonths(anchor, -1)));
  return w.perHour ?? workMonth(b, job.id, monthStart(anchor), b.today).perHour;
}

/** 12 months by category with count and average, 3- and 12-month averages, weekday patterns. */
export function chatDetail(s: State, today: string): string {
  const b = base(s, today);
  const cats = b.cats;
  const L: string[] = [];
  const cur = monthStart(today);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(cur, -11 + i));
  L.push('MONTHS (the user’s own income/expenses; transfers excluded; the current month is up to today). Format: total (count × average):');
  for (const m of months) {
    const w = span(b, m, m === cur ? today : monthEnd(m));
    if (!w.income && !w.expense) continue;
    const top = [...w.top.entries()].sort((x, y) => y[1].total - x[1].total).map(([id, v]) => {
      const subs = [...w.sub.entries()].filter(([sid]) => cats[sid]?.parent_id === id).sort((x, y) => y[1].total - x[1].total).slice(0, 5)
        .map(([sid, sv]) => `${cats[sid]?.name} ${num(round2(sv.total))} (${sv.count}×${num(round2(sv.total / sv.count))})`);
      return `${cats[id]?.name ?? 'Other'} ${num(round2(v.total))}${subs.length ? ` [${subs.join(', ')}]` : ''}`;
    });
    const inc = [...w.inc.entries()].sort((x, y) => y[1].total - x[1].total).map(([id, v]) => `${cats[id]?.name ?? 'Other'} ${num(round2(v.total))}`);
    L.push(`${m.slice(0, 7)}: income ${num(w.income)}, expenses ${num(w.expense)}, saved ${num(round2(w.income - w.expense))}`);
    L.push(`  expenses: ${top.join('; ')}`);
    L.push(`  income: ${inc.join('; ')}`);
  }
  // averages per category
  const avgOver = (n: number) => {
    const out = new Map<string, number>();
    for (let i = 1; i <= n; i++) { const m = addMonths(cur, -i); for (const [id, v] of span(b, m, monthEnd(m)).top) out.set(id, (out.get(id) ?? 0) + v.total / n); }
    return out;
  };
  const a3 = avgOver(3), a12 = avgOver(12);
  L.push('MONTHLY AVERAGES BY CATEGORY (full months; 3-month | 12-month): ' + [...a12.entries()].sort((x, y) => y[1] - x[1]).map(([id, v]) => `${cats[id]?.name ?? 'Other'} ${num(round2(a3.get(id) ?? 0))} | ${num(round2(v))}`).join('; '));
  const hr = hourlyWithTips(b, cur);
  if (hr) L.push(`HIS HOURLY PAY WITH TIPS (evening job, last 3 months): ${num(hr)} €/h`);
  return L.join('\n');
}

/**
 * Money until the next pay (the 16th or the 1st when a job pays twice a month, else the 1st): what's in the
 * everyday accounts now + what's planned before then (future entries and repeating ones) → per day.
 */
export function untilNextPay(s: State, today: string) {
  const me = s.user?.id;
  const semi = alive(s.jobs).some(j => !j.archived && j.pay === 'semimonthly');
  const d = fromISO(today);
  const until = semi && d.getDate() < 16 ? toISO(new Date(d.getFullYear(), d.getMonth(), 16)) : toISO(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const accs = alive(s.accounts).filter(a => a.owner_id === me);
  const sel = new Set(defaultSelection(accs));
  const bal = computeBalances(accs, alive(s.transactions), today);
  let now = 0;
  sel.forEach(id => { now += bal.get(id) ?? 0; });
  const effect = (t: Pick<Tx, 'type' | 'amount' | 'account_id' | 'to_account_id'>) =>
    t.type === 'expense' ? (sel.has(t.account_id) ? -t.amount : 0) : t.type === 'income' ? (sel.has(t.account_id) ? t.amount : 0)
      : (t.to_account_id && sel.has(t.to_account_id) ? t.amount : 0) - (sel.has(t.account_id) ? t.amount : 0);
  let planned = 0;
  const items: Array<{ date: string; amount: number; type: string; what: string; account: string }> = [];
  const item = (date: string, t: Pick<Tx, 'type' | 'amount' | 'account_id' | 'to_account_id' | 'category_id' | 'note'>) => items.push({
    date, amount: t.amount, type: t.type, account: s.accounts[t.account_id]?.name ?? '',
    what: t.type === 'transfer' ? `${s.accounts[t.account_id]?.name} → ${s.accounts[t.to_account_id ?? '']?.name}` : `${catName(t.category_id, s.categories)}${t.note ? ` "${t.note}"` : ''}`,
  });
  for (const t of alive(s.transactions)) if (t.owner_id === me && isPending(t, today) && t.date < until) { planned += effect(t); item(t.date, t); }
  for (const r of Object.values(s.recurring)) if (r.owner_id === me) for (const day of ruleDates(r, addDays(today, 1), addDays(until, -1))) { planned += effect(r); item(day, r); }
  const left = round2(now + planned);
  const days = Math.max(1, Math.round((fromISO(until).getTime() - d.getTime()) / 864e5));
  return { until, days, now: round2(now), planned: round2(planned), left, perDay: round2(left / days), items: items.sort((a, b) => a.date.localeCompare(b.date)), accounts: [...sel].map(id => s.accounts[id]?.name ?? '') };
}

/** Planned entries (future-dated + repeating) for the next `n` days, after the pay window. */
export function plannedAhead(s: State, today: string, n = 30) {
  const me = s.user?.id, end = addDays(today, n);
  const out: Array<{ date: string; line: string }> = [];
  const line = (t: Pick<Tx, 'type' | 'amount' | 'account_id' | 'to_account_id' | 'category_id' | 'note'>) =>
    `${t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}${t.amount} ${t.type === 'transfer' ? `${s.accounts[t.account_id]?.name} → ${s.accounts[t.to_account_id ?? '']?.name}` : catName(t.category_id, s.categories)}${t.note ? ` "${t.note}"` : ''} (${s.accounts[t.account_id]?.name ?? ''})`;
  for (const t of alive(s.transactions)) if (t.owner_id === me && isPending(t, today) && t.date <= end) out.push({ date: t.date, line: line(t) });
  for (const r of Object.values(s.recurring)) if (r.owner_id === me) for (const day of ruleDates(r, addDays(today, 1), end)) out.push({ date: day, line: line(r) + ' [repeating]' });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
