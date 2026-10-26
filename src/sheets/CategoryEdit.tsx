import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, GripVertical, Plus, UserPlus, Users, X, ChevronRight } from 'lucide-react';
import { Sheet, Segmented, IconBox, Icon, toast } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore, put, shareCategory, unshareCategory, categoryPeople, saveCategoryOrder } from '../lib/store';
import { Sortable } from '../components/Sortable';
import { useCategories } from '../lib/calc';
import { ICON_NAMES, COLORS, guessStyle } from '../lib/icons';
import { REMOTE } from '../lib/supabase';
import { uuid } from '../lib/format';
import type { CatType, Category, Person } from '../lib/types';

export function CategorySheet() {
  const arg = useUi(u => u.category);
  const cat = useStore(s => (arg?.id ? s.categories[arg.id] : undefined));
  const close = () => setUi({ category: null });
  const isSub = !!(cat?.parent_id ?? arg?.parentId);
  return (
    <Sheet open={!!arg} onClose={close} title={cat ? (isSub ? 'Edit subcategory' : 'Edit category') : isSub ? 'New subcategory' : 'New category'} z={1} full>
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
      icon, color: isSub ? parentRec!.color : color, archived: cat?.archived ?? false,
      sort: cat?.sort ?? Math.max(0, ...cats.map(c => c.sort)) + 1,
    });
    toast(cat ? 'Saved' : isSub ? 'Subcategory added' : 'Category added');
    close();
  };
  const toggleHidden = () => {
    if (!cat) return;
    const hide = !cat.archived;
    put('categories', { ...cat, archived: hide });
    toast(hide ? `${cat.name} hidden · its history stays` : `${cat.name} is visible again`, hide ? { label: 'Undo', run: () => put('categories', { ...cat, archived: false }) } : undefined);
    if (hide && !isSub) setUi({ catDetail: null });
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
      {cat && !isSub && <SubList parent={cat} />}
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
      {cat && !isSub && REMOTE && <ShareSection cat={cat} />}
      <button className="btn" onClick={save}>Save</button>
      {cat && (
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={toggleHidden}>
          {cat.archived ? <><Eye size={18} />Show again</> : <><EyeOff size={18} />Hide {isSub ? 'subcategory' : 'category'}</>}
        </button>
      )}
      {cat && !cat.archived && <p className="tiny muted" style={{ textAlign: 'center', marginTop: 8 }}>Hiding removes it from the grid and pickers. No transactions are lost — reports still include them.</p>}
    </div>
  );
}

function ShareSection({ cat }: { cat: Category }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const online = useStore(s => s.online);
  const me = useStore(s => s.user?.id);
  const load = () => categoryPeople(cat.id).then(setPeople).catch(() => setPeople([]));
  useEffect(() => { if (online) void load(); }, [cat.id, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const r = await shareCategory(cat.id, email);
      if (r === 'ok') { toast('Shared · you both see each other\'s entries here'); setEmail(''); void load(); }
      else if (r === 'no_user') toast('No user with that email — they need to create an account in the app first');
      else if (r === 'self') toast('Already part of this category');
      else toast('Could not share');
    } catch { toast('Could not share — check your connection'); }
    setBusy(false);
  };
  const others = (people ?? []).filter(p => p.id !== me);
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="section-head"><span className="section-title row" style={{ gap: 6 }}><Users size={14} />Shared with</span></div>
      <div className="list">
        {others.map(p => (
          <div key={p.id} className="list-row">
            <div className="avatar">{(p.display_name ?? p.email ?? '?').slice(0, 1).toUpperCase()}</div>
            <div className="grow"><div className="bold small">{p.display_name}{p.is_owner && <span className="badge" style={{ marginLeft: 6 }}>created it</span>}</div><div className="tiny muted">{p.email}</div></div>
            {!p.is_owner && (
              <button className="iconbtn" aria-label="Stop sharing" onClick={async () => { await unshareCategory(cat.id, p.id); void load(); toast('Stopped sharing'); }}><X size={18} /></button>
            )}
          </div>
        ))}
        {(people ?? []).some(p => p.is_owner && p.id !== me) && (
          <button className="list-row small" style={{ color: 'var(--expense)' }} onClick={async () => { await unshareCategory(cat.id, me!); toast('You left this shared category'); setUi({ category: null, catDetail: null }); }}>
            Leave this shared category
          </button>
        )}
        <div className="list-row" style={{ gap: 8 }}>
          <input className="input" style={{ boxShadow: 'none', background: 'var(--surface-2)', height: 44 }} type="email" placeholder="Partner's email" value={email} onChange={e => setEmail(e.target.value)} />
          <button className="iconbtn" disabled={busy || !online} onClick={share} aria-label="Share" style={{ color: 'var(--accent)' }}><UserPlus size={22} /></button>
        </div>
      </div>
      <div className="tiny muted" style={{ padding: '6px 6px 0' }}>
        You both add your own part here and see each other's entries and totals (with subcategories). Each person can only edit their own entries. Your other categories and your accounts stay private.
      </div>
    </div>
  );
}

/** Subcategories in their display order: hold and move to reorder, tap to edit. */
function SubList({ parent }: { parent: Category }) {
  const cats = useCategories();
  const subs = cats.filter(c => c.parent_id === parent.id && !c.archived);
  const byId = new Map(subs.map(c => [c.id, c]));
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="section-head"><span className="section-title">Subcategories</span>{subs.length > 1 && <span className="tiny muted">Hold and move to reorder</span>}</div>
      <Sortable ids={subs.map(c => c.id)} style={{ display: 'grid', gap: 8 }} liftScale={1.03}
        onCommit={saveCategoryOrder}
        onTap={id => setUi({ category: { id } })}
        render={id => {
          const c = byId.get(id);
          if (!c) return null;
          return (
            <div className="sub-row">
              <span className="grip"><GripVertical size={18} /></span>
              <span style={{ color: parent.color, display: 'grid' }}><Icon name={c.icon !== 'circle' ? c.icon : parent.icon} size={20} /></span>
              <span className="grow ellipsis" style={{ fontWeight: 550 }}>{c.name}</span>
              <ChevronRight size={18} className="faint" />
            </div>
          );
        }} />
      <button className="btn secondary" style={{ marginTop: 8, height: 46 }} onClick={() => setUi({ category: { parentId: parent.id } })}><Plus size={18} />Add subcategory</button>
    </div>
  );
}
