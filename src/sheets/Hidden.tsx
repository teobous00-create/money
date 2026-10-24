import { AnimatePresence, motion } from 'motion/react';
import { Eye, EyeOff } from 'lucide-react';
import { Sheet, IconBox, toast } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore, put } from '../lib/store';
import { useCategories } from '../lib/calc';

export function HiddenSheet() {
  const open = useUi(u => u.hidden);
  const close = () => setUi({ hidden: false });
  return <Sheet open={open} onClose={close} title="Hidden categories" z={1}>{open && <Body />}</Sheet>;
}

function Body() {
  const cats = useCategories();
  const rec = useStore(s => s.categories);
  const hidden = cats.filter(c => c.archived).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  return (
    <div className="sheet-body">
      {hidden.length === 0 && (
        <div className="empty">
          <div className="ico lg" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}><EyeOff size={24} /></div>
          Nothing hidden.
        </div>
      )}
      <div className="list">
        <AnimatePresence initial={false}>
          {hidden.map(c => {
            const parent = c.parent_id ? rec[c.parent_id] : null;
            return (
              <motion.div key={c.id} className="list-row" layout exit={{ opacity: 0, height: 0 }}>
                <IconBox icon={c.icon} color={parent?.color ?? c.color} soft round size="sm" />
                <div className="grow">
                  <div className="ellipsis" style={{ fontWeight: 550 }}>{c.name}</div>
                  <div className="tiny muted">{parent ? `Subcategory of ${parent.name}` : c.type === 'expense' ? 'Expense category' : 'Income category'}</div>
                </div>
                <button className="chip" onClick={() => { put('categories', { ...c, archived: false }); toast(`${c.name} is visible again`); }}><Eye size={16} />Show</button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {hidden.length > 0 && <p className="tiny muted" style={{ padding: '10px 6px' }}>Hidden categories keep all their transactions and still count in reports.</p>}
    </div>
  );
}
