import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useMotionValue } from 'motion/react';
import { haptic } from '../lib/format';

/** Shared flag so other gestures (e.g. swipe to change month) ignore a reorder drag. */
export const dragState = { active: false, endedAt: 0 };
export const isDragging = () => dragState.active || Date.now() - dragState.endedAt < 450;

const HOLD_MS = 420;   // how long to hold before an item lifts
const SLOP = 10;       // finger movement (px) that cancels the hold → normal scrolling
function swallowNextClick() {
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); cleanup(); };
  const cleanup = () => { window.removeEventListener('click', stop, true); clearTimeout(t); };
  const t = setTimeout(cleanup, 500);
  window.addEventListener('click', stop, true);
}

const layoutSpring = { type: 'spring' as const, stiffness: 520, damping: 42 };

interface Props {
  ids: string[];
  render: (id: string, lifted: boolean) => ReactNode;
  onCommit: (ids: string[]) => void;      // new order after a drag
  onTap?: (id: string) => void;
  onHold?: (id: string) => void;          // held and released without moving
  className?: string;
  style?: CSSProperties;
  after?: ReactNode;                      // non-sortable content at the end (e.g. a "New" tile)
  liftScale?: number;
  handle?: boolean;                       // drag only from an element marked data-drag-handle, no hold needed
}

interface Press {
  id: string; pointerId: number; sx: number; sy: number; x: number; y: number;
  timer?: ReturnType<typeof setTimeout>; raf?: number;
  held: boolean; dragging: boolean; offX: number; offY: number; w: number; h: number;
  slots: Array<{ cx: number; cy: number }>; order: string[]; initial: string; scroller: HTMLElement | null;
}

/**
 * Hold an item, then move it: the others slide out of the way and the order updates live.
 * Works for grids (any number of columns) and lists, because the drop target is the nearest slot.
 */
export function Sortable({ ids, render, onCommit, onTap, onHold, className, style, after, liftScale = 1.1, handle = false }: Props) {
  const key = ids.join('|');
  const [order, setOrder] = useState(ids);
  const [held, setHeld] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; w: number; h: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const mounted = useRef(false);
  const fx = useMotionValue(0), fy = useMotionValue(0);
  const cb = useRef({ onCommit, onTap, onHold });
  cb.current = { onCommit, onTap, onHold };

  useEffect(() => { mounted.current = true; }, []);
  useEffect(() => { if (!press.current?.dragging) setOrder(ids); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // A non-passive touchmove listener lets us stop the page from scrolling once an item is lifted.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (press.current?.held) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const begin = (id: string, e: React.PointerEvent) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || press.current) return;
    suppressClick.current = false;
    const onHandle = !!(e.target as HTMLElement).closest('[data-drag-handle]');
    if (handle && !onHandle) return; // the rest of the row is a normal tap / scroll area
    const p: Press = {
      id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      held: false, dragging: false, offX: 0, offY: 0, w: 0, h: 0, slots: [], order: order.slice(), initial: order.join('|'),
      scroller: container.current?.closest('.screen, .sheet-body') as HTMLElement | null,
    };
    press.current = p;
    suppressClick.current = false;
    const lift = () => { p.held = true; suppressClick.current = true; haptic(12); setHeld(id); };
    if (handle) { e.preventDefault(); lift(); } else p.timer = setTimeout(lift, HOLD_MS);

    const retarget = () => {
      const c = container.current;
      if (!c) return;
      const cr = c.getBoundingClientRect();
      const cx = p.x - p.offX + p.w / 2 - cr.left, cy = p.y - p.offY + p.h / 2 - cr.top;
      let best = 0, bd = Infinity;
      p.slots.forEach((s, i) => { const d = (s.cx - cx) ** 2 + (s.cy - cy) ** 2; if (d < bd) { bd = d; best = i; } });
      const cur = p.order.indexOf(p.id);
      if (best !== cur) {
        const o = p.order.slice();
        o.splice(cur, 1);
        o.splice(best, 0, p.id);
        p.order = o;
        setOrder(o);
        haptic(4);
      }
    };
    const autoscroll = () => {
      const sc = p.scroller;
      if (!sc) return;
      const r = sc.getBoundingClientRect();
      let v = 0;
      if (p.y < r.top + 70) v = -Math.ceil((r.top + 70 - p.y) / 5);
      else if (p.y > r.bottom - 120) v = Math.ceil((p.y - (r.bottom - 120)) / 5);
      if (v) { const before = sc.scrollTop; sc.scrollTop += v; if (sc.scrollTop !== before) retarget(); }
    };
    const startDrag = () => {
      const el = els.current.get(id), c = container.current;
      if (!el || !c) return;
      const r = el.getBoundingClientRect(), cr = c.getBoundingClientRect();
      p.offX = p.sx - r.left; p.offY = p.sy - r.top; p.w = r.width; p.h = r.height;
      // slot centers (relative to the container) don't change while dragging: position is by index
      p.slots = p.order.map(oid => {
        const er = els.current.get(oid)!.getBoundingClientRect();
        return { cx: er.left + er.width / 2 - cr.left, cy: er.top + er.height / 2 - cr.top };
      });
      p.dragging = true;
      dragState.active = true;
      fx.set(p.x - p.offX); fy.set(p.y - p.offY);
      setDrag({ id, w: r.width, h: r.height });
      const tick = () => { autoscroll(); p.raf = requestAnimationFrame(tick); };
      p.raf = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== p.pointerId) return;
      p.x = ev.clientX; p.y = ev.clientY;
      const dist = Math.hypot(p.x - p.sx, p.y - p.sy);
      if (!p.held) { if (dist > SLOP) finish(false); return; }
      if (!p.dragging && dist > (handle ? 2 : 6)) startDrag();
      if (p.dragging) { fx.set(p.x - p.offX); fy.set(p.y - p.offY); retarget(); }
    };
    const up = (ev: PointerEvent) => { if (ev.pointerId === p.pointerId) finish(true); };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === p.pointerId) finish(false); };
    const finish = (released: boolean) => {
      clearTimeout(p.timer);
      if (p.raf) cancelAnimationFrame(p.raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      press.current = null;
      setHeld(null);
      setDrag(null);
      // the browser sends a click right after the finger lifts; don't let it land on whatever just opened
      if (p.held) swallowNextClick();
      if (p.dragging) {
        dragState.active = false;
        dragState.endedAt = Date.now();
        if (p.order.join('|') !== p.initial) { haptic(10); cb.current.onCommit(p.order); }
      } else if (p.held && released && !handle) {
        cb.current.onHold?.(p.id);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  return (
    <div ref={container} className={className} style={style}>
      {order.map((id, i) => {
        const dragging = drag?.id === id;
        const lifted = held === id && !drag;
        return (
          <motion.div key={id} ref={el => { if (el) els.current.set(id, el); else els.current.delete(id); }}
            layout="position"
            initial={mounted.current ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: dragging ? 0.22 : 1, scale: lifted ? liftScale - 0.02 : dragging ? 0.9 : 1 }}
            transition={{ layout: layoutSpring, default: { duration: 0.22, delay: mounted.current ? 0 : Math.min(i, 24) * 0.02 } }}
            style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none', minWidth: 0, zIndex: lifted ? 2 : undefined }}
            onPointerDown={e => begin(id, e)}
            onClick={e => {
              if (suppressClick.current) { suppressClick.current = false; return; }
              if (handle && (e.target as HTMLElement).closest('[data-drag-handle]')) return;
              cb.current.onTap?.(id);
            }}
            onContextMenu={e => e.preventDefault()}>
            {render(id, false)}
          </motion.div>
        );
      })}
      {after}
      {drag && createPortal(
        <motion.div className="lifted" style={{ position: 'fixed', left: 0, top: 0, x: fx, y: fy, width: drag.w, height: drag.h, zIndex: 200, pointerEvents: 'none' }}
          initial={{ scale: 1 + (liftScale - 1) / 2 }} animate={{ scale: liftScale }} transition={{ type: 'spring', stiffness: 400, damping: 22 }}>
          {render(drag.id, true)}
        </motion.div>,
        document.body,
      )}
    </div>
  );
}
