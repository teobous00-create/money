import { useEffect, useRef, type ReactNode } from 'react';
import { motion, useAnimate } from 'motion/react';
import { budgetLevel, LEVEL_COLOR } from '../lib/insights';
import { money, round2 } from '../lib/format';
import { ease } from './ui';

/** Ring around a category icon that fills toward the monthly budget; shakes once when it goes over. */
export function BudgetRing({ spent, limit, children, size = 66 }: { spent: number; limit: number; children: ReactNode; size?: number }) {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, limit > 0 ? spent / limit : 0);
  const level = budgetLevel(spent, limit);
  const [scope, animate] = useAnimate();
  const wasOver = useRef(level === 'over');
  useEffect(() => {
    if (level === 'over' && !wasOver.current && scope.current) void animate(scope.current, { x: [0, -5, 5, -4, 4, -2, 0] }, { duration: 0.45 });
    wasOver.current = level === 'over';
  }, [level, animate, scope]);
  return (
    <div ref={scope} style={{ position: 'relative', width: size, height: size, display: 'grid', placeItems: 'center', margin: (54 - size) / 2 }}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={3} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v), stroke: LEVEL_COLOR[level] }}
          transition={{ duration: 0.8, ease }} />
      </svg>
      {children}
    </div>
  );
}

/** "112 € / 150 € · 38 € left" with a bar. */
export function BudgetLine({ spent, limit, compact = false, note }: { spent: number; limit: number; compact?: boolean; note?: string }) {
  const level = budgetLevel(spent, limit);
  const left = round2(limit - spent);
  return (
    <div style={{ marginTop: compact ? 4 : 8 }}>
      <div className={`num ${compact ? 'tiny' : 'small'}`} style={{ fontWeight: 600, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{money(spent)} / {money(limit)}</span>
        <span style={{ color: LEVEL_COLOR[level] }}>{left >= 0 ? `${money(left)} left` : `${money(-left)} over`}</span>
      </div>
      <div className="bar" style={{ marginTop: 5 }}>
        <motion.div style={{ background: LEVEL_COLOR[level] }} initial={{ width: 0 }}
          animate={{ width: `${Math.min(1, limit > 0 ? spent / limit : 0) * 100}%` }} transition={{ duration: 0.7, ease }} />
      </div>
      {note && <div className="tiny muted num" style={{ marginTop: 4 }}>{note}</div>}
    </div>
  );
}
