import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { METRICS, type LevelDef, type Metric, type Rule, type Unit } from '../lib/levels';
import { setPrefs } from '../lib/store';
import { uuid } from '../lib/format';
import { parseNum } from '../sheets/AccountEdit';
import { ease, toast } from './ui';

const UNITS: Record<Unit, string> = { eur: '€', x: '× exp.', pct: '%' };   // × exp. = times a month of expenses
const unitsFor = (m: Metric): Unit[] => (m === 'coverage' ? ['pct'] : m === 'expenses' ? ['eur'] : m === 'investments' ? ['eur', 'x'] : ['x', 'eur']);
const show = (v: number) => String(v).replace('.', ',');

/** Your ladder: names, a line about each, and the rules (all must hold; every level also needs the ones below). */
export function LevelEditor({ defs, done }: { defs: LevelDef[]; done: () => void }) {
  type ERule = Rule & { text: string };   // the value as you type it
  type EDef = Omit<LevelDef, 'rules'> & { rules: ERule[] };
  const [list, setList] = useState<EDef[]>(() => defs.map(d => ({ ...d, rules: d.rules.map(r => ({ ...r, text: show(r.value) })) })));
  const set = (i: number, patch: Partial<EDef>) => setList(l => l.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const setRule = (i: number, j: number, patch: Partial<ERule>) => setList(l => l.map((d, k) => (k === i ? { ...d, rules: d.rules.map((r, q) => (q === j ? { ...r, ...patch } : r)) } : d)));
  const move = (i: number, dir: -1 | 1) => setList(l => { const n = l.slice(); [n[i], n[i + dir]] = [n[i + dir], n[i]]; return n; });

  const save = () => {
    if (list.some(d => !d.name.trim())) return toast('Every level needs a name');
    const out = list.map(d => ({
      ...d, name: d.name.trim(), rule: d.rule.trim(),
      rules: d.rules.map(({ text, ...r }) => ({ ...r, value: parseNum(text) || 0 })),
    }));
    if (out.slice(1).some(d => !d.rules.length)) return toast('Every level above 0 needs at least one rule');
    out[0] = { ...out[0], rules: [] };   // level 0 is where everyone starts
    setPrefs({ levelDefs: out });
    toast('Levels saved');
    done();
  };
  const reset = () => { setPrefs({ levelDefs: [] }); toast('Back to the original levels'); done(); };

  return (
    <div className="sheet-body">
      <p className="tiny muted" style={{ margin: '0 4px 12px' }}>Each level needs all of its rules, and every level below it. Level 0 has none: it's where you start.</p>
      <AnimatePresence initial={false}>
        {list.map((d, i) => (
          <motion.div key={d.id} layout className="card" style={{ padding: '10px 12px', marginBottom: 10 }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }} transition={{ duration: 0.25, ease }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="num bold" style={{ width: 26, height: 26, borderRadius: 13, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)', flex: 'none', fontSize: 13 }}>{i}</span>
              <input className="input grow" style={{ height: 38, minWidth: 0 }} value={d.name} placeholder="Name" onChange={e => set(i, { name: e.target.value })} />
              {i > 1 && <button className="iconbtn" style={{ width: 32, height: 32 }} aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp size={17} /></button>}
              {i > 0 && i < list.length - 1 && <button className="iconbtn" style={{ width: 32, height: 32 }} aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown size={17} /></button>}
              {i > 0 && <button className="iconbtn" style={{ width: 32, height: 32, color: 'var(--expense)' }} aria-label="Delete level" onClick={() => setList(l => l.filter((_, k) => k !== i))}><Trash2 size={17} /></button>}
            </div>
            <input className="input" style={{ height: 36, marginTop: 6, fontSize: 13 }} value={d.rule} placeholder="A line about it" onChange={e => set(i, { rule: e.target.value })} />
            {i > 0 && d.rules.map((r, j) => {
              return (
                <div key={j} style={{ marginTop: 8, padding: 8, borderRadius: 12, background: 'var(--surface-2)' }}>
                  <div className="row" style={{ gap: 6 }}>
                    <select className="input grow" style={{ height: 36, fontSize: 13, minWidth: 0 }} value={r.metric}
                      onChange={e => { const m = e.target.value as Metric; setRule(i, j, { metric: m, unit: unitsFor(m).includes(r.unit) ? r.unit : unitsFor(m)[0] }); }}>
                      {(Object.keys(METRICS) as Metric[]).map(m => <option key={m} value={m}>{METRICS[m]}</option>)}
                    </select>
                    <button className="iconbtn" style={{ width: 30, height: 30 }} aria-label="Remove rule" onClick={() => set(i, { rules: d.rules.filter((_, k) => k !== j) })}><X size={16} /></button>
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <button className="chip" style={{ height: 36, padding: '0 14px', flex: 'none' }} onClick={() => setRule(i, j, { op: r.op === '>=' ? '<=' : '>=' })}>{r.op === '>=' ? '≥' : '≤'}</button>
                    <input className="input num grow" style={{ height: 36, fontSize: 14, minWidth: 0 }} inputMode="decimal" value={r.text} onChange={e => setRule(i, j, { text: e.target.value })} />
                    <select className="input" style={{ height: 36, width: 118, fontSize: 13, flex: 'none' }} value={r.unit} onChange={e => setRule(i, j, { unit: e.target.value as Unit })}>
                      {unitsFor(r.metric).map(u => <option key={u} value={u}>{UNITS[u]}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
            {i > 0 && (
              <button className="tiny bold" style={{ marginTop: 8, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => set(i, { rules: [...d.rules, { metric: 'cash', op: '>=', value: 1, unit: 'x', text: '1' }] })}>
                <Plus size={14} />Rule
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      <button className="btn secondary" onClick={() => setList(l => [...l, { id: uuid(), name: '', rule: '', rules: [{ metric: 'passive', op: '>=', value: 0, unit: 'eur', text: '' }] }])}>
        <Plus size={18} />Add level
      </button>
      <button className="btn" style={{ marginTop: 10 }} onClick={save}>Save</button>
      <button className="tiny muted" style={{ margin: '14px auto 4px', display: 'flex', alignItems: 'center', gap: 5 }} onClick={reset}><RotateCcw size={13} />Back to the original levels</button>
    </div>
  );
}

