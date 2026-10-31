import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeftRight, Minus, Plus, Trash2 } from 'lucide-react';
import { Sheet, Segmented, IconBox, Icon, Toggle, toast, ease } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore, put, remove, restore, getState, setPrefs } from '../lib/store';
import { useBalances, useAccounts } from '../lib/calc';
import { ICON_NAMES, COLORS } from '../lib/icons';
import { money, num, round2, uuid } from '../lib/format';
import type { Account, AccountKind } from '../lib/types';

export const parseNum = (s: string) => {
  const v = parseFloat(s.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(v) ? round2(v) : 0;
};
const show = (n: number | null | undefined) => (n == null ? '' : num(n).replace(/\./g, '').replace('−', '-'));

export function AccountSheet() {
  const arg = useUi(u => u.account);
  const acc = useStore(s => (arg?.id ? s.accounts[arg.id] : undefined));
  const close = () => setUi({ account: null });
  return (
    <Sheet open={!!arg} onClose={close} title={acc ? 'Edit account' : 'New account'} full>
      {arg && <AccountForm key={arg.id ?? 'new'} acc={acc} close={close} />}
    </Sheet>
  );
}

function AccountForm({ acc, close }: { acc?: Account; close: () => void }) {
  const bal = useBalances();
  const accounts = useAccounts();
  const current = acc ? bal.get(acc.id) ?? 0 : 0;
  const [name, setName] = useState(acc?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(acc?.kind ?? 'regular');
  const [icon, setIcon] = useState(acc?.icon ?? 'wallet');
  const [color, setColor] = useState(acc?.color ?? COLORS[8]);
  const [balance, setBalance] = useState(show(current));
  const [limit, setLimit] = useState(show(acc?.credit_limit));
  const [goal, setGoal] = useState(show(acc?.goal));
  const [archived, setArchived] = useState(acc?.archived ?? false);
  type Holds = 'cash' | 'trading' | 'invest';   // what the money is, for the groups and the levels
  const wasHolds = useStore((s): Holds => (!acc ? 'cash' : (s.prefs.tradingAccounts ?? []).includes(acc.id) ? 'trading' : (s.prefs.investmentAccounts ?? []).includes(acc.id) ? 'invest' : 'cash'));
  const [holds, setHolds] = useState<Holds>(wasHolds);
  const [confirmDel, setConfirmDel] = useState(false);

  const save = () => {
    if (!name.trim()) return toast('Give the account a name');
    const target = parseNum(balance);
    const opening = acc ? round2(acc.opening_balance + (target - current)) : target;
    const id = acc?.id ?? uuid();
    const h = kind === 'credit' ? 'cash' : holds;
    if (h !== wasHolds) {
      const p = getState().prefs;
      const t = (p.tradingAccounts ?? []).filter(x => x !== id), inv = (p.investmentAccounts ?? []).filter(x => x !== id);
      setPrefs({ tradingAccounts: h === 'trading' ? [...t, id] : t, investmentAccounts: h === 'invest' ? [...inv, id] : inv });
    }
    put('accounts', {
      id, owner_id: acc?.owner_id ?? '', name: name.trim(), kind, icon, color, opening_balance: opening,
      credit_limit: kind === 'credit' && limit ? parseNum(limit) : null, goal: kind === 'savings' && goal ? parseNum(goal) : null,
      archived, sort: acc?.sort ?? Math.max(0, ...accounts.map(a => a.sort)) + 1,
    });
    toast(acc ? 'Account saved' : 'Account added');
    close();
  };
  const del = () => {
    if (!acc) return;
    remove('accounts', acc.id);
    toast(`${acc.name} deleted`, { label: 'Undo', run: () => { restore('accounts', acc.id); } });
    close();
  };

  return (
    <div className="sheet-body">
      <motion.div className="row" style={{ justifyContent: 'center', margin: '4px 0 18px' }} layout>
        <motion.div key={icon + color} initial={{ scale: 0.8, rotate: -6 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
          <IconBox icon={icon} color={color} size="lg" />
        </motion.div>
      </motion.div>

      {acc && (
        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
          <button className="btn secondary" style={{ height: 44, fontSize: 14 }} onClick={() => { close(); setUi({ addTx: { type: 'expense', accountId: acc.id } }); }}><Minus size={16} />Expense</button>
          <button className="btn secondary" style={{ height: 44, fontSize: 14 }} onClick={() => { close(); setUi({ addTx: { type: 'income', accountId: acc.id } }); }}><Plus size={16} />Income</button>
          <button className="btn secondary" style={{ height: 44, fontSize: 14 }} onClick={() => { close(); setUi({ addTx: { type: 'transfer', accountId: acc.id } }); }}><ArrowLeftRight size={16} />Transfer</button>
        </div>
      )}

      <div className="field"><label>Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Revolut" /></div>
      <div className="field">
        <label>Type</label>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'regular', label: 'Regular' }, { value: 'credit', label: 'Credit card' }, { value: 'savings', label: 'Savings' }]} />
      </div>
      <div className="field">
        <label>{acc ? 'Current balance' : 'Starting balance'}</label>
        <input className="input num" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} placeholder="0" />
        {acc && parseNum(balance) !== current && <span className="tiny muted" style={{ paddingLeft: 4 }}>Balance will be corrected from {money(current)} without adding a transaction.</span>}
      </div>
      <AnimatePresence initial={false}>
        {kind === 'credit' && (
          <motion.div key="lim" className="field" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22, ease }}>
            <label>Credit limit</label>
            <input className="input num" inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} placeholder="e.g. 1000" />
          </motion.div>
        )}
        {kind === 'savings' && (
          <motion.div key="goal" className="field" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22, ease }}>
            <label>Goal</label>
            <input className="input num" inputMode="decimal" value={goal} onChange={e => setGoal(e.target.value)} placeholder="e.g. 3000" />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="field">
        <label>Color</label>
        <div className="pick-grid">
          {COLORS.map(c => <button key={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
        </div>
      </div>
      <div className="field">
        <label>Icon</label>
        <div className="pick-grid">
          {ICON_NAMES.map(n => <button key={n} className={n === icon ? 'on' : ''} onClick={() => setIcon(n)} aria-label={n}><Icon name={n} size={20} /></button>)}
        </div>
      </div>
      {kind !== 'credit' && (
        <div className="field">
          <label>Holds</label>
          <Segmented value={holds} onChange={setHolds} options={[{ value: 'cash', label: 'Cash' }, { value: 'trading', label: 'Trading' }, { value: 'invest', label: 'Investments' }]} />
          <span className="tiny muted" style={{ paddingLeft: 4 }}>Trading capital and investments get their own group and don't count as your cash in the levels.</span>
        </div>
      )}
      {acc && (
        <div className="list" style={{ marginBottom: 14 }}>
          <div className="list-row"><span className="grow">Archived<div className="tiny muted">Hidden from lists and totals, history kept</div></span><Toggle on={archived} onChange={setArchived} /></div>
        </div>
      )}
      <button className="btn" onClick={save} style={{ marginTop: 6 }}>Save</button>
      {acc && (
        <AnimatePresence mode="wait" initial={false}>
          {!confirmDel ? (
            <motion.button key="d" className="btn danger" style={{ marginTop: 10 }} onClick={() => setConfirmDel(true)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Trash2 size={18} />Delete account
            </motion.button>
          ) : (
            <motion.div key="c" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ marginTop: 10 }}>
              <div className="small muted" style={{ textAlign: 'center', marginBottom: 8 }}>This deletes the account and all its transactions. Archive instead to keep history.</div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn secondary" onClick={() => setConfirmDel(false)}>Cancel</button>
                <button className="btn danger" onClick={del}>Delete</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
