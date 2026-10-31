import { useState } from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { Sheet, Icon } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { setAccountFilter, useStore } from '../lib/store';
import { useAccounts, useBalances, useSelection, defaultSelection } from '../lib/calc';
import { haptic, money } from '../lib/format';
import type { Account } from '../lib/types';

export function FilterSheet() {
  const open = useUi(u => u.filter);
  const close = () => setUi({ filter: false });
  return <Sheet open={open} onClose={close} title="Accounts in totals">{open && <Body close={close} />}</Sheet>;
}

function Body({ close }: { close: () => void }) {
  const accounts = useAccounts().filter(a => !a.archived);
  const bal = useBalances();
  const me = useStore(s => s.user?.id);
  const current = useSelection();
  const [sel, setSel] = useState<Set<string>>(() => new Set(current));
  const toggle = (id: string) => { haptic(5); setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const trading = new Set(useStore(s => s.prefs.tradingAccounts) ?? []);
  const invest = new Set((useStore(s => s.prefs.investmentAccounts) ?? []).filter(id => !trading.has(id)));
  const mine = accounts.filter(a => a.owner_id === me);
  // same groups as the Accounts tab
  const groups: Array<[string, Account[]]> = [
    ['Accounts', mine.filter(a => a.kind === 'regular' && !trading.has(a.id) && !invest.has(a.id))],
    ['Trading capital', mine.filter(a => trading.has(a.id))],
    ['Savings', mine.filter(a => a.kind === 'savings' && !trading.has(a.id) && !invest.has(a.id))],
    ['Investments', mine.filter(a => a.kind !== 'credit' && invest.has(a.id))],
    ['Debts', mine.filter(a => a.kind === 'credit' && !trading.has(a.id))],
  ];
  return (
    <div className="sheet-body">
      <p className="small muted" style={{ margin: '0 4px 12px' }}>Selected accounts make up the total at the top and every report.</p>
      {groups.filter(([, l]) => l.length).map(([title, list]) => (
        <div key={title} style={{ marginBottom: 16 }}>
          <div className="section-head"><span className="section-title">{title}</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {list.map(a => {
              const on = sel.has(a.id);
              return (
                <motion.button key={a.id} className="row" whileTap={{ scale: 0.96 }} onClick={() => toggle(a.id)}
                  style={{ borderRadius: 16, padding: '11px 12px', gap: 10, textAlign: 'left', border: `2px solid ${a.color}`, background: on ? a.color : 'transparent', color: on ? '#fff' : 'var(--ink)', transition: 'background .2s, color .2s' }}>
                  <span style={{ color: on ? '#fff' : a.color, display: 'grid' }}><Icon name={a.icon} size={20} /></span>
                  <div className="grow">
                    <div className="ellipsis small bold">{a.name}</div>
                    <div className="num small" style={{ opacity: 0.85 }}>{money(bal.get(a.id) ?? 0)}</div>
                  </div>
                  {on && <Check size={16} />}
                </motion.button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="row" style={{ gap: 10, marginTop: 8 }}>
        <button className="btn secondary" onClick={() => setSel(new Set(defaultSelection(accounts)))}>Reset</button>
        <button className="btn" onClick={() => { setAccountFilter(sel.size ? [...sel] : null); close(); }}>Done</button>
      </div>
    </div>
  );
}
