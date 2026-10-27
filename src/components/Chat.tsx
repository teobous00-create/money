import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { ArrowUp, Mic, RotateCcw, ChevronDown } from 'lucide-react';
import { askClaude, aiErrorText, aiRemaining, loadChat, saveChat, type ChatItem, type QueryResult } from '../lib/ai';
import { useListen } from './QuickEntry';
import { setUi } from '../lib/ui';
import { haptic, money, num, shortDate } from '../lib/format';
import { ease, toast } from './ui';
import { applyProposal, type Proposal } from '../lib/aiActions';

const IDEAS = ['Τι να κόψω αυτόν τον μήνα;', 'Πόσα έδωσα σε delivery φέτος;', 'Ποια βάρδια μου αποδίδει περισσότερο;', 'Πώς πάει το trading σε σχέση με τη δουλειά;'];

/** Ask Claude about your money. Comes down from the top; drag it back up (or press back) to close. */
export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const drag = useDragControls();
  // the phone's back button closes it
  useEffect(() => {
    if (!open) return;
    history.pushState({ chat: true }, '');
    const pop = () => onClose();
    window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('popstate', pop); if (history.state?.chat) history.back(); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="chat" initial={{ y: '-100%' }} animate={{ y: 0 }} exit={{ y: '-100%' }} transition={{ duration: 0.38, ease }}
          drag="y" dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.7, bottom: 0 }}
          onDragEnd={(_, i) => { if (i.offset.y < -90 || i.velocity.y < -600) onClose(); }}>
          <Body onClose={onClose} startDrag={e => drag.start(e)} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Body({ onClose, startDrag }: { onClose: () => void; startDrag: (e: React.PointerEvent) => void }) {
  const [items, setItems] = useState<ChatItem[]>(loadChat);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [items.length, busy]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    haptic(8);
    const mine: ChatItem = { role: 'user', text: question, at: new Date().toISOString() };
    const next = [...items, mine];
    setItems(next); saveChat(next); setText(''); setBusy(true);
    let reply: ChatItem;
    try { reply = await askClaude(items, question); }
    catch (e) { reply = { role: 'assistant', text: aiErrorText(e), error: true, at: new Date().toISOString() }; }
    const done = [...next, reply];
    setItems(done); saveChat(done); setBusy(false);
  };
  const { listening, heard, start, supported } = useListen(t => void send(t));
  useEffect(() => { if (listening) setText(heard); }, [heard, listening]);
  const left = aiRemaining();

  return (
    <>
      <div className="chat-head" onPointerDown={startDrag}>
        <span className="chat-title">Ask</span>
        <span className="tiny muted">{left != null ? `${left} left today` : 'about your money'}</span>
        <span className="grow" />
        {items.length > 0 && (
          <button className="iconbtn" aria-label="New chat" onPointerDown={e => e.stopPropagation()} onClick={() => { setItems([]); saveChat([]); }}><RotateCcw size={19} /></button>
        )}
        <button className="iconbtn" aria-label="Close" onPointerDown={e => e.stopPropagation()} onClick={onClose}><ChevronDown size={22} style={{ transform: 'rotate(180deg)' }} /></button>
      </div>
      <div className="chat-list" ref={list}>
        {items.length === 0 && (
          <div className="chat-empty">
            <div className="small muted" style={{ marginBottom: 12 }}>Ask anything about your money — it sees your totals, budgets, work and trading, and looks up exact numbers when it needs them.</div>
            {IDEAS.map(q => <button key={q} className="chip" style={{ margin: '0 6px 8px 0' }} onClick={() => void send(q)}>{q}</button>)}
          </div>
        )}
        {items.map((m, i) => <Bubble key={i} m={m} onProposal={status => { const next = items.map((x, k) => (k === i && x.proposal ? { ...x, proposal: { ...x.proposal, status } } : x)); setItems(next); saveChat(next); }} />)}
        {busy && <div className="bubble ai"><span className="dots"><i /><i /><i /></span></div>}
      </div>
      <div className="chat-input">
        <input className="quick-input" value={text} placeholder={listening ? 'Listening…' : 'Ρώτα κάτι…'} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void send(text); }} enterKeyHint="send" />
        {text.trim() && !listening
          ? <button className="quick-btn go" aria-label="Send" onClick={() => void send(text)} disabled={busy}><ArrowUp size={19} /></button>
          : supported && (
            <button className={`quick-btn mic ${listening ? 'on' : ''}`} aria-label={listening ? 'Stop' : 'Speak'} onClick={start} disabled={busy}>
              {listening && <motion.span className="quick-pulse" initial={{ scale: 1, opacity: 0.5 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 1.1, repeat: Infinity }} />}
              <Mic size={19} />
            </button>
          )}
      </div>
      <div className="chat-grip" onPointerDown={startDrag}><span /></div>
    </>
  );
}

/** Light formatting: **bold**, bullet lines. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, k) => (p.startsWith('**') && p.endsWith('**') ? <b key={k}>{p.slice(2, -2)}</b> : p));
        return <div key={i} style={{ minHeight: line.trim() ? undefined : 8 }}>{parts}</div>;
      })}
    </>
  );
}

function Bubble({ m, onProposal }: { m: ChatItem; onProposal: (s: Proposal['status']) => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}
      className={`bubble ${m.role === 'user' ? 'me' : 'ai'} ${m.error ? 'err' : ''}`}>
      {m.results?.filter(r => r.count > 0).map((r, i) => <ResultCard key={i} r={r} />)}
      <Rich text={m.text} />
      {m.proposal && <ProposalCard p={m.proposal} onStatus={onProposal} />}
    </motion.div>
  );
}

/** What the AI wants to change. Nothing is saved until Apply; then one Undo takes it all back. */
function ProposalCard({ p, onStatus }: { p: Proposal; onStatus: (s: Proposal['status']) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? p.items : p.items.slice(0, 8);
  const apply = () => {
    haptic(12);
    const undo = applyProposal(p);
    onStatus('applied');
    toast(`✓ ${p.items.length} ${p.items.length === 1 ? 'change' : 'changes'} saved`, { label: 'Undo', run: () => { undo(); onStatus('undone'); } }, { ms: 7000 });
  };
  return (
    <div className={`pcard ${p.status}`}>
      {p.summary && <div className="small bold" style={{ marginBottom: 6 }}>{p.summary}</div>}
      {shown.map((it, i) => <div key={i} className="prow">{it.label}</div>)}
      {p.items.length > shown.length && <button className="tiny bold" style={{ color: 'var(--accent)', marginTop: 4 }} onClick={() => setAll(true)}>Show all {p.items.length}</button>}
      {p.status === 'pending' ? (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn" style={{ height: 42, flex: 1 }} onClick={apply}>Apply</button>
          <button className="btn secondary" style={{ height: 42, flex: 1 }} onClick={() => onStatus('cancelled')}>Cancel</button>
        </div>
      ) : (
        <div className="tiny bold" style={{ marginTop: 8, color: p.status === 'applied' ? 'var(--income)' : 'var(--ink-3)' }}>
          {p.status === 'applied' ? '✓ Applied' : p.status === 'undone' ? 'Undone' : 'Cancelled'}
        </div>
      )}
    </div>
  );
}

/** The exact numbers Claude looked up, with the entries behind them. */
function ResultCard({ r }: { r: QueryResult }) {
  const [all, setAll] = useState(false);
  const max = Math.max(...r.groups.map(g => g.total), 1);
  const rows = all ? r.rows : r.rows.slice(0, 4);
  return (
    <div className="qcard">
      <div className="tiny muted" style={{ fontWeight: 600 }}>{r.label} · {shortDate(r.from)} – {shortDate(r.to)}</div>
      <div className="row" style={{ alignItems: 'baseline', gap: 8, margin: '2px 0 6px' }}>
        <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{money(r.total)}</span>
        <span className="tiny muted">{r.count} {r.count === 1 ? 'entry' : 'entries'}</span>
      </div>
      {r.groups.length > 1 && (
        <div style={{ display: 'grid', gap: 4, marginBottom: 6 }}>
          {r.groups.slice(0, 12).map(g => (
            <div key={g.key} className="row tiny num" style={{ gap: 8 }}>
              <span style={{ width: 62, flex: 'none' }} className="ellipsis">{g.key}</span>
              <span className="grow"><span className="qbar" style={{ width: `${(g.total / max) * 100}%` }} /></span>
              <span style={{ width: 70, textAlign: 'right', fontWeight: 600 }}>{num(g.total)} €</span>
            </div>
          ))}
        </div>
      )}
      {rows.map(x => (
        <button key={x.id} className="qrow" onClick={() => setUi({ addTx: { editId: x.id } })}>
          <span className="tiny muted" style={{ width: 46, flex: 'none' }}>{shortDate(x.date)}</span>
          <span className="grow ellipsis small">{x.what}{x.note ? <span className="muted"> · {x.note}</span> : null}</span>
          <span className="small num bold">{num(x.amount)} €</span>
        </button>
      ))}
      {r.rows.length > 4 && !all && <button className="tiny bold" style={{ color: 'var(--accent)', marginTop: 4 }} onClick={() => setAll(true)}>Show {Math.min(r.count, 30) - 4} more</button>}
    </div>
  );
}

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
