import { motion, AnimatePresence } from 'motion/react';
import { Pause, Play, Trash2, Repeat } from 'lucide-react';
import { Sheet, IconBox, toast } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore, put, remove, restore } from '../lib/store';
import { alive, catName, catStyle, ruleDates, virtualId } from '../lib/calc';
import { money, shortDate, addDays, todayISO, round2 } from '../lib/format';
import type { Recurring } from '../lib/types';

const F = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const PER_MONTH = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 };

/** What the running rules cost (or bring in) per month and per day: weekly ×52/12, yearly ÷12; paused or ended rules don't count. */
function Totals({ list }: { list: Recurring[] }) {
  const t = todayISO();
  const live = list.filter(r => r.active && r.type !== 'transfer' && (!r.end_date || r.end_date >= t) && ruleDates(r, r.next_date, addDays(t, 800), 1).length > 0);
  const sum = (type: 'expense' | 'income') => live.filter(r => r.type === type).reduce((s, r) => s + r.amount * PER_MONTH[r.freq], 0);
  const rows = ([['expense', 'Expenses', 'var(--expense)'], ['income', 'Income', 'var(--income)']] as const)
    .map(([k, label, color]) => ({ label, color, m: sum(k) })).filter(x => x.m > 0);
  if (!rows.length) return null;
  return (
    <div className="card" style={{ marginTop: 12, padding: '12px 16px' }}>
      {rows.map(r => (
        <div key={r.label} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
          <span className="small" style={{ fontWeight: 600 }}>{r.label}</span>
          <span className="num small" style={{ textAlign: 'right' }}>
            <b style={{ color: r.color }}>{money(round2(r.m))}</b><span className="muted">/month</span>
            <span className="muted"> · </span>
            <b style={{ color: r.color }}>{money(round2((r.m * 12) / 365))}</b><span className="muted">/day</span>
          </span>
        </div>
      ))}
    </div>
  );
}

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
      {list.length > 0 && <Totals list={list} />}
      {list.length > 0 && <p className="tiny muted" style={{ padding: '10px 6px' }}>Past entries stay when you pause or remove a rule.</p>}
    </div>
  );
}
