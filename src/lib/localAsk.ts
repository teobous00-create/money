/**
 * More questions answered on the phone, no AI:
 *  - work:     "πόσες ώρες δούλεψα αυτόν τον μήνα", "πόσα μου χρωστάει η απογευματινή",
 *              "πόσες επαφές θέλω για το μπόνους", "πόσα θα βγάλω τον Νοέμβριο"
 *  - budgets:  "budget καφές 60", "σβήσε το budget του καφέ", "πόσα μου μένουν για καφέ"
 *  - compare:  "καφές αυτόν τον μήνα σε σχέση με τον προηγούμενο", "πού ξόδεψα τα περισσότερα"
 *  - trading:  "πόσα έβγαλε το DDG αυτόν τον μήνα", "πόσα έβγαλαν οι στρατηγικές σήμερα"
 *  - pace:     "πόσα μπορώ να ξοδεύω τη μέρα"
 * Returns false whenever it isn't sure, and the phrase goes on as before.
 */
import { getState, setBudget } from './store';
import { alive, catName, computeBalances, defaultSelection, ruleDates } from './calc';
import { addDays, fromISO, money, num, round2, shortDate, toISO, todayISO } from './format';
import { like, norm, parseQuick, sameWord } from './quickparse';
import { isPending } from './txTime';
import { voiceCtxNow } from './voiceRun';
import { DAY_ALIASES, EVE_ALIASES, findStrategy } from './voice';
import { monthBonus, payPeriods, periodLabel, shiftParts } from './tracker';
import { LEAD, period, toks, type Range } from './localCmd';
import { toast } from '../components/ui';
import type { Category, Job, Strategy, Tx } from './types';

const say = (text: string, ms = 10000) => { toast(text, undefined, { ms }); return true; };
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(round2(v)))} €`;
const today = () => todayISO();
const monthRange = (future = false): Range => {
  const T = fromISO(today());
  return { from: toISO(new Date(T.getFullYear(), T.getMonth(), 1)), to: future ? toISO(new Date(T.getFullYear(), T.getMonth() + 1, 0)) : today(), label: 'this month', kind: 'month' };
};
/** a period from the words, else a single day ("χθες", "15/10"), else this month */
function rangeOf(ws: string[], used: Set<number>, future = false): Range {
  const p = period(ws, used, future);
  if (p) return p;
  const d = parseQuick(ws.filter((_, i) => !used.has(i)).join(' '), voiceCtxNow()).date;
  if (d) return { from: d, to: d, label: d === today() ? 'today' : d === addDays(today(), -1) ? 'yesterday' : shortDate(d) };
  return monthRange(future);
}
const has = (ws: string[], re: RegExp) => ws.some(w => re.test(w));

// ---------------------------------------------------------------- work

function jobsNamed(ws: string[]): Job[] {
  const jobs = alive(getState().jobs).filter(j => !j.archived);
  const named = jobs.filter(j => ws.some(w => (j.kind === 'daily' ? DAY_ALIASES : EVE_ALIASES).some(a => sameWord(w, a))
    || norm(j.name).split(/[^\p{L}\p{N}]+/u).some(x => x.length >= 3 && like(w, x))));
  return named.length ? named : jobs;
}
const shiftsOf = (job: Job) => alive(getState().shifts).filter(s => s.job_id === job.id);
const tipOf = (txId: string | null) => { const t = txId ? getState().transactions[txId] : null; return t && !t.deleted_at ? t.amount : 0; };

function work(ws: string[]): boolean {
  const jobs = alive(getState().jobs).filter(j => !j.archived);
  if (!jobs.length) return false;
  const T = today();

  // what they owe me
  if (has(ws, /^(χρωσταει|χρωστανε|χρωστουν|χρωστα|οφειλ\p{L}*|περιμενω|owe\p{L}*)$/u)) {
    const out = jobsNamed(ws).map(job => {
      const { list } = payPeriods(job, shiftsOf(job), getState().payouts, getState().transactions);
      const owed = list.filter(p => p.owed > 0.004).reverse();
      const pending = list.find(p => p.current)?.pendingBonus ?? 0;
      const sum = round2(owed.reduce((x, p) => x + p.owed, 0));
      return `${job.name}: ${money(sum)}${owed.length ? ` (${owed.map(p => `${periodLabel(p)} ${money(p.owed)}`).join(', ')})` : ''}${pending ? ` + bonus ${money(pending)} at month end` : ''}`;
    });
    return say(out.join(' · '));
  }

  // contacts for the bonus
  if (has(ws, /^(επαφ\p{L}*|contacts?|μπονουσ|bonus)$/u)) {
    const job = jobsNamed(ws).find(j => j.kind === 'daily') ?? jobs.find(j => j.kind === 'daily');
    const mb = job ? monthBonus(job, shiftsOf(job), T, T) : null;
    if (!job || !mb) return false;
    const need = mb.needPerDay != null ? ` · need ${num(mb.needPerDay)}/day on the ${mb.planned} planned days` : mb.met ? '' : ` · need ${num(mb.min)} on average`;
    return say(`${job.name}: ${mb.contacts} contacts in ${mb.worked} days · avg ${num(mb.avg)} / ${num(mb.min)}${need} · bonus ${mb.met ? money(mb.bonus) : '0 € so far'}`);
  }

  const future = has(ws, /^(θα|will)$/) || has(ws, /^(βγαλω|βγαζω|πληρωθω)$/);
  // expected pay for a month
  if (future && has(ws, /^(βγαλω|βγαζω|πληρωθω|παρω)$/)) {
    const used = new Set<number>();
    const r = period(ws, used, true) ?? monthRange(true);
    let base = 0, bonus = 0, tips = 0, tipsEst = 0;
    for (const job of jobsNamed(ws)) {
      const sh = shiftsOf(job).filter(s => s.date >= r.from && s.date <= r.to);
      for (const s of sh) { const p = shiftParts(job, s); base += p.base; bonus += p.bonus; if (s.date <= T) tips += tipOf(s.tips_tx_id); }
      const mb = monthBonus(job, shiftsOf(job), r.from, T);
      if (mb) bonus += mb.over ? mb.bonus : mb.projected * mb.per;   // assumes the target is met
      if (job.kind === 'hourly') {
        const recent = shiftsOf(job).filter(s => s.date <= T && s.date > addDays(T, -90));
        const avg = recent.length ? recent.reduce((x, s) => x + tipOf(s.tips_tx_id), 0) / recent.length : 0;
        tipsEst += avg * sh.filter(s => s.date > T).length;
      }
    }
    if (!base && !bonus && !tips) return say(`No shifts entered for ${r.label} yet`);
    const total = base + bonus + tips + tipsEst;
    return say(`${r.label[0].toUpperCase() + r.label.slice(1)}: ≈ ${money(total)} · pay ${money(base)}${bonus ? ` + bonus ${money(bonus)}` : ''} + tips ${money(tips)}${tipsEst ? ` + ≈ ${money(tipsEst)}` : ''}`);
  }

  // hours / shifts
  if (has(ws, /^(ωρ\p{L}*|hours?|βαρδι\p{L}*|shifts?|δουλεψα|δουλεψ\p{L}*|μεροκαματα)$/u)) {
    const used = new Set<number>();
    const r = rangeOf(ws, used, future);
    const lines = jobsNamed(ws).map(job => {
      const sh = shiftsOf(job).filter(s => s.date >= r.from && s.date <= r.to && (future || s.date <= T));
      const hours = round2(sh.reduce((x, s) => x + (s.hours ?? 0), 0));
      return sh.length ? `${job.name}: ${sh.length} ${job.kind === 'daily' ? 'days' : 'shifts'}${hours ? ` · ${num(hours)}h` : ''}` : `${job.name}: none`;
    });
    return say(`${r.label[0].toUpperCase() + r.label.slice(1)} · ${lines.join(' · ')}`);
  }
  return false;
}

// ---------------------------------------------------------------- budgets

const BUDGET = /^(budget|budgets|μπατζετ|προυπολογισμ\p{L}*|οριο|ορια|οριου)$/u;
const findCat = (text: string): Category | null => {
  const id = parseQuick(text, voiceCtxNow()).categoryId;
  const c = id ? getState().categories[id] : null;
  return c && c.type === 'expense' ? c : null;
};
/** spent this month in a category (+ its subcategories), mine and — in a shared one — theirs too */
function spentIn(c: Category, from: string, to: string): number {
  const s = getState(), me = s.user?.id;
  const root = c.parent_id ?? c.id;
  const shared = s.members.some(m => m.category_id === root) || s.categories[root]?.owner_id !== me;
  const ids = new Set([c.id, ...Object.values(s.categories).filter(x => x.parent_id === c.id).map(x => x.id)]);
  return round2(alive(s.transactions).filter(t => t.type === 'expense' && t.category_id && ids.has(t.category_id) && t.date >= from && t.date <= to
    && !isPending(t) && (t.owner_id === me || shared)).reduce((x, t) => x + t.amount, 0));
}

/** "budget καφές 60", "όριο 200 στο delivery", "σβήσε το budget του καφέ" */
export function tryLocalBudget(text: string): boolean {
  const ws = toks(text);
  const bi = ws.findIndex(w => BUDGET.test(w));
  if (bi < 0) return false;
  const first = ws.find(w => !LEAD.has(w)) ?? '';
  if (/^(ποσα|ποσο|ποσεσ|τι|πωσ|ποιο|ποια)$/.test(first)) return false;   // a question — tryLocalAnswer
  const removing = /^(σβησ|σβην|διεγραψ|διαγραψ|αφαιρεσ|ακυρωσ|βγαλ|delete|remove)/.test(first);
  const rest = text.split(/\s+/).filter(x => { const n = norm(x).replace(/[^\p{L}\p{N}]/gu, ''); return !BUDGET.test(n) && !/^(βαλε|κανε|ορισε|set|σβησε|σβηνε|διεγραψε|αφαιρεσε|βγαλε|ακυρωσε|remove|delete)$/.test(n); }).join(' ');
  const c = findCat(rest);
  if (!c) return false;
  const amount = removing ? null : parseQuick(rest, voiceCtxNow()).amount;
  if (!removing && amount === null) return false;
  const before = getState().prefs.budgets?.[c.id] ?? null;
  setBudget(c.id, amount && amount > 0 ? amount : null);
  const name = catName(c.id, getState().categories, false);
  toast(amount && amount > 0 ? `Budget · ${name}: ${money(amount)} a month` : `Budget · ${name} removed`, { label: 'Undo', run: () => setBudget(c.id, before) }, { ms: 6000 });
  return true;
}

function budgetLeft(ws: string[], text: string): boolean {
  if (!has(ws, /^(μενουν|μενει|απομενουν|εμειναν|εμεινε|left)$/) && !has(ws, BUDGET)) return false;
  const c = findCat(text);
  if (!c) return false;
  const m = monthRange();
  const T = fromISO(today());
  const end = toISO(new Date(T.getFullYear(), T.getMonth() + 1, 0));
  const spent = spentIn(c, m.from, m.to);
  const b = getState().prefs.budgets?.[c.id];
  const name = catName(c.id, getState().categories, false);
  if (!b) return say(`${name}: no budget set · spent ${money(spent)} this month`);
  const left = round2(b - spent);
  const days = Math.round((fromISO(end).getTime() - T.getTime()) / 864e5) + 1;
  return say(left >= 0
    ? `${name}: ${money(left)} left of ${money(b)} · ${money(round2(left / days))} a day for ${days} days`
    : `${name}: over by ${money(-left)} (${money(spent)} of ${money(b)})`);
}

// ---------------------------------------------------------------- compare and top

function myExpenses(from: string, to: string): Tx[] {
  const s = getState(), me = s.user?.id;
  return alive(s.transactions).filter(t => t.owner_id === me && t.type === 'expense' && t.date >= from && t.date <= to && !isPending(t));
}
function compare(ws: string[], text: string): boolean {
  if (!has(ws, /^(σχεση|συγκρι\p{L}*|vs|compare\p{L}*)$/u)) return false;
  const used = new Set<number>();
  // the period being compared is "this" one; the words about the previous one are dropped
  const cur = period(ws.map((w, i) => (PREVISH.test(ws[i - 1] ?? '') || PREVISH.test(w) ? '' : w)), used) ?? monthRange();
  if (cur.kind !== 'month' && cur.kind !== 'week') return false;
  let prev: { from: string; to: string; full: [string, string] };
  if (cur.kind === 'week') {
    const len = Math.round((fromISO(cur.to).getTime() - fromISO(cur.from).getTime()) / 864e5);
    prev = { from: addDays(cur.from, -7), to: addDays(cur.from, -7 + len), full: [addDays(cur.from, -7), addDays(cur.from, -1)] };
  } else {
    const f = fromISO(cur.from);
    const pf = new Date(f.getFullYear(), f.getMonth() - 1, 1), pl = new Date(f.getFullYear(), f.getMonth(), 0);
    const day = Math.min(fromISO(cur.to).getDate(), pl.getDate());
    prev = { from: toISO(pf), to: toISO(new Date(pf.getFullYear(), pf.getMonth(), day)), full: [toISO(pf), toISO(pl)] };
  }
  const rest = ws.filter(w => !/^(συγκρι\p{L}*|σχεση|vs|compare\p{L}*)$/u.test(w) && !PREVISH.test(w) && !/^(μηνα|μηνασ|εβδομαδα|βδομαδα|week|month)$/.test(w)).join(' ');
  const c = findCat(rest);
  const sum = (from: string, to: string) => {
    if (c) return spentIn(c, from, to);
    return round2(myExpenses(from, to).reduce((x, t) => x + t.amount, 0));
  };
  const a = sum(cur.from, cur.to), b = sum(prev.from, prev.to), full = sum(...prev.full);
  const name = c ? catName(c.id, getState().categories, false) : 'Spent';
  const same = cur.to !== prev.full[1] && prev.to !== prev.full[1];
  return say(`${name} · ${cur.label}: ${money(a)} vs ${money(b)}${same ? ' the same days before' : ' before'} (${signed(a - b)})${same ? ` · whole ${cur.kind === 'week' ? 'last week' : 'last month'}: ${money(full)}` : ''}`);
}
const PREVISH = /^(προηγουμεν\p{L}*|περασμεν\p{L}*|last|previous)$/u;

function top(ws: string[]): boolean {
  if (!has(ws, /^(περισσοτερ\p{L}*|μεγαλυτερ\p{L}*|top|most)$/u)) return false;
  const used = new Set<number>();
  const r = rangeOf(ws, used);
  const s = getState();
  const by = new Map<string, number>();
  for (const t of myExpenses(r.from, r.to)) {
    const root = t.category_id ? s.categories[t.category_id]?.parent_id ?? t.category_id : 'none';
    by.set(root, (by.get(root) ?? 0) + t.amount);
  }
  const list = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!list.length) return say(`Nothing spent ${r.label}`);
  return say(`${r.label[0].toUpperCase() + r.label.slice(1)}: ${list.map(([id, v]) => `${id === 'none' ? 'Other' : catName(id, s.categories, false)} ${money(round2(v))}`).join(' · ')}`);
}

// ---------------------------------------------------------------- trading

function strategiesNamed(ws: string[]): Strategy[] | null {
  const all = alive(getState().strategies).filter(s => !s.archived);
  if (!all.length) return null;
  const found = findStrategy(ws, all);
  if (found) return [found.s];
  return has(ws, /^(στρατηγικ\p{L}*|trading|ea|eas|bots?|strateg\p{L}*)$/u) ? all : null;
}
function trading(ws: string[]): boolean {
  const list = strategiesNamed(ws);
  if (!list) return false;
  const used = new Set<number>();
  const r = rangeOf(ws, used);
  const ids = new Set(list.map(s => s.id));
  const byDay = new Map<string, number>();
  for (const p of alive(getState().pnl)) if (ids.has(p.strategy_id) && p.date >= r.from && p.date <= r.to) byDay.set(p.date, (byDay.get(p.date) ?? 0) + p.pnl);
  const net = [...byDay.values()].reduce((x, v) => x + v, 0);
  const up = [...byDay.values()].filter(v => v > 0).length, down = [...byDay.values()].filter(v => v < 0).length;
  const goal = r.kind === 'month' ? list.reduce((x, s) => x + (s.goal ?? 0), 0) : 0;
  const name = list.length === 1 ? list[0].name : 'All strategies';
  return say(`${name} · ${r.label}: ${signed(net)}${byDay.size > 1 ? ` · ${up} up / ${down} down` : ''}${goal ? ` · goal ${money(goal)}` : ''}`);
}

// ---------------------------------------------------------------- pace

function pace(ws: string[]): boolean {
  if (!has(ws, /^(μερα|ημερα|ημερησιωσ|day|daily)$/) || !has(ws, /^(μπορω|ξοδευω|ξοδεψω|εχω|can)$/)) return false;
  const s = getState(), me = s.user?.id, T = today();
  // until the next pay period starts (16th or the 1st), when the next pay is owed
  const semi = alive(s.jobs).some(j => !j.archived && j.pay === 'semimonthly');
  const d = fromISO(T);
  const until = semi && d.getDate() < 16 ? toISO(new Date(d.getFullYear(), d.getMonth(), 16)) : toISO(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const accs = alive(s.accounts).filter(a => a.owner_id === me);
  const sel = new Set(defaultSelection(accs));
  const bal = computeBalances(accs, alive(s.transactions), T);
  let money0 = 0;
  sel.forEach(id => { money0 += bal.get(id) ?? 0; });
  // what's already planned before then (entries + repeating ones)
  const effect = (t: Pick<Tx, 'type' | 'amount' | 'account_id' | 'to_account_id'>) =>
    t.type === 'expense' ? (sel.has(t.account_id) ? -t.amount : 0) : t.type === 'income' ? (sel.has(t.account_id) ? t.amount : 0)
      : (t.to_account_id && sel.has(t.to_account_id) ? t.amount : 0) - (sel.has(t.account_id) ? t.amount : 0);
  let planned = 0;
  for (const t of alive(s.transactions)) if (t.owner_id === me && isPending(t, T) && t.date < until) planned += effect(t);
  for (const r of Object.values(s.recurring)) if (r.owner_id === me) for (const _d of ruleDates(r, addDays(T, 1), addDays(until, -1))) planned += effect(r);
  const left = round2(money0 + planned);
  const days = Math.round((fromISO(until).getTime() - d.getTime()) / 864e5);
  if (left <= 0) return say(`Until ${shortDate(until)}: ${money(left)} after what's planned — nothing to spend`);
  return say(`Until ${shortDate(until)} (${days} days): ${money(left)} after what's planned → ${money(round2(left / days))} a day`);
}

// ---------------------------------------------------------------- entry point

const ASK = /^(ποσα|ποσο|ποσεσ|ποσουσ|ποσοι|ποση|που|ποια|ποιεσ|ποιο|ποιοσ|τι|πωσ|συγκρινε|συγκριση)$/;
export function tryLocalAnswer(text: string): boolean {
  if (tryLocalBudget(text)) return true;
  const w = toks(text);
  let i = 0;
  while (i < w.length - 1 && LEAD.has(w[i])) i++;
  const ws = w.slice(i);
  const asking = ASK.test(ws[0] ?? '') || /[?;;]\s*$/.test(text.trim());
  const comparing = has(ws, /^(σχεση|συγκρι\p{L}*|vs|compare\p{L}*)$/u);
  if (!asking && !comparing) return false;
  return work(ws) || budgetLeft(ws, text) || (comparing && compare(ws, text)) || top(ws) || trading(ws) || pace(ws);
}

