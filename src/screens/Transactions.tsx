import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { ArrowLeftRight, Search, Trash2, X, Repeat } from 'lucide-react';
import { useTxs, useSelection, catName, catStyle, sortTxs } from '../lib/calc';
import { useStore, remove, restore } from '../lib/store';
import { setUi, useUi } from '../lib/ui';
import { range } from '../lib/period';
import { IconBox, Icon, Money, toast, ease } from '../components/ui';
import { RecurringBanner } from '../components/RecurringBanner';
import { fromISO, haptic, num, relativeDay, round2, todayISO } from '../lib/format';
import type { Tx } from '../lib/types';

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

export function TransactionsScreen() {
  const txs = useTxs();
  const sel = useSelection();
  const period = useStore(s => s.period);
  const cats = useStore(s => s.categories);
  const accs = useStore(s => s.accounts);
  const search = useUi(u => u.search);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(30);

  const groups = useMemo(() => {
    const [a, b] = range(period);
    const query = q.trim().toLowerCase();
    const list = txs.filter(t => {
      if (!(sel.has(t.account_id) || (t.to_account_id && sel.has(t.to_account_id)))) return false;
      if (query) {
        const hay = [t.note, catName(t.category_id, cats), accs[t.account_id]?.name, t.to_account_id ? accs[t.to_account_id]?.name : '', num(t.amount)].join(' ').toLowerCase();
        return hay.includes(query);
      }
      return t.date >= a && t.date <= b;
    });
    const out: Array<{ date: string; txs: Tx[]; net: number }> = [];
    for (const t of sortTxs(list)) {
      let g = out[out.length - 1];
      if (!g || g.date !== t.date) out.push((g = { date: t.date, txs: [], net: 0 }));
      g.txs.push(t);
      if (t.type === 'income' && sel.has(t.account_id)) g.net += t.amount;
      else if (t.type === 'expense' && sel.has(t.account_id)) g.net -= t.amount;
    }
    out.forEach(g => { g.net = round2(g.net); });
    return out;
  }, [txs, sel, period, q, cats, accs]);

  useEffect(() => setLimit(30), [period, q]);
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const io = new IntersectionObserver(e => { if (e[0].isIntersecting) setLimit(l => l + 30); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [groups.length, limit]);

  let rowIndex = 0;
  return (
    <div className="screen" style={{ width: '100%' }}>
      <AnimatePresence initial={false}>
        {search && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease }} style={{ overflow: 'hidden' }}>
            <div className="row" style={{ gap: 8, paddingBottom: 6 }}>
              <div className="grow" style={{ position: 'relative' }}>
                <Search size={18} style={{ position: 'absolute', left: 14, top: 16, color: 'var(--ink-3)' }} />
                <input className="input" autoFocus placeholder="Search notes, categories, amounts" value={q} onChange={e => setQ(e.target.value)} style={{ paddingLeft: 42 }} />
              </div>
              <button className="iconbtn" onClick={() => { setQ(''); setUi({ search: false }); }} aria-label="Close search"><X size={22} /></button>
            </div>
            {q && <div className="tiny faint" style={{ padding: '0 4px' }}>Searching all dates</div>}
          </motion.div>
        )}
      </AnimatePresence>
      {!search && <RecurringBanner />}
      {groups.length === 0 && (
        <div className="empty">
          <IconBox icon="receipt" color="#64748B" size="lg" />
          <div className="bold" style={{ color: 'var(--ink)' }}>{q ? 'Nothing found' : 'No transactions here'}</div>
          <div className="small" style={{ marginTop: 4 }}>{q ? 'Try another word or amount.' : 'Tap + to add one.'}</div>
        </div>
      )}
      {groups.slice(0, limit).map(g => {
        const d = fromISO(g.date);
        const rel = relativeDay(g.date);
        return (
          <div key={g.date}>
            <div className="day-head">
              <div className="day-num num" style={{ color: g.date === todayISO() ? 'var(--accent)' : undefined }}>{d.getDate()}</div>
              <div className="day-meta grow">
                <div className="d1" style={{ color: g.date === todayISO() ? undefined : 'var(--ink-2)' }}>{rel}</div>
                <div className="d2">{monthFmt.format(d)}</div>
              </div>
              {g.net !== 0 && <Money value={g.net} sign colorize className="bold" animate={false} />}
            </div>
            <div className="list">
              {g.txs.map(t => <TxRow key={t.id} t={t} index={rowIndex++} />)}
            </div>
          </div>
        );
      })}
      {groups.length > limit && <div ref={more} style={{ height: 40 }} />}
    </div>
  );
}

function TxRow({ t, index }: { t: Tx; index: number }) {
  const cats = useStore(s => s.categories);
  const accs = useStore(s => s.accounts);
  const me = useStore(s => s.user?.id);
  const profiles = useStore(s => s.profiles);
  const mine = t.owner_id === me;
  const style = t.type === 'transfer' ? { icon: 'circle', color: '#64748B' } : catStyle(t.category_id, cats);
  const acc = accs[t.account_id];
  const to = t.to_account_id ? accs[t.to_account_id] : null;
  const ownerName = profiles[t.owner_id]?.display_name ?? 'Partner';

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -100 || info.velocity.x < -700) {
      haptic(14);
      remove('transactions', t.id);
      toast('Transaction deleted', { label: 'Undo', run: () => restore('transactions', t.id) });
    }
  };
  const anim = index < 14;
  return (
    <motion.div className="swipe-wrap" layout="position" exit={{ height: 0, opacity: 0 }}
      initial={anim ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease, delay: anim ? index * 0.022 : 0 }}>
      {mine && <div className="swipe-bg"><Trash2 size={20} /></div>}
      <motion.button className="list-row" drag={mine ? 'x' : false} dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0.5, right: 0 }}
        dragDirectionLock onDragEnd={onDragEnd} onClick={() => setUi({ addTx: { editId: t.id } })} style={{ touchAction: 'pan-y' }}>
        {t.type === 'transfer'
          ? <div className="ico round" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}><ArrowLeftRight size={20} /></div>
          : <IconBox icon={style.icon} color={style.color} round />}
        <div className="grow">
          <div className="ellipsis" style={{ fontWeight: 550 }}>
            {t.type === 'transfer' ? 'Transfer' : catName(t.category_id, cats)}
          </div>
          <div className="tx-sub ellipsis">
            {t.type === 'transfer'
              ? <>{acc?.name ?? ownerName}<ArrowLeftRight size={12} />{to?.name ?? '—'}</>
              : <><Icon name={acc?.icon ?? 'wallet'} size={13} />{acc?.name ?? '—'}</>}
            {t.recurring_id && <Repeat size={12} />}
            {!mine && <span className="badge" style={{ marginLeft: 4 }}>by {ownerName}</span>}
          </div>
          {t.note && <div className="tx-note ellipsis">{t.note}</div>}
        </div>
        <span className="tx-amt num" style={{ color: t.type === 'expense' ? 'var(--expense)' : t.type === 'income' ? 'var(--income)' : 'var(--ink-2)' }}>
          {t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}{num(t.amount)}<span className="cur">€</span>
        </span>
      </motion.button>
    </motion.div>
  );
}
