import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Lock, Pencil, Sparkles } from 'lucide-react';
import { useLevel, useLevelHistory, type LevelState } from '../lib/levels';
import { LevelEditor } from './LevelEditor';
import { getState, setPrefs, useStore } from '../lib/store';
import { setUi, useUi } from '../lib/ui';
import { money } from '../lib/format';
import { Sheet, ease, toast } from './ui';

const monthShort = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const progressOf = (st: LevelState) => (st.next.length ? Math.min(1, ...st.next.map(n => n.met ? 1 : n.op === '<=' ? Math.max(0, Math.min(1, n.need / Math.max(n.have, 0.01))) : n.need > 0 ? Math.max(0, n.have) / n.need : 1)) : 1);
const fmt = (n: { pct: boolean }, v: number) => (n.pct ? `${Math.round(v)}%` : money(v));

/** Next to your avatar: the level and a thin bar toward the next one. Tap → everything about it. */
export function LevelBadge() {
  const st = useLevel();
  if (!st) return null;
  return (
    <motion.button whileTap={{ scale: 0.94 }} onClick={() => setUi({ levels: true })} aria-label={`Level ${st.level}`}
      style={{ display: 'grid', justifyItems: 'center', gap: 3, padding: '4px 6px', borderRadius: 12, background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
      <span className="num" style={{ fontSize: 12, fontWeight: 750, lineHeight: 1, color: 'var(--accent)' }}>Lv {st.level}</span>
      <span style={{ width: 30, height: 4, borderRadius: 2, background: 'var(--surface-3)', overflow: 'hidden' }}>
        <motion.span style={{ display: 'block', height: '100%', background: 'var(--accent)' }} initial={{ width: 0 }} animate={{ width: `${progressOf(st) * 100}%` }} transition={{ duration: 0.8, ease }} />
      </span>
    </motion.button>
  );
}

/** The level card: where you are, what the next level needs, what's already waiting, the ladder and the year. */
export function LevelSheet() {
  const open = useUi(u => !!u.levels);
  const st = useLevel();
  const [editing, setEditing] = useState(false);
  const close = () => { setUi({ levels: false }); setEditing(false); };
  const pencil = (
    <button className="iconbtn" aria-label={editing ? 'Done editing' : 'Edit levels'} onClick={() => setEditing(e => !e)}
      style={{ color: editing ? 'var(--accent)' : undefined }}>
      <Pencil size={19} />
    </button>
  );
  return (
    <Sheet open={open && !!st} onClose={close} title={editing ? 'Edit levels' : 'Level'} full right={pencil}>
      {st && (editing ? <LevelEditor defs={st.defs} done={() => setEditing(false)} /> : <LevelBody st={st} />)}
    </Sheet>
  );
}

function LevelBody({ st }: { st: LevelState }) {
  const hist = useLevelHistory();
  const LEVELS = st.defs, TOP = st.defs.length - 1;
  const L = LEVELS[st.level];
  return (
    <div className="sheet-body">
      {/* where you are */}
      <div style={{ display: 'grid', justifyItems: 'center', textAlign: 'center', margin: '4px 0 16px' }}>
        <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          style={{ width: 92, height: 92, borderRadius: 46, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <span className="num" style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}>{st.level}</span>
        </motion.div>
        <div className="bold" style={{ fontSize: 20, marginTop: 10 }}>{L.name}</div>
        <div className="small muted">{L.rule}</div>
      </div>

      {/* the next level: one bar per condition = your XP */}
      {st.level < TOP ? (
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="row" style={{ alignItems: 'baseline', marginBottom: 6 }}>
            <span className="grow bold">Level {st.level + 1} · {LEVELS[st.level + 1].name}</span>
            <span className="num small bold" style={{ color: 'var(--accent)' }}>{Math.floor(progressOf(st) * 100)}%</span>
          </div>
          <div className="tiny muted" style={{ marginBottom: 8 }}>{LEVELS[st.level + 1].rule}</div>
          {st.next.map((n, i) => {
            const v = n.op === '<=' ? (n.met ? 1 : Math.max(0, Math.min(1, n.need / Math.max(n.have, 0.01)))) : n.need > 0 ? Math.min(1, Math.max(0, n.have) / n.need) : 1;
            return (
              <div key={n.label} style={{ marginTop: i ? 10 : 0 }}>
                <div className="row tiny num" style={{ fontWeight: 600 }}>
                  <span className="grow muted">{n.label}</span>
                  <span>{fmt(n, n.have)} {n.op === '<=' ? '≤' : '/'} {fmt(n, n.need)}</span>
                </div>
                <div style={{ height: 10, borderRadius: 6, background: 'var(--surface-3)', overflow: 'hidden', marginTop: 5 }}>
                  <motion.div style={{ height: '100%', borderRadius: 6, background: n.met ? 'var(--income)' : 'var(--accent)' }}
                    initial={{ width: 0 }} animate={{ width: `${v * 100}%` }} transition={{ duration: 1, ease, delay: 0.15 + i * 0.1 }} />
                </div>
                <div className="tiny muted num" style={{ marginTop: 3 }}>{n.met ? 'Done' : n.op === '<=' ? `${fmt(n, n.have - n.need)} over` : `${fmt(n, n.need - Math.max(0, n.have))} to go`}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card small" style={{ padding: '12px 14px' }}>Top level. New levels come once you're here.</div>
      )}

      {/* unlocked, waiting */}
      {st.ready.length > 0 && (
        <div className="card" style={{ padding: '10px 14px', marginTop: 10 }}>
          {st.ready.map(n => (
            <div key={n} className="row small" style={{ gap: 8, padding: '4px 0' }}>
              <Sparkles size={16} style={{ color: 'var(--warn)', flex: 'none' }} />
              <span className="grow"><b>Level {n}</b> unlocked, waiting · {LEVELS[n].rule.toLowerCase()} ✓</span>
            </div>
          ))}
          <div className="tiny muted" style={{ marginTop: 4 }}>Counts once every level below it is reached.</div>
        </div>
      )}

      {/* the numbers behind it */}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        {([['Expenses / month', st.expenses], ['Cash after debt', st.cash], ['Passive / month', st.passive]] as const).map(([l, v]) => (
          <div key={l} className="card grow" style={{ padding: '10px 10px', minWidth: 0 }}>
            <div className="tiny muted" style={{ fontWeight: 600 }}>{l}</div>
            <div className="num bold" style={{ fontSize: 15, color: v < 0 ? 'var(--expense)' : undefined }}>{money(v)}</div>
          </div>
        ))}
      </div>
      <div className="tiny faint" style={{ margin: '6px 4px 0' }}>Expenses (without goals): average of the last 3 full months. Passive: the last 90 days ÷ 3. Cash: today's balances minus card debt, without trading capital and investments.</div>

      {/* the year */}
      {hist.length > 1 && (
        <div className="card" style={{ padding: '12px 14px 8px', marginTop: 12 }}>
          <div className="bold small" style={{ marginBottom: 10 }}>The level each month closed at</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 110 }}>
            {hist.map((h, i) => (
              <div key={h.month} style={{ flex: 1, display: 'grid', justifyItems: 'center', gap: 4, height: '100%', alignContent: 'end' }}>
                <span className="tiny num bold" style={{ color: i === hist.length - 1 ? 'var(--accent)' : 'var(--ink-2)' }}>{h.level}</span>
                <motion.div initial={{ height: 0 }} animate={{ height: `${((h.level + 0.35) / (TOP + 0.35)) * 76}px` }} transition={{ duration: 0.7, ease, delay: i * 0.04 }}
                  style={{ width: '100%', maxWidth: 22, borderRadius: 6, background: i === hist.length - 1 ? 'var(--accent)' : 'var(--surface-3)' }} />
                <span className="tiny muted">{i === hist.length - 1 ? 'Now' : monthShort.format(new Date(h.month))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* the ladder */}
      <div className="list" style={{ marginTop: 12 }}>
        {LEVELS.map((d, n) => ({ ...d, n })).reverse().map(l => {
          const here = l.n === st.level, reached = l.n <= st.level;
          return (
            <div key={l.id} className="list-row" style={{ gap: 12, background: here ? 'var(--accent-soft)' : undefined }}>
              <span className="num bold" style={{ width: 26, height: 26, borderRadius: 13, display: 'grid', placeItems: 'center', flex: 'none',
                background: reached ? 'var(--accent)' : 'var(--surface-3)', color: reached ? 'var(--bg)' : 'var(--ink-2)', fontSize: 13 }}>{l.n}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{l.name}</div>
                <div className="tiny muted">{l.rule}</div>
              </div>
              {reached ? <Check size={18} style={{ color: 'var(--income)' }} /> : st.ready.includes(l.n) ? <Sparkles size={16} style={{ color: 'var(--warn)' }} /> : <Lock size={15} className="faint" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A full-screen moment the first time you reach a new level; a quiet note if you drop one. */
export function LevelWatch() {
  const st = useLevel();
  const idle = useStore(s => s.phase === 'ready' && !s.syncing && s.pending === 0);
  const [settled, setSettled] = useState(false);   // give the first sync a moment, so old data on the phone doesn't fake a level change
  useEffect(() => { const t = setTimeout(() => setSettled(true), 6000); return () => clearTimeout(t); }, []);
  const ready = idle && settled;
  const [show, setShow] = useState<number | null>(null);
  useEffect(() => {
    if (!st || !ready) return;
    const last = getState().prefs.lastLevel;
    if (last === undefined) { setPrefs({ lastLevel: st.level }); return; }   // first time: no fanfare for where you already are
    if (st.level > last) { setShow(st.level); setPrefs({ lastLevel: st.level }); }
    else if (st.level < last) { toast(`Level ${st.level} for now · ${st.defs[st.level].name}`); setPrefs({ lastLevel: st.level }); }
  }, [st?.level, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AnimatePresence>
      {show !== null && (
        <motion.div key="lvl" onClick={() => setShow(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', backdropFilter: 'blur(4px)' }}>
          {Array.from({ length: 26 }).map((_, i) => {
            const a = (i / 26) * Math.PI * 2, d = 120 + (i % 5) * 26;
            return (
              <motion.span key={i} initial={{ x: 0, y: 0, opacity: 1, scale: 1 }} animate={{ x: Math.cos(a) * d, y: Math.sin(a) * d, opacity: 0, scale: 0.4 }}
                transition={{ duration: 1.4, ease: 'easeOut', delay: 0.25 }}
                style={{ position: 'absolute', width: 9, height: 9, borderRadius: i % 3 ? 5 : 2, background: ['var(--accent)', 'var(--warn)', 'var(--income)'][i % 3] }} />
            );
          })}
          <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}
            style={{ display: 'grid', justifyItems: 'center', textAlign: 'center', color: '#fff' }}>
            <div className="small" style={{ letterSpacing: '.2em', fontWeight: 700, opacity: 0.8 }}>LEVEL UP</div>
            <motion.div className="num" initial={{ rotate: -12 }} animate={{ rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 8, delay: 0.2 }}
              style={{ fontSize: 112, fontWeight: 850, lineHeight: 1, margin: '6px 0' }}>{show}</motion.div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{st?.defs[show]?.name}</div>
            <div className="small" style={{ opacity: 0.8, marginTop: 4, maxWidth: 260 }}>{st?.defs[show]?.rule}</div>
            <div className="tiny" style={{ opacity: 0.55, marginTop: 22 }}>Tap to continue</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

