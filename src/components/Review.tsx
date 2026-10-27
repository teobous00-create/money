import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { RotateCw, Sparkles } from 'lucide-react';
import { useStore, setPrefs, getState } from '../lib/store';
import { useTips, useCategoryCompare, useSavings, useWorkStats, useBudgetSpend, monthStart, monthEnd } from '../lib/insights';
import { usePnlByDay, useStrategies, statsFor } from '../lib/tracker';
import { useTxs, catName } from '../lib/calc';
import { fromISO, num, shortDate, todayISO } from '../lib/format';
import { writeReview, aiErrorText } from '../lib/ai';
import { ease } from './ui';

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const inflight = new Set<string>();
const n = (v: number) => num(v);

/** The month in a few lines, written by Claude from numbers the app computes. Saved once, synced to your devices. */
export function ReviewCard({ anchor }: { anchor: string }) {
  const key = anchor.slice(0, 7);
  const saved = useStore(s => s.prefs.reviews?.[key]);
  const today = todayISO();
  const [a, b] = [monthStart(anchor), monthEnd(anchor)];
  const current = today >= a && today <= b;
  const upTo = current ? today : b;
  const facts = useFacts(anchor, upTo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const make = async () => {
    if (!facts || inflight.has(key)) return;
    inflight.add(key); setBusy(true); setErr(null);
    try {
      const text = await writeReview(facts);
      setPrefs({ reviews: { ...(getState().prefs.reviews ?? {}), [key]: { text, upTo, at: new Date().toISOString() } } });
    } catch (e) { setErr(aiErrorText(e)); }
    inflight.delete(key); setBusy(false);
  };
  // first time you open a month, or a month that finished since its review was written
  useEffect(() => {
    if (!facts || a > today) return;
    if (!saved || (!current && saved.upTo < b)) void make();
  }, [key, !!facts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!facts || a > today) return null;
  return (
    <motion.div className="card review" style={{ marginBottom: 12 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <span style={{ color: 'var(--accent)', display: 'grid' }}><Sparkles size={20} /></span>
        <span className="grow bold">{monthFmt.format(fromISO(a))} in 30″</span>
        {saved && !busy && (
          <button className="iconbtn" style={{ width: 34, height: 34 }} aria-label="Write again" onClick={() => void make()}><RotateCw size={17} /></button>
        )}
      </div>
      {busy && !saved ? (
        <div className="review-skel"><span /><span /><span /><span /></div>
      ) : saved ? (
        <div className="review-text" style={{ opacity: busy ? 0.5 : 1 }}>{saved.text.split('\n').filter(l => l.trim()).map((l, i) => <div key={i}>{l}</div>)}</div>
      ) : null}
      {err && (
        <div className="small" style={{ color: 'var(--expense)', marginTop: 6 }}>
          {err} <button className="small bold" style={{ color: 'var(--accent)' }} onClick={() => void make()}>Try again</button>
        </div>
      )}
      {saved && <div className="tiny faint" style={{ marginTop: 8 }}>{saved.upTo < b ? `Up to ${shortDate(saved.upTo)}` : 'Whole month'} · written by Claude from your numbers</div>}
    </motion.div>
  );
}

/** The facts for one month, as plain lines (what Claude may use — nothing else). */
function useFacts(anchor: string, upTo: string): string | null {
  const sav = useSavings(anchor);
  const cmp = useCategoryCompare(anchor);
  const tips = useTips(anchor);
  const work = useWorkStats(anchor);
  const budget = useBudgetSpend(anchor);
  const budgets = useStore(s => s.prefs.budgets);
  const cats = useStore(s => s.categories);
  const me = useStore(s => s.user?.id);
  const txs = useTxs();
  const strategies = useStrategies();
  const allPnl = usePnlByDay('all');
  const pnlRec = useStore(s => s.pnl);
  return useMemo(() => {
    const [a, b] = [monthStart(anchor), monthEnd(anchor)];
    if (!sav.income && !sav.expense) return null;
    const L: string[] = [];
    L.push(`Month: ${monthFmt.format(fromISO(a))}${upTo < b ? ` — not over, facts up to ${upTo}` : ''}`);
    L.push(`Income ${n(sav.income)} €, expenses ${n(sav.expense)} €, saved ${n(sav.saved)} € (3-month average saved ${n(sav.avgSaved)} €)`);
    const top = cmp.slice(0, 5).map(r => `${catName(r.id, cats)} ${n(r.now)} € (avg ${n(r.avg)} €)`);
    if (top.length) L.push(`Biggest categories this month vs 3-month average: ${top.join('; ')}`);
    const big = txs.filter(t => t.owner_id === me && t.type === 'expense' && t.date >= a && t.date <= upTo).sort((x, y) => y.amount - x.amount)[0];
    if (big) L.push(`Largest single expense: ${n(big.amount)} € ${catName(big.category_id, cats)}${big.note ? ` "${big.note}"` : ''} on ${big.date}`);
    const bl = Object.entries(budgets ?? {}).filter(([id]) => cats[id] && !cats[id].deleted_at && !cats[id].archived)
      .map(([id, lim]) => { const sp = budget.total.get(id) ?? 0; return `${catName(id, cats)} ${n(sp)}/${n(lim)} €${sp > lim ? ' OVER' : ''}${budget.joint(id) ? ' (joint)' : ''}`; });
    if (bl.length) L.push(`Budgets: ${bl.join('; ')}`);
    if (tips.current.count) L.push(`Tips: ${n(tips.current.avg)} € per shift over ${tips.current.count} shifts (3-month average ${n(tips.previous.avg)} € over ${tips.previous.count})`);
    let perHour = 0;
    for (const w of work) {
      if (!w.now.shifts) continue;
      if (w.job.kind === 'hourly') { perHour = w.perHourNow ?? 0; L.push(`${w.job.name}: ${w.now.shifts} shifts, ${n(w.now.hours)} h, pay ${n(w.now.earned)} €, tips ${n(w.now.tips)} €, ${n(w.perHourNow ?? 0)} €/h with tips (3-month avg ${w.perHourAvg != null ? n(w.perHourAvg) + ' €/h' : 'n/a'})`); }
      else L.push(`${w.job.name}: ${w.now.shifts} days, pay ${n(w.now.earned)} € of which bonus ${n(w.now.bonus)} € (3-month avg bonus ${w.avg ? n(w.avg.bonus) : 'n/a'} €)`);
    }
    if (strategies.length) {
      const st = statsFor(allPnl, a, upTo);
      if (st.days) {
        const per = strategies.map(s => {
          const v = Object.values(pnlRec).filter(p => !p.deleted_at && p.strategy_id === s.id && p.date >= a && p.date <= upTo);
          return v.length ? `${s.name} ${n(v.reduce((x, p) => x + p.pnl, 0))} €` : null;
        }).filter(Boolean);
        L.push(`Trading (not in account balances): ${n(st.net)} € over ${st.days} days, ${st.winDays} winning; ${per.join(', ')}${perHour ? `; that equals about ${n(Math.abs(st.net) / perHour)} hours of evening work` : ''}`);
      }
    }
    return L.join('\n');
  }, [anchor, upTo, sav, cmp, tips, work, budget, budgets, cats, me, txs, strategies, allPnl, pnlRec]);
}
