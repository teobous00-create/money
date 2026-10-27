/**
 * Numbers the AI may use, computed on the phone. Explanations, not just totals:
 * how often × how much, same point of the month vs before, weekdays, one-offs, pace, budgets, work €/h.
 */
import type { State } from './store';
import { alive, catName, ruleDates } from './calc';
import { addDays, fromISO, num, round2, toISO } from './format';
import { payPeriods, shiftPay, shiftParts, monthBonus } from './tracker';
import type { Category, Tx } from './types';

export const monthStart = (d: string) => d.slice(0, 7) + '-01';
export const monthEnd = (d: string) => { const x = fromISO(monthStart(d)); return toISO(new Date(x.getFullYear(), x.getMonth() + 1, 0)); };
export const addMonths = (d: string, n: number) => { const x = fromISO(monthStart(d)); return toISO(new Date(x.getFullYear(), x.getMonth() + n, 1)); };
const dayOf = (d: string) => fromISO(d).getDate();
/** the same day number inside another month (clipped to its length) */
const sameDayIn = (m: string, day: number) => { const e = monthEnd(m); return dayOf(e) < day ? e : `${m.slice(0, 8)}${String(day).padStart(2, '0')}`; };
const e = (v: number) => `${num(v)} €`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
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

/** average of the previous n full months, each cut at the same day of the month as `upTo` (same point of the month) */
function samePoint(b: Base, a: string, upTo: string, n = 3) {
  const day = dayOf(upTo);
  const full = upTo === monthEnd(a);
  const ws = Array.from({ length: n }, (_, i) => { const m = addMonths(a, -(i + 1)); return span(b, m, full ? monthEnd(m) : sameDayIn(m, day)); });
  const avgMap = (key: 'top' | 'sub' | 'inc') => {
    const out = new Map<string, Agg>();
    for (const w of ws) for (const [k, v] of w[key]) { const x = out.get(k) ?? { total: 0, count: 0 }; x.total += v.total / n; x.count += v.count / n; out.set(k, x); }
    return out;
  };
  return { income: round2(ws.reduce((x, w) => x + w.income, 0) / n), expense: round2(ws.reduce((x, w) => x + w.expense, 0) / n), top: avgMap('top'), sub: avgMap('sub'), inc: avgMap('inc'), ws };
}

/** "21 times × 12,30 € (usual 14 × 12,10 €): +86 € mostly from more often" */
function explain(now: Agg | undefined, usual: Agg | undefined) {
  const n1 = now?.count ?? 0, t1 = now ? now.total / Math.max(1, n1) : 0;
  const n0 = usual?.count ?? 0, t0 = usual && n0 ? usual.total / n0 : 0;
  const delta = (now?.total ?? 0) - (usual?.total ?? 0);
  const freq = (n1 - n0) * t0, price = n1 * (t1 - t0);
  const driver = Math.abs(delta) < 1 ? 'about the same' : Math.abs(freq) >= Math.abs(price) ? (freq > 0 ? 'mostly more often' : 'mostly less often') : (price > 0 ? 'mostly more expensive each time' : 'mostly cheaper each time');
  return { delta, text: `${n1} × ${e(round2(t1))} = ${e(round2(now?.total ?? 0))} (usual ${num(round2(n0))} × ${e(round2(t0))} = ${e(round2(usual?.total ?? 0))}); ${delta >= 0 ? '+' : '−'}${e(round2(Math.abs(delta)))}, ${driver}` };
}

function weekdayShare(list: Tx[]) {
  const c = new Array(7).fill(0);
  for (const t of list) c[fromISO(t.date).getDay()]++;
  const n = list.length || 1;
  return c.map((v, i) => ({ d: WD[i], share: v / n })).sort((x, y) => y.share - x.share);
}

/** €/hour with tips per weekday for an hourly job, over a window */
function workByWeekday(b: Base, jobId: string, from: string, to: string) {
  const s = b.s;
  const job = s.jobs[jobId];
  const per = new Map<string, { pay: number; hours: number; n: number }>();
  for (const sh of alive(s.shifts)) {
    if (sh.job_id !== jobId || sh.date < from || sh.date > to || sh.date > b.today) continue;
    const tip = sh.tips_tx_id ? s.transactions[sh.tips_tx_id] : null;
    const k = WD[fromISO(sh.date).getDay()];
    const x = per.get(k) ?? { pay: 0, hours: 0, n: 0 };
    x.pay += shiftPay(job, sh) + (tip && !tip.deleted_at ? tip.amount : 0);
    x.hours += job.kind === 'hourly' ? sh.hours ?? 0 : 1;
    x.n++;
    per.set(k, x);
  }
  return [...per.entries()].map(([d, v]) => ({ d, rate: v.hours ? v.pay / v.hours : 0, n: v.n })).sort((x, y) => y.rate - x.rate);
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

// ---------------------------------------------------------------- monthly review facts

export function reviewFacts(s: State, anchor: string, today: string): string | null {
  const b = base(s, today);
  const a = monthStart(anchor), end = monthEnd(anchor);
  const upTo = today < end ? today : end;
  const partial = upTo < end;
  const d = dayOf(upTo), D = dayOf(end);
  const now = span(b, a, upTo);
  if (!now.income && !now.expense) return null;
  const usual = samePoint(b, a, upTo);
  const cats = b.cats;
  const L: string[] = [];
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(fromISO(a));
  L.push(`MONTH: ${monthName}. ${partial ? `Not over: day ${d} of ${D}. "Usual" below = average of the previous 3 months at the same day of the month.` : `Whole month. "Usual" = average of the previous 3 months.`}`);
  L.push(`TOTALS: income ${e(now.income)} (usual ${e(usual.income)}), expenses ${e(now.expense)} (usual ${e(usual.expense)}), saved ${e(round2(now.income - now.expense))} (usual ${e(round2(usual.income - usual.expense))})${now.income ? `, savings rate ${pct(now.income - now.expense, now.income)}%` : ''}.`);

  // pace: where the month ends
  if (partial) {
    const left = D - d;
    const big = now.list.filter(t => t.type === 'expense' && !t.recurring_id && t.amount >= 150);
    const rec = now.list.filter(t => t.type === 'expense' && t.recurring_id);
    const variable = now.expense - big.reduce((x, t) => x + t.amount, 0) - rec.reduce((x, t) => x + t.amount, 0);
    const planned = b.mine.filter(t => t.type === 'expense' && t.date > upTo && t.date <= end).reduce((x, t) => x + t.amount, 0);
    let recDue = 0;
    for (const r of alive(s.recurring)) if (r.owner_id === b.me && r.active && r.type === 'expense') recDue += ruleDates(r, addDays(upTo, 1), end).length * r.amount;
    const proj = now.expense + (variable / d) * left + planned + recDue;
    const usualFull = round2(usual.ws.length ? [1, 2, 3].reduce((x, i) => x + span(b, addMonths(a, -i), monthEnd(addMonths(a, -i))).expense, 0) / 3 : 0);
    L.push(`PACE: day-to-day spending ${e(round2(variable / d))}/day (excluding recurring and one-offs ≥150 €). If it continues, expenses end at about ${e(round2(proj))} (usual whole month ${e(usualFull)}); this includes ${e(round2(planned + recDue))} planned/recurring still due.`);
  }

  // categories that moved the most, with why
  const ids = new Set([...now.top.keys(), ...usual.top.keys()]);
  const moves = [...ids].map(id => ({ id, ...explain(now.top.get(id), usual.top.get(id)) })).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 5);
  L.push('CATEGORIES THAT MOVED MOST (count × average = total):');
  for (const m of moves) {
    if (Math.abs(m.delta) < 5) continue;
    // a single big purchase can explain the whole change: say so, and what's left without it
    const ones = now.list.filter(t => t.type === 'expense' && !t.recurring_id && t.amount >= 150 && topOf(t.category_id, cats) === m.id);
    const oneSum = ones.reduce((x, t) => x + t.amount, 0);
    L.push(`- ${cats[m.id]?.name ?? 'Other'}: ${m.text}${ones.length ? ` — includes one-off ${ones.map(t => `${e(t.amount)}${t.note ? ` "${t.note}"` : ''}`).join(', ')}; without it ${e(round2((now.top.get(m.id)?.total ?? 0) - oneSum))} vs usual ${e(round2(usual.top.get(m.id)?.total ?? 0))}` : ''}`);
    const subs = [...new Set([...now.sub.keys(), ...usual.sub.keys()])].filter(sid => cats[sid]?.parent_id === m.id)
      .map(sid => ({ sid, ...explain(now.sub.get(sid), usual.sub.get(sid)) })).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 3);
    for (const x of subs) if (Math.abs(x.delta) >= 5) L.push(`    · ${cats[x.sid]?.name}: ${x.text}`);
    // weekdays, for the ones that went up
    if (m.delta > 0) {
      const inCat = (t: Tx) => t.type === 'expense' && topOf(t.category_id, cats) === m.id;
      const wNow = weekdayShare(now.list.filter(inCat));
      const wUsual = weekdayShare(usual.ws.flatMap(w => w.list).filter(inCat));
      if (now.list.filter(inCat).length >= 4) L.push(`    · days: now ${wNow.slice(0, 2).map(x => `${x.d} ${Math.round(x.share * 100)}%`).join(', ')}; usual ${wUsual.slice(0, 2).map(x => `${x.d} ${Math.round(x.share * 100)}%`).join(', ')}`);
    }
  }

  // income changes
  const incMoves = [...new Set([...now.inc.keys(), ...usual.inc.keys()])].map(id => ({ id, ...explain(now.inc.get(id), usual.inc.get(id)) }))
    .filter(x => Math.abs(x.delta) >= 20).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 3);
  if (incMoves.length) L.push('INCOME THAT MOVED: ' + incMoves.map(x => `${cats[x.id]?.name ?? 'Other'}: ${x.text}`).join(' | '));

  // one-offs
  const prev3From = addMonths(a, -3);
  const biggest = now.list.filter(t => t.type === 'expense').sort((x, y) => y.amount - x.amount).slice(0, 3);
  if (biggest.length) L.push('LARGEST SINGLE EXPENSES: ' + biggest.map(t => {
    const seen = b.mine.some(o => o.id !== t.id && o.type === 'expense' && o.date >= prev3From && o.date < a && o.category_id === t.category_id && (o.note ?? '') === (t.note ?? '') && Math.abs(o.amount - t.amount) <= t.amount * 0.2);
    return `${e(t.amount)} ${catName(t.category_id, cats)}${t.note ? ` "${t.note}"` : ''} on ${t.date}${t.recurring_id ? ' (recurring)' : seen ? ' (similar in previous months)' : ' (one-off)'}`;
  }).join(' | '));

  // out of the usual
  const before = span(b, prev3From, addDays(a, -1));
  const fresh = [...now.sub.entries(), ...[...now.top.entries()].filter(([id]) => !now.sub.has(id))]
    .filter(([id]) => !before.sub.has(id) && !before.top.has(id) && cats[id]).map(([id, v]) => `${catName(id, cats)} ${e(round2(v.total))}`);
  if (fresh.length) L.push(`NEW THIS MONTH (not used in the previous 3 months): ${fresh.join(', ')}`);
  const priced: string[] = [];
  for (const t of now.list) {
    if (t.type !== 'expense' || !t.recurring_id) continue;
    const prev = b.mine.filter(o => o.recurring_id === t.recurring_id && o.date < t.date).sort((x, y) => y.date.localeCompare(x.date))[0];
    if (prev && Math.abs(prev.amount - t.amount) >= 0.5) priced.push(`${t.note || catName(t.category_id, cats)} ${e(prev.amount)} → ${e(t.amount)}`);
  }
  if (priced.length) L.push(`RECURRING THAT CHANGED PRICE: ${priced.join(', ')}`);

  // budgets
  const budgets = s.prefs.budgets ?? {};
  const bl: string[] = [];
  for (const [id, lim] of Object.entries(budgets)) {
    const c = cats[id];
    if (!c || c.deleted_at || c.archived) continue;
    const joint = b.shared.has(c.parent_id ?? id);
    const spent = round2(b.all.filter(t => t.type === 'expense' && t.date >= a && t.date <= upTo && (t.category_id === id || cats[t.category_id ?? '']?.parent_id === id) && (joint || t.owner_id === b.me)).reduce((x, t) => x + t.amount, 0));
    let line = `${catName(id, cats)}${joint ? ' (joint, both of you)' : ''}: ${e(spent)} of ${e(lim)}`;
    if (spent > lim) line += `, over by ${e(round2(spent - lim))}`;
    else if (partial && spent > 0) {
      const proj = (spent / d) * D;
      line += proj > lim ? `; at this pace ${e(round2(proj))}, passes the limit around day ${Math.ceil((lim / spent) * d)}` : `; at this pace ${e(round2(proj))}, within the limit`;
    }
    bl.push(line);
  }
  if (bl.length) L.push(`BUDGETS: ${bl.join(' | ')}`);

  // work
  if (s.prefs.analytics) {
    for (const j of alive(s.jobs).filter(x => !x.archived)) {
      const w = workMonth(b, j.id, a, upTo);
      const u = [1, 2, 3].map(i => { const m = addMonths(a, -i); return workMonth(b, j.id, m, partial ? sameDayIn(m, d) : monthEnd(m)); }).filter(x => x.n);
      const avg = (k: 'n' | 'hours' | 'pay' | 'tips' | 'bonus') => (u.length ? round2(u.reduce((x, y) => x + y[k], 0) / u.length) : null);
      if (!w.n && !u.length) continue;
      if (j.kind === 'hourly') {
        const uh = u.reduce((x, y) => x + y.hours, 0), up = u.reduce((x, y) => x + y.pay + y.tips, 0);
        const wd = workByWeekday(b, j.id, addDays(upTo, -90), upTo).filter(x => x.n >= 2);
        L.push(`WORK ${j.name} (hourly + tips): ${w.n} shifts, ${num(w.hours)} h, pay ${e(w.pay)}, tips ${e(w.tips)} (${w.n ? e(round2(w.tips / w.n)) : '—'}/shift), ${w.perHour != null ? e(w.perHour) + '/h with tips' : 'no hours'}; usual ${avg('n') ?? '—'} shifts, ${avg('hours') ?? '—'} h, ${uh ? e(round2(up / uh)) + '/h' : '—'}.${wd.length >= 2 ? ` Last 90 days by weekday (€/h with tips): best ${wd.slice(0, 2).map(x => `${x.d} ${e(round2(x.rate))} (${x.n} shifts)`).join(', ')}; worst ${wd.slice(-1).map(x => `${x.d} ${e(round2(x.rate))} (${x.n} shifts)`).join('')}.` : ''}`);
      } else {
        const t = monthBonus(j, alive(s.shifts), a, today);
        if (t) L.push(`WORK ${j.name} (day pay + monthly contacts bonus: ${t.per} € per contact for all contacts, only if the month's average per worked day is at least ${t.min}, else 0): ${t.worked} days worked, ${t.planned} more planned, day pay ${e(w.pay)}; contacts ${t.contacts}, average ${num(t.avg)}/day; ${t.over ? `bonus ${e(t.bonus)}` : t.planned ? `needs ${num(t.needPerDay ?? 0)}/day on the planned days to keep the target (${t.target} total); at this pace ${t.projected} contacts → bonus ${e(t.projectedBonus)}` : `bonus so far ${e(t.bonus)}`}.`);
        else L.push(`WORK ${j.name} (day pay + sales bonus): ${w.n} days, pay ${e(w.pay)} of which bonus ${e(w.bonus)} (${w.n ? e(round2(w.bonus / w.n)) : '—'}/day); usual ${avg('n') ?? '—'} days, bonus ${avg('bonus') != null ? e(avg('bonus')!) : '—'}.`);
      }
      const owed = payPeriods(j, alive(s.shifts), s.payouts, s.transactions);
      if (owed.owed > 0) L.push(`  owed to him by ${j.name} now: ${e(owed.owed)}`);
    }
    // trading
    const strategies = alive(s.strategies).filter(x => !x.archived);
    const pnl = alive(s.pnl);
    if (strategies.length && pnl.some(p => p.date >= a && p.date <= upTo)) {
      const inM = pnl.filter(p => p.date >= a && p.date <= upTo);
      const byDay = new Map<string, number>(); for (const p of inM) byDay.set(p.date, (byDay.get(p.date) ?? 0) + p.pnl);
      const net = round2(inM.reduce((x, p) => x + p.pnl, 0));
      const wins = [...byDay.values()].filter(v => v > 0).length;
      const goal = strategies.reduce((x, st) => x + (st.goal ?? 0), 0);
      const past = [1, 2, 3].map(i => { const m = addMonths(a, -i); return pnl.filter(p => p.date >= m && p.date <= monthEnd(m)).reduce((x, p) => x + p.pnl, 0); });
      const hr = hourlyWithTips(b, a);
      L.push(`TRADING (not part of account balances): ${e(net)} over ${byDay.size} days, ${wins} winning; ${strategies.map(st => { const v = inM.filter(p => p.strategy_id === st.id); return v.length ? `${st.name} ${e(round2(v.reduce((x, p) => x + p.pnl, 0)))}` : null; }).filter(Boolean).join(', ')}${goal ? `; monthly goal ${e(goal)}` : ''}; previous 3 months ${past.map(v => e(round2(v))).join(', ')}${hr ? `; ${e(Math.abs(net))} = ${num(round2(Math.abs(net) / hr))} h of evening work at ${e(hr)}/h` : ''}.`);
    }
  }
  const hr = hourlyWithTips(b, a);
  if (hr) L.push(`HIS HOURLY PAY WITH TIPS (evening job, last 3 months): ${e(hr)}/h — use it to turn € into hours of work.`);
  return L.join('\n');
}

// ---------------------------------------------------------------- extra detail for the chat summary

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
