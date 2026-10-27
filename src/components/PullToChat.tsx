import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { haptic } from '../lib/format';

/** Pull down from the top of any screen to open the chat. Returns handlers for the content area and the hint to draw. */
export function usePullToChat(enabled: boolean, onOpen: () => void, isBlocked: () => boolean) {
  const [pull, setPull] = useState(0);
  const st = useRef<{ x: number; y: number; on: boolean } | null>(null);
  const LIMIT = 90;
  const onTouchStart = (e: React.TouchEvent) => {
    if (!enabled) return;
    const el = e.target as HTMLElement;
    if (el.closest('.sheet, .chat, input, textarea, .favs-row, .chips')) { st.current = null; return; }
    const sc = el.closest('.screen') as HTMLElement | null;
    if (!sc || sc.scrollTop > 2) { st.current = null; return; }
    const t = e.touches[0];
    st.current = { x: t.clientX, y: t.clientY, on: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = st.current;
    if (!s || isBlocked()) { if (pull) setPull(0); return; }
    const t = e.touches[0];
    const dy = t.clientY - s.y, dx = Math.abs(t.clientX - s.x);
    if (!s.on) { if (dy > 12 && dy > dx * 1.4) s.on = true; else if (dx > 14 || dy < -6) { st.current = null; return; } else return; }
    setPull(Math.max(0, Math.min(140, (dy - 12) * 0.6)));
  };
  const onTouchEnd = () => {
    if (st.current?.on && pull >= LIMIT * 0.6) { haptic(12); onOpen(); }
    st.current = null;
    setPull(0);
  };
  return { pull, ready: pull >= LIMIT * 0.6, handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd } };
}

export function PullHint({ pull, ready }: { pull: number; ready: boolean }) {
  return (
    <AnimatePresence>
      {pull > 4 && (
        <motion.div className={`pull-hint ${ready ? 'ready' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: Math.min(1, pull / 40), y: pull * 0.5, scale: 0.85 + Math.min(0.2, pull / 400) }} exit={{ opacity: 0, y: 0 }} transition={{ duration: 0.05 }}>
          <span className="pull-dot" />{ready ? 'Let go to ask' : 'Ρώτα…'}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
