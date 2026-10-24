import { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Sheet, Segmented } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore, setPeriod } from '../lib/store';
import { fromISO, todayISO } from '../lib/format';
import type { PeriodMode } from '../lib/period';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PeriodSheet() {
  const open = useUi(u => u.periodPicker);
  const close = () => setUi({ periodPicker: false });
  return <Sheet open={open} onClose={close} title="Period">{open && <Body close={close} />}</Sheet>;
}

function Body({ close }: { close: () => void }) {
  const period = useStore(s => s.period);
  const [year, setYear] = useState(fromISO(period.anchor).getFullYear());
  const now = new Date();
  const pickMode = (m: PeriodMode) => { setPeriod({ mode: m, anchor: m === 'month' || m === 'year' ? period.anchor : todayISO() }); if (m !== 'month') close(); };
  const curM = fromISO(period.anchor);
  return (
    <div className="sheet-body">
      <Segmented value={period.mode} onChange={pickMode}
        options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }, { value: 'all', label: 'All' }]} />
      {(period.mode === 'month' || period.mode === 'year') && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <button className="iconbtn" onClick={() => setYear(y => y - 1)}><ChevronLeft size={22} /></button>
            <motion.button key={year} className="bold" style={{ fontSize: 18 }} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => { setPeriod({ mode: 'year', anchor: `${year}-01-01` }); close(); }}>{year}</motion.button>
            <button className="iconbtn" onClick={() => setYear(y => y + 1)}><ChevronRight size={22} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {MONTHS.map((m, i) => {
              const on = period.mode === 'month' && curM.getFullYear() === year && curM.getMonth() === i;
              const isNow = now.getFullYear() === year && now.getMonth() === i;
              return (
                <motion.button key={m} whileTap={{ scale: 0.94 }} onClick={() => { setPeriod({ mode: 'month', anchor: `${year}-${String(i + 1).padStart(2, '0')}-01` }); close(); }}
                  style={{ height: 44, borderRadius: 12, fontWeight: 600, background: on ? 'var(--accent)' : 'var(--surface-2)', color: on ? 'var(--accent-ink)' : isNow ? 'var(--accent)' : 'var(--ink)' }}>
                  {m}
                </motion.button>
              );
            })}
          </div>
        </div>
      )}
      <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => { setPeriod({ mode: period.mode === 'all' ? 'month' : period.mode, anchor: todayISO() }); close(); }}>Go to today</button>
    </div>
  );
}
