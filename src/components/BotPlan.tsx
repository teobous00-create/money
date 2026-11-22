import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Clock, Plus, Rocket, Settings2, Trash2 } from 'lucide-react';
import { useStore, getState, setPrefs } from '../lib/store';
import { fromISO, money, shortDate, todayISO, uuid } from '../lib/format';
import { DEFAULT_SPEND, DEFAULT_WEEKLY, getPlan, logOut, nextMonday, PLAN_V, planAccount, receiveOut, removeOut, savePlan, stepFor, unreceiveOut, useWeekView, type WeekView, type WOut } from '../lib/botPlan';
import { alive, computeBalances, useAccounts } from '../lib/calc';
import { useStrategies } from '../lib/tracker';
import { parseNum } from '../sheets/AccountEdit';
import { ease, Sheet, toast } from './ui';
import type { BotPlan } from '../lib/types';

const days = (a: string, b: string) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 864e5);
const until = (date: string, today: string) => { const n = days(today, date); return n < 0 ? `${-n} day${n < -1 ? 's' : ''} ago` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`; };
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const when = (iso: string) => `${weekday.format(fromISO(iso))} ${shortDate(iso)}`;
const caption = (p: BotPlan) => `${p.pct}% a trading day · weekly withdrawals to ${money((p.weekly ?? DEFAULT_WEEKLY).goal)}`;
const upper = { fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' } as const;

/** Tracker → Trading: account 1's road to the goal — this week's withdrawal, today's lot, the curve, the Fridays ahead
 *  and what the withdrawals pay for. */
export function BotPlanCard() {
  const v = useWeekView();
  const [setup, setSetup] = useState(false);
  const [settings, setSettings] = useState(false);
  const [logging, setLogging] = useState<WOut | null>(null);
  const [receiving, setReceiving] = useState<WOut | null>(null);
  const today = todayISO();
  const { plan } = v;

  // once: the plan of 22 Nov 2026 — 10% a day to 10.000 € with Friday withdrawals down to round steps; no account 2,
  // nothing after the goal; 0.01 lot per 300 €. Capital, start and strategy stay.
  // then (23 Nov): the 74,51 € withdrawn on 21 Nov, still on its way to the bank, and the bot's trading account (Eightcup)
  // linked to its strategy so its balance moves with the daily P&L (evened out to the plan's balance at linking).
  useEffect(() => {
    const v0 = plan.v ?? 1;
    if (v0 >= PLAN_V) return;
    let p: BotPlan = plan;
    if (v0 < 3) p = { ...p, v: 3, bought: p.bought ?? '2026-11-11', pct: 10, lotPer: 300, a1: { ...p.a1, boost: null },
      a2: { capital: 0, start: null, strategy: null, boost: null }, milestones: [], logged: {}, weekly: DEFAULT_WEEKLY, spend: DEFAULT_SPEND, outs: [] };
    const outs = (p.outs ?? []).some(o => o.date === '2026-11-21') ? p.outs ?? [] : [...(p.outs ?? []), { id: 'o-1121', date: '2026-11-21', amount: 74.51, step: 0, received: null }];
    savePlan({ ...p, v: PLAN_V, outs });
    const st = getState();
    const strat = p.a1.strategy;
    if (strat && !Object.values(st.prefs.accountLinks ?? {}).some(l => l.strategy === strat)) {
      const tradingIds = st.prefs.tradingAccounts ?? [];
      const accs = alive(st.accounts).filter(a => !a.archived);
      const acc = accs.find(a => /eight/i.test(a.name) && tradingIds.includes(a.id)) ?? accs.find(a => /eight/i.test(a.name));
      if (acc) {
        const book = computeBalances([acc], alive(st.transactions)).get(acc.id) ?? acc.opening_balance;
        setPrefs({ accountLinks: { ...(st.prefs.accountLinks ?? {}), [acc.id]: { strategy: strat, since: p.a1.start, adj: Math.round((p.a1.capital - book) * 100) / 100 } } });
      }
    }
  }, [plan.v]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan.bought) {
    return (
      <>
        <motion.div className="card lumen-card" style={{ padding: 14, marginTop: 12 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
          <div className="row" style={{ gap: 10 }}>
            <Rocket size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
            <div className="grow">
              <div className="small" style={{ fontWeight: 650 }}>Waiting for the bot</div>
              <div className="tiny muted">{caption(plan)}, from {when(plan.a1.start)}</div>
            </div>
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => setSetup(true)}>I bought it</button>
        </motion.div>
        <Sheet open={setup} onClose={() => setSetup(false)} title="You bought it">{setup && <Setup close={() => setSetup(false)} />}</Sheet>
      </>
    );
  }

  const goal = v.weekly.goal;
  const now = v.actual ?? v.curve.slice().reverse().find(c => c.date <= today)?.bal ?? plan.a1.capital;
  const atGoal = v.goalDate != null && v.goalDate <= today && v.outs.some(o => o.real && o.step >= goal);
  const progress = Math.max(0, Math.min(1, now / goal));
  const next = v.next;
  const dueNow = next && next.date <= today;
  return (
    <>
      <motion.div className="card" style={{ padding: 14, marginTop: 12 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
        <div className="row" style={{ gap: 10, marginBottom: 10 }}>
          <Rocket size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold">Bot plan</div>
            <div className="tiny muted">{caption(plan)}</div>
          </div>
          <button className="chip on" style={{ height: 30, gap: 4 }} onClick={() => setLogging(next && next.date <= today ? next : NEW)}><Plus size={14} />Withdrawal</button>
          <button className="iconbtn" style={{ width: 32, height: 32 }} aria-label="Plan settings" onClick={() => setSettings(true)}><Settings2 size={17} /></button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div className="tiny muted" style={upper}>Next</div>
          {next ? (
            <>
              <div className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 22, fontWeight: 750 }}>Withdraw {money(next.amount)}</span>
                <span className="small muted">{until(next.date, today)}</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div className="small muted grow">{when(next.date)} · leave {money(next.step)}</div>
                {dueNow && v.linked && <button className="chip on" style={{ height: 30 }} onClick={() => setLogging(next)}>Done</button>}
              </div>
            </>
          ) : <div className="small muted" style={{ marginTop: 2 }}>{atGoal ? `At ${money(goal)}. The plan after the goal comes later.` : 'No withdrawal in sight.'}</div>}
          <div className="bar" style={{ height: 9, marginTop: 10 }}>
            <motion.div style={{ background: 'var(--accent)' }} initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.8, ease }} />
          </div>
          <div className="row tiny num" style={{ justifyContent: 'space-between', marginTop: 6, fontWeight: 600 }}>
            <span>{money(now)}{v.actual == null ? ' · plan' : ''}</span>
            <span style={{ color: 'var(--income)' }}>{money(goal)}{v.goalDate ? ` · ${shortDate(v.goalDate)}` : ''}</span>
          </div>
        </div>

        <TodayLot v={v} today={today} />
        {v.actual != null && <Pace v={v} />}
        <PlanCurve v={v} />
        <Fridays v={v} today={today} onLog={setLogging} onReceive={setReceiving} />
        <SpendList v={v} today={today} />
      </motion.div>
      <Sheet open={settings} onClose={() => setSettings(false)} title="Bot plan">{settings && <Settings close={() => setSettings(false)} />}</Sheet>
      <Sheet open={!!logging} onClose={() => setLogging(null)} title="Withdrawal">{logging && <LogOut out={logging} v={v} close={() => setLogging(null)} />}</Sheet>
      <Sheet open={!!receiving} onClose={() => setReceiving(null)} title="Received">{receiving && <Receive out={receiving} close={() => setReceiving(null)} />}</Sheet>
    </>
  );
}

/** The lot for the next trading day: 0.01 per 300 € of the balance it opens with, rounded down. */
function TodayLot({ v, today }: { v: WeekView; today: string }) {
  const t = v.today;
  if (!t) return null;
  return (
    <div className="card" style={{ padding: '10px 12px', marginBottom: 10, background: 'var(--surface-2)', boxShadow: 'none' }}>
      <div className="tiny muted" style={upper}>{t.day === today ? 'Today' : when(t.day)}</div>
      <div className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span className="num" style={{ fontSize: 20, fontWeight: 750 }}>{t.lot.toFixed(2)} lot</span>
        <span className="small" style={{ fontWeight: 650, color: 'var(--accent)' }}>{t.pct}% target</span>
        <span className="grow" />
        <span className="tiny muted num" style={{ textAlign: 'right' }}>{money(t.bal)}{t.real ? '' : ' · plan'}</span>
      </div>
    </div>
  );
}

function Pace({ v }: { v: WeekView }) {
  const d = v.daysAhead ?? 0;
  const color = d > 0 ? 'var(--income)' : d < 0 ? 'var(--expense)' : 'var(--ink-2)';
  return (
    <div className="row small" style={{ justifyContent: 'space-between', padding: '6px 0 10px', gap: 8 }}>
      <span className="muted">Account now <b className="num" style={{ color: 'var(--ink)' }}>{money(v.actual!)}</b></span>
      <span className="num" style={{ fontWeight: 650, color, flex: 'none' }}>{d === 0 ? 'on plan' : d > 0 ? `${d} day${d > 1 ? 's' : ''} ahead` : `${-d} day${d < -1 ? 's' : ''} behind`}</span>
    </div>
  );
}

/** The real balance so far (solid) and the plan from here (dashed), with the weekly withdrawals as steps down. */
function PlanCurve({ v }: { v: WeekView }) {
  const W = 320, H = 110;
  const pts = v.curve;
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map(p => p.bal), v.weekly.goal);
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (b: number) => H - 4 - (b / max) * (H - 10);
  const lastReal = pts.reduce((k, p, i) => (p.real ? i : k), -1);
  const path = (from: number, to: number) => pts.slice(from, to + 1).map((p, i) => `${i ? 'L' : 'M'}${x(from + i).toFixed(1)},${y(p.bal).toFixed(1)}`).join(' ');
  const dReal = lastReal > 0 ? path(0, lastReal) : '';
  const dPlan = path(Math.max(0, lastReal), pts.length - 1);
  const gy = y(v.weekly.goal);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block', margin: '2px 0 8px' }} aria-label="Plan curve">
      <line x1={0} x2={W} y1={gy} y2={gy} stroke="var(--income)" strokeOpacity={0.35} strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
      {v.todayIdx > 0 && <line x1={x(v.todayIdx)} x2={x(v.todayIdx)} y1={0} y2={H} stroke="var(--line)" strokeDasharray="3 4" />}
      <motion.path d={dPlan} fill="none" stroke="var(--accent)" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease }} />
      {dReal && <motion.path d={dReal} fill="none" stroke="var(--income)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease, delay: 0.2 }} />}
    </svg>
  );
}

/** Every week's withdrawal up to the goal: the ones you made (pending until they reach the bank, then ticked) and the ones ahead. */
function Fridays({ v, today, onLog, onReceive }: { v: WeekView; today: string; onLog: (o: WOut) => void; onReceive: (o: WOut) => void }) {
  const goal = v.weekly.goal;
  const goalRow = v.goalDate;
  const accounts = useStore(s => s.accounts);
  return (
    <div style={{ marginTop: 4 }}>
      <div className="tiny muted" style={{ ...upper, margin: '6px 0 2px' }}>Withdrawals</div>
      {v.outs.map((o, i) => {
        const pending = o.real && !o.received;
        const leave = o.step ? `leave ${money(o.step)}${o.step >= goal && o.date === goalRow ? ' · goal reached' : ''}` : '';
        const sub = pending ? ['pending', leave].filter(Boolean).join(' · ')
          : o.real ? [`in ${accounts[o.to ?? '']?.name ?? 'the bank'} ${when(o.received!)}`, leave].filter(Boolean).join(' · ')
          : leave || undefined;
        const action = pending ? { label: 'Received', run: () => onReceive(o) }
          : !o.real && o.date <= today && v.linked ? { label: 'Done', run: () => onLog(o) } : undefined;
        return (
          <motion.div key={o.date + (o.id ?? '')} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease, delay: Math.min(i, 12) * 0.04 }}>
            <Row icon={o.real && o.received ? <Check size={14} /> : pending ? <Clock size={13} /> : <Dot />} done={o.real && !!o.received}
              title={`Withdraw ${money(o.amount)}`} sub={sub} date={o.date} today={today} action={action} />
          </motion.div>
        );
      })}
    </div>
  );
}

/** What the withdrawals pay for: the running total against the list, each item's day and when the money is in the bank. */
function SpendList({ v, today }: { v: WeekView; today: string }) {
  if (!v.spend.length) return null;
  const p = v.spendTotal > 0 ? Math.max(0, Math.min(1, v.spendOut / v.spendTotal)) : 0;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', margin: '6px 0 6px' }}>
        <span className="tiny muted" style={upper}>Pays for</span>
        <span className="tiny num" style={{ fontWeight: 600 }}>{money(Math.min(v.spendOut, v.spendTotal))} <span className="muted">/ {money(v.spendTotal)}</span></span>
      </div>
      <div className="bar" style={{ height: 7, marginBottom: 6 }}>
        <motion.div style={{ background: 'var(--income)' }} initial={{ width: 0 }} animate={{ width: `${p * 100}%` }} transition={{ duration: 0.8, ease }} />
      </div>
      {v.spend.map((s, i) => (
        <motion.div key={s.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease, delay: i * 0.04 }}>
          <Row icon={s.done ? <Check size={14} /> : <Dot />} done={s.done} title={`${s.name} · ${money(s.amount)}`}
            sub={s.arrives ? `in the bank ~${when(s.arrives)}` : undefined} date={s.date} today={today} />
        </motion.div>
      ))}
    </div>
  );
}

const Dot = () => <span style={{ width: 7, height: 7, borderRadius: 4, background: 'currentColor', opacity: 0.55 }} />;

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

// ---------------------------------------------------------------- logging, check-in and settings

const NEW: WOut = { date: '', amount: 0, step: 0, real: false };

/** Log a withdrawal: the plan's amount when it's due, or any amount any day. It stays pending until it reaches the bank. */
function LogOut({ out, v, close }: { out: WOut; v: WeekView; close: () => void }) {
  const fresh = !out.date;
  const [amount, setAmount] = useState(fresh ? '' : String(out.amount));
  const [date, setDate] = useState(fresh || out.date > todayISO() ? todayISO() : out.date);
  const save = () => {
    const a = parseNum(amount);
    if (!(a > 0)) return;
    const last = Math.max(0, ...(v.plan.outs ?? []).map(o => o.step));
    const step = !fresh && Math.abs(a - out.amount) < 0.01 ? out.step
      : v.actual != null ? (stepFor(v.actual - a + 0.005, last, v.weekly.steps) ?? last) : last;
    const id = logOut({ date, amount: Math.round(a * 100) / 100, step, received: null });
    close();
    toast(`Withdrew ${money(a)} · pending`, { label: 'Undo', run: () => removeOut(id) });
  };
  return (
    <div className="sheet-body">
      {!fresh && <div className="small muted" style={{ marginBottom: 12 }}>The plan says {money(out.amount)}, leaving {money(out.step)} in the account.</div>}
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>Withdrawn (€)</label><input className="input num" inputMode="decimal" autoFocus={fresh} value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div className="field grow"><label>On</label><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      </div>
      <div className="tiny faint" style={{ padding: '0 4px 10px', marginTop: -6 }}>It counts against the bot right away, and stays pending until you mark it received in the bank.</div>
      <button className="btn" style={{ marginTop: 8 }} onClick={save}>Save</button>
    </div>
  );
}

/** It reached the bank: pick the account (the last one by default); a transfer from the bot's account is written that day. */
function Receive({ out, close }: { out: WOut; close: () => void }) {
  const accounts = useAccounts();
  const tradingIds = useStore(s => s.prefs.tradingAccounts) ?? [];
  const lastTo = useStore(s => getPlan(s).lastTo);
  const from = planAccount();
  const banks = accounts.filter(a => !a.archived && a.kind !== 'credit' && !tradingIds.includes(a.id) && a.id !== from);
  const [to, setTo] = useState((lastTo && banks.some(a => a.id === lastTo) ? lastTo : banks[0]?.id) ?? '');
  const [date, setDate] = useState(todayISO());
  const save = () => {
    if (!to || !out.id) return;
    receiveOut(out.id, to, date);
    close();
    const id = out.id;
    toast(`${money(out.amount)} in ${banks.find(a => a.id === to)?.name ?? 'the bank'}`, { label: 'Undo', run: () => unreceiveOut(id) });
  };
  return (
    <div className="sheet-body">
      <div className="small muted" style={{ marginBottom: 12 }}>{money(out.amount)} withdrawn {when(out.date)}.{from ? '' : ' No trading account is linked to the bot, so no transfer is written.'}</div>
      <div className="field"><label>Into</label>
        <select className="input" value={to} onChange={e => setTo(e.target.value)}>
          {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></div>
      <div className="field"><label>On</label><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      <button className="btn" style={{ marginTop: 8 }} onClick={save}>Received</button>
    </div>
  );
}

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

function StrategySelect({ value, onChange, strategies }: { value: string; onChange: (v: string) => void; strategies: ReturnType<typeof useStrategies> }) {
  return (
    <div className="field"><label>Its strategy (MT5 sync), for the real balance</label>
      <select className="input" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Not linked yet</option>
        {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></div>
  );
}

type SpendEdit = { id: string; name: string; amount: string };

function Settings({ close }: { close: () => void }) {
  const p: BotPlan = useStore(s => getPlan(s));
  const strategies = useStrategies();
  const w = p.weekly ?? DEFAULT_WEEKLY;
  const [pct, setPct] = useState(String(p.pct));
  const [per, setPer] = useState(String(p.lotPer ?? 300));
  const [c1, setC1] = useState(String(p.a1.capital));
  const [s1, setS1] = useState(p.a1.start);
  const [st1, setSt1] = useState(p.a1.strategy ?? '');
  const [goal, setGoal] = useState(String(w.goal));
  const [steps, setSteps] = useState(w.steps.join(', '));
  const [spendFrom, setSpendFrom] = useState(w.spendFrom);
  const [spend, setSpend] = useState<SpendEdit[]>((p.spend ?? []).map(x => ({ ...x, amount: String(x.amount) })));
  const outs = [...(p.outs ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const setS = (id: string, patch: Partial<SpendEdit>) => setSpend(l => l.map(x => (x.id === id ? { ...x, ...patch } : x)));
  const save = () => {
    const g = parseNum(goal) > 0 ? parseNum(goal) : w.goal;
    const st = steps.split(/[,;\s]+/).map(parseNum).filter(n => n > 0 && n <= g);
    if (!st.includes(g)) st.push(g);
    savePlan({
      pct: Math.max(0.1, parseNum(pct)), lotPer: parseNum(per) > 0 ? parseNum(per) : 300,
      a1: { ...p.a1, capital: Math.max(1, parseNum(c1)), start: s1, strategy: st1 || null },
      weekly: { goal: g, steps: [...new Set(st)].sort((a, b) => a - b), spendFrom: spendFrom || w.spendFrom },
      spend: spend.filter(x => x.name.trim() && parseNum(x.amount) > 0).map(x => ({ id: x.id, name: x.name.trim(), amount: parseNum(x.amount) })),
    });
    close();
  };
  return (
    <div className="sheet-body">
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>% a trading day</label><input className="input num" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} /></div>
        <div className="field grow"><label>0.01 lot per (€)</label><input className="input num" inputMode="decimal" value={per} onChange={e => setPer(e.target.value)} /></div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>Capital (€)</label><input className="input num" inputMode="decimal" value={c1} onChange={e => setC1(e.target.value)} /></div>
        <div className="field grow"><label>Starts</label><input className="input" type="date" value={s1} onChange={e => setS1(e.target.value)} /></div>
      </div>
      <StrategySelect value={st1} onChange={setSt1} strategies={strategies} />

      <div className="section-head"><span className="section-title">Weekly withdrawals</span></div>
      <div className="field"><label>Goal (€)</label><input className="input num" inputMode="decimal" value={goal} onChange={e => setGoal(e.target.value)} /></div>
      <div className="field"><label>Steps to withdraw down to (€)</label><input className="input num" value={steps} onChange={e => setSteps(e.target.value)} /></div>
      <div className="tiny faint" style={{ padding: '0 4px 10px', marginTop: -6 }}>On the last trading day of each week, withdraw down to the highest step the balance has passed, never below last week's.</div>

      <div className="section-head"><span className="section-title">Pays for</span></div>
      <div className="field"><label>Counting withdrawals from</label><input className="input" type="date" value={spendFrom} onChange={e => setSpendFrom(e.target.value)} /></div>
      <div className="list">
        <AnimatePresence initial={false}>
          {spend.map(x => (
            <motion.div key={x.id} className="list-row" style={{ gap: 8 }}
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease }}>
              <input className="input grow" value={x.name} placeholder="What" onChange={e => setS(x.id, { name: e.target.value })} style={{ height: 44 }} />
              <input className="input num" inputMode="decimal" value={x.amount} placeholder="€" onChange={e => setS(x.id, { amount: e.target.value })} style={{ height: 44, width: 96, flex: 'none' }} />
              <button className="iconbtn" style={{ width: 36, height: 36, flex: 'none' }} aria-label="Remove" onClick={() => setSpend(l => l.filter(y => y.id !== x.id))}><Trash2 size={16} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => setSpend(l => [...l, { id: uuid().slice(0, 8), name: '', amount: '' }])}><Plus size={18} />Add</button>

      {outs.length > 0 && <>
        <div className="section-head"><span className="section-title">Withdrawals made</span></div>
        <div className="list">
          {outs.map(o => (
            <div key={o.id} className="list-row" style={{ gap: 8 }}>
              <span className="grow small">{when(o.date)}<span className="tiny muted">{o.received ? ` · received ${shortDate(o.received)}` : ' · pending'}</span></span>
              <span className="small num" style={{ fontWeight: 650 }}>{money(o.amount)}</span>
              <button className="iconbtn" style={{ width: 36, height: 36, flex: 'none' }} aria-label="Remove withdrawal" onClick={() => removeOut(o.id)}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </>}

      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={save}>Save</button>
        <button className="btn secondary" onClick={() => { savePlan({ bought: null }); close(); }}>Back to waiting for the bot</button>
      </div>
    </div>
  );
}
