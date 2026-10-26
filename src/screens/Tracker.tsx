import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, ChevronLeft, ChevronRight, Delete, Pencil, Plus, Settings2, Check, Sun, Moon, Wallet } from 'lucide-react';
import { Segmented, Sheet, toast, ease } from '../components/ui';
import { useStore, put, putMany, remove, getState } from '../lib/store';
import { REMOTE } from '../lib/supabase';
import { useAccounts, alive } from '../lib/calc';
import { COLORS } from '../lib/icons';
import { addDays, fromISO, haptic, money, num, round2, toISO, todayISO, uuid } from '../lib/format';
import {
  useJobs, useJobShifts, usePayPeriods, shiftPay, shiftId, payoutId, rateAt,
  useStrategies, usePnlByDay, statsFor, tRange, tShift, goalOf, pnlId, type TMode, type PayPeriod,
} from '../lib/tracker';
import type { Job, Strategy } from '../lib/types';
import { parseNum } from '../sheets/AccountEdit';

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const mShort = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v));
const periodLabel = (p: { start: string; end: string }) => `${fromISO(p.start).getDate()}–${shortFmt.format(fromISO(p.end))}`;

let lastSection: 'work' | 'trading' = (lsGet('money:tracker') as 'work' | 'trading') || 'work';

export function TrackerScreen() {
  const [section, setSectionState] = useState(lastSection);
  const setSection = (s: typeof section) => { lastSection = s; lsSet('money:tracker', s); setSectionState(s); };
  return (
    <div className="screen" style={{ width: '100%' }}>
      <Segmented value={section} onChange={setSection} style={{ margin: '4px 0 12px' }}
        options={[{ value: 'work', label: 'Work' }, { value: 'trading', label: 'Trading' }]} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={section} initial={{ opacity: 0, x: section === 'work' ? -16 : 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }}>
          {section === 'work' ? <Work /> : <Trading />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function MonthNav({ label, onPrev, onNext, right }: { label: string; onPrev: () => void; onNext: () => void; right?: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', margin: '2px 0 12px' }}>
      <motion.button className="iconbtn" whileTap={{ scale: 0.9 }} onClick={onPrev} aria-label="Previous"><ChevronLeft size={24} /></motion.button>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={label} className="bold" style={{ fontSize: 17 }} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.15 }}>{label}</motion.span>
      </AnimatePresence>
      <div className="row" style={{ gap: 0 }}>
        {right}
        <motion.button className="iconbtn" whileTap={{ scale: 0.9 }} onClick={onNext} aria-label="Next"><ChevronRight size={24} /></motion.button>
      </div>
    </div>
  );
}

/** Calendar grid: weeks of the month, Monday first; `cols` 5 hides weekends. */
function monthCells(anchor: string, weekends: boolean): Array<string | null> {
  const d = fromISO(anchor);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const cells: Array<string | null> = [];
  const lead = (first.getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) if (weekends || i < 5) cells.push(null);
  for (let n = 1; n <= days; n++) {
    const dt = new Date(d.getFullYear(), d.getMonth(), n);
    const wd = (dt.getDay() + 6) % 7;
    if (!weekends && wd > 4) continue;
    cells.push(toISO(dt));
  }
  return cells;
}

// ======================================================================= WORK

function useEnsureJobs() {
  const jobs = useStore(s => s.jobs);
  const lastSync = useStore(s => s.lastSync);
  const cats = useStore(s => s.categories);
  const accs = useStore(s => s.accounts);
  const me = useStore(s => s.user?.id ?? '');
  useEffect(() => {
    if (Object.keys(jobs).length || (REMOTE && !lastSync)) return;
    const income = alive(cats).filter(c => c.type === 'income' && c.owner_id === me && !c.archived);
    const find = (re: RegExp, sub = true) => income.find(c => re.test(c.name) && (!sub || c.parent_id))?.id ?? null;
    const cash = alive(accs).find(a => a.owner_id === me && /μετρητ|cash/i.test(a.name))?.id ?? null;
    putMany('jobs', [
      { id: uuid(), owner_id: '', name: 'Morning', kind: 'daily', pay: 'monthly', rates: [], color: '#E8A33D', salary_category_id: null, tips_category_id: null, tips_account_id: null, sort: 0, archived: false },
      { id: uuid(), owner_id: '', name: 'Evening', kind: 'hourly', pay: 'semimonthly', rates: [], color: '#5B5BD6', salary_category_id: find(/cake/i), tips_category_id: find(/^tips/i), tips_account_id: cash, sort: 1, archived: false },
    ]);
  }, [jobs, lastSync, cats, accs, me]);
}

function Work() {
  useEnsureJobs();
  const jobs = useJobs();
  const shifts = useJobShifts();
  const [anchor, setAnchor] = useState(todayISO());
  const [day, setDay] = useState<string | null>(null);
  const [payJob, setPayJob] = useState<Job | null>(null);
  const [settings, setSettings] = useState(false);
  const byDay = useMemo(() => {
    const m = new Map<string, Array<{ job: Job; hours: number; sales: number }>>();
    for (const s of shifts) {
      const job = jobs.find(j => j.id === s.job_id);
      if (!job) continue;
      const l = m.get(s.date) ?? [];
      l.push({ job, hours: s.hours, sales: s.sales });
      m.set(s.date, l);
    }
    return m;
  }, [shifts, jobs]);
  const d = fromISO(anchor);
  const cells = monthCells(anchor, true);
  const today = todayISO();
  return (
    <div>
      <div style={{ display: 'grid', gap: 10 }}>
        {jobs.map(j => <JobCard key={j.id} job={j} onPay={() => setPayJob(j)} onSettings={() => setSettings(true)} />)}
      </div>
      <div style={{ marginTop: 16 }}>
        <MonthNav label={monthFmt.format(d)}
          onPrev={() => setAnchor(toISO(new Date(d.getFullYear(), d.getMonth() - 1, 1)))}
          onNext={() => setAnchor(toISO(new Date(d.getFullYear(), d.getMonth() + 1, 1)))}
          right={<button className="iconbtn" aria-label="Job settings" onClick={() => setSettings(true)}><Settings2 size={20} /></button>} />
        <div className="cal cal7">
          {WD.map(w => <div key={w} className="cal-wd">{w}</div>)}
          {cells.map((c, i) => {
            if (!c) return <div key={'b' + i} />;
            const list = byDay.get(c) ?? [];
            return (
              <motion.button key={c} className={`cal-cell ${c === today ? 'today' : ''} ${c > today ? 'future' : ''}`} whileTap={{ scale: 0.93 }}
                onClick={() => { haptic(5); setDay(c); }}>
                <span className="cal-n">{fromISO(c).getDate()}</span>
                <span className="cal-jobs">
                  {list.map(x => (
                    <span key={x.job.id} className="cal-chip" style={{ background: x.job.color }}>
                      {x.job.kind === 'daily' ? (x.sales ? `✓${x.sales}` : '✓') : `${num(x.hours)}h`}
                    </span>
                  ))}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
      <ShiftSheet date={day} onClose={() => setDay(null)} />
      <PayoutSheet job={payJob} onClose={() => setPayJob(null)} />
      <JobsSheet open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

function JobCard({ job, onPay, onSettings }: { job: Job; onPay: () => void; onSettings: () => void }) {
  const { owed, current } = usePayPeriods(job);
  const r = rateAt(job, todayISO());
  const noRate = job.kind === 'daily' ? !r.day : !r.hour;
  const Icon = job.kind === 'daily' ? Sun : Moon;
  return (
    <motion.div className="card" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }} style={{ padding: 14 }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="ico sm" style={{ background: job.color }}><Icon size={18} /></span>
        <span className="grow bold">{job.name}</span>
        <motion.button className="chip" whileTap={{ scale: 0.95 }} onClick={onPay}><Wallet size={16} />Got paid</motion.button>
      </div>
      {noRate ? (
        <button className="small" style={{ marginTop: 10, color: 'var(--warn)', fontWeight: 600 }} onClick={onSettings}>Set your pay rate (⚙) to see earnings</button>
      ) : (
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <div className="grow">
            <div className="tiny muted" style={{ fontWeight: 600 }}>Owed to you</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', color: owed > 0 ? 'var(--ink)' : 'var(--ink-3)' }}>{money(owed)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="tiny muted" style={{ fontWeight: 600 }}>This period · {periodLabel(current)}</div>
            <div className="num bold">{money(current.earned)}</div>
            <div className="tiny muted num">{current.shifts} {job.kind === 'daily' ? (current.shifts === 1 ? 'day' : 'days') : `${current.shifts === 1 ? 'shift' : 'shifts'} · ${num(current.hours)}h`}</div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Stepper({ value, onChange, step = 1, min = 0, suffix = '' }: { value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string }) {
  return (
    <div className="stepper">
      <motion.button whileTap={{ scale: 0.88 }} onClick={() => { haptic(4); onChange(Math.max(min, round2(value - step))); }} aria-label="Less">−</motion.button>
      <span className="num">{num(value)}{suffix}</span>
      <motion.button whileTap={{ scale: 0.88 }} onClick={() => { haptic(4); onChange(round2(value + step)); }} aria-label="More">+</motion.button>
    </div>
  );
}

function ShiftSheet({ date, onClose }: { date: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!date} onClose={onClose} title={date ? dayFmt.format(fromISO(date)) : ''}>
      {date && <ShiftForm key={date} date={date} onClose={onClose} />}
    </Sheet>
  );
}

function ShiftForm({ date, onClose }: { date: string; onClose: () => void }) {
  const jobs = useJobs();
  const shifts = useStore(s => s.shifts);
  const txs = useStore(s => s.transactions);
  const accounts = useAccounts().filter(a => a.owner_id === getState().user?.id && !a.archived);
  const init = () => Object.fromEntries(jobs.map(j => {
    const s = shifts[shiftId(j.id, date)];
    const live = s && !s.deleted_at ? s : null;
    const tip = live?.tips_tx_id ? txs[live.tips_tx_id] : null;
    return [j.id, {
      worked: !!live, hours: live?.hours ?? 0, sales: live?.sales ?? 0,
      tips: tip && !tip.deleted_at ? num(tip.amount).replace(/\./g, '') : '', account: tip?.account_id ?? j.tips_account_id ?? accounts[0]?.id ?? '',
    }];
  }));
  const [v, setV] = useState<Record<string, { worked: boolean; hours: number; sales: number; tips: string; account: string }>>(init);
  const set = (id: string, patch: Partial<(typeof v)[string]>) => setV(x => ({ ...x, [id]: { ...x[id], ...patch } }));

  const save = () => {
    for (const j of jobs) {
      const f = v[j.id];
      const id = shiftId(j.id, date);
      const existing = shifts[id] && !shifts[id].deleted_at ? shifts[id] : null;
      const active = j.kind === 'daily' ? f.worked : f.hours > 0;
      const tipAmt = j.kind === 'hourly' ? parseNum(f.tips) : 0;
      let tipsTx = existing?.tips_tx_id ?? null;
      if (j.kind === 'hourly' && j.tips_category_id && active && tipAmt > 0 && f.account) {
        tipsTx = tipsTx ?? uuid();
        put('transactions', {
          id: tipsTx, owner_id: '', type: 'income', date, amount: tipAmt, account_id: f.account, to_account_id: null,
          category_id: j.tips_category_id, note: null, recurring_id: null, seq: txs[tipsTx]?.seq ?? Date.now() % 100000,
        });
      } else if (tipsTx && txs[tipsTx] && !txs[tipsTx].deleted_at) {
        remove('transactions', tipsTx);
        tipsTx = null;
      }
      if (active) put('shifts', { id, owner_id: '', job_id: j.id, date, hours: j.kind === 'hourly' ? f.hours : 1, sales: j.kind === 'daily' ? f.sales : 0, tips_tx_id: tipsTx });
      else if (existing) remove('shifts', id);
    }
    haptic(10);
    toast('Saved');
    onClose();
  };

  return (
    <div className="sheet-body">
      {jobs.map(j => {
        const f = v[j.id];
        if (!f) return null;
        const pay = shiftPay(j, { id: '', owner_id: '', job_id: j.id, date, hours: f.hours, sales: f.sales, tips_tx_id: null });
        const active = j.kind === 'daily' ? f.worked : f.hours > 0;
        return (
          <div key={j.id} className="card" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 10, marginBottom: 12 }}>
              <span className="ico sm" style={{ background: j.color }}>{j.kind === 'daily' ? <Sun size={18} /> : <Moon size={18} />}</span>
              <span className="grow bold">{j.name}</span>
              {active && <span className="num small bold" style={{ color: 'var(--income)' }}>= {money(pay)}</span>}
            </div>
            {j.kind === 'daily' ? (
              <>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>Worked</span>
                  <button className={`toggle ${f.worked ? 'on' : ''}`} onClick={() => set(j.id, { worked: !f.worked })} aria-pressed={f.worked} />
                </div>
                <AnimatePresence initial={false}>
                  {f.worked && (
                    <motion.div className="row" style={{ justifyContent: 'space-between', marginTop: 12, overflow: 'hidden' }}
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }}>
                      <span>Sales</span>
                      <Stepper value={f.sales} onChange={x => set(j.id, { sales: x })} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>Hours</span>
                  <Stepper value={f.hours} step={0.5} onChange={x => set(j.id, { hours: x })} suffix="h" />
                </div>
                {j.tips_category_id ? (
                  <div className="row" style={{ marginTop: 12, gap: 8 }}>
                    <span style={{ width: 50 }}>Tips</span>
                    <input className="input num" inputMode="decimal" placeholder="0" value={f.tips} onChange={e => set(j.id, { tips: e.target.value })} style={{ height: 44, flex: 1 }} />
                    <select className="input" value={f.account} onChange={e => set(j.id, { account: e.target.value })} style={{ height: 44, width: 130 }}>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                ) : <div className="tiny muted" style={{ marginTop: 8 }}>Choose a tips category in ⚙ to log tips here.</div>}
              </>
            )}
          </div>
        );
      })}
      {jobs.length === 0 && <div className="empty">No jobs yet.</div>}
      <button className="btn" onClick={save} style={{ marginTop: 6 }}>Save</button>
      <p className="tiny muted" style={{ textAlign: 'center', marginTop: 8 }}>Tips are added to your income automatically — don't add them again with +.</p>
    </div>
  );
}

function PayoutSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  return (
    <Sheet open={!!job} onClose={onClose} title={job ? `${job.name} · got paid` : ''}>
      {job && <PayoutForm job={job} onClose={onClose} />}
    </Sheet>
  );
}

function PayoutForm({ job, onClose }: { job: Job; onClose: () => void }) {
  const { list } = usePayPeriods(job);
  const payouts = useStore(s => s.payouts);
  const me = useStore(s => s.user?.id);
  const accounts = useAccounts().filter(a => a.owner_id === me && !a.archived);
  const periods = list.filter(p => p.owed > 0.004 || p.paid > 0).slice(0, 8);
  const [pick, setPick] = useState<PayPeriod | null>(periods.find(p => p.owed > 0 && !p.current) ?? periods.find(p => p.owed > 0) ?? null);
  const [amount, setAmount] = useState(pick ? num(pick.owed).replace(/\./g, '') : '');
  const [account, setAccount] = useState(lsGet('money:payacc:' + job.id) ?? accounts.find(a => /eurobank|τράπεζ|bank/i.test(a.name))?.id ?? accounts[0]?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const choose = (p: PayPeriod) => { setPick(p); setAmount(num(Math.max(0, p.owed)).replace(/\./g, '')); };
  const save = () => {
    if (!pick) return;
    const amt = parseNum(amount);
    if (amt <= 0) return toast('Enter the amount you got');
    const id = payoutId(job.id, pick.start);
    const prev = payouts[id] && !payouts[id].deleted_at ? payouts[id] : null;
    let txId: string | null = null;
    if (job.salary_category_id && account) {
      txId = uuid();
      put('transactions', {
        id: txId, owner_id: '', type: 'income', date, amount: amt, account_id: account, to_account_id: null,
        category_id: job.salary_category_id, note: `${job.name} ${periodLabel(pick)}`, recurring_id: null, seq: Date.now() % 100000,
      });
      lsSet('money:payacc:' + job.id, account);
    }
    put('payouts', { id, owner_id: '', job_id: job.id, period_start: pick.start, period_end: pick.end, amount: round2((prev?.amount ?? 0) + amt), tx_id: txId ?? prev?.tx_id ?? null, date });
    haptic(12);
    toast(txId ? `${money(amt)} added to your income` : 'Payment saved');
    onClose();
  };
  return (
    <div className="sheet-body">
      {periods.length === 0 && <div className="empty">Nothing owed yet. Log your shifts first.</div>}
      <div className="list">
        {periods.map(p => (
          <button key={p.start} className="list-row" onClick={() => choose(p)}>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>{periodLabel(p)}{p.current && <span className="badge" style={{ marginLeft: 6 }}>now</span>}</span>
              <div className="tiny muted num">earned {money(p.earned)} · paid {money(p.paid)}</div>
            </span>
            <span className="num bold" style={{ color: p.owed > 0.004 ? 'var(--ink)' : p.owed < -0.004 ? 'var(--warn)' : 'var(--income)' }}>{p.owed > 0.004 ? money(p.owed) : p.owed < -0.004 ? `+${money(-p.owed)}` : '✓'}</span>
            {pick?.start === p.start && <Check size={18} style={{ color: 'var(--accent)', marginLeft: 6 }} />}
          </button>
        ))}
      </div>
      {pick && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 14 }}>
          <div className="field"><label>Amount you got for {periodLabel(pick)}</label>
            <input className="input num" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          {job.salary_category_id ? (
            <div className="row" style={{ gap: 8 }}>
              <select className="input" value={account} onChange={e => setAccount(e.target.value)} style={{ flex: 1 }}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <input className="input" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={{ width: 150 }} />
            </div>
          ) : <div className="tiny muted">Choose a salary category in ⚙ so the payment is also added to your accounts.</div>}
          <button className="btn" style={{ marginTop: 14 }} onClick={save}>Save payment</button>
        </motion.div>
      )}
    </div>
  );
}

function JobsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const jobs = useJobs();
  const [edit, setEdit] = useState<Job | 'new' | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Jobs" full>
      <div className="sheet-body">
        <div className="list">
          {jobs.map(j => {
            const r = rateAt(j, todayISO());
            return (
              <button key={j.id} className="list-row" onClick={() => setEdit(j)}>
                <span className="ico sm" style={{ background: j.color }}>{j.kind === 'daily' ? <Sun size={18} /> : <Moon size={18} />}</span>
                <span className="grow"><span style={{ fontWeight: 600 }}>{j.name}</span>
                  <div className="tiny muted num">{j.kind === 'daily' ? `${money(r.day ?? 0)}/day + ${money(r.bonus ?? 0)}/sale` : `${money(r.hour ?? 0)}/hour`} · {j.pay === 'monthly' ? 'paid monthly' : 'paid 1–15 & 16–end'}</div>
                </span>
                <Pencil size={17} className="faint" />
              </button>
            );
          })}
        </div>
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => setEdit('new')}><Plus size={18} />Add job</button>
      </div>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New job' : 'Edit job'} z={1} full>
        {edit && <JobForm key={edit === 'new' ? 'new' : edit.id} job={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      </Sheet>
    </Sheet>
  );
}

function JobForm({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const cats = useStore(s => s.categories);
  const me = useStore(s => s.user?.id);
  const accounts = useAccounts().filter(a => a.owner_id === me && !a.archived);
  const jobs = useJobs();
  const r = job ? rateAt(job, todayISO()) : { from: '' };
  const [name, setName] = useState(job?.name ?? '');
  const [kind, setKind] = useState<Job['kind']>(job?.kind ?? 'hourly');
  const [pay, setPay] = useState<Job['pay']>(job?.pay ?? 'monthly');
  const [day, setDay] = useState(r.day ? num(r.day).replace(/\./g, '') : '');
  const [bonus, setBonus] = useState(r.bonus ? num(r.bonus).replace(/\./g, '') : '');
  const [hour, setHour] = useState(r.hour ? num(r.hour).replace(/\./g, '') : '');
  const [from, setFrom] = useState(todayISO());
  const [salary, setSalary] = useState(job?.salary_category_id ?? '');
  const [tips, setTips] = useState(job?.tips_category_id ?? '');
  const [tipsAcc, setTipsAcc] = useState(job?.tips_account_id ?? '');
  const income = alive(cats).filter(c => c.type === 'income' && c.owner_id === me && !c.archived && !(c.parent_id && cats[c.parent_id]?.archived));
  const label = (id: string) => { const c = cats[id]; const p = c?.parent_id ? cats[c.parent_id] : null; return p ? `${p.name} · ${c!.name}` : c?.name ?? ''; };
  const opts = income.map(c => c.id).sort((a, b) => label(a).localeCompare(label(b)));
  const hasRates = !!job && (job.rates ?? []).length > 0;
  const changed = kind === 'daily' ? parseNum(day) !== (r.day ?? 0) || parseNum(bonus) !== (r.bonus ?? 0) : parseNum(hour) !== (r.hour ?? 0);

  const save = () => {
    if (!name.trim()) return toast('Give the job a name');
    let rates = job?.rates ?? [];
    if (changed || !rates.length) {
      const nr = kind === 'daily' ? { day: parseNum(day), bonus: parseNum(bonus) } : { hour: parseNum(hour) };
      rates = hasRates ? [...rates.filter(x => x.from !== from), { from, ...nr }] : [{ from: '0000-01-01', ...nr }];
    }
    put('jobs', {
      id: job?.id ?? uuid(), owner_id: '', name: name.trim(), kind, pay, rates, color: job?.color ?? COLORS[(jobs.length * 3 + 8) % COLORS.length],
      salary_category_id: salary || null, tips_category_id: kind === 'hourly' ? tips || null : null, tips_account_id: kind === 'hourly' ? tipsAcc || null : null,
      sort: job?.sort ?? jobs.length, archived: false,
    });
    toast('Saved');
    onClose();
  };
  const hide = () => { if (job) { put('jobs', { ...job, archived: true }); toast(`${job.name} hidden`); onClose(); } };
  return (
    <div className="sheet-body">
      <div className="field"><label>Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Evening" /></div>
      <div className="field"><label>Pay</label>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'daily', label: 'Day rate + bonus' }, { value: 'hourly', label: 'Hourly + tips' }]} />
      </div>
      {kind === 'daily' ? (
        <div className="row" style={{ gap: 10 }}>
          <div className="field grow"><label>Per day</label><input className="input num" inputMode="decimal" value={day} onChange={e => setDay(e.target.value)} placeholder="0" /></div>
          <div className="field grow"><label>Bonus per sale</label><input className="input num" inputMode="decimal" value={bonus} onChange={e => setBonus(e.target.value)} placeholder="0" /></div>
        </div>
      ) : (
        <div className="field"><label>Per hour</label><input className="input num" inputMode="decimal" value={hour} onChange={e => setHour(e.target.value)} placeholder="0" /></div>
      )}
      {hasRates && changed && (
        <div className="field"><label>New rate applies from</label>
          <input className="input" type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
          <span className="tiny muted" style={{ paddingLeft: 4 }}>Shifts before this date keep the old rate.</span>
        </div>
      )}
      <div className="field"><label>Paid</label>
        <Segmented value={pay} onChange={setPay} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'semimonthly', label: '1–15 & 16–end' }]} />
      </div>
      <div className="field"><label>Salary goes to category</label>
        <select className="input" value={salary} onChange={e => setSalary(e.target.value)}>
          <option value="">— none —</option>
          {opts.map(id => <option key={id} value={id}>{label(id)}</option>)}
        </select>
      </div>
      {kind === 'hourly' && (
        <div className="row" style={{ gap: 10 }}>
          <div className="field grow"><label>Tips category</label>
            <select className="input" value={tips} onChange={e => setTips(e.target.value)}>
              <option value="">— none —</option>
              {opts.map(id => <option key={id} value={id}>{label(id)}</option>)}
            </select>
          </div>
          <div className="field grow"><label>Tips account</label>
            <select className="input" value={tipsAcc} onChange={e => setTipsAcc(e.target.value)}>
              <option value="">— choose —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      )}
      <button className="btn" onClick={save}>Save</button>
      {job && <button className="btn secondary" style={{ marginTop: 10 }} onClick={hide}>Hide job (history kept)</button>}
    </div>
  );
}

// ======================================================================= TRADING

function Trading() {
  const strategies = useStrategies();
  const [mode, setMode] = useState<TMode>((lsGet('money:t:mode') as TMode) || 'month');
  const [anchor, setAnchor] = useState(todayISO());
  const [sel, setSelState] = useState<string>(lsGet('money:t:sel') || 'all');
  const [weekends, setWeekendsState] = useState(lsGet('money:t:we') === '1');
  const [view, setView] = useState<'calendar' | 'stats'>('calendar');
  const [entry, setEntry] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const selected = sel === 'all' || strategies.some(s => s.id === sel) ? sel : 'all';
  const setSel = (s: string) => { lsSet('money:t:sel', s); setSelState(s); };
  const setWeekends = (w: boolean) => { lsSet('money:t:we', w ? '1' : '0'); setWeekendsState(w); };
  const changeMode = (m: TMode) => { lsSet('money:t:mode', m); setMode(m); };
  const byDay = usePnlByDay(selected);
  const [from, to] = tRange(mode, anchor);
  const st = statsFor(byDay, from, to);
  const today = todayISO();
  const d = fromISO(anchor);
  const label = mode === 'week' ? `${shortFmt.format(fromISO(from))} – ${shortFmt.format(fromISO(to))}` : mode === 'month' ? monthFmt.format(d) : mode === 'year' ? String(d.getFullYear()) : 'All time';
  const goal = goalOf(selected, strategies);
  const selName = selected === 'all' ? 'All strategies' : strategies.find(s => s.id === selected)?.name ?? '';
  const selColor = selected === 'all' ? 'var(--accent)' : strategies.find(s => s.id === selected)?.color;

  if (!strategies.length) {
    return (
      <div className="empty">
        <div className="bold" style={{ color: 'var(--ink)', marginBottom: 6 }}>No strategies yet</div>
        <div className="small" style={{ marginBottom: 14 }}>Add each strategy or EA you trade, then log its daily result on the calendar.</div>
        <button className="btn" onClick={() => setPicker(true)}><Plus size={18} />Add strategy</button>
        <StrategyPicker open={picker} onClose={() => setPicker(false)} selected={selected} onSelect={setSel} startNew />
      </div>
    );
  }

  return (
    <div>
      <Segmented value={mode} onChange={changeMode}
        options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }, { value: 'all', label: 'All time' }]} />
      <div style={{ marginTop: 10 }}>
        {mode === 'all' ? <div style={{ height: 8 }} /> : <MonthNav label={label} onPrev={() => setAnchor(tShift(mode, anchor, -1))} onNext={() => setAnchor(tShift(mode, anchor, 1))} />}
      </div>
      <div className="ie-row">
        <div className="card" style={{ padding: 14 }}>
          <div className="small muted" style={{ fontWeight: 600 }}>Total P&L</div>
          <div className="num" style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: st.net > 0 ? 'var(--income)' : st.net < 0 ? 'var(--expense)' : 'var(--ink-3)' }}>{signed(st.net)} €</div>
        </div>
        {mode === 'month' ? (
          <button className="card" style={{ padding: 14, textAlign: 'left' }} onClick={() => setGoalOpen(true)}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted" style={{ fontWeight: 600 }}>Monthly goal</span><Pencil size={15} style={{ color: 'var(--accent)' }} />
            </div>
            <div className="bar" style={{ height: 9, marginTop: 12 }}>
              <motion.div style={{ background: st.net >= goal && goal > 0 ? 'var(--income)' : 'var(--accent)' }} initial={{ width: 0 }}
                animate={{ width: `${goal > 0 ? Math.max(0, Math.min(1, st.net / goal)) * 100 : 0}%` }} transition={{ duration: 0.7, ease }} />
            </div>
            <div className="row tiny num" style={{ justifyContent: 'space-between', marginTop: 8, fontWeight: 600 }}>
              <span style={{ color: st.net < 0 ? 'var(--expense)' : 'var(--ink-2)' }}>{signed(st.net)} €</span>
              <span style={{ color: 'var(--income)' }}>{goal ? `${num(goal)} €` : 'set goal'}</span>
            </div>
          </button>
        ) : (
          <div className="card" style={{ padding: 14 }}>
            <div className="small muted" style={{ fontWeight: 600 }}>Winning days</div>
            <div className="num" style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{st.winDays}<span className="muted" style={{ fontSize: 16 }}> / {st.days}</span></div>
          </div>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', margin: '14px 2px 10px' }}>
        <button className="row small bold" style={{ gap: 4 }} onClick={() => setWeekends(!weekends)}>Weekends: {weekends ? 'ON' : 'OFF'}</button>
        <button className="row small bold" style={{ gap: 4, color: selColor }} onClick={() => setPicker(true)}>
          <span className="ellipsis" style={{ maxWidth: 200, textTransform: 'uppercase', letterSpacing: '.02em' }}>{selName}</span><ChevronDown size={16} />
        </button>
      </div>
      <Segmented value={view} onChange={setView} style={{ marginBottom: 12 }} options={[{ value: 'calendar', label: 'Calendar' }, { value: 'stats', label: 'Stats' }]} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view + mode + from + selected} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {view === 'stats' ? <StatsView sel={selected} from={from} to={to} /> : (
            mode === 'month' || mode === 'week' ? (
              <div className={`cal ${weekends ? 'cal7' : 'cal5'}`}>
                {(weekends ? WD : WD.slice(0, 5)).map(w => <div key={w} className="cal-wd">{w.toUpperCase()}</div>)}
                {(mode === 'month' ? monthCells(anchor, weekends) : weekCells(from, weekends)).map((c, i) => {
                  if (!c) return <div key={'b' + i} />;
                  const v = byDay.get(c);
                  const cls = v == null || v === 0 ? '' : v > 0 ? 'pos' : 'neg';
                  return (
                    <motion.button key={c} className={`cal-cell tcell ${cls} ${c === today ? 'today' : ''} ${mode === 'week' ? 'big' : ''}`}
                      whileTap={{ scale: 0.93 }} onClick={() => { haptic(5); setEntry(c); }}
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2, delay: Math.min(i, 30) * 0.008 }}>
                      <span className="cal-n">{fromISO(c).getDate()}</span>
                      <span className="cal-v num">{v == null ? '—' : signed(v)}</span>
                    </motion.button>
                  );
                })}
              </div>
            ) : (
              <PeriodTiles mode={mode} anchor={anchor} byDay={byDay} onOpen={(m, a) => { changeMode(m); setAnchor(a); }} />
            )
          )}
        </motion.div>
      </AnimatePresence>

      <PnlEntrySheet date={entry} sel={selected} onClose={() => setEntry(null)} />
      <StrategyPicker open={picker} onClose={() => setPicker(false)} selected={selected} onSelect={setSel} />
      <GoalSheet open={goalOpen} onClose={() => setGoalOpen(false)} sel={selected} />
    </div>
  );
}

function weekCells(from: string, weekends: boolean) {
  const out: string[] = [];
  for (let i = 0; i < (weekends ? 7 : 5); i++) out.push(addDays(from, i));
  return out;
}

function PeriodTiles({ mode, anchor, byDay, onOpen }: { mode: TMode; anchor: string; byDay: Map<string, number>; onOpen: (m: TMode, a: string) => void }) {
  const tiles = useMemo(() => {
    const sum = (a: string, b: string) => { let s = 0, any = false; for (const [d, v] of byDay) if (d >= a && d <= b) { s += v; any = true; } return any ? round2(s) : null; };
    if (mode === 'year') {
      const y = fromISO(anchor).getFullYear();
      return Array.from({ length: 12 }, (_, m) => {
        const a = toISO(new Date(y, m, 1)), b = toISO(new Date(y, m + 1, 0));
        return { key: a, label: mShort.format(fromISO(a)), v: sum(a, b), open: () => onOpen('month', a) };
      });
    }
    const years = [...new Set([...byDay.keys()].map(d => d.slice(0, 4)))].sort();
    if (!years.length) years.push(todayISO().slice(0, 4));
    return years.map(y => ({ key: y, label: y, v: sum(`${y}-01-01`, `${y}-12-31`), open: () => onOpen('year', `${y}-01-01`) }));
  }, [mode, anchor, byDay, onOpen]);
  return (
    <div className="cal" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      {tiles.map((t, i) => (
        <motion.button key={t.key} className={`cal-cell tcell big ${t.v == null || t.v === 0 ? '' : t.v > 0 ? 'pos' : 'neg'}`} whileTap={{ scale: 0.95 }} onClick={t.open}
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2, delay: i * 0.02 }}>
          <span className="cal-n">{t.label}</span>
          <span className="cal-v num">{t.v == null ? '—' : signed(t.v)}</span>
        </motion.button>
      ))}
    </div>
  );
}

function PnlEntrySheet({ date, sel, onClose }: { date: string | null; sel: string; onClose: () => void }) {
  return (
    <Sheet open={!!date} onClose={onClose} title={date ? dayFmt.format(fromISO(date)) : ''}>
      {date && (sel === 'all' ? <PnlAllForm key={date} date={date} onClose={onClose} /> : <PnlOneForm key={date + sel} date={date} sid={sel} onClose={onClose} />)}
    </Sheet>
  );
}

function savePnl(sid: string, date: string, value: number | null) {
  const id = pnlId(sid, date);
  const existing = getState().pnl[id];
  if (value == null) { if (existing && !existing.deleted_at) remove('pnl', id); return; }
  put('pnl', { id, owner_id: '', strategy_id: sid, date, pnl: round2(value) });
}

function PnlOneForm({ date, sid, onClose }: { date: string; sid: string; onClose: () => void }) {
  const s = useStore(st => st.strategies[sid]);
  const existing = useStore(st => st.pnl[pnlId(sid, date)]);
  const start = existing && !existing.deleted_at ? existing.pnl : null;
  const [neg, setNeg] = useState(start != null && start < 0);
  const [txt, setTxt] = useState(start != null ? num(Math.abs(start)).replace(/\./g, '') : '');
  const press = (k: string) => {
    haptic(4);
    if (k === 'pm') return setNeg(n => !n);
    setTxt(t => {
      if (k === 'del') return t.slice(0, -1);
      if (k === ',') return t.includes(',') ? t : (t || '0') + ',';
      if (/,\d\d$/.test(t) || t.replace(',', '').length >= 8) return t;
      return t === '0' ? k : t + k;
    });
  };
  const value = txt ? parseNum(txt) * (neg ? -1 : 1) : null;
  const save = () => { savePnl(sid, date, value); haptic(10); toast(value == null ? 'Cleared' : `${s?.name}: ${signed(value)} €`); onClose(); };
  const color = value == null || value === 0 ? 'var(--ink-3)' : value > 0 ? 'var(--income)' : 'var(--expense)';
  return (
    <div style={{ padding: '0 12px 12px' }}>
      <div className="row small bold" style={{ justifyContent: 'center', gap: 6, color: s?.color }}><span className="dot" style={{ background: s?.color }} />{s?.name}</div>
      <div className="num" style={{ textAlign: 'center', fontSize: 46, fontWeight: 700, margin: '10px 0 14px', color }}>{value == null ? '0' : signed(value)} <span className="cur" style={{ fontSize: '0.5em' }}>€</span></div>
      <div className="keypad">
        {['7', '8', '9', 'del', '4', '5', '6', 'pm', '1', '2', '3', ',', 'clear', '0', '00', 'ok'].map(k => (
          <motion.button key={k} className={`key ${['del', 'pm', 'clear'].includes(k) ? 'op' : ''} ${k === 'ok' ? 'go' : ''}`} whileTap={{ scale: 0.92 }}
            onClick={() => (k === 'ok' ? save() : k === 'clear' ? setTxt('') : k === '00' ? (press('0'), press('0')) : press(k))} aria-label={k}>
            {k === 'del' ? <Delete size={22} /> : k === 'pm' ? '±' : k === 'clear' ? <span className="small">Clear</span> : k === 'ok' ? <Check size={26} /> : k}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function PnlAllForm({ date, onClose }: { date: string; onClose: () => void }) {
  const strategies = useStrategies();
  const pnl = useStore(s => s.pnl);
  const [vals, setVals] = useState<Record<string, { neg: boolean; txt: string }>>(() => Object.fromEntries(strategies.map(s => {
    const e = pnl[pnlId(s.id, date)];
    const v = e && !e.deleted_at ? e.pnl : null;
    return [s.id, { neg: v != null && v < 0, txt: v != null ? num(Math.abs(v)).replace(/\./g, '') : '' }];
  })));
  const save = () => {
    for (const s of strategies) { const f = vals[s.id]; savePnl(s.id, date, f.txt.trim() ? parseNum(f.txt) * (f.neg ? -1 : 1) : null); }
    haptic(10); toast('Saved'); onClose();
  };
  return (
    <div className="sheet-body">
      <div style={{ display: 'grid', gap: 8 }}>
        {strategies.map(s => {
          const f = vals[s.id];
          return (
            <div key={s.id} className="row card" style={{ padding: '8px 10px 8px 14px', gap: 10 }}>
              <span className="dot" style={{ background: s.color }} />
              <span className="grow ellipsis" style={{ fontWeight: 600 }}>{s.name}</span>
              <motion.button whileTap={{ scale: 0.9 }} className="pm" style={{ color: f.neg ? 'var(--expense)' : 'var(--income)' }}
                onClick={() => setVals(v => ({ ...v, [s.id]: { ...f, neg: !f.neg } }))} aria-label="Plus or minus">{f.neg ? '−' : '+'}</motion.button>
              <input className="input num" inputMode="decimal" placeholder="—" value={f.txt} style={{ width: 110, height: 44, textAlign: 'right' }}
                onChange={e => setVals(v => ({ ...v, [s.id]: { ...f, txt: e.target.value.replace('-', '') , neg: e.target.value.includes('-') ? true : f.neg } }))} />
            </div>
          );
        })}
      </div>
      <button className="btn" style={{ marginTop: 14 }} onClick={save}>Save</button>
      <p className="tiny muted" style={{ textAlign: 'center', marginTop: 8 }}>Leave empty for days a strategy didn't trade. Tap +/− to switch profit or loss.</p>
    </div>
  );
}

function StrategyPicker({ open, onClose, selected, onSelect, startNew = false }: { open: boolean; onClose: () => void; selected: string; onSelect: (s: string) => void; startNew?: boolean }) {
  const strategies = useStrategies();
  const [edit, setEdit] = useState<Strategy | 'new' | null>(null);
  useEffect(() => { if (open && startNew) setEdit('new'); }, [open, startNew]);
  return (
    <Sheet open={open} onClose={onClose} title="Strategy">
      <div className="sheet-body">
        <div className="list">
          {[{ id: 'all', name: 'All strategies', color: 'var(--accent)' } as Strategy, ...strategies].map(s => (
            <div key={s.id} className="list-row" style={{ paddingRight: 6 }}>
              <button className="row grow" style={{ textAlign: 'left' }} onClick={() => { onSelect(s.id); onClose(); }}>
                <span className="dot" style={{ background: s.color }} />
                <span className="grow" style={{ fontWeight: 600 }}>{s.name}</span>
                {selected === s.id && <Check size={18} style={{ color: 'var(--accent)' }} />}
              </button>
              {s.id !== 'all' ? <button className="iconbtn" style={{ width: 38 }} onClick={() => setEdit(s)} aria-label={`Edit ${s.name}`}><Pencil size={16} /></button> : <span style={{ width: 38 }} />}
            </div>
          ))}
        </div>
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => setEdit('new')}><Plus size={18} />New strategy</button>
      </div>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New strategy' : 'Edit strategy'} z={1}>
        {edit && <StrategyForm key={edit === 'new' ? 'new' : edit.id} s={edit === 'new' ? null : edit} onDone={id => { setEdit(null); if (id) { onSelect(id); onClose(); } }} />}
      </Sheet>
    </Sheet>
  );
}

function StrategyForm({ s, onDone }: { s: Strategy | null; onDone: (id?: string) => void }) {
  const strategies = useStrategies();
  const [name, setName] = useState(s?.name ?? '');
  const [color, setColor] = useState(s?.color ?? COLORS[(strategies.length * 5 + 5) % COLORS.length]);
  const [goal, setGoal] = useState(s?.goal ? num(s.goal).replace(/\./g, '') : '');
  const save = () => {
    if (!name.trim()) return toast('Give it a name');
    const id = s?.id ?? uuid();
    put('strategies', { id, owner_id: '', name: name.trim(), color, goal: goal.trim() ? parseNum(goal) : null, sort: s?.sort ?? strategies.length, archived: false });
    toast('Saved');
    onDone(s ? undefined : id);
  };
  return (
    <div className="sheet-body">
      <div className="field"><label>Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. DEEP DIP GOLD" autoFocus={!s} /></div>
      <div className="field"><label>Monthly goal</label><input className="input num" inputMode="decimal" value={goal} onChange={e => setGoal(e.target.value)} placeholder="No goal" /></div>
      <div className="field"><label>Color</label>
        <div className="pick-grid">{COLORS.map(c => <button key={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}</div>
      </div>
      <button className="btn" onClick={save}>Save</button>
      {s && <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => { put('strategies', { ...s, archived: true }); toast(`${s.name} hidden · results kept`); onDone(); }}>Hide strategy</button>}
    </div>
  );
}

function GoalSheet({ open, onClose, sel }: { open: boolean; onClose: () => void; sel: string }) {
  const strategies = useStrategies();
  const list = sel === 'all' ? strategies : strategies.filter(s => s.id === sel);
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { if (open) setVals(Object.fromEntries(list.map(s => [s.id, s.goal ? num(s.goal).replace(/\./g, '') : '']))); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    putMany('strategies', list.map(s => ({ ...s, goal: vals[s.id]?.trim() ? parseNum(vals[s.id]) : null })));
    toast('Goals saved'); onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Monthly goal">
      <div className="sheet-body">
        {sel === 'all' && <p className="small muted" style={{ margin: '0 4px 10px' }}>The total goal is the sum of each strategy's goal.</p>}
        {list.map(s => (
          <div key={s.id} className="row" style={{ gap: 10, marginBottom: 8 }}>
            <span className="dot" style={{ background: s.color }} /><span className="grow" style={{ fontWeight: 600 }}>{s.name}</span>
            <input className="input num" inputMode="decimal" placeholder="—" style={{ width: 120, height: 44, textAlign: 'right' }} value={vals[s.id] ?? ''} onChange={e => setVals(v => ({ ...v, [s.id]: e.target.value }))} />
          </div>
        ))}
        <button className="btn" style={{ marginTop: 8 }} onClick={save}>Save</button>
      </div>
    </Sheet>
  );
}

function StatsView({ sel, from, to }: { sel: string; from: string; to: string }) {
  const strategies = useStrategies();
  const byDay = usePnlByDay(sel);
  const st = statsFor(byDay, from, to);
  return (
    <div>
      <div className="card" style={{ padding: '14px 12px 10px' }}>
        <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Equity curve</div>
        <Curve points={st.curve.map(p => p.v)} />
      </div>
      <div className="tstats">
        {([
          ['Net', `${signed(st.net)} €`, st.net],
          ['Winning days', st.days ? `${Math.round((st.winDays / st.days) * 100)}% · ${st.winDays}/${st.days}` : '—', 0],
          ['Avg winning day', `${signed(st.avgWin)} €`, st.avgWin],
          ['Avg losing day', `${signed(st.avgLoss)} €`, st.avgLoss],
          ['Profit factor', st.profitFactor == null ? (st.winDays ? '∞' : '—') : num(st.profitFactor), 0],
          ['Max drawdown', st.maxDD ? `−${num(st.maxDD)} €` : '0 €', st.maxDD ? -1 : 0],
          ['Best day', `${signed(st.best)} €`, st.best],
          ['Worst day', `${signed(st.worst)} €`, st.worst],
        ] as Array<[string, string, number]>).map(([l, v, sign], i) => (
          <motion.div key={l} className="stat" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.025, duration: 0.25, ease }}>
            <div className="l">{l}</div>
            <div className="v num" style={{ color: sign > 0 ? 'var(--income)' : sign < 0 ? 'var(--expense)' : 'var(--ink)' }}>{v}</div>
          </motion.div>
        ))}
      </div>
      {sel === 'all' && strategies.length > 1 && <PerStrategy from={from} to={to} />}
    </div>
  );
}

function PerStrategy({ from, to }: { from: string; to: string }) {
  const strategies = useStrategies();
  const pnl = useStore(s => s.pnl);
  const rows = useMemo(() => strategies.map(s => {
    const m = new Map<string, number>();
    for (const p of alive(pnl)) if (p.strategy_id === s.id) m.set(p.date, p.pnl);
    return { s, st: statsFor(m, from, to) };
  }).sort((a, b) => b.st.net - a.st.net), [strategies, pnl, from, to]);
  return (
    <div className="section">
      <div className="section-head"><span className="section-title">By strategy</span></div>
      <div className="list">
        {rows.map(({ s, st }) => (
          <div key={s.id} className="list-row">
            <span className="dot" style={{ background: s.color }} />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div className="tiny muted num">{st.days} days · {st.days ? Math.round((st.winDays / st.days) * 100) : 0}% green · PF {st.profitFactor == null ? '—' : num(st.profitFactor)} · DD {num(st.maxDD)} €</div>
            </div>
            <span className="num bold" style={{ color: st.net > 0 ? 'var(--income)' : st.net < 0 ? 'var(--expense)' : 'var(--ink-3)' }}>{signed(st.net)} €</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Curve({ points }: { points: number[] }) {
  const W = 320, H = 120;
  if (points.length < 2) return <div className="small muted" style={{ height: H, display: 'grid', placeItems: 'center' }}>Log at least two days to see the curve.</div>;
  const all = [0, ...points];
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => (i / (all.length - 1)) * W;
  const y = (v: number) => H - 6 - ((v - min) / span) * (H - 12);
  const d = all.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const color = last >= 0 ? 'var(--income)' : 'var(--expense)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="4 4" />
      <motion.path d={`${d} L${W},${H} L0,${H} Z`} fill={color} opacity={0.1} initial={{ opacity: 0 }} animate={{ opacity: 0.1 }} transition={{ duration: 0.6 }} />
      <motion.path d={d} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease }} />
    </svg>
  );
}

