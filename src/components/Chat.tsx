import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { ArrowUp, Mic, ChevronDown, MessagesSquare, SquarePen, Trash2, NotebookPen } from 'lucide-react';
import { askClaude, aiErrorText, aiRemaining, deleteConvo, getConvo, loadConvos, newConvo, saveConvo, saveNote, startingConvo, type ChatItem, type Convo, type NoteCard, type QueryResult } from '../lib/ai';
import { useListen } from './QuickEntry';
import { getUi, setUi, useUi } from '../lib/ui';
import { useStore } from '../lib/store';
import { addDays, haptic, money, num, shortDate, toISO, todayISO } from '../lib/format';
import { ease, toast, Sheet } from './ui';
import { applyProposal, type Proposal } from '../lib/aiActions';

const IDEAS = ['Τι να κόψω αυτόν τον μήνα;', 'Πόσα έδωσα σε delivery φέτος;', 'Ποια βάρδια μου αποδίδει περισσότερο;', 'Πώς πάει το trading σε σχέση με τη δουλειά;'];

/** Luna: ask about your money. Comes down from the top; drag it back up (or press back) to close. */
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
  // the conversation asked for (from the mic window), else the last one if it's recent, else a new one
  const [convo, setConvoState] = useState<Convo>(() => { const id = getUi().convo; const c = id ? getConvo(id) : null; return c ?? startingConvo(); });
  const cur = useRef(convo);
  const setConvo = (c: Convo) => { cur.current = c; setConvoState(c); };
  useEffect(() => { if (getUi().convo) setUi({ convo: null }); }, []);
  const items = convo.items;
  const [showList, setShowList] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);   // the conversation waiting for an answer
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!showList) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [items.length, busy, showList, convo.id]);

  /** saves the conversation; shows it only if it's still the one on screen */
  const commit = (c: Convo, next: ChatItem[]) => { const saved = saveConvo({ ...c, items: next }); if (cur.current.id === c.id) setConvo(saved); return saved; };
  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    haptic(8);
    setShowList(false);
    const c = cur.current;
    const before = c.items;
    const mine: ChatItem = { role: 'user', text: question, at: new Date().toISOString() };
    const withQ = commit(c, [...before, mine]);
    setText(''); setBusy(c.id);
    let reply: ChatItem;
    try { reply = await askClaude(before, question); }
    catch (e) { reply = { role: 'assistant', text: aiErrorText(e), error: true, at: new Date().toISOString() }; }
    const latest = getConvo(withQ.id) ?? withQ;
    commit(latest, [...latest.items, reply]);
    setBusy(null);
  };
  const update = (i: number, patch: Partial<ChatItem>) => commit(cur.current, cur.current.items.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const { listening, heard, start, supported } = useListen(t => void send(t));
  useEffect(() => { if (listening) setText(heard); }, [heard, listening]);
  const left = aiRemaining();
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <>
      <div className="chat-head" onPointerDown={startDrag}>
        <button className="iconbtn" aria-label="Conversations" onPointerDown={stop} onClick={() => { haptic(4); setShowList(v => !v); }}
          style={{ color: showList ? 'var(--accent)' : undefined, marginLeft: -12 }}><MessagesSquare size={21} /></button>
        <span className="chat-title">Luna</span>
        <span className="tiny muted">{left != null ? `${left} left today` : ''}</span>
        <span className="grow" />
        {(items.length > 0 || showList) && (
          <button className="iconbtn" aria-label="New conversation" onPointerDown={stop} onClick={() => { haptic(4); setConvo(newConvo()); setShowList(false); }}><SquarePen size={19} /></button>
        )}
        <button className="iconbtn" aria-label="Close" onPointerDown={stop} onClick={onClose}><ChevronDown size={22} style={{ transform: 'rotate(180deg)' }} /></button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {showList ? (
          <motion.div key="list" className="chat-list" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2, ease }}>
            <ConvoList current={convo.id} onOpen={c => { haptic(4); setConvo(c); setShowList(false); }} onDeleted={id => { if (id === cur.current.id) setConvo(newConvo()); }} />
          </motion.div>
        ) : (
          <motion.div key={'c' + convo.id} className="chat-list" ref={list} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.2, ease }}>
            {items.length === 0 && (
              <div className="chat-empty">
                <div className="small muted" style={{ marginBottom: 12 }}>Luna sees your totals, budgets, goals, levels, work and trading, looks up exact numbers when it needs them, and can work out when you'll get where you're going.</div>
                {IDEAS.map(q => <button key={q} className="chip" style={{ margin: '0 6px 8px 0' }} onClick={() => void send(q)}>{q}</button>)}
              </div>
            )}
            {items.map((m, i) => (
              <Bubble key={i} m={m}
                onProposal={status => m.proposal && update(i, { proposal: { ...m.proposal, status } })}
                onNote={status => m.note && update(i, { note: { ...m.note, status } })} />
            ))}
            {busy === convo.id && <div className="bubble ai"><span className="dots"><i /><i /><i /></span></div>}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="chat-input">
        <input className="quick-input" value={text} placeholder={listening ? 'Listening…' : 'Ρώτα τη Luna…'} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void send(text); }} enterKeyHint="send" />
        {text.trim() && !listening
          ? <button className="quick-btn go" aria-label="Send" onClick={() => void send(text)} disabled={!!busy}><ArrowUp size={19} /></button>
          : supported && (
            <button className={`quick-btn mic ${listening ? 'on' : ''}`} aria-label={listening ? 'Stop' : 'Speak'} onClick={() => { setShowList(false); start(); }} disabled={!!busy}>
              {listening && <motion.span className="quick-pulse" initial={{ scale: 1, opacity: 0.5 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 1.1, repeat: Infinity }} />}
              <Mic size={19} />
            </button>
          )}
      </div>
      <div className="chat-grip" onPointerDown={startDrag}><span /></div>
    </>
  );
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
function when(iso: string) {
  const d = new Date(iso), today = todayISO(), day = toISO(d);
  if (day === today) return timeFmt.format(d);
  if (day === addDays(today, -1)) return 'Yesterday';
  return dayFmt.format(d);
}

/** Your conversations, newest first. Tap to continue one; swipe left to delete. */
function ConvoList({ current, onOpen, onDeleted }: { current: string; onOpen: (c: Convo) => void; onDeleted: (id: string) => void }) {
  const [list, setList] = useState<Convo[]>(loadConvos);
  if (!list.length) return <div className="chat-empty small muted">No conversations yet.</div>;
  return (
    <div className="convos">
      <AnimatePresence initial={false}>
        {list.map(c => (
          <motion.div key={c.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22, ease }} className="convo-wrap">
            <div className="convo-del"><Trash2 size={18} /></div>
            <motion.button className={`convo ${c.id === current ? 'on' : ''}`} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0.6, right: 0 }} dragDirectionLock dragSnapToOrigin
              onDragEnd={(_, i) => { if (i.offset.x < -110) { haptic(10); deleteConvo(c.id); setList(l => l.filter(x => x.id !== c.id)); onDeleted(c.id); } }}
              onClick={() => onOpen(c)}>
              <span className="grow ellipsis" style={{ fontWeight: 600, textAlign: 'left' }}>{c.title || 'Untitled'}</span>
              <span className="tiny muted" style={{ flex: 'none' }}>{when(c.updated)}</span>
            </motion.button>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="tiny faint" style={{ textAlign: 'center', marginTop: 12 }}>Swipe left to delete · the last 30 stay on this phone</div>
    </div>
  );
}

/** A question from the top mic: answered in a small window, kept as its own conversation. */
export function AskSheet() {
  const ask = useUi(u => u.ask);
  const lite = !useStore(st => !!st.prefs.analytics);   // her account: one command or question, no chat
  const [q, setQ] = useState<string | null>(null);
  const [reply, setReply] = useState<ChatItem | null>(null);
  const [cid, setCid] = useState<string | null>(null);
  useEffect(() => {
    if (!ask) return;
    let alive = true;
    setQ(ask); setReply(null);
    const mine: ChatItem = { role: 'user', text: ask, at: new Date().toISOString() };
    const c = lite ? null : saveConvo({ ...newConvo(), items: [mine] });
    setCid(c?.id ?? null);
    (async () => {
      let r: ChatItem;
      try { r = await askClaude([], ask, lite, true); }   // from the top mic: Sonnet
      catch (e) { r = { role: 'assistant', text: aiErrorText(e), error: true, at: new Date().toISOString() }; }
      if (c) saveConvo({ ...(getConvo(c.id) ?? c), items: [mine, r] });   // kept even if the window was closed meanwhile
      if (alive) setReply(r);
    })();
    return () => { alive = false; };
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => setUi({ ask: null });
  const patch = (p: Partial<ChatItem>) => {
    setReply(r => (r ? { ...r, ...p } : r));
    const c = cid ? getConvo(cid) : null;
    if (c) saveConvo({ ...c, items: c.items.map((x, k) => (k === 1 ? { ...x, ...p } : x)) });
  };
  return (
    <Sheet open={!!ask} onClose={close} title="Luna">
      <div className="sheet-body">
        <div className="ask-q small muted">“{q}”</div>
        <div className="ask-a">
          {reply
            ? <Bubble m={reply} onProposal={status => reply.proposal && patch({ proposal: { ...reply.proposal, status } })} onNote={status => reply.note && patch({ note: { ...reply.note, status } })} />
            : <div className="bubble ai"><span className="dots"><i /><i /><i /></span></div>}
        </div>
        {!lite && <button className="btn secondary" style={{ width: '100%', marginTop: 12 }} disabled={!reply} onClick={() => setUi({ ask: null, chat: true, convo: cid })}>Continue in chat</button>}
      </div>
    </Sheet>
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

function Bubble({ m, onProposal, onNote }: { m: ChatItem; onProposal: (s: Proposal['status']) => void; onNote: (s: NoteCard['status']) => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}
      className={`bubble ${m.role === 'user' ? 'me' : 'ai'} ${m.error ? 'err' : ''}`}>
      {m.results?.filter(r => r.count > 0).map((r, i) => <ResultCard key={i} r={r} />)}
      <Rich text={m.text} />
      {m.proposal && <ProposalCard p={m.proposal} onStatus={onProposal} />}
      {m.note && <NoteCardView n={m.note} onStatus={onNote} />}
    </motion.div>
  );
}

/** A note Luna suggests keeping in mind; saved only with a tap. */
function NoteCardView({ n, onStatus }: { n: NoteCard; onStatus: (s: NoteCard['status']) => void }) {
  return (
    <div className={`pcard ${n.status === 'pending' ? '' : 'applied'}`}>
      <div className="row tiny bold muted" style={{ gap: 6, marginBottom: 4 }}><NotebookPen size={14} />Note to keep in mind</div>
      <div className="small">{n.text}</div>
      {n.status === 'pending' ? (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn" style={{ height: 40, flex: 1 }} onClick={() => { haptic(10); saveNote(n.text); onStatus('saved'); toast('Note saved · Settings › Luna notes'); }}>Save</button>
          <button className="btn secondary" style={{ height: 40, flex: 1 }} onClick={() => onStatus('dismissed')}>No</button>
        </div>
      ) : (
        <div className="tiny bold" style={{ marginTop: 8, color: n.status === 'saved' ? 'var(--income)' : 'var(--ink-3)' }}>{n.status === 'saved' ? '✓ Saved' : 'Not saved'}</div>
      )}
    </div>
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
              <span style={{ width: 62, flex: 'none' }} className="ellipsis">{/^\d{4}-\d{2}-\d{2}$/.test(g.key) ? shortDate(g.key) : g.key}</span>
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

