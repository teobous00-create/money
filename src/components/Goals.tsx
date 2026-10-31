import { motion } from 'motion/react';
import { Check, Target } from 'lucide-react';
import { useStore } from '../lib/store';
import { catStyle } from '../lib/calc';
import { money, round2, shortDate } from '../lib/format';
import { useGoals } from '../lib/goals';
import { setUi } from '../lib/ui';
import { ease } from './ui';

/** Goals with a target: a bar that fills as money goes in, and a check when it's reached. */
export function GoalsCard() {
  const goals = useGoals();
  const cats = useStore(s => s.categories);
  if (!goals.length) return null;
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <span style={{ color: 'var(--accent)', display: 'grid' }}><Target size={20} /></span>
        <span className="grow bold">Goals</span>
      </div>
      {goals.map((g, i) => {
        const done = !!g.doneOn;
        const v = Math.min(1, g.saved / g.target);
        const color = done ? 'var(--income)' : catStyle(g.id, cats).color;
        return (
          <button key={g.id} className="row" style={{ width: '100%', textAlign: 'left', padding: '8px 0', gap: 12, alignItems: 'center' }}
            onClick={() => setUi({ category: { id: g.id } })}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
                <span className="grow ellipsis" style={{ fontWeight: 600 }}>{g.name}</span>
                <span className="num small" style={{ fontWeight: 650 }}>{money(g.saved)} <span className="muted" style={{ fontWeight: 500 }}>/ {money(g.target)}</span></span>
              </div>
              {/* the jar: fills from the left, a soft shine runs over it while it's not full */}
              <div style={{ position: 'relative', height: 12, borderRadius: 8, background: 'var(--surface-3)', overflow: 'hidden', marginTop: 7 }}>
                <motion.div initial={{ width: 0 }} animate={{ width: `${v * 100}%` }} transition={{ duration: 1.1, ease, delay: 0.1 + i * 0.08 }}
                  style={{ height: '100%', borderRadius: 8, background: color, position: 'relative', overflow: 'hidden' }}>
                  {!done && v > 0.04 && (
                    <motion.span style={{ position: 'absolute', top: 0, bottom: 0, width: 36, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent)' }}
                      initial={{ left: -40 }} animate={{ left: '110%' }} transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }} />
                  )}
                </motion.div>
              </div>
              <div className="tiny muted num" style={{ marginTop: 5 }}>
                {done ? `Reached on ${shortDate(g.doneOn!)}${g.saved > g.target ? ` · ${money(round2(g.saved - g.target))} extra` : ''}`
                  : `${money(round2(g.target - g.saved))} to go · ${Math.floor(v * 100)}%`}{g.parent ? ` · ${g.parent}` : ''}
              </div>
            </div>
            {done && (
              <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 14, delay: 0.9 + i * 0.08 }}
                style={{ width: 30, height: 30, borderRadius: 15, background: 'var(--income)', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }}>
                <Check size={18} strokeWidth={3} />
              </motion.span>
            )}
          </button>
        );
      })}
    </motion.div>
  );
}
