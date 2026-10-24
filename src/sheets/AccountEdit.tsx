import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeftRight, Minus, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import { Sheet, Segmented, IconBox, Icon, Toggle, toast, ease } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore, put, remove, restore, shareAccount, unshareAccount, memberList } from '../lib/store';
import { useBalances, useAccounts } from '../lib/calc';
import { ICON_NAMES, COLORS } from '../lib/icons';
import { REMOTE } from '../lib/supabase';
import { money, num, round2, uuid } from '../lib/format';
import type { Account, AccountKind, Profile } from '../lib/types';

export const parseNum = (s: string) => {
  const v = parseFloat(s.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(v) ? round2(v) : 0;
};
const show = (n: number | null | undefined) => (n == null ? '' : num(n).replace(/\./g, '').replace('−', '-'));

export function AccountSheet() {
  const arg = useUi(u => u.account);
  const acc = useStore(s => (arg?.id ? s.accounts[arg.id] : undefined));
  const me = useStore(s => s.user?.id);
  const close = () => setUi({ account: null });
  const shared = !!acc && acc.owner_id !== me;
  return (
    <Sheet open={!!arg} onClose={close} title={shared ? acc!.name : acc ? 'Edit account' : 'New account'} full={!shared}>
      {arg && (shared ? <SharedInfo acc={acc!} close={close} /> : <AccountForm key={arg.id ?? 'new'} acc={acc} close={close} />)}
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
  const [confirmDel, setConfirmDel] = useState(false);

  const save = () => {
    if (!name.trim()) return toast('Give the account a name');
    const target = parseNum(balance);
    const opening = acc ? round2(acc.opening_balance + (target - current)) : target;
    put('accounts', {
      id: acc?.id ?? uuid(), owner_id: acc?.owner_id ?? '', name: name.trim(), kind, icon, color, opening_balance: opening,
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
      {acc && (
        <div className="list" style={{ marginBottom: 14 }}>
          <div className="list-row"><span className="grow">Archived<div className="tiny muted">Hidden from lists and totals, history kept</div></span><Toggle on={archived} onChange={setArchived} /></div>
        </div>
      )}
      {acc && REMOTE && <ShareSection acc={acc} />}
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

function ShareSection({ acc }: { acc: Account }) {
  const [list, setList] = useState<Profile[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const online = useStore(s => s.online);
  const pending = useStore(s => s.pending);
  const load = () => memberList(acc.id).then(setList).catch(() => setList([]));
  useEffect(() => { if (online) void load(); }, [acc.id, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    if (!email.trim()) return;
    if (pending > 0) return toast('Still syncing — try again in a moment');
    setBusy(true);
    try {
      const r = await shareAccount(acc.id, email);
      if (r === 'ok') { toast('Shared · they can view this account'); setEmail(''); void load(); }
      else if (r === 'no_user') toast('No user with that email — they need to create an account first');
      else if (r === 'self') toast("That's you");
      else toast('Could not share');
    } catch { toast('Could not share — check your connection'); }
    setBusy(false);
  };
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="section-head"><span className="section-title row" style={{ gap: 6 }}><Users size={14} />Shared with</span></div>
      <div className="list">
        {list?.map(p => (
          <div key={p.id} className="list-row">
            <div className="avatar">{(p.display_name ?? p.email ?? '?').slice(0, 1).toUpperCase()}</div>
            <div className="grow"><div className="bold small">{p.display_name}</div><div className="tiny muted">{p.email} · view only</div></div>
            <button className="iconbtn" aria-label="Stop sharing" onClick={async () => { await unshareAccount(acc.id, p.id); void load(); toast('Stopped sharing'); }}><X size={18} /></button>
          </div>
        ))}
        <div className="list-row" style={{ gap: 8 }}>
          <input className="input" style={{ boxShadow: 'none', background: 'var(--surface-2)', height: 44 }} type="email" placeholder="Partner's email" value={email} onChange={e => setEmail(e.target.value)} />
          <button className="iconbtn" disabled={busy || !online} onClick={share} aria-label="Share" style={{ color: 'var(--accent)' }}><UserPlus size={22} /></button>
        </div>
      </div>
      <div className="tiny muted" style={{ padding: '6px 6px 0' }}>They see this account's balance and transactions. They can't add, edit or see anything else.</div>
    </div>
  );
}

function SharedInfo({ acc, close }: { acc: Account; close: () => void }) {
  const bal = useBalances();
  const profiles = useStore(s => s.profiles);
  return (
    <div className="sheet-body" style={{ textAlign: 'center' }}>
      <div style={{ display: 'grid', placeItems: 'center', margin: '8px 0 12px' }}><IconBox icon={acc.icon} color={acc.color} size="lg" /></div>
      <div style={{ fontSize: 36, fontWeight: 650 }} className="num">{money(bal.get(acc.id) ?? 0)}</div>
      <div className="badge" style={{ marginTop: 10 }}><Users size={12} />Shared by {profiles[acc.owner_id]?.display_name ?? 'partner'} · view only</div>
      <button className="btn secondary" style={{ marginTop: 22 }} onClick={() => { close(); setUi({ tab: 'transactions' }); }}>See transactions</button>
    </div>
  );
}
