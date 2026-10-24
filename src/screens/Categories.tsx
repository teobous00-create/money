import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { useCategories, usePeriodStats } from '../lib/calc';
import { useStore } from '../lib/store';
import { setUi } from '../lib/ui';
import { IconBox, Money, Pressable, Segmented, ease, softSpring } from '../components/ui';
import { RecurringBanner } from '../components/RecurringBanner';
import { haptic, money } from '../lib/format';
import type { CatType } from '../lib/types';

let lastType: CatType = 'expense';

export function CategoriesScreen() {
  const [type, setTypeState] = useState<CatType>(lastType);
  const setType = (t: CatType) => { lastType = t; setTypeState(t); };
  const cats = useCategories();
  const catRec = useStore(s => s.categories);
  const me = useStore(s => s.user?.id);
  const stats = usePeriodStats();

  const tops = useMemo(() => {
    const own = cats.filter(c => c.type === type && !c.parent_id && !c.archived && c.owner_id === me);
    // categories of a shared account's owner, shown only when they carry an amount
    const shared = [...stats.byCat.keys()].map(id => catRec[id]).filter(c => c && c.type === type && c.owner_id !== me && !c.deleted_at);
    return [...own, ...shared];
  }, [cats, catRec, type, me, stats]);

  const total = type === 'expense' ? stats.expense : stats.income;
  const other = type === 'expense' ? stats.income : stats.expense;
  const ranked = tops.map(c => ({ c, v: stats.byCat.get(c.id) ?? 0 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);

  return (
    <div className="screen" style={{ width: '100%' }}>
      <RecurringBanner />
      <div className="card" style={{ padding: 14 }}>
        <Segmented value={type} onChange={setType}
          options={[{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} />
        <div style={{ padding: '14px 4px 4px' }}>
          <div style={{ fontSize: 34, fontWeight: 650, letterSpacing: '-0.03em', color: type === 'expense' ? 'var(--expense)' : 'var(--income)' }}>
            <Money value={total} />
          </div>
          <div className="small muted" style={{ marginTop: 2 }}>
            {type === 'expense' ? 'Income' : 'Expenses'} {money(other)}
            {stats.income > 0 && type === 'expense' && <> · {Math.round((stats.expense / stats.income) * 100)}% of income spent</>}
          </div>
        </div>
        <div className="sharebar" style={{ marginTop: 12 }}>
          {ranked.map(({ c, v }) => (
            <motion.div key={c.id} layout style={{ background: c.color }} initial={{ flexGrow: 0 }} animate={{ flexGrow: v }} transition={{ duration: 0.7, ease }} />
          ))}
        </div>
      </div>

      <motion.div className="cat-grid" style={{ marginTop: 18 }} key={type}
        initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.025 } } }}>
        {tops.map(c => {
          const v = stats.byCat.get(c.id) ?? 0;
          const mine = c.owner_id === me;
          return (
            <motion.div key={c.id} variants={{ hidden: { opacity: 0, scale: 0.85, y: 6 }, show: { opacity: 1, scale: 1, y: 0 } }} transition={softSpring}>
              <Pressable className="cat-tile" style={{ width: '100%' }}
                onClick={() => { if (!mine) return setUi({ catDetail: { id: c.id, type } }); haptic(6); setUi({ addTx: { type, categoryId: c.id } }); }}
                onLongPress={() => { haptic(12); setUi({ catDetail: { id: c.id, type } }); }}>
                <span className="cat-name">{c.name}</span>
                <IconBox icon={c.icon} color={c.color} soft={v === 0} />
                <span className="cat-amt num" style={{ color: v ? c.color : 'var(--ink-3)' }}>{money(v)}</span>
              </Pressable>
            </motion.div>
          );
        })}
        <motion.div variants={{ hidden: { opacity: 0, scale: 0.85 }, show: { opacity: 1, scale: 1 } }}>
          <Pressable className="cat-tile" style={{ width: '100%' }} onClick={() => setUi({ category: { type } })}>
            <span className="cat-name">New</span>
            <div className="ico" style={{ background: 'transparent', border: '1.5px dashed var(--ink-3)', color: 'var(--ink-3)', width: 54, height: 54, borderRadius: 18 }}><Plus size={22} /></div>
            <span className="cat-amt">&nbsp;</span>
          </Pressable>
        </motion.div>
      </motion.div>
      <p className="tiny faint" style={{ textAlign: 'center', marginTop: 22 }}>Tap a category to add · hold for details</p>
    </div>
  );
}
