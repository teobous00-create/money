import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Sparkles, X, Wallet, Target, TrendingUp, PiggyBank, Users } from 'lucide-react';
import { useStore } from '../lib/store';
import { alive, catName, catStyle, useSharedRoots } from '../lib/calc';
import { addDays, money, num, todayISO } from '../lib/format';
import { setUi } from '../lib/ui';
import { useBudgetSpend } from '../lib/insights';
import { goalIds, goalRows } from '../lib/goals';
import { isPending } from '../lib/txTime';
import { payPeriods, periodLabel } from '../lib/tracker';
import { ease, IconBox, Sheet } from './ui';
import type { Tx } from '../lib/types';

/**
 * Luna's heads-ups, worked out on the phone (no AI): a budget at 80% / over, an entry far above its usual
 * size, a goal just reached, a finished pay period still not marked paid 3 days later, and what your partner
 * spent on shared categories in the last 24 hours. Each one can be
 * dismissed; it comes back only for a new event (next month, another entry…).
 */
interface Alert { key: string; kind: 'budget' | 'unusual' | 'goal' | 'pay' | 'shared'; text: string; sub?: string; go?: () => void }

const KEY = 'money:lumen-dismissed';
const loadDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const DAY_MS = 24 * 3600 * 1000;
/** Added in the last 24 hours (when it was entered; an entry without that time counts by its date: today or yesterday). */
const lastDay = (t: Tx, now: number, today: string) =>
  t.date <= today && (t.created_at ? Date.parse(t.created_at) >= now - DAY_MS : t.date >= addDays(today, -1));

export function LumenAlerts() {
  const analytics = useStore(s => !!s.prefs.analytics);
  const me = useStore(s => s.user?.id ?? '');
  const prefs = useStore(s => s.prefs);
  const cats = useStore(s => s.categories);
  const txs = useStore(s => s.transactions);
  const jobs = useStore(s => s.jobs);
  const shifts = useStore(s => s.shifts);
  const payouts = useStore(s => s.payouts);
  const today = todayISO();
  const spend = useBudgetSpend(today);
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  const profiles = useStore(s => s.profiles);
  const shared = useSharedRoots();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5 * 60 * 1000); return () => clearInterval(t); }, []);   // the 24 hours move on
  const [partner, setPartner] = useState<string | null>(null);   // whose shared entries are open

  const alerts = useMemo(() => {
    if (!analytics) return [];
    const out: Alert[] = [];
    const month = today.slice(0, 7);

    // budgets this month
    for (const [id, lim] of Object.entries(prefs.budgets ?? {})) {
      if (!lim || !cats[id] || cats[id].deleted_at) continue;
      const spent = (spend.joint(id) ? spend.total : spend.mine).get(id) ?? 0;
      const name = catName(id, cats, false);
      if (spent > lim + 0.004) out.push({ key: `b:${id}:${month}:100`, kind: 'budget', text: `${name}: over budget by ${money(spent - lim)}`, sub: `${money(spent)} of ${money(lim)} this month` });
      else if (spent >= lim * 0.8) out.push({ key: `b:${id}:${month}:80`, kind: 'budget', text: `${name}: ${Math.round((spent / lim) * 100)}% of the budget`, sub: `${money(lim - spent)} left for the rest of the month` });
    }

    // an entry far above its usual size (last 7 days, against the 120 days before it)
    const goals = goalIds(prefs.goals, cats);
    const mine = alive(txs).filter(t => t.owner_id === me && t.type === 'expense' && t.category_id && !goals.has(t.category_id) && !isPending(t, today));
    const since = addDays(today, -120), week = addDays(today, -6);
    for (const t of mine) {
      if (t.date < week || t.amount < 20) continue;
      const others = mine.filter(x => x.category_id === t.category_id && x.id !== t.id && x.date >= since && x.date <= today);
      if (others.length < 5) continue;
      const avg = others.reduce((x, y) => x + y.amount, 0) / others.length;
      if (t.amount >= avg * 3) out.push({ key: `u:${t.id}`, kind: 'unusual', text: `${catName(t.category_id, cats, false)} ${money(t.amount)}: ${Math.round(t.amount / avg)}× your usual`, sub: `usually ${money(avg)} · tap to check it`, go: () => setUi({ addTx: { editId: t.id } }) });
    }

    // a goal reached in the last 14 days
    for (const g of goalRows({ prefs, categories: cats, transactions: txs }, today)) {
      if (g.doneOn && g.doneOn >= addDays(today, -13)) out.push({ key: `g:${g.id}`, kind: 'goal', text: `${g.name}: goal reached`, sub: `${money(g.target)} put in · ${g.doneOn}` });
    }

    // a finished pay period still owed 3 days after it ended (only the last ~6 weeks)
    for (const j of alive(jobs).filter(x => !x.archived)) {
      const { list } = payPeriods(j, alive(shifts), payouts, txs);
      for (const p of list) {
        if (p.current || p.owed <= 0.004 || addDays(p.end, 3) >= today || p.end < addDays(today, -45)) continue;
        out.push({ key: `p:${j.id}:${p.start}`, kind: 'pay', text: `${j.name} ${periodLabel(p)}: ${money(p.owed)} not marked as paid`, sub: 'Got it? Tap to enter it', go: () => setUi({ tab: 'tracker', payJob: j.id }) });
      }
    }
    // what a partner spent on shared categories in the last 24 hours (one line per person, back for each new entry)
    const byOwner = new Map<string, Tx[]>();
    for (const t of alive(txs)) {
      if (t.owner_id === me || t.type !== 'expense' || !t.category_id || isPending(t, today) || !lastDay(t, now, today)) continue;
      if (!shared.has(cats[t.category_id]?.parent_id ?? t.category_id)) continue;
      byOwner.set(t.owner_id, [...(byOwner.get(t.owner_id) ?? []), t]);
    }
    for (const [owner, list] of byOwner) {
      const total = list.reduce((x, t) => x + t.amount, 0);
      const newest = list.reduce((a, b) => ((b.created_at ?? b.date) > (a.created_at ?? a.date) ? b : a));
      out.push({ key: `s:${owner}:${newest.id}`, kind: 'shared', text: `${profiles[owner]?.display_name ?? 'Partner'}: ${money(total)} on shared`, sub: `${list.length} ${list.length === 1 ? 'entry' : 'entries'} in the last 24 hours · tap to see`, go: () => setPartner(owner) });
    }
    return out;
  }, [analytics, me, prefs, cats, txs, jobs, shifts, payouts, spend, today, shared, profiles, now]);

  const partnerTxs = useMemo(() => !partner ? [] : alive(txs)
    .filter(t => t.owner_id === partner && t.type === 'expense' && t.category_id && !isPending(t, today) && lastDay(t, now, today) && shared.has(cats[t.category_id]?.parent_id ?? t.category_id))
    .sort((a, b) => (b.created_at ?? b.date).localeCompare(a.created_at ?? a.date)), [partner, txs, today, now, shared, cats]);

  const shown = alerts.filter(a => !dismissed.includes(a.key));
  const dismiss = (key: string) => {
    const next = [...dismissed, key].slice(-300);
    setDismissed(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const Icon = { budget: Wallet, unusual: TrendingUp, goal: Target, pay: PiggyBank, shared: Users };
  const color = { budget: 'var(--warn)', unusual: 'var(--expense)', goal: 'var(--income)', pay: 'var(--accent)', shared: 'var(--accent)' };

  return (
    <>
    <Sheet open={!!partner} onClose={() => setPartner(null)} title={`${partner ? profiles[partner]?.display_name ?? 'Partner' : ''} · last 24 hours`}>
      <div className="sheet-body">
        {partnerTxs.length === 0 && <div className="empty">Nothing on shared in the last 24 hours.</div>}
        <div className="list">
          {partnerTxs.map((t, i) => {
            const st = catStyle(t.category_id, cats);
            return (
              <motion.div key={t.id} className="list-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease, delay: i * 0.03 }}>
                <IconBox icon={st.icon} color={st.color} round />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 550 }}>{catName(t.category_id, cats)}</div>
                  <div className="tx-sub ellipsis">{ago(t, now)}</div>
                  {t.note && <div className="tx-note ellipsis">{t.note}</div>}
                </div>
                <span className="tx-amt num" style={{ color: 'var(--expense)' }}>−{num(t.amount)}<span className="cur">€</span></span>
              </motion.div>
            );
          })}
        </div>
        {partnerTxs.length > 1 && <div className="row small bold" style={{ justifyContent: 'space-between', padding: '12px 4px 4px' }}><span>Total</span><span className="num">{money(partnerTxs.reduce((x, t) => x + t.amount, 0))}</span></div>}
      </div>
    </Sheet>
    <AnimatePresence initial={false}>
      {shown.length > 0 && (
        <motion.div className="card lumen-card" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease }}>
          <div className="row tiny bold" style={{ gap: 6, color: 'var(--accent)', marginBottom: 4 }}><Sparkles size={14} />Luna</div>
          <AnimatePresence initial={false}>
            {shown.map(a => {
              const I = Icon[a.kind];
              return (
                <motion.div key={a.key} className="lumen-row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, x: 40 }} transition={{ duration: 0.25, ease }}>
                  <I size={18} style={{ color: color[a.kind], flex: 'none', marginTop: 2 }} />
                  <button className="grow" style={{ textAlign: 'left' }} onClick={a.go} disabled={!a.go}>
                    <div className="small" style={{ fontWeight: 600 }}>{a.text}</div>
                    {a.sub && <div className="tiny muted">{a.sub}</div>}
                  </button>
                  <button className="iconbtn" style={{ width: 30, height: 30, flex: 'none' }} aria-label="Dismiss" onClick={() => dismiss(a.key)}><X size={16} /></button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}

/** "2 h ago", "35 min ago"; by date when the entry has no time. */
function ago(t: Tx, now: number): string {
  if (!t.created_at) return t.date === todayISO() ? 'today' : 'yesterday';
  const m = Math.max(0, Math.round((now - Date.parse(t.created_at)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
