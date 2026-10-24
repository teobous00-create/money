import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Pencil, Plus, Users } from 'lucide-react';
import { Sheet, DragZone, IconBox, Money, Bar, Segmented, ease } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore, getState } from '../lib/store';
import { useTxs, useSelection, useCategories, useSharedRoots, partnersOf, sortTxs } from '../lib/calc';
import { label, range } from '../lib/period';
import { money, round2, shortDate, todayISO } from '../lib/format';
import { tint } from '../lib/icons';

type Scope = 'mine' | 'theirs' | 'both';

export function CategoryDetailSheet() {
  const arg = useUi(u => u.catDetail);
  const close = () => setUi({ catDetail: null });
  return (
    <Sheet open={!!arg} onClose={close} full>
      {arg && <Detail id={arg.id} close={close} />}
    </Sheet>
  );
}

function Detail({ id, close }: { id: string; close: () => void }) {
  const cat = useStore(s => s.categories[id]);
  const catRec = useStore(s => s.categories);
  const accs = useStore(s => s.accounts);
  const profiles = useStore(s => s.profiles);
  const members = useStore(s => s.members);
  const me = useStore(s => s.user?.id);
  const period = useStore(s => s.period);
  const cats = useCategories();
  const txs = useTxs();
  const sel = useSelection();
  const sharedRoots = useSharedRoots();
  const [scope, setScope] = useState<Scope>('mine');

  const shared = sharedRoots.has(id);
  const partners = useMemo(() => partnersOf(id, getState()), [id, members, catRec]); // eslint-disable-line react-hooks/exhaustive-deps
  const partnerName = partners.length === 1 ? profiles[partners[0]]?.display_name ?? 'Partner' : 'Others';
  const myName = (me && profiles[me]?.display_name) || 'Me';
  const nameOf = (uid: string) => (uid === me ? myName : profiles[uid]?.display_name ?? 'Partner');

  const data = useMemo(() => {
    if (!cat) return null;
    const [a, b] = range(period);
    const subs = cats.filter(c => c.parent_id === id);
    const subIds = new Set(subs.map(s => s.id));
    const inCat = txs.filter(t => (t.category_id === id || (t.category_id && subIds.has(t.category_id))) && t.date >= a && t.date <= b && t.type === cat.type);
    const isMine = (t: (typeof txs)[number]) => t.owner_id === me && sel.has(t.account_id);
    const scoped = sortTxs(inCat.filter(t => scope === 'both' ? (isMine(t) || t.owner_id !== me) : scope === 'mine' ? isMine(t) : t.owner_id !== me));
    const today = todayISO();
    const counted = scoped.filter(t => t.date <= today); // planned entries are listed but not counted yet
    const total = round2(counted.reduce((s, t) => s + t.amount, 0));
    const perPerson = new Map<string, number>();
    for (const t of counted) perPerson.set(t.owner_id, round2((perPerson.get(t.owner_id) ?? 0) + t.amount));
    const sum = (catId: string) => {
      const m = new Map<string, number>();
      for (const t of counted) if (t.category_id === catId) m.set(t.owner_id, round2((m.get(t.owner_id) ?? 0) + t.amount));
      return m;
    };
    // hidden subcategories still show while they carry amounts, so the rows always add up to the total
    const rows = [{ id, name: 'General', isSub: false, hidden: false }, ...subs.map(s => ({ id: s.id, name: s.name, isSub: true, hidden: s.archived }))]
      .map(r => { const m = sum(r.id); return { ...r, v: round2([...m.values()].reduce((x, y) => x + y, 0)), people: m }; })
      .filter(r => r.v > 0 || (r.isSub && !r.hidden))
      .sort((x, y) => y.v - x.v);
    return { scoped, total, perPerson, rows };
  }, [cat, cats, id, txs, period, scope, me, sel]);

  if (!cat || !data) return null;
  const max = Math.max(...data.rows.map(r => r.v), 0.01);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <DragZone style={{ padding: '2px 20px 16px', background: `linear-gradient(180deg, ${tint(cat.color, 0.18)}, transparent)` }}>
        <div className="row">
          <IconBox icon={cat.icon} color={cat.color} size="lg" round />
          <div className="grow">
            <div style={{ fontSize: 22, fontWeight: 650 }} className="ellipsis">{cat.name}</div>
            <div className="small muted">{data.scoped.length} transactions · {label(period)}</div>
          </div>
          <button className="iconbtn" onClick={() => setUi({ category: { id } })} aria-label="Edit"><Pencil size={20} /></button>
        </div>
        {shared && (
          <div style={{ marginTop: 14 }} onPointerDown={e => e.stopPropagation()}>
            <Segmented value={scope} onChange={setScope}
              options={[{ value: 'mine', label: 'Mine' }, { value: 'theirs', label: partnerName }, { value: 'both', label: 'Both' }]} />
          </div>
        )}
        <div className="row" style={{ marginTop: 14, justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 30, fontWeight: 650, color: cat.color }}><Money value={data.total} /></div>
          {shared && scope === 'both' && (
            <div className="small muted num" style={{ textAlign: 'right' }}>
              {[...data.perPerson.entries()].map(([uid, v]) => <div key={uid}>{nameOf(uid)} {money(v)}</div>)}
            </div>
          )}
        </div>
        {shared && <div className="tiny muted row" style={{ gap: 5, marginTop: 6 }}><Users size={12} />Shared with {partners.map(p => profiles[p]?.display_name ?? 'partner').join(', ') || 'your partner'}</div>}
      </DragZone>

      <div className="sheet-body" style={{ paddingTop: 0 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={scope} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {data.rows.length > 0 && (
              <div className="list">
                {data.rows.map((r, i) => (
                  <div key={r.id} className="list-row" style={{ paddingRight: 6 }}>
                    <button className="grow" style={{ textAlign: 'left' }} onClick={() => { close(); setUi({ addTx: { type: cat.type, categoryId: r.id } }); }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <span className="ellipsis" style={{ fontWeight: 550, opacity: r.hidden ? 0.55 : 1 }}>{r.name}{r.hidden && <span className="badge" style={{ marginLeft: 6 }}>hidden</span>}</span>
                        <span className="num bold">{money(r.v)}</span>
                      </div>
                      <div className="row" style={{ gap: 8, marginTop: 6 }}>
                        <div className="grow"><Bar value={r.v / max} color={cat.color} delay={i * 0.03} /></div>
                        <span className="tiny bold num" style={{ width: 34, textAlign: 'right', color: cat.color }}>{data.total ? Math.round((r.v / data.total) * 100) : 0}%</span>
                      </div>
                      {scope === 'both' && r.people.size > 0 && (
                        <div className="tiny muted" style={{ marginTop: 4 }}>{[...r.people.entries()].map(([uid, v]) => `${nameOf(uid)} ${money(v)}`).join(' · ')}</div>
                      )}
                    </button>
                    {r.isSub
                      ? <button className="iconbtn" style={{ width: 38 }} aria-label={`Edit ${r.name}`} onClick={() => setUi({ category: { id: r.id } })}><Pencil size={17} /></button>
                      : <span style={{ width: 38 }} />}
                  </div>
                ))}
              </div>
            )}
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { close(); setUi({ addTx: { type: cat.type, categoryId: id } }); }}><Plus size={18} />Add {cat.type}</button>
              <button className="btn secondary" onClick={() => setUi({ category: { parentId: id } })}><Plus size={18} />Subcategory</button>
            </div>
            {data.scoped.length > 0 && (
              <div className="section">
                <div className="section-head"><span className="section-title">Transactions</span></div>
                <div className="list">
                  {data.scoped.slice(0, 150).map((t, i) => {
                    const mine = t.owner_id === me;
                    return (
                      <motion.button key={t.id} className="list-row" onClick={() => setUi({ addTx: { editId: t.id } })}
                        initial={i < 12 ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02, duration: 0.25, ease }}>
                        <div className="grow">
                          <div className="ellipsis" style={{ fontWeight: 550 }}>{t.category_id && t.category_id !== id ? catRec[t.category_id]?.name : cat.name}</div>
                          <div className="tx-sub">{shortDate(t.date)} · {mine ? accs[t.account_id]?.name ?? '—' : nameOf(t.owner_id)}
                            {shared && mine && <span className="badge" style={{ marginLeft: 4 }}>{myName}</span>}
                          </div>
                          {t.note && <div className="tx-note ellipsis">{t.note}</div>}
                        </div>
                        {t.date > todayISO() && <span className="badge">Planned</span>}
                        <span className="tx-amt num" style={{ opacity: t.date > todayISO() ? 0.5 : 1, color: cat.type === 'expense' ? 'var(--expense)' : 'var(--income)' }}>{money(t.amount)}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
