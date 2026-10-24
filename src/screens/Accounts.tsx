import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Archive } from 'lucide-react';
import { useAccounts, useBalances } from '../lib/calc';
import { useStore } from '../lib/store';
import { setUi } from '../lib/ui';
import { IconBox, Money, Ring, Segmented, ease, softSpring } from '../components/ui';
import type { Account } from '../lib/types';
import { money, round2 } from '../lib/format';

export function AccountsScreen() {
  const [view, setView] = useState<'list' | 'worth'>('list');
  const accounts = useAccounts();
  const bal = useBalances();
  const me = useStore(s => s.user?.id);
  const [showArchive, setShowArchive] = useState(false);

  const regular = accounts.filter(a => !a.archived && a.kind !== 'savings');
  const savings = accounts.filter(a => !a.archived && a.kind === 'savings');
  const archived = accounts.filter(a => a.archived);
  const sum = (l: Account[]) => round2(l.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0));

  const Row = ({ a, i }: { a: Account; i: number }) => {
    const b = bal.get(a.id) ?? 0;
    return (
      <motion.button className="list-row" onClick={() => setUi({ account: { id: a.id } })}
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: Math.min(i, 10) * 0.03 }}>
        <div style={{ position: 'relative' }}>
          <IconBox icon={a.icon} color={a.color} />
        </div>
        <div className="grow">
          <div className="ellipsis" style={{ fontWeight: 550 }}>{a.name}</div>
          <Money value={b} className={b < 0 ? 'neg' : b === 0 ? 'zero' : ''} />
        </div>
        {a.kind === 'credit' && a.credit_limit != null && (
          <div style={{ textAlign: 'right' }}>
            <div className="tiny faint">Available</div>
            <div className="small bold num pos">{money(round2(a.credit_limit + b))}</div>
          </div>
        )}
        {a.kind === 'savings' && a.goal ? (
          <div className="row" style={{ gap: 10 }}>
            <span className="small muted num">{money(a.goal)}</span>
            <Ring value={b / a.goal} color={a.color} />
          </div>
        ) : null}
      </motion.button>
    );
  };

  return (
    <div className="screen" style={{ width: '100%' }}>
      <Segmented value={view} onChange={setView} style={{ margin: '4px 0 6px' }}
        options={[{ value: 'list', label: 'Accounts' }, { value: 'worth', label: 'Net worth' }]} />

      <AnimatePresence mode="wait" initial={false}>
        {view === 'list' ? (
          <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            {accounts.length === 0 && (
              <div className="empty">
                <IconBox icon="wallet" color="#64748B" size="lg" />
                <div className="bold" style={{ color: 'var(--ink)' }}>No accounts yet</div>
                <div className="small" style={{ marginTop: 4 }}>Tap + to add one, or import your 1Money export from Settings.</div>
              </div>
            )}
            {regular.length > 0 && (
              <div className="section">
                <div className="section-head"><span className="section-title">Accounts</span><Money value={sum(regular)} className="bold" colorize /></div>
                <div className="list">{regular.map((a, i) => <Row key={a.id} a={a} i={i} />)}</div>
              </div>
            )}
            {savings.length > 0 && (
              <div className="section">
                <div className="section-head"><span className="section-title">Savings</span><Money value={sum(savings)} className="bold" /></div>
                <div className="list">{savings.map((a, i) => <Row key={a.id} a={a} i={i + regular.length} />)}</div>
              </div>
            )}
            {archived.length > 0 && (
              <div className="section">
                <button className="section-head" style={{ width: '100%' }} onClick={() => setShowArchive(v => !v)}>
                  <span className="section-title row" style={{ gap: 6 }}><Archive size={14} />Archive · {archived.length}</span>
                  <motion.span animate={{ rotate: showArchive ? 180 : 0 }} transition={softSpring} className="muted"><ChevronDown size={18} /></motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {showArchive && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} style={{ overflow: 'hidden' }}>
                      <div className="list">{archived.map((a, i) => <Row key={a.id} a={a} i={i} />)}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="worth" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <NetWorth accounts={accounts.filter(a => a.owner_id === me && !a.archived)} bal={bal} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NetWorth({ accounts, bal }: { accounts: Account[]; bal: Map<string, number> }) {
  let assets = 0, debts = 0;
  for (const a of accounts) { const b = bal.get(a.id) ?? 0; if (b >= 0) assets += b; else debts -= b; }
  assets = round2(assets); debts = round2(debts);
  const max = Math.max(assets, debts, 1);
  return (
    <div className="section">
      <div className="card">
        <div className="small muted" style={{ fontWeight: 600 }}>Net worth</div>
        <div style={{ fontSize: 32, fontWeight: 650, letterSpacing: '-0.02em' }}>
          <Money value={round2(assets - debts)} colorize />
        </div>
        <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
          {[['Assets', assets, 'var(--income)'], ['Debts', debts, 'var(--expense)']].map(([l, v, c], i) => (
            <div key={l as string}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="small" style={{ fontWeight: 600 }}>{l}</span>
                <Money value={v as number} className="small bold" />
              </div>
              <div className="bar" style={{ height: 10 }}>
                <motion.div style={{ background: c as string }} initial={{ width: 0 }} animate={{ width: `${((v as number) / max) * 100}%` }} transition={{ duration: 0.8, ease, delay: i * 0.08 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <div className="section-head"><span className="section-title">Debts</span></div>
        <div className="list">
          {accounts.filter(a => (bal.get(a.id) ?? 0) < 0).map(a => (
            <div key={a.id} className="list-row">
              <IconBox icon={a.icon} color={a.color} size="sm" />
              <span className="grow ellipsis">{a.name}</span>
              <Money value={bal.get(a.id) ?? 0} className="bold neg" />
            </div>
          ))}
          {accounts.every(a => (bal.get(a.id) ?? 0) >= 0) && <div className="list-row muted small">No debts. Nice.</div>}
        </div>
      </div>
    </div>
  );
}
