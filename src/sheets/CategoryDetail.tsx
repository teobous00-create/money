import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Pencil, Plus } from 'lucide-react';
import { Sheet, IconBox, Money, Bar, ease } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore } from '../lib/store';
import { usePeriodStats, useCategories, sortTxs } from '../lib/calc';
import { label } from '../lib/period';
import { money, round2, shortDate } from '../lib/format';
import { tint } from '../lib/icons';

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
  const me = useStore(s => s.user?.id);
  const period = useStore(s => s.period);
  const cats = useCategories();
  const stats = usePeriodStats();
  const mine = cat?.owner_id === me;

  const data = useMemo(() => {
    if (!cat) return null;
    const subs = cats.filter(c => c.parent_id === id);
    const txs = sortTxs(stats.txs.filter(t => t.category_id === id || subs.some(s => s.id === t.category_id)));
    const total = round2(txs.reduce((s, t) => s + t.amount, 0));
    const typeTotal = cat.type === 'expense' ? stats.expense : stats.income;
    const rows = [{ id, name: 'General', v: stats.bySub.get(id) ?? 0 }, ...subs.map(s => ({ id: s.id, name: s.name, v: stats.bySub.get(s.id) ?? 0 }))]
      .filter(r => r.v > 0 || r.id !== id).sort((a, b) => b.v - a.v);
    return { subs, txs, total, typeTotal, rows };
  }, [cat, cats, id, stats]);

  if (!cat || !data) return null;
  const pct = data.typeTotal ? data.total / data.typeTotal : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ padding: '4px 20px 18px', background: `linear-gradient(180deg, ${tint(cat.color, 0.16)}, transparent)` }}>
        <div className="row">
          <IconBox icon={cat.icon} color={cat.color} size="lg" round />
          <div className="grow">
            <div style={{ fontSize: 22, fontWeight: 650 }} className="ellipsis">{cat.name}</div>
            <div className="small muted">{data.txs.length} transactions · {label(period)}</div>
          </div>
          {mine && <button className="iconbtn" onClick={() => setUi({ category: { id } })} aria-label="Edit"><Pencil size={20} /></button>}
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
          <div style={{ fontSize: 30, fontWeight: 650, color: cat.color }}><Money value={data.total} /></div>
          <div className="small muted num">{Math.round(pct * 100)}% of {money(data.typeTotal)}</div>
        </div>
        <div style={{ marginTop: 8 }}><Bar value={pct} color={cat.color} /></div>
      </div>

      <div className="sheet-body" style={{ paddingTop: 0 }}>
        {data.rows.length > 0 && (
          <div className="list">
            {data.rows.map((r, i) => (
              <motion.button key={r.id} className="list-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.25, ease }}
                onClick={() => mine && (close(), setUi({ addTx: { type: cat.type, categoryId: r.id } }))}>
                <div className="grow">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="ellipsis" style={{ fontWeight: 550 }}>{r.name}</span>
                    <span className="num bold">{money(r.v)}</span>
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 6 }}>
                    <div className="grow"><Bar value={data.total ? r.v / data.total : 0} color={cat.color} delay={i * 0.03} /></div>
                    <span className="tiny bold num" style={{ width: 34, textAlign: 'right', color: cat.color }}>{data.total ? Math.round((r.v / data.total) * 100) : 0}%</span>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        )}
        {mine && (
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={() => { close(); setUi({ addTx: { type: cat.type, categoryId: id } }); }}><Plus size={18} />Add {cat.type}</button>
            <button className="btn secondary" onClick={() => setUi({ category: { parentId: id } })}>Subcategory</button>
          </div>
        )}
        {data.txs.length > 0 && (
          <div className="section">
            <div className="section-head"><span className="section-title">Transactions</span></div>
            <div className="list">
              {data.txs.slice(0, 100).map(t => (
                <button key={t.id} className="list-row" onClick={() => setUi({ addTx: { editId: t.id } })}>
                  <div className="grow">
                    <div className="ellipsis" style={{ fontWeight: 550 }}>{t.category_id && t.category_id !== id ? catRec[t.category_id]?.name : cat.name}</div>
                    <div className="tx-sub">{shortDate(t.date)} · {accs[t.account_id]?.name ?? '—'}</div>
                    {t.note && <div className="tx-note ellipsis">{t.note}</div>}
                  </div>
                  <span className="tx-amt num" style={{ color: cat.type === 'expense' ? 'var(--expense)' : 'var(--income)' }}>{money(t.amount)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
