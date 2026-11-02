/**
 * "What if" for the AI, computed on the phone: with the last 3 full months as the baseline (or a change
 * he describes — more/fewer shifts, spending more/less in a category, extra income, one-off amounts),
 * when does each goal close and when does each level come, month by month.
 */
import { getState, type State } from './store';
import { alive, catName } from './calc';
import { round2, todayISO } from './format';
import { norm, sameWord } from './quickparse';
import { addMonths, base, monthEnd, monthStart, span } from './aiFacts';
import { goalIds, goalRows } from './goals';
import { levelDefs, levelOf, measuresAt } from './levels';
import { shiftPay } from './tracker';

export interface ProjectInput {
  months?: number;
  shifts?: Array<{ job: string; per_month: number }>;          // +2 = two more shifts a month, −2 = two fewer
  spending?: Array<{ category: string; per_month: number }>;   // +50 = spends 50 € more a month in it, −50 = less
  income_per_month?: number;                                    // any other change in income per month (+/−)
  one_off?: Array<{ amount: number; month?: string; what?: string }>;   // −300 = a 300 € purchase; month YYYY-MM, default this month
  to_goal?: string;                                             // put the extra money into this goal
}

export const PROJECT_TOOL = {
  name: 'project',
  description: 'Projection computed on his phone: from his average of the last 3 full months (income, expenses, savings), month by month for the next months — cash, the level he would be at, when each higher level is reached, and when each goal closes. Optional changes: more/fewer shifts per month (valued at his real average pay per shift with tips), spending more/less in a category, other income change, one-off amounts, and which goal gets the extra money. Use it for "when will I reach…", "what if I…", "is it worth…" questions. Call it once without changes for the baseline and once with them to compare.',
  input_schema: {
    type: 'object',
    properties: {
      months: { type: 'integer', minimum: 1, maximum: 36, description: 'how far ahead, default 12' },
      shifts: { type: 'array', items: { type: 'object', properties: { job: { type: 'string' }, per_month: { type: 'number' } }, required: ['job', 'per_month'] } },
      spending: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, per_month: { type: 'number', description: '+ = spends more, − = spends less' } }, required: ['category', 'per_month'] } },
      income_per_month: { type: 'number' },
      one_off: { type: 'array', items: { type: 'object', properties: { amount: { type: 'number', description: '− = money out, + = money in' }, month: { type: 'string', description: 'YYYY-MM' }, what: { type: 'string' } }, required: ['amount'] } },
      to_goal: { type: 'string', description: 'goal name that gets the extra money each month' },
    },
  },
};

const words = (x: string) => norm(x).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2);
const fits = (name: string, want: string) => { const w = words(want); return w.length > 0 && w.every(x => words(name).some(y => sameWord(y, x) || y === x)); };

export function runProject(q: ProjectInput, s: State = getState(), today = todayISO()): string {
  const n = Math.min(36, Math.max(1, Math.round(q.months ?? 12)));
  const b = base(s, today);
  const cur = monthStart(today);
  const notes: string[] = [];

  // baseline: the 3 full months before this one
  const from = addMonths(cur, -3), to = monthEnd(addMonths(cur, -1));
  const w = span(b, from, to);
  const gIds = goalIds(s.prefs.goals, s.categories);
  const toGoals = w.list.filter(t => t.type === 'expense' && t.category_id && gIds.has(t.category_id)).reduce((x, t) => x + t.amount, 0);
  const income = round2(w.income / 3), expenses = round2(w.expense / 3), intoGoals = round2(toGoals / 3);
  const net = round2(income - expenses);   // what's left each month after everything, goals included

  // the change he describes, € per month
  let delta = 0;
  const parts: string[] = [];
  const recent = alive(s.shifts).filter(x => x.date >= from && x.date <= to);
  for (const c of q.shifts ?? []) {
    const job = alive(s.jobs).find(j => !j.archived && (fits(j.name, c.job) || (j.kind === 'daily' ? /πρωι|morning|day/ : /απογευ|βραδ|evening|night/).test(norm(c.job))));
    if (!job) { notes.push(`no job matches "${c.job}"`); continue; }
    const sh = recent.filter(x => x.job_id === job.id);
    if (!sh.length) { notes.push(`no ${job.name} shifts in the baseline months to value a shift`); continue; }
    const tips = sh.reduce((x, y) => { const t = y.tips_tx_id ? s.transactions[y.tips_tx_id] : null; return x + (t && !t.deleted_at ? t.amount : 0); }, 0);
    const per = round2((sh.reduce((x, y) => x + shiftPay(job, y), 0) + tips) / sh.length);
    const v = round2(per * c.per_month);
    delta += v; parts.push(`${c.per_month > 0 ? '+' : ''}${c.per_month} ${job.name} shifts × ${per} (avg per shift${job.kind === 'hourly' ? ' with tips' : ', bonus not included'}) = ${v}`);
  }
  let spendDelta = 0;
  for (const c of q.spending ?? []) {
    const cat = Object.values(s.categories).find(x => !x.deleted_at && x.type === 'expense' && fits(x.name, c.category));
    const label = cat ? catName(cat.id, s.categories) : c.category;
    if (!cat) notes.push(`no category matches "${c.category}" — counted anyway`);
    delta -= c.per_month; spendDelta += c.per_month;
    parts.push(`${label} ${c.per_month > 0 ? '+' : ''}${c.per_month}/month spending`);
  }
  if (q.income_per_month) { delta += q.income_per_month; parts.push(`other income ${q.income_per_month > 0 ? '+' : ''}${q.income_per_month}/month`); }
  delta = round2(delta);
  const oneOff = new Map<string, number>();
  for (const o of q.one_off ?? []) { const m = o.month ? `${o.month.slice(0, 7)}-01` : cur; oneOff.set(m, (oneOff.get(m) ?? 0) + o.amount); parts.push(`one-off ${o.amount} in ${m.slice(0, 7)}${o.what ? ` (${o.what})` : ''}`); }

  // goals: their own pace, plus the extra if he names one
  const goals = goalRows(s, today).filter(g => !g.doneOn);
  const goal = q.to_goal ? goals.find(g => fits(g.name, q.to_goal!)) : null;
  if (q.to_goal && !goal) notes.push(`no open goal matches "${q.to_goal}"`);
  const pace = (id: string) => {
    const inside = new Set([id, ...Object.values(s.categories).filter(c => c.parent_id === id).map(c => c.id)]);
    return round2(w.list.filter(t => t.type === 'expense' && t.category_id && inside.has(t.category_id)).reduce((x, t) => x + t.amount, 0) / 3);
  };

  // month by month
  const defs = levelDefs(s);
  const m0 = measuresAt(s, today);
  const start = levelOf(defs, m0).level;
  const reached = new Map<number, string>();
  const path: string[] = [];
  let cash = m0.cash;
  const goalLeft = new Map(goals.map(g => [g.id, g.target - g.saved]));
  const goalDone = new Map<string, string>();
  for (let k = 0; k < n; k++) {
    const m = addMonths(cur, k);
    // the extra put into the named goal is spent (goal entries are expenses), until the goal closes
    let intoGoal = 0;
    for (const g of goals) {
      if (goalDone.has(g.id)) continue;
      const extra = goal?.id === g.id ? Math.min(Math.max(0, delta), Math.max(0, goalLeft.get(g.id)! - pace(g.id))) : 0;
      intoGoal += extra;
      const left = goalLeft.get(g.id)! - pace(g.id) - extra;
      goalLeft.set(g.id, left);
      if (left <= 0.004) goalDone.set(g.id, m.slice(0, 7));
    }
    cash += net + delta - intoGoal + (oneOff.get(m) ?? 0);
    const lv = levelOf(defs, { ...m0, cash: round2(cash), expenses: round2(m0.expenses + spendDelta) }).level;
    for (let L = start + 1; L <= lv; L++) if (!reached.has(L)) reached.set(L, m.slice(0, 7));
    path.push(`${m.slice(0, 7)}: cash ${round2(cash)} → ${defs[lv].name}`);
  }
  if (goal) notes.push(`the extra ${Math.max(0, delta)}/month goes to ${goal.name} until it closes, so cash only grows by the rest`);
  notes.push('cash = everyday + savings accounts (not trading or investments), starting from today\'s balance; the current month counts as a full month; assumes the baseline months repeat and passive income stays where it is');

  return JSON.stringify({
    baseline: { months: `${from.slice(0, 7)} – ${to.slice(0, 7)}`, income_per_month: income, expenses_per_month: expenses, of_which_into_goals: intoGoals, left_per_month: net },
    change: parts.length ? { per_month: delta, parts } : 'none',
    with_change_left_per_month: round2(net + delta),
    level_now: defs[start].name,
    levels_reached: Object.fromEntries([...reached.entries()].map(([L, m]) => [defs[L].name, m])),
    not_reached_in_horizon: defs.slice(start + 1).filter((_, i) => !reached.has(start + 1 + i)).map(d => d.name),
    goals: goals.map(g => ({ name: g.name, left: round2(g.target - g.saved), pace_per_month: pace(g.id), closes: goalDone.get(g.id) ?? `not within ${n} months` })),
    path,
    notes,
  });
}
