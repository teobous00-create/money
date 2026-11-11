import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Plus, Rocket, Settings2, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { fromISO, money, shortDate, todayISO, uuid } from '../lib/format';
import { defaultPlan, getPlan, isTradingDay, nextMonday, nextTradingDay, PLAN_V, planView, savePlan, usePlanView, type AccView } from '../lib/botPlan';
import { useStrategies } from '../lib/tracker';
import { parseNum } from '../sheets/AccountEdit';
import { ease, Segmented, Sheet, toast } from './ui';
import { getState } from '../lib/store';
import type { BotAcc, BotMilestone, BotPlan } from '../lib/types';

const days = (a: string, b: string) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 864e5);
const until = (date: string, today: string) => { const n = days(today, date); return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`; };
const label = (m: BotMilestone) => (m.kind === 'once' ? `Withdraw ${money(m.amount)}` : `${money(m.amount)} a day`);
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const when = (iso: string) => `${weekday.format(fromISO(iso))} ${shortDate(iso)}`;
const pace = (p: BotPlan) => (p.a1.boost ? `${p.a1.boost.pct}% a trading day to ${money(p.a1.boost.until)}, then ${p.pct}%` : `${p.pct}% a trading day`);

/** Tracker → Trading: the bot's plan — check in when you buy it, then the milestones count down. */
export function BotPlanCard() {
  const v = usePlanView();
  const [setup, setSetup] = useState(false);
  const [settings, setSettings] = useState(false);
  const today = todayISO();
  const { plan } = v;
  const acc1 = v.accs.find(a => a.acc === 1);
  // once: the plan chosen on 11 Nov 2026 (plan B) — bought that day, starts Thu 12 Nov with 610 €; linked strategies stay
  useEffect(() => {
    if ((plan.v ?? 1) >= PLAN_V) return;
    const b = defaultPlan();
    savePlan({ ...b, bought: '2026-11-11', logged: {},
      a1: { ...b.a1, capital: 610, start: '2026-11-12', strategy: plan.a1.strategy }, a2: { ...b.a2, strategy: plan.a2.strategy } });
  }, [plan.v]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan.bought) {
    return (
      <>
        <motion.div className="card lumen-card" style={{ padding: 14, marginBottom: 12 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
          <div className="row" style={{ gap: 10 }}>
            <Rocket size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
            <div className="grow">
              <div className="small" style={{ fontWeight: 650 }}>Waiting for the bot</div>
              <div className="tiny muted">At {pace(plan)} from {when(plan.a1.start)}:</div>
            </div>
          </div>
          <Timeline v={v} today={today} compact />
          <button className="btn" style={{ marginTop: 12 }} onClick={() => setSetup(true)}>I bought it</button>
        </motion.div>
        <Sheet open={setup} onClose={() => setSetup(false)} title="You bought it">{setup && <Setup close={() => setSetup(false)} />}</Sheet>
      </>
    );
  }

  const next = v.next;
  const nextAcc = next ? v.accs.find(a => a.acc === next.acc) : null;
  const now = nextAcc ? (nextAcc.actual ?? nextAcc.curvePlan.slice().reverse().find(c => c.date <= today)?.bal ?? nextAcc.capital) : 0;
  const progress = next ? Math.max(0, Math.min(1, now / next.at)) : 1;
  return (
    <>
      <motion.div className="card" style={{ padding: 14, marginBottom: 12 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
        <div className="row" style={{ gap: 10, marginBottom: 10 }}>
          <Rocket size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold">Bot plan</div>
            <div className="tiny muted">{pace(plan)}</div>
          </div>
          <button className="iconbtn" style={{ width: 32, height: 32 }} aria-label="Plan settings" onClick={() => setSettings(true)}><Settings2 size={17} /></button>
        </div>

        {next && next.date ? (
          <div style={{ marginBottom: 10 }}>
            <div className="tiny muted" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Next</div>
            <div className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 22, fontWeight: 750 }}>{label(next)}</span>
              <span className="small muted">{until(next.date, today)}</span>
            </div>
            <div className="small muted">{when(next.date)} · account {next.acc} at {money(next.at)}</div>
            <div className="bar" style={{ height: 9, marginTop: 10 }}>
              <motion.div style={{ background: 'var(--accent)' }} initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.8, ease }} />
            </div>
            <div className="row tiny num" style={{ justifyContent: 'space-between', marginTop: 6, fontWeight: 600 }}>
              <span>{money(now)}{nextAcc?.actual == null ? ' · plan' : ''}</span><span style={{ color: 'var(--income)' }}>{money(next.at)}</span>
            </div>
          </div>
        ) : <div className="small muted" style={{ marginBottom: 10 }}>Every milestone is behind you.</div>}

        <TodayLot v={v} today={today} />
        {acc1?.actual != null && <Pace a={acc1} />}
        {acc1 && <PlanCurve a={acc1} today={today} />}
        <Timeline v={v} today={today} />
      </motion.div>
      <Sheet open={settings} onClose={() => setSettings(false)} title="Bot plan">{settings && <Settings close={() => setSettings(false)} />}</Sheet>
    </>
  );
}

/** Today's lot per running account, from its balance and the day's target %. Weekends: the next trading day's. */
function TodayLot({ v, today }: { v: ReturnType<typeof planView>; today: string }) {
  let day = nextOpen(today);
  let accs = v.accs.filter(a => a.today && a.start <= day);
  if (!accs.length) { day = nextTradingDay(day); accs = v.accs.filter(a => a.today && a.start <= day); }   // e.g. the night before the start
  if (!accs.length) return null;
  const lot = (n: number) => n.toFixed(2);
  return (
    <div className="card" style={{ padding: '10px 12px', marginBottom: 10, background: 'var(--surface-2)', boxShadow: 'none' }}>
      <div className="tiny muted" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{day === today ? 'Today' : when(day)}</div>
      {accs.map(a => (
        <div key={a.acc} className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 4 }}>
          <span className="num" style={{ fontSize: 20, fontWeight: 750 }}>{lot(a.today!.lot)} lot</span>
          <span className="small" style={{ fontWeight: 650, color: 'var(--accent)' }}>{a.today!.pct}% target</span>
          <span className="grow" />
          <span className="tiny muted num" style={{ textAlign: 'right' }}>{v.accs.length > 1 ? `acc ${a.acc} · ` : ''}{money(a.today!.bal)}{a.today!.real ? '' : ' · plan'}</span>
        </div>
      ))}
    </div>
  );
}
const nextOpen = (iso: string) => (isTradingDay(iso) ? iso : nextTradingDay(iso));

function Pace({ a }: { a: AccView }) {
  const d = a.daysAhead ?? 0;
  const color = d > 0 ? 'var(--income)' : d < 0 ? 'var(--expense)' : 'var(--ink-2)';
  return (
    <div className="row small" style={{ justifyContent: 'space-between', padding: '6px 0 10px', gap: 8 }}>
      <span className="muted">Account 1 now <b className="num" style={{ color: 'var(--ink)' }}>{money(a.actual!)}</b></span>
      <span className="num" style={{ fontWeight: 650, color, flex: 'none' }}>{d === 0 ? 'on plan' : d > 0 ? `${d} day${d > 1 ? 's' : ''} ahead` : `${-d} day${d < -1 ? 's' : ''} behind`}</span>
    </div>
  );
}

/** Account 1: the plan's curve (to a bit past its last milestone) with the real balance on top. */
function PlanCurve({ a, today }: { a: AccView; today: string }) {
  const W = 320, H = 110;
  const pts = a.curvePlan.slice(0, Math.min(a.curvePlan.length, 70));
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map(p => p.bal), ...a.curveReal.map(p => p.bal), a.capital);
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - 4 - (v / max) * (H - 10);
  const idx = new Map(pts.map((p, i) => [p.date, i]));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.bal).toFixed(1)}`).join(' ');
  const real = a.curveReal.filter(p => idx.has(p.date));
  const dr = real.map((p, i) => `${i ? 'L' : 'M'}${x(idx.get(p.date)!).toFixed(1)},${y(p.bal).toFixed(1)}`).join(' ');
  const ti = pts.findIndex(p => p.date >= today);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block', margin: '2px 0 8px' }} aria-label="Plan curve">
      {ti > 0 && <line x1={x(ti)} x2={x(ti)} y1={0} y2={H} stroke="var(--line)" strokeDasharray="3 4" />}
      <motion.path d={d} fill="none" stroke="var(--accent)" strokeOpacity={0.45} strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease }} />
      {real.length > 1 && <motion.path d={dr} fill="none" stroke="var(--income)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease, delay: 0.3 }} />}
    </svg>
  );
}

function Timeline({ v, today, compact }: { v: ReturnType<typeof planView>; today: string; compact?: boolean }) {
  const byId = new Map(v.hits.map(h => [h.id, h]));
  const acc2 = v.accs.find(a => a.acc === 2);
  type Item = { key: string; date: string | null; m?: BotMilestone };
  const items: Item[] = v.plan.milestones.map(m => ({ key: m.id, date: byId.get(m.id)?.logged ?? byId.get(m.id)?.date ?? null, m }));
  if (acc2 && v.plan.milestones.some(m => m.acc === 2)) items.push({ key: 'a2', date: acc2.start });
  items.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  const dot = <span style={{ width: 7, height: 7, borderRadius: 4, background: 'currentColor', opacity: 0.55 }} />;
  return (
    <div style={{ marginTop: compact ? 10 : 4 }}>
      {items.map((it, i) => {
        const m = it.m;
        const body = !m
          ? <Row icon={<Plus size={13} />} title={`Start account 2 with ${money(acc2!.capital)}`} date={it.date} today={today} done={acc2!.started} />
          : (() => {
            const h = byId.get(m.id);
            const acc = v.accs.find(a => a.acc === m.acc);
            const reached = acc?.actual != null && acc.actual >= m.at;
            const stop = m.kind === 'daily' && m.until ? v.plan.milestones.find(x => x.id === m.until) : null;
            return <Row icon={h?.logged ? <Check size={14} /> : dot} title={label(m)} sub={`account ${m.acc} at ${money(m.at)}${stop ? ` · until account ${stop.acc} at ${money(stop.at)}` : ''}`} date={it.date} today={today} done={!!h?.logged}
              action={!compact && m.kind === 'once' && !h?.logged && reached ? { label: 'Done', run: () => markDone(m) } : undefined} />;
          })();
        return <motion.div key={it.key} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease, delay: i * 0.05 }}>{body}</motion.div>;
      })}
    </div>
  );
}

function Row({ icon, title, sub, date, today, done, action }: { icon: React.ReactNode; title: string; sub?: string; date: string | null; today: string; done?: boolean; action?: { label: string; run: () => void } }) {
  return (
    <div className="row" style={{ gap: 10, padding: '7px 0' }}>
      <span style={{ width: 24, height: 24, borderRadius: 12, display: 'grid', placeItems: 'center', flex: 'none', background: done ? 'var(--income)' : 'var(--surface-2)', color: done ? '#fff' : 'var(--ink-2)' }}>{icon}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small ellipsis" style={{ fontWeight: 600 }}>{title}</div>
        {sub && <div className="tiny muted">{sub}</div>}
      </div>
      {action ? <button className="chip on" style={{ height: 30 }} onClick={action.run}>{action.label}</button> : (
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div className="small num" style={{ fontWeight: 650 }}>{date ? when(date) : '—'}</div>
          {date && !done && <div className="tiny muted">{until(date, today)}</div>}
        </div>
      )}
    </div>
  );
}

function markDone(m: BotMilestone) {
  const p = getPlan(getState());
  const today = todayISO();
  savePlan({ logged: { ...(p.logged ?? {}), [m.id]: today } });
  toast(`${label(m)} — done`, { label: 'Undo', run: () => { const q = getPlan(getState()); const l = { ...(q.logged ?? {}) }; delete l[m.id]; savePlan({ logged: l }); } });
}

// ---------------------------------------------------------------- check-in and settings

function Setup({ close }: { close: () => void }) {
  const p = getPlan(getState());
  const strategies = useStrategies();
  const [start, setStart] = useState(p.a1.start < todayISO() ? nextMonday() : p.a1.start);
  const [capital, setCapital] = useState(String(p.a1.capital));
  const [pct, setPct] = useState(String(p.pct));
  const [strategy, setStrategy] = useState(p.a1.strategy ?? '');
  const save = () => {
    savePlan({ bought: todayISO(), pct: Math.max(0.1, parseNum(pct)), a1: { ...p.a1, capital: Math.max(1, parseNum(capital)), start, strategy: strategy || null } });
    close();
    toast('Here we go');
  };
  return (
    <div className="sheet-body">
      <div className="field"><label>Starts on</label><input className="input" type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>Capital (€)</label><input className="input num" inputMode="decimal" value={capital} onChange={e => setCapital(e.target.value)} /></div>
        <div className="field grow"><label>% a trading day</label><input className="input num" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} /></div>
      </div>
      <StrategySelect value={strategy} onChange={setStrategy} strategies={strategies} />
      <button className="btn" style={{ marginTop: 8 }} onClick={save}>Start the plan</button>
    </div>
  );
}

function StrategySelect({ value, onChange, strategies, label: l = 'Its strategy (MT5 sync), for the real balance' }: { value: string; onChange: (v: string) => void; strategies: ReturnType<typeof useStrategies>; label?: string }) {
  return (
    <div className="field"><label>{l}</label>
      <select className="input" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Not linked yet</option>
        {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></div>
  );
}

type MsEdit = Omit<BotMilestone, 'at' | 'amount'> & { at: string; amount: string };

function Settings({ close }: { close: () => void }) {
  const p: BotPlan = useStore(s => getPlan(s));
  const strategies = useStrategies();
  const [pct, setPct] = useState(String(p.pct));
  const [per, setPer] = useState(String(p.lotPer ?? 300));
  const [c1, setC1] = useState(String(p.a1.capital));
  const [s1, setS1] = useState(p.a1.start);
  const [st1, setSt1] = useState(p.a1.strategy ?? '');
  const [c2, setC2] = useState(String(p.a2.capital));
  const [s2, setS2] = useState(p.a2.start ?? '');
  const [st2, setSt2] = useState(p.a2.strategy ?? '');
  const [b1, setB1] = useState(boostEdit(p.a1));
  const [b2, setB2] = useState(boostEdit(p.a2));
  const [after, setAfter] = useState(p.a2.afterDaily != null ? String(p.a2.afterDaily) : '');
  const [ms, setMs] = useState<MsEdit[]>(p.milestones.map(m => ({ ...m, at: String(m.at), amount: String(m.amount) })));
  const set = (id: string, patch: Partial<MsEdit>) => setMs(l => l.map(m => (m.id === id ? { ...m, ...patch } : m)));
  const save = () => {
    savePlan({
      pct: Math.max(0.1, parseNum(pct)), lotPer: parseNum(per) > 0 ? parseNum(per) : 300,
      a1: { capital: Math.max(1, parseNum(c1)), start: s1, strategy: st1 || null, boost: boostSave(b1) },
      a2: { capital: Math.max(0, parseNum(c2)), start: s2 || null, strategy: st2 || null, boost: boostSave(b2), afterDaily: after.trim() === '' ? null : Math.max(0, Math.round(parseNum(after))) },
      milestones: ms.filter(m => parseNum(m.at) > 0).map(m => ({ ...m, at: parseNum(m.at), amount: Math.max(0, parseNum(m.amount)), until: m.kind === 'daily' ? m.until ?? null : null })),
    });
    close();
  };
  return (
    <div className="sheet-body">
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>% a trading day</label><input className="input num" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} /></div>
        <div className="field grow"><label>0.01 lot per (€) at that %</label><input className="input num" inputMode="decimal" value={per} onChange={e => setPer(e.target.value)} /></div>
      </div>

      <div className="section-head"><span className="section-title">Account 1</span></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>Capital (€)</label><input className="input num" inputMode="decimal" value={c1} onChange={e => setC1(e.target.value)} /></div>
        <div className="field grow"><label>Starts</label><input className="input" type="date" value={s1} onChange={e => setS1(e.target.value)} /></div>
      </div>
      <BoostFields value={b1} onChange={setB1} />
      <StrategySelect value={st1} onChange={setSt1} strategies={strategies} />

      <div className="section-head"><span className="section-title">Account 2</span></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>Capital (€)</label><input className="input num" inputMode="decimal" value={c2} onChange={e => setC2(e.target.value)} /></div>
        <div className="field grow"><label>Starts</label><input className="input" type="date" value={s2} onChange={e => setS2(e.target.value)} /></div>
      </div>
      <div className="tiny faint" style={{ padding: '0 4px 10px', marginTop: -6 }}>{s2 ? <button className="tiny" style={{ color: 'var(--accent)' }} onClick={() => setS2('')}>Back to: worked out from account 1</button> : after.trim() !== '' ? `Empty: after account 1’s daily withdrawal no. ${after} (they pay for it).` : 'Empty: the trading day after account 1’s first withdrawal.'}</div>
      {!s2 && <div className="field"><label>Start after account 1’s Nth daily withdrawal (empty = after its first withdrawal)</label><input className="input num" inputMode="numeric" value={after} onChange={e => setAfter(e.target.value)} /></div>}
      <BoostFields value={b2} onChange={setB2} />
      <StrategySelect value={st2} onChange={setSt2} strategies={strategies} />

      <div className="section-head"><span className="section-title">Milestones</span></div>
      <div className="list">
        <AnimatePresence initial={false}>
          {ms.map(m => (
            <motion.div key={m.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease }}>
              <div className="row" style={{ gap: 8 }}>
                <Segmented value={String(m.acc)} onChange={v => set(m.id, { acc: Number(v) as 1 | 2 })} style={{ width: 120, flex: 'none' }} options={[{ value: '1', label: 'Acc 1' }, { value: '2', label: 'Acc 2' }]} />
                <Segmented value={m.kind} onChange={kind => set(m.id, { kind })} style={{ flex: 1 }} options={[{ value: 'once', label: 'Once' }, { value: 'daily', label: 'Daily' }]} />
                <button className="iconbtn" style={{ width: 36, height: 36, flex: 'none' }} aria-label="Remove milestone" onClick={() => setMs(l => l.filter(x => x.id !== m.id))}><Trash2 size={16} /></button>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div className="field grow" style={{ margin: 0 }}><label>When it reaches (€)</label><input className="input num" inputMode="decimal" value={m.at} onChange={e => set(m.id, { at: e.target.value })} style={{ height: 44 }} /></div>
                <div className="field grow" style={{ margin: 0 }}><label>{m.kind === 'once' ? 'Withdraw (€)' : 'Withdraw a day (€)'}</label><input className="input num" inputMode="decimal" value={m.amount} onChange={e => set(m.id, { amount: e.target.value })} style={{ height: 44 }} /></div>
              </div>
              {m.kind === 'daily' && ms.some(x => x.acc !== m.acc) && (
                <div className="field" style={{ margin: 0 }}><label>Stops when</label>
                  <select className="input" value={m.until ?? ''} onChange={e => set(m.id, { until: e.target.value || null })} style={{ height: 44 }}>
                    <option value="">Never</option>
                    {ms.filter(x => x.acc !== m.acc).map(x => <option key={x.id} value={x.id}>account {x.acc} reaches {money(parseNum(x.at))}</option>)}
                  </select></div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => setMs(l => [...l, { id: uuid().slice(0, 8), acc: 1, kind: 'once', at: '', amount: '' }])}><Plus size={18} />Add milestone</button>

      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={save}>Save</button>
        <button className="btn secondary" onClick={() => { savePlan({ bought: null, logged: {} }); close(); }}>Back to waiting for the bot</button>
      </div>
    </div>
  );
}

type BoostEdit = { pct: string; until: string };
const boostEdit = (a: BotAcc): BoostEdit => ({ pct: a.boost ? String(a.boost.pct) : '', until: a.boost ? String(a.boost.until) : '' });
const boostSave = (b: BoostEdit) => (parseNum(b.pct) > 0 && parseNum(b.until) > 0 ? { pct: parseNum(b.pct), until: parseNum(b.until) } : null);

/** A higher % a day until the account first reaches an amount (empty = the plan's % all along). */
function BoostFields({ value, onChange }: { value: BoostEdit; onChange: (v: BoostEdit) => void }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className="field grow"><label>Higher % a day</label><input className="input num" inputMode="decimal" placeholder="—" value={value.pct} onChange={e => onChange({ ...value, pct: e.target.value })} /></div>
      <div className="field grow"><label>Until it reaches (€)</label><input className="input num" inputMode="decimal" placeholder="—" value={value.until} onChange={e => onChange({ ...value, until: e.target.value })} /></div>
    </div>
  );
}
