import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Calendar, Check, ChevronDown, Delete, Repeat, StickyNote, Trash2, X } from 'lucide-react';
import { Sheet, Segmented, IconBox, Icon, Pressable, toast, ease, softSpring } from '../components/ui';
import { useUi, setUi, type AddTxArgs } from '../lib/ui';
import { useStore, put, remove, restore, getState, nextOccurrence } from '../lib/store';
import { useAccounts, useCategories, useBalances, catName, catStyle } from '../lib/calc';
import { evalExpr, haptic, money, num, relativeDay, shortDate, todayISO, uuid, fromISO } from '../lib/format';
import type { Freq, Tx, TxType } from '../lib/types';

const FREQ_LABEL: Record<'never' | Freq, string> = { never: 'Never', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

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
  const accounts = useAccounts();
  const cats = useCategories();
  const editing: Tx | null = args.editId ? txRec[args.editId] ?? null : null;
  const readOnly = !!editing && editing.owner_id !== me;
  const myAccounts = accounts.filter(a => a.owner_id === me && !a.archived);

  const [type, setType] = useState<TxType>(editing?.type ?? args.type ?? 'expense');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category_id ?? args.categoryId ?? null);
  const defaultAcc = (t: TxType) => {
    const l = lastAccount(t);
    return (l && myAccounts.some(a => a.id === l) ? l : null) ?? myAccounts.find(a => a.kind !== 'savings')?.id ?? myAccounts[0]?.id ?? null;
  };
  const [accountId, setAccountId] = useState<string | null>(editing?.account_id ?? args.accountId ?? defaultAcc(editing?.type ?? args.type ?? 'expense'));
  const [toAccountId, setToAccountId] = useState<string | null>(editing?.to_account_id ?? null);
  const [expr, setExpr] = useState(editing ? num(editing.amount).replace(/\./g, '') : '');
  const [date, setDate] = useState(editing?.date ?? args.date ?? todayISO());
  const [note, setNote] = useState(editing?.note ?? '');
  const rule = editing?.recurring_id ? recRec[editing.recurring_id] : undefined;
  const [repeat, setRepeat] = useState<'never' | Freq>(rule && rule.active && !rule.deleted_at ? rule.freq : 'never');
  const [picker, setPicker] = useState<null | 'from' | 'to' | 'repeat'>(null);
  const [noteOpen, setNoteOpen] = useState(!!editing?.note);
  const dateRef = useRef<HTMLInputElement>(null);

  const parent = categoryId ? (catRec[categoryId]?.parent_id ?? categoryId) : null;
  const subs = useMemo(() => cats.filter(c => c.parent_id === parent && !c.archived), [cats, parent]);
  const step: 'pick' | 'amount' = type !== 'transfer' && !categoryId ? 'pick' : 'amount';

  const changeType = (t: TxType) => {
    if (t === type) return;
    setType(t);
    if (categoryId && catRec[categoryId]?.type !== t) setCategoryId(null);
    if (t === 'transfer' && !toAccountId) setToAccountId(myAccounts.find(a => a.id !== accountId)?.id ?? null);
  };

  const amount = evalExpr(expr);
  const hasOp = /[+\-]/.test(expr.replace(/^-/, ''));
  const color = type === 'expense' ? 'var(--expense)' : type === 'income' ? 'var(--income)' : 'var(--ink)';

  const press = (k: string) => {
    haptic(4);
    setExpr(e => {
      if (k === 'del') return e.slice(0, -1);
      if (k === '+' || k === '-') { if (!e || /[+\-]$/.test(e)) return e; return e + k; }
      if (k === ',') {
        const seg = e.split(/[+\-]/).pop() ?? '';
        if (seg.includes(',')) return e;
        return e + (seg === '' ? '0,' : ',');
      }
      const seg = e.split(/[+\-]/).pop() ?? '';
      if (/,\d\d$/.test(seg)) return e;          // max 2 decimals
      if (seg === '0' && k !== ',') return e.slice(0, -1) + k;
      if (seg.replace(',', '').length >= 9) return e;
      return e + k;
    });
  };

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
    // recurring rule
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
    toast(editing ? 'Changes saved' : `${type === 'expense' ? 'Expense' : type === 'income' ? 'Income' : 'Transfer'} of ${money(amount)} saved`);
    close();
  };

  const del = () => {
    if (!editing) return;
    remove('transactions', editing.id);
    haptic(14);
    toast('Transaction deleted', { label: 'Undo', run: () => restore('transactions', editing.id) });
    close();
  };

  if (readOnly && editing) return <ReadOnly tx={editing} close={close} />;

  const amountStr = expr ? expr.replace(/-/g, '−') : '0';
  const fontSize = Math.max(30, 60 - Math.max(0, amountStr.length - 5) * 4.2);

  return (
    <>
      <div className="row" style={{ padding: '0 12px 6px 16px', gap: 8 }}>
        <Segmented value={type} onChange={changeType} style={{ flex: 1 }}
          options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }]} />
        {editing && <button className="iconbtn" onClick={del} aria-label="Delete" style={{ color: 'var(--expense)' }}><Trash2 size={21} /></button>}
        <button className="iconbtn" onClick={close} aria-label="Close"><X size={22} /></button>
      </div>

      <AnimatePresence mode="popLayout" initial={false}>
        {step === 'pick' ? (
          <motion.div key="pick" className="sheet-body" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.24, ease }}>
            <div className="small muted" style={{ margin: '8px 4px 14px', fontWeight: 600 }}>Choose a category</div>
            <motion.div className="cat-grid" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.02 } } }}>
              {cats.filter(c => c.type === type && !c.parent_id && !c.archived && c.owner_id === me).map(c => (
                <motion.div key={c.id} variants={{ h: { opacity: 0, scale: 0.85 }, s: { opacity: 1, scale: 1 } }} transition={softSpring}>
                  <Pressable className="cat-tile" style={{ width: '100%' }} onClick={() => { haptic(6); setCategoryId(c.id); }}>
                    <IconBox icon={c.icon} color={c.color} />
                    <span className="cat-name">{c.name}</span>
                  </Pressable>
                </motion.div>
              ))}
            </motion.div>
            {cats.filter(c => c.type === type && !c.parent_id && c.owner_id === me).length === 0 && (
              <div className="empty">No {type} categories yet.<br />
                <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => setUi({ category: { type: type === 'income' ? 'income' : 'expense' } })}>Create category</button>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="amount" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
            initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.24, ease }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 16px 0' }}>
              {/* account + category */}
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <AccountChip id={accountId} onClick={() => setPicker('from')} />
                {type === 'transfer' ? (
                  <><ArrowRight size={18} className="faint" /><AccountChip id={toAccountId} onClick={() => setPicker('to')} placeholder="To account" /></>
                ) : (
                  <motion.button className="chip" whileTap={{ scale: 0.96 }} onClick={() => setCategoryId(null)}>
                    <span style={{ color: catStyle(parent, catRec).color, display: 'grid' }}><Icon name={catStyle(parent, catRec).icon} size={18} /></span>
                    {parent ? catRec[parent]?.name : 'Category'}<ChevronDown size={15} className="faint" />
                  </motion.button>
                )}
              </div>

              {/* amount */}
              <div className="amount-wrap">
                <div className="expr">{hasOp ? `= ${money(amount)}` : ''}</div>
                <div className="amount num" style={{ fontSize, color: expr ? color : 'var(--ink-3)' }}>
                  <AnimatePresence initial={false} mode="popLayout">
                    {amountStr.split('').map((ch, i) => (
                      <motion.span key={i + ch} className="ch" initial={{ opacity: 0, y: 14, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.8 }} transition={{ type: 'spring', stiffness: 520, damping: 34 }}>{ch}</motion.span>
                    ))}
                  </AnimatePresence>
                  <span className="cur" style={{ fontSize: '0.5em' }}>€</span>
                </div>
              </div>

              {/* subcategories */}
              {type !== 'transfer' && subs.length > 0 && (
                <div className="chips" style={{ marginBottom: 6 }}>
                  <button className={`chip ${categoryId === parent ? 'on' : ''}`} onClick={() => setCategoryId(parent)}>General</button>
                  {subs.map(s => (
                    <button key={s.id} className={`chip ${categoryId === s.id ? 'on' : ''}`} onClick={() => { haptic(4); setCategoryId(s.id); }}>{s.name}</button>
                  ))}
                </div>
              )}

              {/* date / repeat / note */}
              <div className="chips">
                <button className="chip" onClick={() => dateRef.current?.showPicker ? dateRef.current.showPicker() : dateRef.current?.click()} style={{ position: 'relative' }}>
                  <Calendar size={16} />{date === todayISO() || Math.abs(fromISO(date).getTime() - Date.now()) < 2 * 86400000 ? relativeDay(date) : shortDate(date)}
                  <input ref={dateRef} type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}
                    style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }} tabIndex={-1} />
                </button>
                <button className={`chip ${repeat !== 'never' ? 'on' : ''}`} onClick={() => setPicker('repeat')}>
                  <Repeat size={16} />{repeat === 'never' ? 'Repeat' : FREQ_LABEL[repeat]}
                </button>
                {!noteOpen && <button className="chip" onClick={() => setNoteOpen(true)}><StickyNote size={16} />Note</button>}
              </div>
              <AnimatePresence initial={false}>
                {noteOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease }} style={{ overflow: 'hidden' }}>
                    <input className="input" placeholder="Note (e.g. Netflix)" value={note} onChange={e => setNote(e.target.value)} autoFocus={!editing} style={{ marginTop: 4, marginBottom: 8 }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Keypad onKey={press} onSave={save} onClear={() => setExpr('')} hasOp={hasOp} ready={amount > 0} />
          </motion.div>
        )}
      </AnimatePresence>

      <AccountPicker open={picker === 'from' || picker === 'to'} exclude={picker === 'to' ? accountId : null}
        title={picker === 'to' ? 'To account' : type === 'transfer' ? 'From account' : 'Account'}
        onPick={id => { if (picker === 'to') setToAccountId(id); else { setAccountId(id); if (id === toAccountId) setToAccountId(null); } setPicker(null); }}
        onClose={() => setPicker(null)} />
      <Sheet open={picker === 'repeat'} onClose={() => setPicker(null)} title="Repeat" z={1}>
        <div className="sheet-body">
          <div className="list">
            {(['never', 'weekly', 'monthly', 'yearly'] as const).map(f => (
              <button key={f} className="list-row" onClick={() => { setRepeat(f); setPicker(null); }}>
                <span className="grow">{FREQ_LABEL[f]}</span>{repeat === f && <Check size={20} style={{ color: 'var(--accent)' }} />}
              </button>
            ))}
          </div>
          <p className="small muted" style={{ padding: '12px 6px 0' }}>
            Repeating entries are added automatically on their date. You'll see a reminder in the app the day before.
          </p>
        </div>
      </Sheet>
    </>
  );
}

function AccountChip({ id, onClick, placeholder = 'Account' }: { id: string | null; onClick: () => void; placeholder?: string }) {
  const acc = useStore(s => (id ? s.accounts[id] : undefined));
  return (
    <motion.button className="chip" whileTap={{ scale: 0.96 }} onClick={onClick}>
      {acc ? <span style={{ color: acc.color, display: 'grid' }}><Icon name={acc.icon} size={18} /></span> : null}
      {acc?.name ?? placeholder}<ChevronDown size={15} className="faint" />
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

function Keypad({ onKey, onSave, onClear, hasOp, ready }: { onKey: (k: string) => void; onSave: () => void; onClear: () => void; hasOp: boolean; ready: boolean }) {
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const keys = ['7', '8', '9', 'del', '4', '5', '6', '-', '1', '2', '3', '+', ',', '0', '00', 'go'];
  useEffect(() => () => clearTimeout(holdTimer.current), []);
  return (
    <div className="keypad">
      {keys.map(k => {
        if (k === 'go') {
          return (
            <motion.button key={k} className="key go" whileTap={{ scale: 0.93 }} onClick={onSave} animate={{ opacity: ready || hasOp ? 1 : 0.55 }} aria-label={hasOp ? 'Calculate' : 'Save'}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={hasOp ? 'eq' : 'ok'} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.14 }} style={{ display: 'grid' }}>
                  {hasOp ? '=' : <Check size={28} strokeWidth={2.6} />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          );
        }
        const op = k === 'del' || k === '+' || k === '-';
        return (
          <motion.button key={k} className={`key ${op ? 'op' : ''}`} whileTap={{ scale: 0.92 }} transition={{ duration: 0.1 }}
            onPointerDown={() => { if (k === 'del') holdTimer.current = setTimeout(() => { onClear(); holdTimer.current = undefined; }, 500); }}
            onPointerUp={() => clearTimeout(holdTimer.current)} onPointerLeave={() => clearTimeout(holdTimer.current)}
            onClick={() => { if (k === '00') { onKey('0'); onKey('0'); } else onKey(k); }} aria-label={k === 'del' ? 'Delete' : k}>
            {k === 'del' ? <Delete size={24} /> : k === '-' ? '−' : k}
          </motion.button>
        );
      })}
    </div>
  );
}

function ReadOnly({ tx, close }: { tx: Tx; close: () => void }) {
  const cats = useStore(s => s.categories);
  const accs = useStore(s => s.accounts);
  const profiles = useStore(s => s.profiles);
  const st = tx.type === 'transfer' ? { icon: 'circle', color: '#64748B' } : catStyle(tx.category_id, cats);
  return (
    <div className="sheet-body" style={{ textAlign: 'center' }}>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="iconbtn" onClick={close}><X size={22} /></button></div>
      <div style={{ display: 'grid', placeItems: 'center', marginTop: 10 }}><IconBox icon={st.icon} color={st.color} size="lg" round /></div>
      <div style={{ fontSize: 40, fontWeight: 650, margin: '16px 0 4px', color: tx.type === 'expense' ? 'var(--expense)' : 'var(--income)' }} className="num">{money(tx.amount)}</div>
      <div className="bold">{tx.type === 'transfer' ? 'Transfer' : catName(tx.category_id, cats)}</div>
      <div className="muted small" style={{ marginTop: 4 }}>{accs[tx.account_id]?.name ?? (profiles[tx.owner_id]?.display_name ?? 'Partner') + "'s account"}{tx.to_account_id ? ` → ${accs[tx.to_account_id]?.name ?? ''}` : ''} · {shortDate(tx.date)}</div>
      {tx.note && <div className="tx-note" style={{ marginTop: 10 }}>{tx.note}</div>}
      <div className="badge" style={{ marginTop: 18 }}>Added by {profiles[tx.owner_id]?.display_name ?? 'partner'} · view only</div>
    </div>
  );
}
