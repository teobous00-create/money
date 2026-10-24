import { useState } from 'react';
import { motion } from 'motion/react';
import { Trash2 } from 'lucide-react';
import { Sheet, Segmented, IconBox, Icon, Toggle, toast } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore, put, remove, restore } from '../lib/store';
import { useCategories } from '../lib/calc';
import { ICON_NAMES, COLORS, guessStyle } from '../lib/icons';
import { uuid } from '../lib/format';
import type { CatType, Category } from '../lib/types';

export function CategorySheet() {
  const arg = useUi(u => u.category);
  const cat = useStore(s => (arg?.id ? s.categories[arg.id] : undefined));
  const close = () => setUi({ category: null });
  const isSub = !!(cat?.parent_id ?? arg?.parentId);
  return (
    <Sheet open={!!arg} onClose={close} title={cat ? (isSub ? 'Edit subcategory' : 'Edit category') : isSub ? 'New subcategory' : 'New category'} z={1} full={!isSub}>
      {arg && <Form key={arg.id ?? 'new' + arg.parentId} cat={cat} type={arg.type} parentId={arg.parentId} close={close} />}
    </Sheet>
  );
}

function Form({ cat, type: initialType, parentId, close }: { cat?: Category; type?: CatType; parentId?: string; close: () => void }) {
  const cats = useCategories();
  const parentRec = useStore(s => (parentId ?? cat?.parent_id ? s.categories[(parentId ?? cat?.parent_id)!] : undefined));
  const [name, setName] = useState(cat?.name ?? '');
  const [type, setType] = useState<CatType>(cat?.type ?? parentRec?.type ?? initialType ?? 'expense');
  const [icon, setIcon] = useState(cat?.icon ?? 'circle');
  const [color, setColor] = useState(cat?.color ?? parentRec?.color ?? COLORS[(cats.length * 5) % COLORS.length]);
  const [archived, setArchived] = useState(cat?.archived ?? false);
  const [touchedIcon, setTouchedIcon] = useState(!!cat);
  const isSub = !!parentRec;

  const onName = (v: string) => {
    setName(v);
    if (!touchedIcon) { const g = guessStyle(v); setIcon(g.icon); if (!isSub && g.icon !== 'circle') setColor(g.color); }
  };
  const save = () => {
    if (!name.trim()) return toast('Give it a name');
    put('categories', {
      id: cat?.id ?? uuid(), owner_id: cat?.owner_id ?? '', type, name: name.trim(), parent_id: parentRec?.id ?? null,
      icon, color: isSub ? parentRec!.color : color, archived,
      sort: cat?.sort ?? Math.max(0, ...cats.map(c => c.sort)) + 1,
    });
    toast(cat ? 'Saved' : 'Category added');
    close();
  };
  const del = () => {
    if (!cat) return;
    remove('categories', cat.id);
    toast(`${cat.name} deleted`, { label: 'Undo', run: () => restore('categories', cat.id) });
    setUi({ catDetail: null });
    close();
  };
  return (
    <div className="sheet-body">
      <div style={{ display: 'grid', placeItems: 'center', margin: '4px 0 18px' }}>
        <motion.div key={icon + color} initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
          <IconBox icon={icon} color={isSub ? parentRec!.color : color} size="lg" round />
        </motion.div>
        {isSub && <div className="small muted" style={{ marginTop: 8 }}>in {parentRec!.name}</div>}
      </div>
      <div className="field"><label>Name</label><input className="input" value={name} onChange={e => onName(e.target.value)} autoFocus={!cat} /></div>
      {!cat && !isSub && (
        <div className="field"><label>Type</label>
          <Segmented value={type} onChange={setType} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />
        </div>
      )}
      {!isSub && (
        <div className="field"><label>Color</label>
          <div className="pick-grid">{COLORS.map(c => <button key={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}</div>
        </div>
      )}
      <div className="field"><label>Icon</label>
        <div className="pick-grid">{ICON_NAMES.map(n => <button key={n} className={n === icon ? 'on' : ''} onClick={() => { setIcon(n); setTouchedIcon(true); }} aria-label={n}><Icon name={n} size={20} /></button>)}</div>
      </div>
      {cat && (
        <div className="list" style={{ marginBottom: 14 }}>
          <div className="list-row"><span className="grow">Hide from grid<div className="tiny muted">History stays in reports</div></span><Toggle on={archived} onChange={setArchived} /></div>
        </div>
      )}
      <button className="btn" onClick={save}>Save</button>
      {cat && <button className="btn danger" style={{ marginTop: 10 }} onClick={del}><Trash2 size={18} />Delete</button>}
    </div>
  );
}
