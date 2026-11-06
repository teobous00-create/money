import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { money, round2, todayISO, fromISO, toISO } from '../lib/format';
import { isPending } from '../lib/txTime';
import { Segmented, ease } from './ui';
import type { Account, Tx } from '../lib/types';

// ============================================================ donut

export interface Slice { id: string; label: string; value: number; color: string }

/** Donut with the total in the middle. Tap a slice: its name, amount and share show in the middle; tap again to open it. */
export function Donut({ slices, total, onOpen, size = 210 }: { slices: Slice[]; total: number; onOpen?: (id: string) => void; size?: number }) {
  const [sel, setSel] = useState<string | null>(null);
  const r = size / 2 - 14, c = size / 2, stroke = 26, gap = slices.length > 1 ? 0.012 : 0;
  let acc = 0;
  const arcs = slices.map(s => {
    const f = total ? s.value / total : 0;
    const a0 = acc, a1 = acc + f;
    acc = a1;
    return { ...s, a0, a1, f };
  });
  const pt = (f: number, rr = r) => { const a = f * Math.PI * 2 - Math.PI / 2; return [c + rr * Math.cos(a), c + rr * Math.sin(a)]; };
  const path = (a0: number, a1: number) => {
    const s0 = a0 + gap / 2, s1 = Math.max(s0 + 0.0005, a1 - gap / 2);
    const [x0, y0] = pt(s0), [x1, y1] = pt(s1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${s1 - s0 > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const cur = arcs.find(a => a.id === sel);
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        {arcs.map((a, i) => (
          a.f >= 0.999
            ? <motion.circle key={a.id} cx={c} cy={c} r={r} fill="none" stroke={a.color} strokeWidth={stroke}
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease }} />
            : <motion.path key={a.id} d={path(a.a0, a.a1)} fill="none" stroke={a.color} strokeLinecap="butt"
              initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: sel && sel !== a.id ? 0.35 : 1, strokeWidth: sel === a.id ? stroke + 8 : stroke }}
              transition={{ duration: 0.55, ease, delay: i * 0.04, strokeWidth: { duration: 0.2 }, opacity: { duration: 0.2 } }}
              style={{ cursor: 'pointer' }} onClick={() => (sel === a.id && onOpen ? onOpen(a.id) : setSel(sel === a.id ? null : a.id))} />
        ))}
      </svg>
      <div style={{ position: 'absolute', inset: stroke + 22, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={cur?.id ?? 'total'} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.16 }}>
            {cur ? (
              <>
                <div className="small ellipsis" style={{ fontWeight: 600, color: cur.color, maxWidth: size - 2 * stroke - 60 }}>{cur.label}</div>
                <div className="num" style={{ fontSize: 22, fontWeight: 700 }}>{money(cur.value)}</div>
                <div className="tiny muted num">{Math.round(cur.f * 1000) / 10}%{onOpen && cur.id !== 'other' ? ' · tap to open' : ''}</div>
              </>
            ) : (
              <>
                <div className="num" style={{ fontSize: 24, fontWeight: 700 }}>{money(total)}</div>
                <div className="tiny muted">Total</div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============================================================ sankey

export interface Flow { id: string; label: string; value: number; color: string }

/** Income sources → total → where it went (expense categories + what's left). Ribbons widths are € amounts. */
export function Sankey({ sources, targets, onOpen }: { sources: Flow[]; targets: Flow[]; onOpen?: (id: string) => void }) {
  const W = 360, LW = 92, bar = 10, gapY = 6, SLOT = 30;   // every node gets at least a label's height, so names never overlap
  const inSum = sources.reduce((s, x) => s + x.value, 0), outSum = targets.reduce((s, x) => s + x.value, 0);
  const total = Math.max(inSum, outSum, 0.01);
  const k = 200 / total;                                     // € → px (the busier side sets the height)
  const layout = (list: Flow[]) => {
    let y = 0;
    const out = list.map(f => { const h = Math.max(2, f.value * k), slot = Math.max(h, SLOT); const n = { ...f, y: y + (slot - h) / 2, h, slot, top: y }; y += slot + gapY; return n; });
    return { out, height: y - gapY };
  };
  const l0 = layout(sources), r0 = layout(targets);
  const H = Math.max(l0.height, r0.height, total * k) + 8;
  const shift = (o: ReturnType<typeof layout>) => o.out.map(n => ({ ...n, y: n.y + (H - o.height) / 2 }));
  const L = shift(l0), R = shift(r0);
  const midH = total * k, midY = (H - midH) / 2;
  const xL = LW, xM = W / 2 - bar / 2, xR = W - LW - bar;
  const ribbon = (x0: number, y0: number, x1: number, y1: number, h: number) => {
    const mx = (x0 + x1) / 2;
    return `M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1} L ${x1} ${y1 + h} C ${mx} ${y1 + h}, ${mx} ${y0 + h}, ${x0} ${y0 + h} Z`;
  };
  let inY = midY, outY = midY;
  const label = (f: Flow & { y: number; h: number }, side: 'l' | 'r') => (
    <foreignObject x={side === 'l' ? 0 : xR + bar + 6} y={f.y + f.h / 2 - 17} width={LW - 6} height={34} style={{ overflow: 'visible' }}>
      <div onClick={() => onOpen?.(f.id)} style={{ textAlign: side === 'l' ? 'right' : 'left', paddingRight: side === 'l' ? 6 : 0, lineHeight: 1.15, cursor: onOpen ? 'pointer' : undefined }}>
        <div className="ellipsis" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink)' }}>{f.label}</div>
        <div className="num" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{money(round2(f.value))}</div>
      </div>
    </foreignObject>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {L.map((f, i) => { const d = ribbon(xL + bar, f.y, xM, inY, f.h); inY += f.h; return (
        <motion.path key={'l' + f.id} d={d} fill={f.color} initial={{ opacity: 0 }} animate={{ opacity: 0.32 }} transition={{ duration: 0.5, delay: 0.05 * i }} />
      ); })}
      {R.map((f, i) => { const d = ribbon(xM + bar, outY, xR, f.y, f.h); outY += f.h; return (
        <motion.path key={'r' + f.id} d={d} fill={f.color} initial={{ opacity: 0 }} animate={{ opacity: 0.32 }} transition={{ duration: 0.5, delay: 0.15 + 0.04 * i }} />
      ); })}
      {L.map(f => <rect key={'ln' + f.id} x={xL} y={f.y} width={bar} height={f.h} rx={3} fill={f.color} />)}
      {R.map(f => <rect key={'rn' + f.id} x={xR} y={f.y} width={bar} height={f.h} rx={3} fill={f.color} />)}
      <rect x={xM} y={midY} width={bar} height={midH} rx={3} fill="var(--ink-3)" />
      {L.map(f => <g key={'lt' + f.id}>{label(f, 'l')}</g>)}
      {R.map(f => <g key={'rt' + f.id}>{label(f, 'r')}</g>)}
    </svg>
  );
}

// ============================================================ net worth over time

type Range = '6m' | '1y' | 'all';

/** Month-end balance of the given accounts, rebuilt from their opening balances and every entry (no snapshots needed). */
export function netWorthSeries(accounts: Account[], txs: Tx[], today = todayISO()): Array<{ date: string; v: number }> {
  const ids = new Set(accounts.map(a => a.id));
  const opening = round2(accounts.reduce((s, a) => s + a.opening_balance, 0));
  const delta = (t: Tx) => {
    if (t.type === 'income') return ids.has(t.account_id) ? t.amount : 0;
    if (t.type === 'expense') return ids.has(t.account_id) ? -t.amount : 0;
    return (ids.has(t.account_id) ? -t.amount : 0) + (t.to_account_id && ids.has(t.to_account_id) ? t.amount : 0);
  };
  const list = txs.filter(t => t.date <= today && !isPending(t, today) && delta(t) !== 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return [{ date: today, v: opening }];
  const first = fromISO(list[0].date);
  const out: Array<{ date: string; v: number }> = [];
  let v = opening, i = 0;
  for (let m = new Date(first.getFullYear(), first.getMonth(), 1); ; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    let end = toISO(new Date(m.getFullYear(), m.getMonth() + 1, 0));
    if (end > today) end = today;
    while (i < list.length && list[i].date <= end) v += delta(list[i++]);
    out.push({ date: end, v: round2(v) });
    if (end >= today) break;
  }
  return out;
}

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' });
const longFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

export function NetWorthChart({ series }: { series: Array<{ date: string; v: number }> }) {
  const [range, setRange] = useState<Range>('1y');
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => (range === 'all' ? series : series.slice(-(range === '6m' ? 7 : 13))), [series, range]);
  const W = 340, H = 150, pad = 6;
  const min = Math.min(...pts.map(p => p.v)), max = Math.max(...pts.map(p => p.v));
  const lo = min === max ? min - 1 : min, hi = min === max ? max + 1 : max;
  const x = (i: number) => (pts.length === 1 ? W / 2 : pad + (i / (pts.length - 1)) * (W - 2 * pad));
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.v)}`).join(' ');
  const area = `${line} L ${x(pts.length - 1)} ${H} L ${x(0)} ${H} Z`;
  const last = pts[pts.length - 1], firstP = pts[0];
  const change = round2(last.v - firstP.v);
  const up = change >= 0, col = up ? 'var(--income)' : 'var(--expense)';
  const shown = hover != null ? pts[hover] : last;
  const zero = lo < 0 && hi > 0 ? y(0) : null;
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((_, i) => { if (Math.abs(x(i) - fx) < Math.abs(x(best) - fx)) best = i; });
    setHover(best);
  };
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div className="small muted" style={{ fontWeight: 600 }}>{hover != null ? longFmt.format(fromISO(shown.date)) : 'Over time'}</div>
          <div className="num" style={{ fontSize: 22, fontWeight: 650, color: shown.v < 0 ? 'var(--expense)' : 'var(--ink)' }}>{money(shown.v)}</div>
          {hover == null && pts.length > 1 && (
            <div className="tiny bold num" style={{ color: col }}>{up ? '+' : '−'}{money(Math.abs(change))} since {monthFmt.format(fromISO(firstP.date))}</div>
          )}
        </div>
        <Segmented value={range} onChange={v => { setRange(v); setHover(null); }} style={{ width: 150 }}
          options={[{ value: '6m', label: '6M' }, { value: '1y', label: '1Y' }, { value: 'all', label: 'All' }]} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 12, touchAction: 'pan-y', display: 'block' }}
        onPointerDown={pick} onPointerMove={e => e.buttons && pick(e)} onPointerLeave={() => setHover(null)} onPointerUp={() => setTimeout(() => setHover(null), 1600)}>
        <defs>
          <linearGradient id="nwfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={up ? '#16a34a' : '#dc2626'} stopOpacity="0.28" />
            <stop offset="100%" stopColor={up ? '#16a34a' : '#dc2626'} stopOpacity="0" />
          </linearGradient>
        </defs>
        {zero != null && <line x1={0} x2={W} y1={zero} y2={zero} stroke="var(--line)" strokeDasharray="4 4" />}
        <motion.path key={range + 'a'} d={area} fill="url(#nwfill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
        <motion.path key={range + 'l'} d={line} fill="none" stroke={col} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease }} />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--ink-3)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(pts[hover].v)} r={5} fill={col} stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
      </svg>
      <div className="row tiny faint" style={{ justifyContent: 'space-between', marginTop: 4 }}>
        <span>{monthFmt.format(fromISO(firstP.date))}</span><span>{monthFmt.format(fromISO(last.date))}</span>
      </div>
    </div>
  );
}
