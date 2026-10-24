import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CalendarDays, Check, Delete, Repeat, Trash2, Users } from 'lucide-react';
import { Sheet, DragZone, IconBox, Icon, Pressable, toast, ease, softSpring } from '../components/ui';
import { useUi, setUi, type AddTxArgs } from '../lib/ui';
import { useStore, put, remove, restore, getState, nextOccurrence } from '../lib/store';
import { useAccounts, useCategories, useBalances, usePeriodStats, useSharedRoots, catName, catStyle } from '../lib/calc';
import { evalExpr, haptic, money, num, shortDate, todayISO, uuid, fromISO, relativeDay } from '../lib/format';
import { tint } from '../lib/icons';
import type { Freq, Tx, TxType } from '../lib/types';

const FREQ_LABEL: Record<'never' | Freq, string> = { never: 'Never', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };
const TYPE_LABEL: Record<TxType, string> = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };
const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function AddTransactionSheet() {
  const args = useUi(u => u.addTx);
  const close = () => setUi({ addTx: null });
  return (
    <Sheet open={!!args} onClose={close} full>
      {args && <Editor key={args.editId ?? 'new' + JSON.stringify(args)} args={args} close={close} />}
    </Sheet>
  );
}

function lastAccount(type: TxType): string | null {
  try { return localStorage.getItem('money:lastacc:' + type); } catch { return null; }
}

function Editor({ args, close }: { args: AddTxArgs; close: () => void }) {
  const me = useStore(s => s.user?.id);
  const txRec = useStore(s => s.transactions);
  const recRec = useStore(s => s.recurring);
  const catRec = useStore(s => s.categories);
  const accRec = useStore(s => s.accounts);
  const accounts = useAccounts();
  const cats = useCategories();
  const editing: Tx | null = args.editId ? txRec[args.editId] ?? null : null;
  const readOnly = !!editing && editing.owner_id !== me;
  const myAccounts = accounts.filter(a => a.owner_id === me && !a.archived);

  const [type, setType] = useState<TxType>(editing?.type ?? args.type ?? 'expense');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category_id ?? args.categoryId ?? null);
  const defaultAcc = (t: TxType, not?: string | null) => {
    const l = lastAccount(t);
    const ok = (id: string | null | undefined) => !!id && id !== not && myAccounts.some(a => a.id === id);
    return (ok(l) ? l : null) ?? myAccounts.find(a => a.kind !== 'savings' && a.id !== not)?.id ?? myAccounts.find(a => a.id !== not)?.id ?? null;
  };
  const [accountId, setAccountId] = useState<string | null>(editing?.account_id ?? args.accountId ?? defaultAcc(editing?.type ?? args.type ?? 'expense'));
  const [toAccountId, setToAccountId] = useState<string | null>(editing?.to_account_id ?? null);
  const [expr, setExpr] = useState(editing ? num(editing.amount).replace(/\./g, '') : '');
  const [date, setDate] = useState(editing?.date ?? args.date ?? todayISO());
  const [note, setNote] = useState(editing?.note ?? '');
  const rule = editing?.recurring_id ? recRec[editing.recurring_id] : undefined;
  const [repeat, setRepeat] = useState<'never' | Freq>(rule && rule.active && !rule.deleted_at ? rule.freq : 'never');
  const [picker, setPicker] = useState<null | 'from' | 'repeat'>(null);
  const [picking, setPicking] = useState(!editing && (type === 'transfer' ? !toAccountId : !categoryId));
  const dateRef = useRef<HTMLInputElement>(null);

  const parent = categoryId ? (catRec[categoryId]?.parent_id ?? categoryId) : null;
  const subs = useMemo(() => cats.filter(c => c.parent_id === parent && !c.archived), [cats, parent]);

  const amount = evalExpr(expr);
  const hasOp = /[+\-*/]/.test(expr.replace(/^-/, ''));
  const from = accountId ? accRec[accountId] : undefined;
  const to = toAccountId ? accRec[toAccountId] : undefined;
  const rightColor = type === 'transfer' ? to?.color ?? '#64748B' : (parent ? catStyle(parent, catRec).color : '#64748B');
  const amountColor = type === 'transfer' ? 'var(--ink)' : rightColor;

  const press = (k: string) => {
    haptic(4);
    setExpr(e => {
      if (k === 'del') return e.slice(0, -1);
      if ('+-*/'.includes(k)) { if (!e) return e; if (/[+\-*/]$/.test(e)) return e.slice(0, -1) + k; return e + k; }
      const seg = e.split(/[+\-*/]/).pop() ?? '';
      if (k === ',') return seg.includes(',') ? e : e + (seg === '' ? '0,' : ',');
      if (/,\d\d$/.test(seg)) return e;          // max 2 decimals
      if (seg === '0') return e.slice(0, -1) + k;
      if (seg.replace(',', '').length >= 9) return e;
      return e + k;
    });
  };

  const openDate = () => { const el = dateRef.current; if (!el) return; try { el.showPicker(); } catch { el.click(); } };

  const save = () => {
    if (hasOp) { setExpr(num(amount).replace(/\./g, '')); return; }
    if (amount <= 0) return toast('Enter an amount');
    if (!accountId) return toast('Pick an account');
    if (type !== 'transfer' && !categoryId) return toast('Pick a category');
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return toast('Pick two different accounts');
    const s = getState();
    const sameDay = Object.values(s.transactions).filter(t => t.date === date && !t.deleted_at);
    const seq = editing && editing.date === date ? editing.seq : Math.max(0, ...sameDay.map(t => t.seq)) + 1;
    const tx: Tx = {
      id: editing?.id ?? uuid(), owner_id: me!, type, date, amount, account_id: accountId,
      to_account_id: type === 'transfer' ? toAccountId : null, category_id: type === 'transfer' ? null : categoryId,
      note: note.trim() || null, recurring_id: editing?.recurring_id ?? null, seq,
    };
    if (repeat !== 'never') {
      const anchor = fromISO(date).getDate();
      const base = rule && !rule.deleted_at ? rule : null;
      const r = {
        id: base?.id ?? uuid(), owner_id: me!, type, amount, account_id: accountId, to_account_id: tx.to_account_id,
        category_id: tx.category_id, note: tx.note, freq: repeat, anchor_day: anchor,
        next_date: base && base.freq === repeat && base.active ? base.next_date : nextOccurrence(date, repeat, anchor), active: true,
      };
      if (r.next_date <= todayISO() && !base) r.next_date = nextOccurrence(todayISO() > date ? todayISO() : date, repeat, anchor);
      put('recurring', r);
      tx.recurring_id = r.id;
    } else if (rule && rule.active) {
      put('recurring', { ...rule, active: false });
    }
    put('transactions', tx);
    try { localStorage.setItem('money:lastacc:' + type, accountId); } catch { /* ignore */ }
    haptic(12);
    toast(editing ? 'Changes saved' : `${TYPE_LABEL[type]} of ${money(amount)} saved`);
    close();
  };

  const del = () => {
    if (!editing) return;
    remove('transactions', editing.id);
    haptic(14);
    toast('Transaction deleted', { label: 'Undo', run: () => restore('transactions', editing.id) });
    close();
  };

  if (readOnly && editing) return <ReadOnly tx={editing} />;

  const onPick = (t: TxType, id: string) => {
    haptic(6);
    setType(t);
    if (t === 'transfer') {
      setToAccountId(id);
      if (!accountId || accountId === id) setAccountId(defaultAcc('transfer', id));
    } else {
      setCategoryId(id);
      if (!accountId) setAccountId(defaultAcc(t));
    }
    setPicking(false);
  };

  const shown = expr ? expr.replace(/-/g, '−').replace(/\*/g, '×').replace(/\//g, '÷') : '0';
  const fontSize = Math.max(28, 52 - Math.max(0, shown.length - 6) * 3.4);

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {picking ? (
        <motion.div key="pick" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22, ease }}>
          <Picker type={type} onType={setType} onPick={onPick} exclude={accountId} />
        </motion.div>
      ) : (
        <motion.div key="amount" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.22, ease }}>
          {/* split header: from (left) → to (right) */}
          <DragZone className="split">
            <motion.button className="split-half" whileTap={{ scale: 0.98 }} onClick={() => setPicker('from')}
              animate={{ backgroundColor: from?.color ?? '#64748B' }} transition={{ duration: 0.3 }}>
              <span className="split-icon"><Icon name={from?.icon ?? 'wallet'} size={19} /></span>
              <span className="split-label">From account</span>
              <span className="split-name">{from?.name ?? 'Choose'}</span>
            </motion.button>
            <motion.button className="split-half" whileTap={{ scale: 0.98 }} onClick={() => setPicking(true)}
              animate={{ backgroundColor: rightColor }} transition={{ duration: 0.3 }}>
              <span className="split-icon"><Icon name={type === 'transfer' ? to?.icon ?? 'wallet' : catStyle(parent, catRec).icon} size={19} /></span>
              <span className="split-label">{type === 'transfer' ? 'To account' : 'To category'}</span>
              <span className="split-name">{type === 'transfer' ? to?.name ?? 'Choose' : parent ? catRec[parent]?.name : 'Choose'}</span>
            </motion.button>
          </DragZone>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '12px 14px 0' }}>
            {type !== 'transfer' && subs.length > 0 && (
              <div className="chips" style={{ paddingBottom: 4 }}>
                {subs.map(s => {
                  const on = categoryId === s.id;
                  return (
                    <motion.button key={s.id} className="subchip" whileTap={{ scale: 0.95 }}
                      style={{ borderColor: rightColor, color: on ? '#fff' : rightColor, background: on ? rightColor : 'transparent' }}
                      onClick={() => { haptic(4); setCategoryId(on ? parent : s.id); }}>
                      <Icon name={s.icon !== 'circle' ? s.icon : catStyle(parent, catRec).icon} size={17} />{s.name}
                    </motion.button>
                  );
                })}
              </div>
            )}
            <div className="amount-wrap" style={{ minHeight: 92 }}>
              <div className="tiny bold" style={{ color: amountColor, letterSpacing: '.02em', marginBottom: 4 }}>{TYPE_LABEL[type]}</div>
              <div className="amount num" style={{ fontSize, color: expr ? amountColor : 'var(--ink-3)' }}>
                <AnimatePresence initial={false} mode="popLayout">
                  {shown.split('').map((ch, i) => (
                    <motion.span key={i + ch} className="ch" initial={{ opacity: 0, y: 12, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.85 }} transition={{ type: 'spring', stiffness: 520, damping: 34 }}>{ch}</motion.span>
                  ))}
                </AnimatePresence>
                <span className="cur" style={{ fontSize: '0.6em' }}>€</span>
              </div>
              <div className="expr" style={{ marginTop: 4, marginBottom: 0 }}>{hasOp ? `= ${money(amount)}` : ''}</div>
            </div>
            <input className="input note-input" placeholder="Notes…" value={note} onChange={e => setNote(e.target.value)} />
          </div>

          <div className="keypad5">
            {['/', '7', '8', '9', 'del', '*', '4', '5', '6', 'date', '-', '1', '2', '3', 'go', '+', '00', '0', ','].map(k => (
              <Key key={k} k={k} onKey={press} onSave={save} onDate={openDate} onClear={() => setExpr('')} hasOp={hasOp} ready={amount > 0} color={type === 'transfer' ? undefined : rightColor} />
            ))}
          </div>
          <div className="dateline">
            <button className={`chip ${repeat !== 'never' ? 'on' : ''}`} style={{ height: 34, fontSize: 13 }} onClick={() => setPicker('repeat')}>
              <Repeat size={15} />{repeat === 'never' ? 'Repeat' : FREQ_LABEL[repeat]}
            </button>
            <button className="grow" onClick={openDate} style={{ position: 'relative', fontWeight: 600, color: 'var(--ink-2)' }}>
              {relativeDay(date).match(/Today|Yesterday|Tomorrow/) ? relativeDay(date) + ', ' : ''}{longDate.format(fromISO(date))}
              <input ref={dateRef} type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }} tabIndex={-1} />
            </button>
            {editing
              ? <button className="iconbtn" style={{ color: 'var(--expense)', width: 40, height: 34 }} onClick={del} aria-label="Delete"><Trash2 size={20} /></button>
              : <span style={{ width: 92 }} />}
          </div>

          <AccountPicker open={picker === 'from'} exclude={type === 'transfer' ? toAccountId : null}
            title={type === 'transfer' ? 'From account' : 'Account'}
            onPick={id => { setAccountId(id); setPicker(null); }} onClose={() => setPicker(null)} />
          <Sheet open={picker === 'repeat'} onClose={() => setPicker(null)} title="Repeat" z={1}>
            <div className="sheet-body">
              <div className="list">
                {(['never', 'weekly', 'monthly', 'yearly'] as const).map(f => (
                  <button key={f} className="list-row" onClick={() => { setRepeat(f); setPicker(null); }}>
                    <span className="grow">{FREQ_LABEL[f]}</span>{repeat === f && <Check size={20} style={{ color: 'var(--accent)' }} />}
                  </button>
                ))}
              </div>
              <p className="small muted" style={{ padding: '12px 6px 0' }}>Repeating entries are added automatically on their date. You'll see a reminder in the app the day before.</p>
            </div>
          </Sheet>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Step 1: Income / Expense / Transfer tabs with the category (or destination account) grid. */
function Picker({ type, onType, onPick, exclude }: { type: TxType; onType: (t: TxType) => void; onPick: (t: TxType, id: string) => void; exclude: string | null }) {
  const cats = useCategories();
  const accounts = useAccounts();
  const me = useStore(s => s.user?.id);
  const stats = usePeriodStats();
  const shared = useSharedRoots();
  const bal = useBalances();
  const tabs: Array<[TxType, string, typeof ArrowUpRight]> = [['income', 'Income', ArrowDownLeft], ['expense', 'Expense', ArrowUpRight], ['transfer', 'Transfer', ArrowLeftRight]];
  const list = type === 'transfer'
    ? accounts.filter(a => a.owner_id === me && !a.archived && a.id !== exclude)
    : cats.filter(c => c.type === type && !c.parent_id && !c.archived);
  return (
    <>
      <DragZone className="ptabs">
        {tabs.map(([t, label, I]) => (
          <button key={t} className={`ptab ${type === t ? 'on' : ''}`} onClick={() => onType(t)}>
            <I size={18} />{label}
            {type === t && <motion.span layoutId="ptab-ind" className="ptab-ind" transition={softSpring} />}
          </button>
        ))}
      </DragZone>
      <div className="sheet-body" style={{ paddingTop: 14 }}>
        <div className="small muted" style={{ margin: '0 4px 12px', fontWeight: 600 }}>{type === 'transfer' ? 'Transfer to' : 'Choose a category'}</div>
        <motion.div className="cat-grid" key={type} initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.018 } } }}>
          {type === 'transfer'
            ? (list as typeof accounts).map(a => (
              <motion.div key={a.id} variants={{ h: { opacity: 0, scale: 0.85 }, s: { opacity: 1, scale: 1 } }} transition={softSpring}>
                <Pressable className="cat-tile" style={{ width: '100%' }} onClick={() => onPick('transfer', a.id)}>
                  <span className="cat-name">{a.name}</span>
                  <IconBox icon={a.icon} color={a.color} />
                  <span className="cat-amt num" style={{ color: 'var(--ink-2)' }}>{money(bal.get(a.id) ?? 0)}</span>
                </Pressable>
              </motion.div>
            ))
            : (list as typeof cats).map(c => {
              const v = stats.byCat.get(c.id) ?? 0;
              return (
                <motion.div key={c.id} variants={{ h: { opacity: 0, scale: 0.85 }, s: { opacity: 1, scale: 1 } }} transition={softSpring}>
                  <Pressable className="cat-tile" style={{ width: '100%' }} onClick={() => onPick(type, c.id)}>
                    <span className="cat-name">{c.name}</span>
                    <div style={{ position: 'relative' }}>
                      <IconBox icon={c.icon} color={c.color} soft={v === 0} />
                      {shared.has(c.id) && <span className="shared-dot"><Users size={10} /></span>}
                    </div>
                    <span className="cat-amt num" style={{ color: v ? c.color : 'var(--ink-3)' }}>{money(v)}</span>
                  </Pressable>
                </motion.div>
              );
            })}
        </motion.div>
        {list.length === 0 && (
          <div className="empty">
            {type === 'transfer' ? 'Add another account first.' : `No ${type} categories yet.`}
            {type !== 'transfer' && <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => setUi({ category: { type } })}>Create category</button>}
          </div>
        )}
      </div>
    </>
  );
}

function Key({ k, onKey, onSave, onDate, onClear, hasOp, ready, color }: {
  k: string; onKey: (k: string) => void; onSave: () => void; onDate: () => void; onClear: () => void; hasOp: boolean; ready: boolean; color?: string;
}) {
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(hold.current), []);
  if (k === 'go') {
    return (
      <motion.button className="key go" style={{ gridRow: 'span 2', background: color ?? 'var(--accent)', color: color ? '#fff' : undefined }}
        whileTap={{ scale: 0.95 }} onClick={onSave} animate={{ opacity: ready || hasOp ? 1 : 0.6 }} aria-label={hasOp ? 'Calculate' : 'Save'}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={hasOp ? 'eq' : 'ok'} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.14 }} style={{ display: 'grid', fontSize: 30 }}>
            {hasOp ? '=' : <Check size={30} strokeWidth={2.4} />}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    );
  }
  const op = '/*-+'.includes(k) || k === 'del' || k === 'date';
  const label: Record<string, React.ReactNode> = { '/': '÷', '*': '×', '-': '−', '+': '+', del: <Delete size={24} />, date: <CalendarDays size={22} /> };
  return (
    <motion.button className={`key ${op ? 'op' : ''}`} whileTap={{ scale: 0.92 }} transition={{ duration: 0.1 }}
      onPointerDown={() => { if (k === 'del') hold.current = setTimeout(() => { onClear(); hold.current = undefined; }, 500); }}
      onPointerUp={() => clearTimeout(hold.current)} onPointerLeave={() => clearTimeout(hold.current)}
      onClick={() => { if (k === 'date') onDate(); else if (k === '00') { onKey('0'); onKey('0'); } else onKey(k); }}
      aria-label={k === 'del' ? 'Delete' : k === 'date' ? 'Date' : k}>
      {label[k] ?? k}
    </motion.button>
  );
}

function AccountPicker({ open, onClose, onPick, exclude, title }: { open: boolean; onClose: () => void; onPick: (id: string) => void; exclude: string | null; title: string }) {
  const accounts = useAccounts();
  const me = useStore(s => s.user?.id);
  const bal = useBalances();
  const list = accounts.filter(a => a.owner_id === me && !a.archived && a.id !== exclude);
  return (
    <Sheet open={open} onClose={onClose} title={title} z={1}>
      <div className="sheet-body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {list.map((a, i) => (
            <motion.button key={a.id} className="row" whileTap={{ scale: 0.96 }} onClick={() => { haptic(6); onPick(a.id); }}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02, duration: 0.25, ease }}
              style={{ background: a.color, color: '#fff', borderRadius: 16, padding: '12px 12px', gap: 10, textAlign: 'left' }}>
              <Icon name={a.icon} size={22} />
              <div className="grow">
                <div className="ellipsis small bold">{a.name}</div>
                <div className="num small" style={{ opacity: 0.9 }}>{money(bal.get(a.id) ?? 0)}</div>
              </div>
            </motion.button>
          ))}
        </div>
        {list.length === 0 && <div className="empty">No accounts. Add one in the Accounts tab.</div>}
      </div>
    </Sheet>
  );
}

function ReadOnly({ tx }: { tx: Tx }) {
  const cats = useStore(s => s.categories);
  const profiles = useStore(s => s.profiles);
  const st = catStyle(tx.category_id, cats);
  const who = profiles[tx.owner_id]?.display_name ?? 'Partner';
  return (
    <div className="sheet-body" style={{ textAlign: 'center' }}>
      <div style={{ display: 'grid', placeItems: 'center', marginTop: 10 }}>
        <div className="ico lg round" style={{ background: tint(st.color, 0.15), color: st.color }}><Icon name={st.icon} size={26} /></div>
      </div>
      <div style={{ fontSize: 40, fontWeight: 650, margin: '16px 0 4px', color: st.color }} className="num">{money(tx.amount)}</div>
      <div className="bold">{catName(tx.category_id, cats)}</div>
      <div className="muted small" style={{ marginTop: 4 }}>Paid by {who} · {shortDate(tx.date)}</div>
      {tx.note && <div className="tx-note" style={{ marginTop: 10 }}>{tx.note}</div>}
      <div className="badge" style={{ marginTop: 18 }}><Users size={12} />Added by {who} · only {who} can edit it</div>
    </div>
  );
}
