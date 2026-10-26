import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Coins, PiggyBank, Shapes, Settings2, Check, Briefcase } from 'lucide-react';
import { useStore, setPrefs } from '../lib/store';
import { useTips, useCategoryCompare, useSavings, useWorkStats, prev3, tipsCategoryIds, type CatCompare } from '../lib/insights';
import { catStyle } from '../lib/calc';
import { IconBox, Sheet, ease, softSpring } from '../components/ui';
import { fromISO, money, num } from '../lib/format';

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const shortM = new Intl.DateTimeFormat('en-GB', { month: 'short' });

export function AnalyticsView() {
  const period = useStore(s => s.period);
  const anchor = period.mode === 'all' ? new Date().toISOString().slice(0, 10) : period.anchor;
  const [pa, pb] = prev3(anchor);
  const month = monthFmt.format(fromISO(anchor));
  const range = `${shortM.format(fromISO(pa))}–${shortM.format(fromISO(pb))}`;
  return (
    <div>
      <div className="small muted" style={{ margin: '0 4px 10px' }}>{month} compared with the 3 months before ({range})</div>
      <TipsCard anchor={anchor} month={month} />
      <WorkCard anchor={anchor} month={month} />
      <SavingsCard anchor={anchor} month={month} />
      <CompareCard anchor={anchor} month={month} />
    </div>
  );
}

function CardHead({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 10, marginBottom: 12 }}>
      <span style={{ color: 'var(--accent)', display: 'grid' }}>{icon}</span>
      <span className="grow bold">{title}</span>
      {right}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="grow" style={{ minWidth: 0 }}>
      <div className="tiny muted" style={{ fontWeight: 600 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em', color }}>{value}</div>
      {sub && <div className="tiny muted num">{sub}</div>}
    </div>
  );
}

function TipsCard({ anchor, month }: { anchor: string; month: string }) {
  const tips = useTips(anchor);
  const cats = useStore(s => s.categories);
  const [pick, setPick] = useState(false);
  const source = tips.ids.map(id => {
    const c = cats[id];
    const p = c?.parent_id ? cats[c.parent_id] : null;
    return p ? `${p.name} · ${c!.name}` : c?.name;
  }).filter(Boolean).join(', ');
  const up = tips.current.count > 0 && tips.previous.count > 0 && tips.current.avg >= tips.previous.avg;
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
      <CardHead icon={<Coins size={20} />} title="Tips per shift"
        right={<button className="iconbtn" style={{ width: 36, height: 36 }} aria-label="Tips source" onClick={() => setPick(true)}><Settings2 size={18} /></button>} />
      {tips.ids.length === 0 ? (
        <div className="small muted">No tips category found. Tap ⚙ to choose which income categories are tips.</div>
      ) : (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Stat label="3-month average" value={tips.previous.count ? `${num(tips.previous.avg)} €` : '—'} sub={`${tips.previous.count} shifts`} />
          <Stat label={`${month}`} value={tips.current.count ? `${num(tips.current.avg)} €` : '—'}
            sub={`${tips.current.count} shifts · ${money(tips.current.total)}`}
            color={tips.current.count && tips.previous.count ? (up ? 'var(--income)' : 'var(--expense)') : undefined} />
        </div>
      )}
      {source && <div className="tiny faint" style={{ marginTop: 10 }}>From: {source}</div>}
      <TipsPicker open={pick} onClose={() => setPick(false)} />
    </motion.div>
  );
}

function TipsPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cats = useStore(s => s.categories);
  const me = useStore(s => s.user?.id ?? '');
  const chosen = useStore(s => s.prefs.tipsCats);
  const current = new Set(tipsCategoryIds(cats, me, chosen));
  const income = Object.values(cats).filter(c => c.type === 'income' && c.owner_id === me && !c.deleted_at && !c.archived && !c.parent_id)
    .sort((a, b) => a.sort - b.sort);
  const toggle = (id: string) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPrefs({ tipsCats: [...next] });
  };
  return (
    <Sheet open={open} onClose={onClose} title="Which entries are tips?" z={1}>
      <div className="sheet-body">
        <p className="small muted" style={{ margin: '0 4px 12px' }}>Each entry counts as one shift. Hidden categories never count — when you change job, hide the old ones.</p>
        {income.map(c => {
          const subs = Object.values(cats).filter(s => s.parent_id === c.id && !s.deleted_at && !s.archived).sort((a, b) => a.sort - b.sort);
          return (
            <div key={c.id} className="list" style={{ marginBottom: 10 }}>
              {[c, ...subs].map(x => (
                <button key={x.id} className="list-row" onClick={() => toggle(x.id)}>
                  <span className="grow" style={{ paddingLeft: x.parent_id ? 18 : 0, fontWeight: x.parent_id ? 500 : 650 }}>{x.parent_id ? x.name : c.name}{!x.parent_id && subs.length ? ' (general)' : ''}</span>
                  {current.has(x.id) && <Check size={20} style={{ color: 'var(--accent)' }} />}
                </button>
              ))}
            </div>
          );
        })}
        <button className="btn secondary" onClick={() => setPrefs({ tipsCats: [] })}>Automatic (anything called “Tips”)</button>
      </div>
    </Sheet>
  );
}

function SavingsCard({ anchor, month }: { anchor: string; month: string }) {
  const s = useSavings(anchor);
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: 0.05 }}>
      <CardHead icon={<PiggyBank size={20} />} title="Saved" />
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Stat label="3-month average" value={`${num(s.avgSaved)} €`} sub="per month" color={s.avgSaved < 0 ? 'var(--expense)' : undefined} />
        <Stat label={month} value={`${num(s.saved)} €`} sub={s.income > 0 ? `${Math.round((s.saved / s.income) * 100)}% of ${money(s.income)} income` : 'no income yet'}
          color={s.saved < 0 ? 'var(--expense)' : 'var(--income)'} />
      </div>
    </motion.div>
  );
}

function CompareCard({ anchor, month }: { anchor: string; month: string }) {
  const rows = useCategoryCompare(anchor);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: 0.1 }} style={{ paddingBottom: 6 }}>
      <CardHead icon={<Shapes size={20} />} title="Expenses by category" />
      <div className="row tiny muted" style={{ fontWeight: 600, padding: '0 0 6px 46px' }}>
        <span className="grow" />
        <span style={{ width: 92, textAlign: 'right' }}>{month.slice(0, 3)}</span>
        <span style={{ width: 84, textAlign: 'right' }}>3-mo avg</span>
      </div>
      {rows.length === 0 && <div className="small muted" style={{ paddingBottom: 10 }}>No expenses in these months.</div>}
      {rows.map(r => (
        <div key={r.id}>
          <CompareRow r={r} onClick={() => r.subs.length && setOpen(open === r.id ? null : r.id)} expanded={open === r.id} />
          <AnimatePresence initial={false}>
            {open === r.id && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease }} style={{ overflow: 'hidden' }}>
                {r.subs.map(s => <CompareRow key={s.id} r={s} sub />)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </motion.div>
  );
}

function CompareRow({ r, sub = false, onClick, expanded }: { r: CatCompare; sub?: boolean; onClick?: () => void; expanded?: boolean }) {
  const cats = useStore(s => s.categories);
  const isGeneral = r.id.startsWith('general:');
  const c = cats[isGeneral ? r.id.slice(8) : r.id];
  const st = catStyle(c?.id ?? null, cats);
  const higher = r.now > r.avg + 0.004;
  return (
    <button className="row" onClick={onClick} style={{ width: '100%', padding: sub ? '7px 0 7px 50px' : '8px 0', textAlign: 'left' }}>
      {!sub && <IconBox icon={st.icon} color={st.color} round size="sm" />}
      <span className={`grow ellipsis ${sub ? 'small muted' : ''}`} style={{ fontWeight: sub ? 500 : 550 }}>
        {isGeneral ? 'General' : c?.name ?? '—'}
        {!sub && (r.subs.length > 0) && (
          <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={softSpring} style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 4 }} className="faint"><ChevronDown size={15} /></motion.span>
        )}
      </span>
      <span className={`num ${sub ? 'small' : ''}`} style={{ width: 92, textAlign: 'right', fontWeight: 650, whiteSpace: 'nowrap', color: higher ? 'var(--expense)' : undefined }}>{money(r.now)}</span>
      <span className={`num muted ${sub ? 'small' : ''}`} style={{ width: 84, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(r.avg)}</span>
    </button>
  );
}

function WorkCard({ anchor, month }: { anchor: string; month: string }) {
  const rows = useWorkStats(anchor).filter(r => r.now.shifts > 0 || r.avg);
  if (!rows.length) return null;
  const m3 = month.slice(0, 3);
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: 0.03 }}>
      <CardHead icon={<Briefcase size={20} />} title="Work" />
      {rows.map((r, i) => {
        const lines: Array<[string, string, string]> = r.job.kind === 'hourly'
          ? [
            ['Hours', r.avg ? `${num(r.avg.hours)}h` : '—', `${num(r.now.hours)}h`],
            ['Pay', r.avg ? money(r.avg.earned) : '—', money(r.now.earned)],
            ['Per hour with tips', r.perHourAvg != null ? money(r.perHourAvg) : '—', r.perHourNow != null ? money(r.perHourNow) : '—'],
          ]
          : [
            ['Days', r.avg ? num(r.avg.shifts) : '—', num(r.now.shifts)],
            ['Bonus', r.avg ? money(r.avg.bonus) : '—', money(r.now.bonus)],
            ['Pay', r.avg ? money(r.avg.earned) : '—', money(r.now.earned)],
          ];
        return (
          <div key={r.job.id} style={{ marginTop: i ? 14 : 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <span className="dot" style={{ background: r.job.color }} /><span className="grow bold small">{r.job.name}</span>
              <span className="tiny muted" style={{ width: 84, textAlign: 'right', fontWeight: 600 }}>3-mo avg</span>
              <span className="tiny muted" style={{ width: 84, textAlign: 'right', fontWeight: 600 }}>{m3}</span>
            </div>
            {lines.map(([l, a, n]) => (
              <div key={l} className="row small" style={{ padding: '3px 0' }}>
                <span className="grow muted">{l}</span>
                <span className="num" style={{ width: 84, textAlign: 'right' }}>{a}</span>
                <span className="num bold" style={{ width: 84, textAlign: 'right' }}>{n}</span>
              </div>
            ))}
          </div>
        );
      })}
      <div className="tiny faint" style={{ marginTop: 10 }}>The average uses only months where you logged shifts.</div>
    </motion.div>
  );
}
