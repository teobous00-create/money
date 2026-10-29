/**
 * Numbers the AI may use, computed on the phone. Explanations, not just totals:
 * how often × how much, same point of the month vs before, weekdays, one-offs, pace, budgets, work €/h.
 */
import type { State } from './store';
import { alive } from './calc';
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

function weekdayShare(list: Tx[]) {
  const c = new Array(7).fill(0);
  for (const t of list) c[fromISO(t.date).getDay()]++;
  const n = list.length || 1;
  return c.map((v, i) => ({ d: WD[i], share: v / n })).sort((x, y) => y.share - x.share);
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
  // weekdays, last 90 days
  const recent = b.mine.filter(t => t.type === 'expense' && t.date > addDays(today, -90) && t.date <= today);
  const byCat = new Map<string, Tx[]>();
  for (const t of recent) { const k = topOf(t.category_id, cats); byCat.set(k, [...(byCat.get(k) ?? []), t]); }
  const wd = [...byCat.entries()].filter(([, l]) => l.length >= 8).sort((x, y) => y[1].length - x[1].length).slice(0, 6)
    .map(([id, l]) => `${cats[id]?.name ?? 'Other'} ${weekdayShare(l).slice(0, 3).map(x => `${x.d} ${Math.round(x.share * 100)}%`).join(' ')}`);
  if (wd.length) L.push(`WHEN HE SPENDS (last 90 days, share of entries by weekday): ${wd.join(' | ')}`);
  const hr = hourlyWithTips(b, cur);
  if (hr) L.push(`HIS HOURLY PAY WITH TIPS (evening job, last 3 months): ${num(hr)} €/h`);
  return L.join('\n');
}
