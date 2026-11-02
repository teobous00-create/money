import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Sparkles, X, Wallet, Target, TrendingUp, PiggyBank } from 'lucide-react';
import { useStore } from '../lib/store';
import { alive, catName } from '../lib/calc';
import { addDays, money, todayISO } from '../lib/format';
import { setUi } from '../lib/ui';
import { useBudgetSpend } from '../lib/insights';
import { goalIds, goalRows } from '../lib/goals';
import { isPending } from '../lib/txTime';
import { payPeriods, periodLabel } from '../lib/tracker';
import { ease } from './ui';

/**
 * Lumen's heads-ups, worked out on the phone (no AI): a budget at 80% / over, an entry far above its usual
 * size, a goal just reached, a finished pay period still not marked paid 3 days later. Each one can be
 * dismissed; it comes back only for a new event (next month, another entry…).
 */
interface Alert { key: string; kind: 'budget' | 'unusual' | 'goal' | 'pay'; text: string; sub?: string; go?: () => void }

const KEY = 'money:lumen-dismissed';
const loadDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };

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
    return out;
  }, [analytics, me, prefs, cats, txs, jobs, shifts, payouts, spend, today]);

  const shown = alerts.filter(a => !dismissed.includes(a.key));
  const dismiss = (key: string) => {
    const next = [...dismissed, key].slice(-300);
    setDismissed(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const Icon = { budget: Wallet, unusual: TrendingUp, goal: Target, pay: PiggyBank };
  const color = { budget: 'var(--warn)', unusual: 'var(--expense)', goal: 'var(--income)', pay: 'var(--accent)' };

  return (
    <AnimatePresence initial={false}>
      {shown.length > 0 && (
        <motion.div className="card lumen-card" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease }}>
          <div className="row tiny bold" style={{ gap: 6, color: 'var(--accent)', marginBottom: 4 }}><Sparkles size={14} />Lumen</div>
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
  );
}
