import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Plus, Users, EyeOff } from 'lucide-react';
import { useCategories, usePeriodStats, useSharedRoots } from '../lib/calc';
import { setUi } from '../lib/ui';
import { IconBox, Money, Pressable, Segmented, ease, softSpring } from '../components/ui';
import { RecurringBanner } from '../components/RecurringBanner';
import { haptic, money } from '../lib/format';
import { Sortable } from '../components/Sortable';
import { saveCategoryOrder, useStore } from '../lib/store';
import { BudgetRing } from '../components/Budget';
import type { CatType } from '../lib/types';

let lastType: CatType = 'expense';

export function CategoriesScreen() {
  const [type, setTypeState] = useState<CatType>(lastType);
  const setType = (t: CatType) => { lastType = t; setTypeState(t); };
  const cats = useCategories();
  const stats = usePeriodStats();
  const shared = useSharedRoots();
  // your categories plus the ones shared with you; amounts are only what you paid
  const tops = useMemo(() => cats.filter(c => c.type === type && !c.parent_id && !c.archived), [cats, type]);
  const hiddenCount = useMemo(() => cats.filter(c => c.archived).length, [cats]);
  const byId = useMemo(() => new Map(cats.map(c => [c.id, c])), [cats]);
  const saveOrder = (ids: string[]) => saveCategoryOrder(ids);
  const budgets = useStore(s => s.prefs.budgets);
  const monthView = useStore(s => s.period.mode === 'month');

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

      <Sortable key={type} className="cat-grid" style={{ marginTop: 18 }} ids={tops.map(c => c.id)}
        onTap={id => { haptic(6); setUi({ addTx: { type, categoryId: id } }); }}
        onHold={id => setUi({ catDetail: { id, type } })}
        onCommit={ids => saveOrder(ids)}
        render={id => {
          const c = byId.get(id)!;
          const v = stats.byCat.get(id) ?? 0;
          return (
            <div className="cat-tile">
              <span className="cat-name">{c.name}</span>
              <div style={{ position: 'relative' }}>
                {monthView && budgets?.[id] && type === 'expense'
                  ? <BudgetRing spent={v} limit={budgets[id]}><IconBox icon={c.icon} color={c.color} soft={v === 0} /></BudgetRing>
                  : <IconBox icon={c.icon} color={c.color} soft={v === 0} />}
                {shared.has(c.id) && <span className="shared-dot"><Users size={10} /></span>}
              </div>
              <span className="cat-amt num" style={{ color: v ? c.color : 'var(--ink-3)' }}>{money(v)}</span>
            </div>
          );
        }}
        after={
          <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={softSpring}>
            <Pressable className="cat-tile" style={{ width: '100%' }} onClick={() => setUi({ category: { type } })}>
              <span className="cat-name">New</span>
              <div className="ico" style={{ background: 'transparent', border: '1.5px dashed var(--ink-3)', color: 'var(--ink-3)', width: 54, height: 54, borderRadius: 18 }}><Plus size={22} /></div>
              <span className="cat-amt">&nbsp;</span>
            </Pressable>
          </motion.div>
        } />
      <p className="tiny faint" style={{ textAlign: 'center', marginTop: 22 }}>Tap to add · hold for details · hold and move to reorder</p>
      {hiddenCount > 0 && (
        <button className="row small muted" style={{ margin: '4px auto 0', gap: 6, padding: 8 }} onClick={() => setUi({ hidden: true })}>
          <EyeOff size={15} />Hidden categories · {hiddenCount}
        </button>
      )}
    </div>
  );
}
