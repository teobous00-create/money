import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { alive, catName } from '../lib/calc';
import { addDays, money, todayISO } from '../lib/format';
import { setUi } from '../lib/ui';
import { ease } from './ui';

/** Day-before reminder for recurring entries that will be added automatically tomorrow. */
export function RecurringBanner() {
  const rec = useStore(s => s.recurring);
  const cats = useStore(s => s.categories);
  const accs = useStore(s => s.accounts);
  const tomorrow = addDays(todayISO(), 1);
  const key = 'money:remind-dismissed';
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === todayISO(); } catch { return false; } });
  const due = useMemo(() => alive(rec).filter(r => r.active && r.next_date === tomorrow), [rec, tomorrow]);
  const show = due.length > 0 && !dismissed;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease }} style={{ overflow: 'hidden' }}>
          <div className="banner">
            <Bell size={20} style={{ color: 'var(--accent)', flex: 'none' }} />
            <button className="grow" style={{ textAlign: 'left' }} onClick={() => setUi({ recurring: true })}>
              <div className="bold small">Tomorrow</div>
              {due.map(r => (
                <div key={r.id} className="small muted ellipsis">
                  {r.note || (r.type === 'transfer' ? 'Transfer' : catName(r.category_id, cats))} · {r.type === 'income' ? '+' : '−'}{money(r.amount)} · {accs[r.account_id]?.name}
                </div>
              ))}
            </button>
            <button className="iconbtn" style={{ width: 32, height: 32 }} aria-label="Dismiss"
              onClick={() => { try { localStorage.setItem(key, todayISO()); } catch { /* ignore */ } setDismissed(true); }}>
              <X size={18} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
