import { useEffect, useMemo } from 'react';
import { useStore, setBudget, setPrefs, getState } from '../lib/store';
import { alive, catStyle, useTxs } from '../lib/calc';
import { fromISO, money, round2, toISO, todayISO } from '../lib/format';
import { norm } from '../lib/quickparse';
import { isPending, useTimesVersion } from '../lib/txTime';
import { setUi } from '../lib/ui';
import { BudgetLine } from './Budget';
import { IconBox } from './ui';
import type { Category } from '../lib/types';

/** What the household lives on: each category's share is shown against it. */
const BASE = 2500;

/** The budgets from the household Excel, matched to subcategories by name — written once as your budgets, then you edit them as usual. */
const EXCEL: Array<[RegExp, number]> = [
  [/supermarket|σουπερ|μαρκετ/, 350],
  [/delivery|takeout|take away|ντελιβερ/, 150],   // was 200 in the Excel; 150 now
  [/ενοικ|rent/, 245],
  [/δεη|ρευμα|electric|ηλεκτρ/, 75],
  [/νερο|ευδαπ|water/, 25],
  [/internet|ιντερνετ|wifi|cosmote|vodafone|nova/, 30],
  [/επιπλ|furniture/, 100],
  [/σκυλ|dog|κατοικιδ/, 100],
  [/αλλα|λοιπα|other|διαφορα/, 75],
];
const excelBudget = (name: string) => EXCEL.find(([re]) => re.test(norm(name)))?.[1] ?? null;
const isHome = (c: Category) => !c.parent_id && /^(σπιτι|home|household|νοικοκυριο)$/.test(norm(c.name).trim());

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const ym = (d: string) => d.slice(0, 7);

/** Σπίτι, month by month: per subcategory what you both spent, its budget, its monthly average and its share of 2.500 €. */
export function HouseholdCard({ anchor }: { anchor: string }) {
  const cats = useStore(s => s.categories);
  const budgets = useStore(s => s.prefs.budgets);
  const txs = useTxs();
  const tv = useTimesVersion();
  const data = useMemo(() => {
    const live = alive(cats);
    const root = live.find(isHome);
    if (!root) return null;
    const subs = live.filter(c => c.parent_id === root.id && !c.archived);
    const ids = new Set([root.id, ...subs.map(s => s.id)]);
    const a = fromISO(anchor);
    const from = toISO(new Date(a.getFullYear(), a.getMonth(), 1)), to = toISO(new Date(a.getFullYear(), a.getMonth() + 1, 0));
    const today = todayISO();
    const mine = txs.filter(t => t.type === 'expense' && t.category_id && ids.has(t.category_id) && !isPending(t, today));
    // spent this month
    const spent = new Map<string, number>();
    for (const t of mine) if (t.date >= from && t.date <= to) spent.set(t.category_id!, (spent.get(t.category_id!) ?? 0) + t.amount);
    // monthly average over the full months before this one (up to 12, from the first month with entries)
    const first = mine.reduce((m, t) => (t.date < m ? t.date : m), from);
    const months: string[] = [];
    for (let k = 1; k <= 12; k++) { const m = toISO(new Date(a.getFullYear(), a.getMonth() - k, 1)); if (ym(m) < ym(first)) break; months.push(ym(m)); }
    const inAvg = new Set(months);
    const past = new Map<string, number>();
    for (const t of mine) if (inAvg.has(ym(t.date))) past.set(t.category_id!, (past.get(t.category_id!) ?? 0) + t.amount);
    const rows = [{ id: root.id, name: 'General' }, ...subs.map(s => ({ id: s.id, name: s.name }))].map(r => {
      return {
        ...r, spent: round2(spent.get(r.id) ?? 0), budget: budgets?.[r.id] ?? null,
        avg: months.length ? round2((past.get(r.id) ?? 0) / months.length) : null,
      };
    }).filter(r => r.id !== root.id || r.spent > 0 || (r.avg ?? 0) > 0)
      .sort((x, y) => y.spent - x.spent || (y.avg ?? 0) - (x.avg ?? 0));
    const total = round2(rows.reduce((s, r) => s + r.spent, 0));
    const budgetTotal = round2(rows.reduce((s, r) => s + (r.budget ?? 0), 0));
    const avgTotal = months.length ? round2(rows.reduce((s, r) => s + (r.avg ?? 0), 0)) : null;
    return { root, subs, rows, total, budgetTotal, avgTotal, months: months.length, label: monthFmt.format(a) };
  }, [cats, budgets, txs, anchor, tv]); // eslint-disable-line react-hooks/exhaustive-deps
  // once: the Excel's budgets become your budgets (only where none is set; Delivery 200 → 150)
  const seeded = useStore(s => s.prefs.homeSeeded ?? 0);
  useEffect(() => {
    if (!data || seeded >= 1) return;
    const have = getState().prefs.budgets ?? {};
    for (const c of data.subs) {
      const x = excelBudget(c.name);
      if (x == null) continue;
      if (have[c.id] == null || (/delivery|ντελιβερ/.test(norm(c.name)) && have[c.id] === 200)) setBudget(c.id, x);
    }
    setPrefs({ homeSeeded: 1 });
  }, [data, seeded]);
  if (!data) return null;
  const pct = (v: number) => { const x = (v / BASE) * 100; return `${x < 10 ? (Math.round(x * 10) / 10).toString().replace('.', ',') : Math.round(x)}%`; };
  const color = catStyle(data.root.id, cats).color;
  return (
    <div className="section">
      <div className="section-head"><span className="section-title">{data.root.name} · {data.label}</span></div>
      <div className="card" style={{ padding: '12px 14px' }}>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="grow bold">Total</span>
          <span className="num bold">{money(data.total)}</span>
        </div>
        <div className="tiny muted num" style={{ marginTop: 2 }}>
          budget {money(data.budgetTotal)}{data.avgTotal != null ? ` · avg ${money(data.avgTotal)}` : ''} · {pct(data.total)} of {money(BASE)}
        </div>
      </div>
      <div className="list" style={{ marginTop: 8 }}>
        {data.rows.map(r => {
          const st = catStyle(r.id, cats);
          const note = `${r.avg != null ? `avg ${money(r.avg)} · ` : ''}${pct(r.spent)} of ${money(BASE)}`;
          return (
            // tap → the subcategory's settings, where its budget is (same budget everywhere)
            <button key={r.id} className="list-row" onClick={() => setUi(r.id === data.root.id ? { catDetail: { id: data.root.id, type: 'expense' } } : { category: { id: r.id } })}>
              <IconBox icon={st.icon} color={st.color || color} round size="sm" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontWeight: 550 }}>{r.name}</div>
                {r.budget != null
                  ? <BudgetLine spent={r.spent} limit={r.budget} compact note={note} />
                  : <div className="tiny muted num" style={{ marginTop: 4 }}><span style={{ fontWeight: 600, color: 'var(--ink)' }}>{money(r.spent)}</span> · {note}</div>}
              </div>
            </button>
          );
        })}
      </div>
      {data.months > 0 && <div className="tiny faint" style={{ padding: '6px 4px 0' }}>Average of the {data.months} full {data.months === 1 ? 'month' : 'months'} before, entries by both of you.</div>}
    </div>
  );
}
