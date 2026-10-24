import { motion, AnimatePresence } from 'motion/react';
import { Pause, Play, Trash2, Repeat } from 'lucide-react';
import { Sheet, IconBox, toast } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore, put, remove, restore } from '../lib/store';
import { alive, catName, catStyle, ruleDates, virtualId } from '../lib/calc';
import { money, shortDate, addDays, todayISO } from '../lib/format';

const F = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

export function RecurringSheet() {
  const open = useUi(u => u.recurring);
  const close = () => setUi({ recurring: false });
  return <Sheet open={open} onClose={close} title="Recurring" z={1}>{open && <Body />}</Sheet>;
}

function Body() {
  const rec = useStore(s => s.recurring);
  const cats = useStore(s => s.categories);
  const accs = useStore(s => s.accounts);
  const me = useStore(s => s.user?.id);
  const list = alive(rec).filter(r => r.owner_id === me).sort((a, b) => Number(b.active) - Number(a.active) || a.next_date.localeCompare(b.next_date));
  return (
    <div className="sheet-body">
      {list.length === 0 && (
        <div className="empty">
          <div className="ico lg" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}><Repeat size={24} /></div>
          <div className="bold" style={{ color: 'var(--ink)' }}>No recurring entries</div>
          <div className="small" style={{ marginTop: 4 }}>When adding a transaction, tap “Repeat” to make it recurring.</div>
        </div>
      )}
      <div className="list">
        <AnimatePresence initial={false}>
          {list.map(r => {
            const st = r.type === 'transfer' ? { icon: 'circle', color: '#64748B' } : catStyle(r.category_id, cats);
            const next = ruleDates(r, r.next_date, addDays(todayISO(), 800), 60)[0];
            const status = !r.active ? 'paused' : next ? `next ${shortDate(next)}${r.end_date ? ` · until ${shortDate(r.end_date)}` : ''}` : 'ended';
            return (
              <motion.div key={r.id} className="list-row" layout exit={{ opacity: 0, height: 0 }} style={{ opacity: r.active && next ? 1 : 0.55 }}>
                <IconBox icon={st.icon} color={st.color} round size="sm" />
                <div className="grow" role="button" onClick={() => next && r.active && setUi({ recurring: false, settings: false, addTx: { editId: virtualId(r.id, next) } })}>
                  <div className="ellipsis" style={{ fontWeight: 550 }}>{r.note || (r.type === 'transfer' ? 'Transfer' : catName(r.category_id, cats))}</div>
                  <div className="tiny muted">{F[r.freq]} · {accs[r.account_id]?.name} · {status}</div>
                </div>
                <span className="num bold small" style={{ color: r.type === 'expense' ? 'var(--expense)' : r.type === 'income' ? 'var(--income)' : undefined }}>{money(r.amount)}</span>
                <button className="iconbtn" style={{ width: 36 }} aria-label={r.active ? 'Pause' : 'Resume'} onClick={() => put('recurring', { ...r, active: !r.active })}>
                  {r.active ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button className="iconbtn" style={{ width: 36, color: 'var(--expense)' }} aria-label="Delete"
                  onClick={() => { remove('recurring', r.id); toast('Recurring entry removed', { label: 'Undo', run: () => restore('recurring', r.id) }); }}>
                  <Trash2 size={18} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {list.length > 0 && <p className="tiny muted" style={{ padding: '10px 6px' }}>Past entries stay when you pause or remove a rule.</p>}
    </div>
  );
}
