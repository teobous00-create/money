import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { RotateCw, Sparkles } from 'lucide-react';
import { useStore, setPrefs, getState } from '../lib/store';
import { monthStart, monthEnd } from '../lib/insights';
import { reviewFacts } from '../lib/aiFacts';
import { fromISO, shortDate, todayISO } from '../lib/format';
import { writeReview, aiErrorText } from '../lib/ai';
import { ease } from './ui';

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const inflight = new Set<string>();
const REVIEW_V = 2;   // bump when the prompt changes → reviews are written again

/** The month in a few lines, written by Claude from numbers the app computes. Saved once, synced to your devices. */
export function ReviewCard({ anchor }: { anchor: string }) {
  const key = anchor.slice(0, 7);
  const saved = useStore(s => s.prefs.reviews?.[key]);
  const today = todayISO();
  const [a, b] = [monthStart(anchor), monthEnd(anchor)];
  const current = today >= a && today <= b;
  const upTo = current ? today : b;
  const facts = useFacts(anchor);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const make = async () => {
    if (!facts || inflight.has(key)) return;
    inflight.add(key); setBusy(true); setErr(null);
    try {
      const text = await writeReview(facts);
      setPrefs({ reviews: { ...(getState().prefs.reviews ?? {}), [key]: { text, upTo, at: new Date().toISOString(), v: REVIEW_V } } });
    } catch (e) { setErr(aiErrorText(e)); }
    inflight.delete(key); setBusy(false);
  };
  // first time you open a month, or a month that finished since its review was written
  useEffect(() => {
    if (!facts || a > today) return;
    if (!saved || saved.v !== REVIEW_V || (!current && saved.upTo < b)) void make();
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
        <div className="review-text" style={{ opacity: busy ? 0.5 : 1 }}>{saved.text.split('\n').filter(l => l.trim()).map((l, i) => {
          const t = l.replace(/^#+\s*/, '').replace(/\*\*/g, '');
          const head = !/^[•\-*]/.test(l.trim()) && t.length < 40;
          return <div key={i} className={head ? 'review-h' : undefined}>{head ? t : t.replace(/^[-*]\s*/, '• ')}</div>;
        })}</div>
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

/** The facts for one month (computed on the phone — the only numbers Claude may use). */
function useFacts(anchor: string): string | null {
  const deps = [
    useStore(s => s.transactions), useStore(s => s.categories), useStore(s => s.recurring), useStore(s => s.shifts),
    useStore(s => s.jobs), useStore(s => s.pnl), useStore(s => s.strategies), useStore(s => s.prefs.budgets),
    useStore(s => s.payouts), useStore(s => s.members), useStore(s => s.accounts),
  ];
  const today = todayISO();
  return useMemo(() => reviewFacts(getState(), anchor, today), [anchor, today, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}
