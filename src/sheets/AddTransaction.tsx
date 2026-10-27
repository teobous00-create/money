import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CalendarDays, Check, Delete, Repeat, Star, Trash2, Users } from 'lucide-react';
import { Sheet, DragZone, IconBox, Icon, Pressable, toast, ease, softSpring } from '../components/ui';
import { useUi, setUi, type AddTxArgs } from '../lib/ui';
import { useStore, put, putMany, remove, restore, getState, nextOccurrence } from '../lib/store';
import { useAccounts, useCategories, useBalances, usePeriodStats, useSharedRoots, catName, catStyle, parseVirtualId, ruleToTx } from '../lib/calc';
import { evalExpr, haptic, money, num, shortDate, todayISO, uuid, fromISO, relativeDay, addDays } from '../lib/format';
import { tint } from '../lib/icons';
import type { Freq, Recurring, Tx, TxType } from '../lib/types';
import { unmarkVoice } from '../lib/voiceRun';
import { findFavorite, toggleFavorite, useFavorites } from '../lib/favorites';
import { learn, type Parsed } from '../lib/quickparse';

const FREQ_LABEL: Record<'never' | Freq, string> = { never: 'Never', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };
const TYPE_LABEL: Record<TxType, string> = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };
const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
type Scope = 'one' | 'next' | 'all';

/** First occurrence on/after `min`, walking the schedule from `start`. */
function firstOnOrAfter(start: string, freq: Freq, anchor: number, min: string) {
  let d = start;
  for (let i = 0; d < min && i < 1000; i++) d = nextOccurrence(d, freq, anchor);
  return d;
}

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
  const favs = useFavorites();
  const virt = args.editId ? parseVirtualId(args.editId) : null;
  const virtRule = virt ? recRec[virt.ruleId] : undefined;
  const editing: Tx | null = args.editId ? (virt ? (virtRule ? ruleToTx(virtRule, virt.date) : null) : txRec[args.editId] ?? null) : null;
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
  const ruleLive = !!rule && rule.active && !rule.deleted_at;
  const [repeat, setRepeat] = useState<'never' | Freq>(ruleLive ? rule!.freq : 'never');
  const [until, setUntil] = useState<string | null>(ruleLive ? rule!.end_date ?? null : null);
  const [askScope, setAskScope] = useState<null | 'save' | 'delete'>(null);
  const inSeries = !!editing && ruleLive;
  const untilRef = useRef<HTMLInputElement>(null);
  const [picker, setPicker] = useState<null | 'from' | 'repeat'>(null);
  const [picking, setPicking] = useState(!editing && (type === 'transfer' ? !toAccountId : !categoryId));
  const dateRef = useRef<HTMLInputElement>(null);
  const parsed = useRef<{ words: string[]; categoryId: string | null } | null>(null);

  /** Fill the form from a typed/spoken phrase; go straight to the amount screen when the category is known. */
  const applyParsed = (p: Parsed, rep: Freq | null = null, untilDate: string | null = null) => {
    if (rep) { setRepeat(rep); setUntil(untilDate); }
    const t = p.type ?? type;
    setType(t);
    if (p.amount !== null) setExpr(num(p.amount).replace(/\./g, ''));
    if (p.date) setDate(p.date);
    if (p.note) setNote(p.note);
    if (t === 'transfer') {
      if (p.toAccountId) setToAccountId(p.toAccountId);
      setAccountId(p.accountId ?? defaultAcc('transfer', p.toAccountId));
      setPicking(!p.toAccountId);
    } else {
      if (p.categoryId) setCategoryId(p.categoryId);
      setAccountId(p.accountId ?? accountId ?? defaultAcc(t));
      setPicking(!p.categoryId);
    }
    parsed.current = { words: p.words, categoryId: p.categoryId };
  };
  // opened from elsewhere with a phrase that still needs you
  useEffect(() => { if (args.prefill) applyParsed(args.prefill.p, args.prefill.repeat, args.prefill.until); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const parent = categoryId ? (catRec[categoryId]?.parent_id ?? categoryId) : null;
  // a chosen subcategory far right in the chip row scrolls into view
  useEffect(() => {
    if (picking) return;
    const t = setTimeout(() => document.querySelector('.subchip[data-on]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }), 260);
    return () => clearTimeout(t);
  }, [picking, categoryId]);
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

  const validate = () => {
    if (amount <= 0) { toast('Enter an amount'); return false; }
    if (!accountId) { toast('Pick an account'); return false; }
    if (type !== 'transfer' && !categoryId) { toast('Pick a category'); return false; }
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) { toast('Pick two different accounts'); return false; }
    return true;
  };
  const nextSeq = (d: string) => {
    const sameDay = Object.values(getState().transactions).filter(t => t.date === d && !t.deleted_at);
    return Math.max(0, ...sameDay.map(t => t.seq)) + 1;
  };
  const values = () => ({
    type, amount, account_id: accountId!, to_account_id: type === 'transfer' ? toAccountId : null,
    category_id: type === 'transfer' ? null : categoryId, note: note.trim() || null,
  });
  const newRule = (startDate: string, freq: Freq, keep?: Partial<Recurring>): Recurring => {
    const anchor = fromISO(startDate).getDate();
    let next = startDate;
    if (next <= todayISO() && !keep?.next_date) next = firstOnOrAfter(nextOccurrence(startDate, freq, anchor), freq, anchor, addDays(todayISO(), 1));
    return {
      id: uuid(), owner_id: me!, ...values(), freq, anchor_day: anchor, next_date: next, active: true,
      end_date: until, skip_dates: [], ...keep,
    };
  };
  const finish = (msg: string) => {
    try { localStorage.setItem('money:lastacc:' + type, accountId!); } catch { /* ignore */ }
    // you corrected the category the phrase gave → remember those words for next time
    if (parsed.current && type !== 'transfer' && categoryId && parsed.current.categoryId !== categoryId) learn(parsed.current.words, categoryId);
    if (editing) unmarkVoice(editing.id);   // checked: the 🎤 mark goes away
    haptic(12);
    toast(msg);
    close();
  };

  /** Save a brand-new transaction, or an edit of one that isn't part of a repeating series. */
  const saveSimple = () => {
    const tx: Tx = {
      id: editing?.id ?? uuid(), owner_id: me!, ...values(), date,
      recurring_id: editing?.recurring_id ?? null, seq: editing && editing.date === date ? editing.seq : nextSeq(date),
    };
    if (repeat !== 'never') {
      // the transaction itself is the first one; the rule takes over from the next date
      const anchor = fromISO(date).getDate();
      const r = newRule(date, repeat, { next_date: firstOnOrAfter(nextOccurrence(date, repeat, anchor), repeat, anchor, addDays(todayISO(), 1)) });
      put('recurring', r);
      tx.recurring_id = r.id;
    }
    put('transactions', tx);
    finish(editing ? 'Changes saved' : `${TYPE_LABEL[type]} of ${money(amount)} saved`);
  };

  /** Save an edit of a repeating entry, for one / this and next / all occurrences. */
  const saveSeries = (scope: Scope) => {
    const r = rule!;
    const D = editing!.date;
    const v = values();
    const realTx = editing!.virtual ? null : editing!;
    const stopping = repeat === 'never';
    // this occurrence as a real transaction
    const thisTx = (recurringId: string | null): Tx => ({
      id: realTx?.id ?? uuid(), owner_id: me!, ...v, date, recurring_id: recurringId,
      seq: realTx && realTx.date === date ? realTx.seq : nextSeq(date),
    });

    if (scope === 'one') {
      put('transactions', thisTx(r.id));
      if (!realTx) put('recurring', { ...r, skip_dates: [...(r.skip_dates ?? []), D] }); // the rule won't add this date again
      return finish('Changed only this one');
    }

    if (stopping) {
      // stop repeating: before this one (next) or completely (all)
      put('recurring', scope === 'next' ? { ...r, end_date: addDays(D, -1) } : { ...r, active: false });
      put('transactions', thisTx(null));
      if (scope === 'all') updatePast(r, v);
      return finish('Repeating stopped');
    }

    const freq = repeat as Freq;
    const dateChanged = date !== D;
    const anchor = dateChanged ? fromISO(date).getDate() : r.anchor_day;
    if (scope === 'next' && !realTx && D !== r.next_date) {
      // split: the old rule ends before this one, a new rule starts here
      put('recurring', { ...r, end_date: addDays(D, -1) });
      put('recurring', { ...newRule(date, freq), anchor_day: anchor, next_date: date, skip_dates: (r.skip_dates ?? []).filter(x => x > D) });
      return finish('Changed this and the next ones');
    }
    // update the rule in place (applies to every future one)
    let next = r.next_date;
    if (!realTx && D === r.next_date) next = date;
    else if (dateChanged || freq !== r.freq) next = firstOnOrAfter(realTx ? date : r.next_date, freq, anchor, addDays(todayISO(), 1));
    put('recurring', { ...r, ...v, freq, anchor_day: anchor, next_date: next, end_date: until, active: true });
    if (realTx) put('transactions', thisTx(r.id));
    if (scope === 'all') updatePast(r, v);
    finish(scope === 'all' ? 'Changed all of them' : 'Changed this and the next ones');
  };

  /** Apply new values to the already-added transactions of a rule (dates stay). */
  const updatePast = (r: Recurring, v: ReturnType<typeof values>) => {
    const past = Object.values(getState().transactions).filter(t => t.recurring_id === r.id && !t.deleted_at && t.id !== editing?.id);
    putMany('transactions', past.map(t => ({ ...t, ...v })));
  };

  const deleteSeries = (scope: Scope) => {
    const r = rule!;
    const D = editing!.date;
    const realTx = editing!.virtual ? null : editing!;
    if (scope === 'one') {
      if (realTx) remove('transactions', realTx.id);
      else put('recurring', { ...r, skip_dates: [...(r.skip_dates ?? []), D] });
      haptic(14);
      toast('Deleted only this one', realTx ? { label: 'Undo', run: () => restore('transactions', realTx.id) } : undefined);
    } else if (scope === 'next') {
      if (realTx) remove('transactions', realTx.id);
      put('recurring', { ...r, end_date: addDays(D, -1) });
      haptic(14);
      toast('Deleted this and the next ones');
    } else {
      const all = Object.values(getState().transactions).filter(t => t.recurring_id === r.id && !t.deleted_at);
      putMany('transactions', all.map(t => ({ ...t, deleted_at: new Date().toISOString() })));
      remove('recurring', r.id);
      haptic(14);
      toast(`Deleted all ${all.length ? all.length + ' ' : ''}of them`);
    }
    close();
  };

  const save = () => {
    if (hasOp) { setExpr(num(amount).replace(/\./g, '')); return; }
    if (!validate()) return;
    if (inSeries) return setAskScope('save');
    saveSimple();
  };

  const del = () => {
    if (!editing) return;
    if (inSeries) return setAskScope('delete');
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

  // ☆ keeps these values as a one-tap favorite on Transactions
  const shape = { type, amount, account_id: accountId ?? '', to_account_id: type === 'transfer' ? toAccountId : null, category_id: type === 'transfer' ? null : categoryId, note: note.trim() || null };
  const fav = amount > 0 && favs.some(f => findFavorite(shape)?.id === f.id);
  const star = () => {
    if (!validate()) return;
    haptic(8);
    toast(toggleFavorite(shape) ? 'Added to favorites · tap it on Transactions' : 'Removed from favorites');
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
                    <motion.button key={s.id} className="subchip" whileTap={{ scale: 0.95 }} data-on={on || undefined}
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
              <Repeat size={15} />{repeat === 'never' ? 'Repeat' : FREQ_LABEL[repeat]}{repeat !== 'never' && until ? ` · until ${shortDate(until)}` : ''}
            </button>
            <button className="grow" onClick={openDate} style={{ position: 'relative', fontWeight: 600, color: 'var(--ink-2)' }}>
              {relativeDay(date).match(/Today|Yesterday|Tomorrow/) ? relativeDay(date) + ', ' : ''}{longDate.format(fromISO(date))}
              <input ref={dateRef} type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }} tabIndex={-1} />
            </button>
            <button className="iconbtn" style={{ width: 40, height: 34, color: fav ? 'var(--warn)' : 'var(--ink-3)' }} onClick={star} aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}>
              <motion.span key={String(fav)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }} style={{ display: 'grid' }}>
                <Star size={21} fill={fav ? 'currentColor' : 'none'} />
              </motion.span>
            </button>
            {editing
              ? <button className="iconbtn" style={{ color: 'var(--expense)', width: 40, height: 34 }} onClick={del} aria-label="Delete"><Trash2 size={20} /></button>
              : <span style={{ width: 52 }} />}
          </div>

          <Sheet open={!!askScope} onClose={() => setAskScope(null)} title={askScope === 'delete' ? 'Delete which ones?' : 'Change which ones?'} z={1}>
            <div className="sheet-body">
              <p className="small muted" style={{ margin: '0 4px 12px' }}>This is a repeating {type}.</p>
              <div className="list">
                {([['one', 'Only this one', shortDate(editing?.date ?? date)], ['next', 'This and the next ones', 'Earlier ones stay as they are'], ['all', 'All of them', 'Earlier and future ones']] as const).map(([k, l, hint]) => (
                  <button key={k} className="list-row" onClick={() => { const a = askScope; setAskScope(null); if (a === 'delete') deleteSeries(k); else saveSeries(k); }}>
                    <span className="grow"><span style={{ fontWeight: 600, color: askScope === 'delete' ? 'var(--expense)' : undefined }}>{l}</span><div className="tiny muted">{hint}</div></span>
                  </button>
                ))}
              </div>
            </div>
          </Sheet>
          <AccountPicker open={picker === 'from'} exclude={type === 'transfer' ? toAccountId : null}
            title={type === 'transfer' ? 'From account' : 'Account'}
            onPick={id => { setAccountId(id); setPicker(null); }} onClose={() => setPicker(null)} />
          <Sheet open={picker === 'repeat'} onClose={() => setPicker(null)} title="Repeat" z={1}>
            <div className="sheet-body">
              <div className="list">
                {(['never', 'weekly', 'monthly', 'yearly'] as const).map(f => (
                  <button key={f} className="list-row" onClick={() => { setRepeat(f); if (f === 'never') { setUntil(null); setPicker(null); } }}>
                    <span className="grow">{FREQ_LABEL[f]}</span>{repeat === f && <Check size={20} style={{ color: 'var(--accent)' }} />}
                  </button>
                ))}
              </div>
              {repeat !== 'never' && (
                <>
                  <div className="section-head" style={{ marginTop: 16 }}><span className="section-title">Until</span></div>
                  <div className="row" style={{ gap: 8 }}>
                    <button className={`chip ${until === null ? 'on' : ''}`} onClick={() => setUntil(null)}>Forever</button>
                    <button className={`chip ${until ? 'on' : ''}`} style={{ position: 'relative' }}
                      onClick={() => { const el = untilRef.current; if (!el) return; try { el.showPicker(); } catch { el.click(); } }}>
                      <CalendarDays size={16} />{until ? longDate.format(fromISO(until)) : 'Pick an end date'}
                      <input ref={untilRef} type="date" min={date} value={until ?? ''} onChange={e => setUntil(e.target.value || null)}
                        style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }} tabIndex={-1} />
                    </button>
                  </div>
                </>
              )}
              <p className="small muted" style={{ padding: '12px 6px 0' }}>Repeating entries are added automatically on their date and show as Planned before that. You'll see a reminder in the app the day before.</p>
              <button className="btn" style={{ marginTop: 10 }} onClick={() => setPicker(null)}>Done</button>
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
          </button>
        ))}
        <span className="ptab-ind" style={{ left: `calc(100% * (${Math.max(0, tabs.findIndex(x => x[0] === type))} + 0.22) / 3)`, width: 'calc(100% * 0.56 / 3)' }} />
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
      aria-label={k === 'del' ? 'Backspace' : k === 'date' ? 'Date' : k}>
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
