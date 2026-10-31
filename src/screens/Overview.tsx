import { lazy, Suspense, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowDownLeft, ArrowUpRight, ChevronDown } from 'lucide-react';
import { usePeriodStats, useTxs, useSelection, topCategoryId } from '../lib/calc';
import { useStore } from '../lib/store';
import { setUi } from '../lib/ui';
import { containsToday, elapsedDays, range } from '../lib/period';
import { IconBox, Money, Bar, Segmented, ease, softSpring } from '../components/ui';
const AnalyticsView = lazy(() => import('./Analytics').then(m => ({ default: m.AnalyticsView })));
import { BudgetLine } from '../components/Budget';
import { useBudgetSpend } from '../lib/insights';
import { catName, catStyle, alive } from '../lib/calc';
import { addDays, fromISO, money, num, round2, todayISO } from '../lib/format';
import type { CatType } from '../lib/types';

let lastView: 'overview' | 'analytics' = 'overview';

export function OverviewScreen() {
  const [type, setType] = useState<CatType>('expense');
  const [expanded, setExpanded] = useState(false);
  const stats = usePeriodStats();
  const period = useStore(s => s.period);
  const cats = useStore(s => s.categories);
  const txs = useTxs();
  const sel = useSelection();
  const analyticsOn = useStore(s => !!s.prefs.analytics);
  const [view, setViewState] = useState(lastView);
  const setView = (v: typeof view) => { lastView = v; setViewState(v); };

  const net = round2(stats.income - stats.expense);
  const total = type === 'expense' ? stats.expense : stats.income;
  const ranked = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of stats.txs) if (t.type === type) { const k = topCategoryId(t.category_id, cats); m.set(k, (m.get(k) ?? 0) + t.amount); }
    return [...m.entries()].map(([id, v]) => ({ id, v: round2(v), c: cats[id] })).sort((a, b) => b.v - a.v);
  }, [stats, type, cats]);

  // ---- chart buckets
  const chart = useMemo(() => {
    if (period.mode === 'day') return null;
    let [a, b] = range(period);
    const buckets: Array<{ key: string; label: string; from: string; to: string }> = [];
    if (period.mode === 'year' || period.mode === 'all') {
      if (period.mode === 'all') {
        const dates = stats.txs.map(t => t.date).sort();
        if (!dates.length) return null;
        a = dates[0].slice(0, 7) + '-01'; b = todayISO();
      }
      const d = fromISO(a);
      const end = fromISO(b);
      const cur = new Date(d.getFullYear(), d.getMonth(), 1);
      const fmt = new Intl.DateTimeFormat('en-GB', { month: 'narrow' });
      while (cur <= end) {
        const from = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`;
        const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
        const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
        buckets.push({ key: from, label: period.mode === 'all' && cur.getMonth() === 0 ? String(cur.getFullYear()).slice(2) : fmt.format(cur), from, to });
        cur.setMonth(cur.getMonth() + 1);
      }
    } else {
      for (let d = a; d <= b; d = addDays(d, 1)) buckets.push({ key: d, label: String(fromISO(d).getDate()), from: d, to: d });
    }
    const top = ranked.slice(0, 6).map(r => r.id);
    const color = (id: string) => (top.includes(id) ? cats[id]?.color ?? '#94a3b8' : '#94a3b8');
    const t0 = todayISO();
    const cols = buckets.map(bk => {
      const m = new Map<string, number>();
      for (const t of stats.txs) {
        if (t.type !== type || t.date < bk.from || t.date > bk.to) continue;
        const k = topCategoryId(t.category_id, cats);
        const key = top.includes(k) ? k : 'other';
        m.set(key, (m.get(key) ?? 0) + t.amount);
      }
      const segs = [...m.entries()].sort((x, y) => top.indexOf(x[0]) - top.indexOf(y[0])).map(([id, v]) => ({ id, v, color: color(id) }));
      return { ...bk, segs, sum: segs.reduce((s, x) => s + x.v, 0), future: bk.from > t0, today: bk.from <= t0 && t0 <= bk.to && period.mode !== 'year' && period.mode !== 'all' };
    });
    const max = Math.max(...cols.map(c => c.sum), 1);
    const nice = niceMax(max);
    return { cols, max: nice };
  }, [period, stats, type, ranked, cats]);

  // ---- stats chips
  const days = elapsedDays(period, txs.filter(t => sel.has(t.account_id)).map(t => t.date).sort()[0]);
  const avg = days ? total / days : 0;
  const t0 = todayISO();
  const sumBetween = (from: string, to: string) => round2(txs.filter(t => t.type === type && sel.has(t.account_id) && t.date >= from && t.date <= to).reduce((s, t) => s + t.amount, 0));
  const weekStart = addDays(t0, -((fromISO(t0).getDay() + 6) % 7));
  const current = containsToday(period) || period.mode === 'all';
  const biggest = chart ? Math.max(0, ...chart.cols.map(c => c.sum)) : total;
  const chips = current
    ? [['Daily avg', avg], ['Today', sumBetween(t0, t0)], ['This week', sumBetween(weekStart, t0)]]
    : [['Daily avg', avg], [period.mode === 'year' ? 'Biggest month' : 'Biggest day', biggest], ['Entries', stats.txs.filter(t => t.type === type).length]];

  const tint = type === 'expense' ? 'var(--expense)' : 'var(--income)';
  const shown = expanded ? ranked : ranked.slice(0, 5);
  const restSum = round2(ranked.slice(5).reduce((s, r) => s + r.v, 0));

  const toggle = analyticsOn ? (
    <Segmented value={view} onChange={setView} style={{ marginBottom: 12 }}
      options={[{ value: 'overview', label: 'Overview' }, { value: 'analytics', label: 'Analytics' }]} />
  ) : null;
  if (analyticsOn && view === 'analytics') {
    return (
      <div className="screen" style={{ width: '100%' }}>
        {toggle}
        <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, ease }}><Suspense fallback={null}><AnalyticsView /></Suspense></motion.div>
      </div>
    );
  }

  return (
    <div className="screen" style={{ width: '100%' }}>
      {toggle}
      <div style={{ textAlign: 'center', padding: '2px 0 12px' }}>
        <div className="small muted" style={{ fontWeight: 600 }}>Balance</div>
        <div style={{ fontSize: 24, fontWeight: 650 }}><Money value={net} colorize sign /></div>
      </div>
      <div className="ie-row">
        {(['expense', 'income'] as const).map(k => {
          const on = type === k;
          const c = k === 'expense' ? 'var(--expense)' : 'var(--income)';
          return (
            <motion.button key={k} className="ie" whileTap={{ scale: 0.97 }} onClick={() => setType(k)}
              style={{ color: on ? '#fff' : c, background: on ? c : (k === 'expense' ? 'var(--expense-soft)' : 'var(--income-soft)') }}>
              <div className="l">{k === 'expense' ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}{k === 'expense' ? 'Expenses' : 'Income'}</div>
              <div className="v"><Money value={k === 'expense' ? stats.expense : stats.income} /></div>
            </motion.button>
          );
        })}
      </div>

      {chart && (
        <div className="card" style={{ marginTop: 12, padding: '14px 12px 10px' }}>
          <div className="chart">
            <div className="chart-grid">
              {[1, 0.5].map(f => (
                <div key={f} className="gl" style={{ top: `${(1 - f) * 100}%` }}><span>{num(chart.max * f)} €</span></div>
              ))}
            </div>
            <div className="bars">
              {chart.cols.map((c, i) => (
                <div key={c.key + type} className={`col ${c.future ? 'future' : ''} ${c.today ? 'today' : ''}`} style={{ height: c.future ? '100%' : undefined }}>
                  {!c.future && c.segs.map(s => (
                    <motion.div key={s.id} className="seg-b" style={{ height: `${(s.v / chart.max) * 100}%`, background: s.color }}
                      initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.55, ease, delay: Math.min(i * 0.012, 0.35) }} />
                  ))}
                </div>
              ))}
            </div>
            <div className="xlabels">
              {chart.cols.map((c, i) => {
                const n = chart.cols.length;
                const show = n <= 12 || i === 0 || i === n - 1 || (n > 20 && (i + 1) % 7 === 0) || (n <= 20 && i % 3 === 0);
                return show ? <span key={c.key} style={{ left: `${((i + 0.5) / n) * 100}%` }}>{c.label}</span> : null;
              })}
            </div>
          </div>
        </div>
      )}

      <div className="stat-row">
        {chips.map(([l, v], i) => (
          <motion.div key={l as string} className="stat" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.3, ease }}>
            <div className="l">{l}</div>
            <div className="v num" style={{ color: l === 'Entries' ? 'var(--ink)' : tint }}>{l === 'Entries' ? v : money(round2(v as number))}</div>
          </motion.div>
        ))}
      </div>

      <div className="section">
        <div className="list">
          {ranked.length === 0 && <div className="list-row muted small">No {type === 'expense' ? 'expenses' : 'income'} in this period.</div>}
          <AnimatePresence initial={false}>
            {shown.map((r, i) => {
              const pct = total ? r.v / total : 0;
              const color = r.c?.color ?? '#94a3b8';
              return (
                <motion.button key={r.id} className="list-row" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={softSpring} onClick={() => r.c && setUi({ catDetail: { id: r.id, type } })}>
                  <IconBox icon={r.c?.icon ?? 'circle'} color={color} round />
                  <div className="grow">
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <span className="ellipsis" style={{ fontWeight: 550 }}>{r.c?.name ?? 'Uncategorized'}</span>
                      <span className="num bold">{money(r.v)}</span>
                    </div>
                    <div className="row" style={{ gap: 8, marginTop: 6 }}>
                      <div className="grow"><Bar value={pct} color={color} delay={i * 0.04} /></div>
                      <span className="tiny bold num" style={{ color, width: 34, textAlign: 'right' }}>{Math.round(pct * 100)}%</span>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
          {ranked.length > 5 && (
            <button className="list-row" onClick={() => setExpanded(v => !v)}>
              <div className="ico round" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={softSpring} style={{ display: 'grid' }}><ChevronDown size={22} /></motion.span>
              </div>
              <span className="grow" style={{ fontWeight: 550 }}>{expanded ? 'Show less' : `${ranked.length - 5} more`}</span>
              {!expanded && <span className="num muted">{money(restSum)}</span>}
            </button>
          )}
        </div>
      </div>

      {period.mode === 'month' && <BudgetsCard anchor={period.anchor} />}
    </div>
  );
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Every category with a monthly budget, closest to (or over) its limit first. */
function BudgetsCard({ anchor }: { anchor: string }) {
  const budgets = useStore(s => s.prefs.budgets);
  const cats = useStore(s => s.categories);
  const { total: spent, joint } = useBudgetSpend(anchor);
  const list = Object.entries(budgets ?? {})
    .map(([id, limit]) => ({ id, limit, c: cats[id], spent: spent.get(id) ?? 0 }))
    .filter(x => x.c && !x.c.deleted_at && !x.c.archived && alive(cats).some(c => c.id === x.id))
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit);
  if (!list.length) return null;
  return (
    <div className="section">
      <div className="section-head"><span className="section-title">Budgets</span></div>
      <div className="list">
        {list.map(x => {
          const st = catStyle(x.id, cats);
          return (
            <button key={x.id} className="list-row" onClick={() => setUi({ catDetail: { id: x.c.parent_id ?? x.id, type: 'expense' } })}>
              <IconBox icon={st.icon} color={st.color} round size="sm" />
              <div className="grow">
                <div className="ellipsis" style={{ fontWeight: 550 }}>{catName(x.id, cats)}{joint(x.id) && <span className="badge" style={{ marginLeft: 6 }}>joint</span>}</div>
                <BudgetLine spent={x.spent} limit={x.limit} compact />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
