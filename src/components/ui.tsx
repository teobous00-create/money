import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, useSpring, useMotionValueEvent, type PanInfo } from 'motion/react';
import { X } from 'lucide-react';
import { ICONS, tint } from '../lib/icons';
import { num } from '../lib/format';

export const spring = { type: 'spring' as const, stiffness: 420, damping: 40, mass: 0.9 };
export const softSpring = { type: 'spring' as const, stiffness: 260, damping: 32 };
export const ease = [0.32, 0.72, 0, 1] as const;

// ------------------------------------------------------------- icons

export function Icon({ name, size = 22, stroke = 1.9 }: { name: string; size?: number; stroke?: number }) {
  const C = ICONS[name] ?? ICONS.circle;
  return <C size={size} strokeWidth={stroke} />;
}

export function IconBox({ icon, color, soft = false, round = false, size = 'md', style }: {
  icon: string; color: string; soft?: boolean; round?: boolean; size?: 'sm' | 'md' | 'lg'; style?: CSSProperties;
}) {
  const px = size === 'sm' ? 18 : size === 'lg' ? 26 : 22;
  return (
    <div className={`ico ${size === 'md' ? '' : size} ${round ? 'round' : ''}`}
      style={{ background: soft ? tint(color, 0.15) : color, color: soft ? color : '#fff', ...style }}>
      <Icon name={icon} size={px} />
    </div>
  );
}

// ------------------------------------------------------------- numbers

/** Money value that glides to new values instead of jumping. */
export function Money({ value, className = '', animate = true, sign = false, colorize = false }: {
  value: number; className?: string; animate?: boolean; sign?: boolean; colorize?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useSpring(value, { stiffness: 150, damping: 26, mass: 0.7 });
  const fmt = (v: number) => (sign && v > 0.004 ? '+' : '') + num(v);
  useEffect(() => { if (animate) mv.set(value); else mv.jump(value); }, [value, animate, mv]);
  useMotionValueEvent(mv, 'change', v => { if (ref.current) ref.current.textContent = fmt(v); });
  const cls = colorize ? (value < -0.004 ? 'neg' : value > 0.004 ? 'pos' : 'zero') : '';
  return (
    <span className={`num ${cls} ${className}`}>
      <span ref={ref}>{fmt(value)}</span><span className="cur">€</span>
    </span>
  );
}

// ------------------------------------------------------------- sheets (with Android back button support)

interface Entry { id: number; close: () => void }
const stack: Entry[] = [];
let ignorePops = 0;
let nextId = 1;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) { ignorePops--; return; }
    const top = stack.pop();
    top?.close();
  });
}

function useBackButton(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const entry: Entry = { id: nextId++, close: () => closeRef.current() };
    stack.push(entry);
    history.pushState({ sheet: entry.id }, '');
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) { stack.splice(i, 1); ignorePops++; history.back(); }
    };
  }, [open]);
}

const SheetDrag = createContext<(e: RPointerEvent) => void>(() => {});

/** Any area wrapped in DragZone drags the sheet down to close it (taps still work). */
export function DragZone({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const start = useContext(SheetDrag);
  return <div className={className} style={{ touchAction: 'none', ...style }} onPointerDown={start}>{children}</div>;
}

export function Sheet({ open, onClose, title, children, full = false, right, z = 0 }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; full?: boolean; right?: ReactNode; z?: number;
}) {
  useBackButton(open, onClose);
  const controls = useDragControls();
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 500) onClose();
  };
  const start = (e: RPointerEvent) => controls.start(e);
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" style={{ zIndex: 50 + z * 2 }} onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
          <motion.div className={`sheet ${full ? 'full' : ''}`} style={{ zIndex: 51 + z * 2 }}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring}
            drag="y" dragListener={false} dragControls={controls} dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }} onDragEnd={onDragEnd}>
            <SheetDrag.Provider value={start}>
              <DragZone>
                <div className="sheet-grab" />
                {(title || right) && (
                  <div className="sheet-head">
                    <div className="sheet-title">{title}</div>
                    {right}
                    <button className="iconbtn" onClick={onClose} aria-label="Close"><X size={22} /></button>
                  </div>
                )}
              </DragZone>
              {children}
            </SheetDrag.Provider>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ------------------------------------------------------------- segmented control

let segUid = 0;
export function Segmented<T extends string>({ value, options, onChange, style }: {
  value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; style?: CSSProperties;
}) {
  const [id] = useState(() => 'seg' + segUid++);
  return (
    <div className="seg" style={style}>
      {options.map(o => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.div layoutId={id} className="seg-thumb" transition={softSpring} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- toast

type ToastMsg = { id: number; text: string; action?: { label: string; run: () => void }; onTap?: () => void; ms?: number };
let pushToast: (t: Omit<ToastMsg, 'id'>) => void = () => {};
export const toast = (text: string, action?: ToastMsg['action'], more?: { onTap?: () => void; ms?: number }) => pushToast({ text, action, ...more });

export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    pushToast = t => {
      clearTimeout(timer.current);
      setMsg({ ...t, id: Date.now() });
      timer.current = setTimeout(() => setMsg(null), t.ms ?? (t.action ? 4500 : 2600));
    };
  }, []);
  return (
    <AnimatePresence>
      {msg && (
        <motion.div key={msg.id} className="toast" initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16 }} transition={softSpring}>
          <span className="grow" role={msg.onTap ? 'button' : undefined} onClick={msg.onTap ? () => { msg.onTap!(); setMsg(null); } : undefined}>{msg.text}</span>
          {msg.action && <button onClick={() => { msg.action!.run(); setMsg(null); }}>{msg.action.label}</button>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------- misc

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />;
}

/** Circular progress ring (savings goals). */
export function Ring({ value, color, size = 40 }: { value: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={4} />
      <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeDasharray={c}
        initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v) }} transition={{ duration: 0.9, ease }} />
      <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" fontSize={size * 0.27} fontWeight={650} fill="var(--ink-2)">
        {Math.round(v * 100)}
      </text>
    </svg>
  );
}

/** Animated horizontal bar. */
export function Bar({ value, color, delay = 0 }: { value: number; color: string; delay?: number }) {
  return (
    <div className="bar">
      <motion.div style={{ background: color }} initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} transition={{ duration: 0.7, ease, delay }} />
    </div>
  );
}

export function Pressable({ children, className = '', onClick, style, onLongPress }: {
  children: ReactNode; className?: string; onClick?: () => void; style?: CSSProperties; onLongPress?: () => void;
}) {
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fired = useRef(false);
  const start = () => {
    fired.current = false;
    if (onLongPress) t.current = setTimeout(() => { fired.current = true; onLongPress(); }, 450);
  };
  const cancel = () => clearTimeout(t.current);
  return (
    <motion.button className={className} style={style} whileTap={{ scale: 0.95 }} transition={{ duration: 0.12 }}
      onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
      onContextMenu={e => e.preventDefault()}
      onClick={() => { if (!fired.current) onClick?.(); }}>
      {children}
    </motion.button>
  );
}
