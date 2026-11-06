import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarRange, ChevronDown, Coins, Settings2, X } from 'lucide-react';
import { useStore, getState } from '../lib/store';
import { alive, catName } from '../lib/calc';
import { goalIds, goalRows } from '../lib/goals';
import { money, round2, shortDate, todayISO } from '../lib/format';
import { DEFAULT_BONUS_PER_SHIFT, DEFAULT_TIPS_PER_SHIFT, useForecast } from '../lib/payForecast';
import { parseNum } from '../sheets/AccountEdit';
import { applySplit, markDone, setSplitPrefs, splitSettings, usePaySplit, type Move, type Split } from '../lib/paySplit';
import { ease, Segmented, Sheet, toast, Toggle } from './ui';
import type { PaySplitPrefs } from '../lib/types';

/** The card that comes up when a pay is entered (not tips): tap it for how to split what the month doesn't need. */
export function PaySplitCard() {
  const split = usePaySplit();
  const [open, setOpen] = useState(false);
  const cats = useStore(s => s.categories);
  useEffect(() => { if (!split) setOpen(false); }, [split]);
  if (!split && !open) return null;
  const sub = !split ? '' : split.toSplit > 0
    ? `${money(split.toSplit)} can go to savings and goals · tap to split`
    : split.spare < 0 ? `All of it stays: the month still needs ${money(-split.spare)} more · tap to see` : 'All of it stays for the month · tap to see';
  const what = split ? [...new Set(split.pays.map(p => catName(p.category_id, cats, false)))].join(' + ') : '';
  return (
    <>
      <AnimatePresence initial={false}>
        {split && (
          <motion.div className="card lumen-card" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease }}
            style={{ paddingBottom: 12 }}>
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <Coins size={18} style={{ color: 'var(--income)', flex: 'none', marginTop: 2 }} />
              <button className="grow" style={{ textAlign: 'left' }} onClick={() => setOpen(true)}>
                <div className="small" style={{ fontWeight: 600 }}>Paid {money(split.payTotal)} · {what}</div>
                <div className="tiny muted">{sub}</div>
              </button>
              <button className="iconbtn" style={{ width: 30, height: 30, flex: 'none' }} aria-label="Dismiss" onClick={() => markDone(split.pays.map(p => p.id))}><X size={16} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Sheet open={open && !!split} onClose={() => setOpen(false)} title="Split the pay">
        {split && <SplitBody split={split} close={() => setOpen(false)} />}
      </Sheet>
    </>
  );
}

function SplitBody({ split, close }: { split: Split; close: () => void }) {
  const [rules, setRules] = useState(false);
  const [fc, setFc] = useState(false);
  const accounts = useStore(s => s.accounts);
  const [showNeeds, setShowNeeds] = useState(false);
  const [showExp, setShowExp] = useState(false);
  // the proposed amounts, editable before accepting (reset when the proposal changes)
  const sig = split.moves.map(m => `${m.key}:${m.amount}`).join('|');
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { setVals(Object.fromEntries(split.moves.map(m => [m.key, String(m.amount)]))); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const moves: Move[] = split.moves.map(m => ({ ...m, amount: vals[m.key] != null ? Math.max(0, parseNum(vals[m.key])) : m.amount }));
  const total = round2(moves.reduce((x, m) => x + m.amount, 0));
  const src = split.source ? accounts[split.source]?.name ?? '' : '';
  const over = split.source ? total > Math.max(0, split.sourceBalance) + 0.004 : false;

  if (rules) return <Rules back={() => setRules(false)} />;
  if (fc) return <ForecastBody back={() => setFc(false)} />;

  const accept = () => {
    const undo = applySplit(split, moves);
    close();
    toast(moves.length ? `Split ${money(total)} from ${src}` : 'Pay marked as split', { label: 'Undo', run: undo });
  };
  const skip = () => { markDone(split.pays.map(p => p.id)); close(); };

  return (
    <div className="sheet-body">
      <div className="card" style={{ padding: '12px 14px' }}>
        <Line label="Paid" value={split.payTotal} bold />
        <button className="row" style={{ width: '100%', padding: '6px 0', alignItems: 'baseline', textAlign: 'left' }} onClick={() => setShowNeeds(v => !v)}>
          <span className="grow small">The month still needs</span>
          <motion.span animate={{ rotate: showNeeds ? 180 : 0 }} style={{ display: 'grid', marginRight: 6, color: 'var(--ink-3)' }}><ChevronDown size={16} /></motion.span>
          <span className="num small">{money(split.needTotal)}</span>
        </button>
        <AnimatePresence initial={false}>
          {showNeeds && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease }} style={{ overflow: 'hidden' }}>
              <div style={{ padding: '2px 0 6px 10px', borderLeft: '2px solid var(--line)', marginBottom: 4 }}>
                {split.needs.map(n => (
                  <div key={n.id} className="row tiny" style={{ justifyContent: 'space-between', padding: '3px 0', gap: 8 }}>
                    <span className="ellipsis muted">{n.label}</span><span className="num">{money(n.amount)}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <Line label="In your accounts now" value={split.available} />
        {split.expected.length > 0 && (
          <>
            <button className="row" style={{ width: '100%', padding: '6px 0', alignItems: 'baseline', textAlign: 'left' }} onClick={() => setShowExp(v => !v)}>
              <span className="grow small">Expected this month</span>
              <motion.span animate={{ rotate: showExp ? 180 : 0 }} style={{ display: 'grid', marginRight: 6, color: 'var(--ink-3)' }}><ChevronDown size={16} /></motion.span>
              <span className="num small">{money(split.expectedTotal)}</span>
            </button>
            <AnimatePresence initial={false}>
              {showExp && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease }} style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '2px 0 6px 10px', borderLeft: '2px solid var(--line)', marginBottom: 4 }}>
                    {split.expected.map(e => (
                      <div key={e.id} style={{ padding: '3px 0' }}>
                        <div className="row tiny" style={{ justifyContent: 'space-between', gap: 8 }}>
                          <span className="ellipsis muted">{e.label}</span><span className="num">{money(e.amount)}</span>
                        </div>
                        {e.planned > 0 && <div className="tiny faint num">{money(e.worked)} worked + {money(e.planned)} planned shifts</div>}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 6 }}>
          <Line label={split.spare >= 0 ? 'Spare after the month' : 'Short for the month'} value={split.spare} bold color={split.spare >= 0 ? 'var(--income)' : 'var(--expense)'} />
        </div>
      </div>

      {split.toSplit <= 0 ? (
        <div className="small muted" style={{ padding: '14px 4px' }}>
          {split.spare < 0 ? `Nothing to put aside: keep all of it — the month needs ${money(-split.spare)} more than you have and expect.` : 'Nothing to put aside: this pay covers the month.'}
        </div>
      ) : (
        <div className="section">
          <div className="section-head"><span className="section-title">Put aside {money(total)}</span>{src && <span className="tiny muted">from {src}</span>}</div>
          <div className="list">
            {moves.map(m => (
              <div key={m.key} className="list-row" style={{ gap: 10 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 550 }}>{m.label}</div>
                  <div className="tiny muted">{m.kind === 'reserve' ? 'transfer' : 'goal entry'}</div>
                </div>
                <input className="input num" inputMode="decimal" aria-label={m.label} value={vals[m.key] ?? ''} onChange={e => setVals(v => ({ ...v, [m.key]: e.target.value }))}
                  style={{ width: 96, height: 42, textAlign: 'right' }} />
                <span className="small muted">€</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {split.notes.map(n => <div key={n} className="tiny muted" style={{ padding: '4px 4px 0' }}>{n}</div>)}
      {over && <div className="tiny" style={{ color: 'var(--expense)', padding: '4px 4px 0' }}>More than {src} has ({money(split.sourceBalance)}).</div>}

      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        {split.toSplit > 0 && <button className="btn" disabled={over || total <= 0} onClick={accept}>Accept</button>}
        <button className="btn secondary" onClick={() => setFc(true)}><CalendarRange size={18} />Forecast</button>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary" onClick={() => setRules(true)}><Settings2 size={18} />Rules</button>
          <button className="btn secondary" onClick={skip}>{split.toSplit > 0 ? 'Skip this pay' : 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, bold, color }: { label: string; value: number; bold?: boolean; color?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0', alignItems: 'baseline' }}>
      <span className="small" style={{ fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span className="num small" style={{ fontWeight: bold ? 650 : 500, color }}>{money(value)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- rules

type GoalRule = Omit<NonNullable<PaySplitPrefs['goals']>[number], 'value'> & { value: string };

function Rules({ back }: { back: () => void }) {
  const st = getState();
  const cfg = useMemo(() => splitSettings(st), []); // eslint-disable-line react-hooks/exhaustive-deps
  const me = useStore(s => s.user?.id);
  const accounts = useStore(s => s.accounts);
  const prefs = useStore(s => s.prefs);
  const cats = useStore(s => s.categories);
  const txs = useStore(s => s.transactions);
  const trading = new Set(prefs.tradingAccounts ?? []), invest = new Set(prefs.investmentAccounts ?? []);
  const mine = alive(accounts).filter(a => a.owner_id === me && !a.archived && !trading.has(a.id) && !invest.has(a.id)).sort((a, b) => a.sort - b.sort);
  const regular = mine.filter(a => a.kind === 'regular');
  const openGoals = goalRows({ prefs, categories: cats, transactions: txs }).filter(g => !g.doneOn);
  const allGoals = [...goalIds(prefs.goals, cats)].filter(id => !cats[id]?.deleted_at);

  const [margin, setMargin] = useState(String(cfg.margin));
  const [sources, setSources] = useState<string[]>(cfg.sources);
  const [resAcc, setResAcc] = useState(cfg.reserve.account ?? '');
  const [resMode, setResMode] = useState(cfg.reserve.mode);
  const [resVal, setResVal] = useState(String(cfg.reserve.value));
  const [matchGoal, setMatchGoal] = useState(cfg.match.goal ?? '');
  const [matchVal, setMatchVal] = useState(String(cfg.match.monthly));
  const [goals, setGoals] = useState<GoalRule[]>(cfg.goals.map(g => ({ ...g, value: String(g.value) })));

  const goalOn = (id: string) => goals.find(g => g.id === id);
  const setGoal = (id: string, patch: Partial<GoalRule> | null) => setGoals(list => {
    if (patch === null) return list.filter(g => g.id !== id);
    const have = list.find(g => g.id === id);
    return have ? list.map(g => (g.id === id ? { ...g, ...patch } : g)) : [...list, { id, mode: 'share', value: '1', ...patch }];
  });

  const save = () => {
    setSplitPrefs({
      margin: Math.max(0, parseNum(margin)), sources,
      reserve: { account: resAcc || null, mode: resMode, value: Math.max(0, parseNum(resVal)) },
      match: { goal: matchGoal || null, monthly: Math.max(0, parseNum(matchVal)) },
      goals: goals.filter(g => g.id !== matchGoal).map(g => ({ ...g, value: Math.max(0, parseNum(g.value)) })),
    });
    back();
  };

  return (
    <div className="sheet-body">
      <div className="tiny muted" style={{ padding: '0 4px 12px' }}>
        On each pay (not tips) what the rest of the month needs stays where it is, plus anything planned for the 1st–5th of the next. What's spare goes, in this order: matching → reserve → goals.
      </div>

      <div className="field"><label>Safety margin on top of the month (€)</label>
        <input className="input num" inputMode="decimal" value={margin} onChange={e => setMargin(e.target.value)} /></div>

      <div className="field"><label>Move the money out of</label>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {regular.map(a => {
            const on = sources.includes(a.id);
            return <button key={a.id} className={`chip ${on ? 'on' : ''}`} onClick={() => setSources(l => (on ? l.filter(x => x !== a.id) : [...l, a.id]))}>{a.name}</button>;
          })}
        </div>
        <span className="tiny faint" style={{ paddingLeft: 4 }}>The account the pay came into, if it's one of these; else the one of these with the most money.</span>
      </div>

      <div className="section-head" style={{ marginTop: 6 }}><span className="section-title">1 · Matching</span></div>
      <div className="field"><label>Goal you put in what your partner did</label>
        <select className="input" value={matchGoal} onChange={e => setMatchGoal(e.target.value)}>
          <option value="">None</option>
          {allGoals.map(id => <option key={id} value={id}>{catName(id, cats)}</option>)}
        </select></div>
      {matchGoal && (
        <div className="field"><label>Each month, when you don't know their amount yet (€)</label>
          <input className="input num" inputMode="decimal" value={matchVal} onChange={e => setMatchVal(e.target.value)} />
          <span className="tiny faint" style={{ paddingLeft: 4 }}>If they've put in more than you, it proposes the difference instead.</span></div>
      )}

      <div className="section-head" style={{ marginTop: 6 }}><span className="section-title">2 · Reserve</span></div>
      <div className="field"><label>Account</label>
        <select className="input" value={resAcc} onChange={e => setResAcc(e.target.value)}>
          <option value="">None</option>
          {mine.filter(a => a.kind !== 'credit').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></div>
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <Segmented value={resMode} onChange={setResMode} style={{ width: 120, flex: 'none' }} options={[{ value: 'eur', label: '€' }, { value: 'pct', label: '%' }]} />
        <input className="input num" inputMode="decimal" aria-label="Reserve amount" value={resVal} onChange={e => setResVal(e.target.value)} style={{ height: 44 }} />
      </div>
      <div className="tiny faint" style={{ padding: '0 4px 12px', marginTop: -8 }}>{resMode === 'eur' ? 'Per pay.' : '% of what\'s spare.'} Also gets what's left when no goal is active.</div>

      <div className="section-head" style={{ marginTop: 6 }}><span className="section-title">3 · Goals</span></div>
      {openGoals.filter(g => g.id !== matchGoal).length === 0 && <div className="tiny muted" style={{ padding: '0 4px 12px' }}>No open goals with a target.</div>}
      <div className="list">
        {openGoals.filter(g => g.id !== matchGoal).map(g => {
          const r = goalOn(g.id);
          return (
            <div key={g.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="row" style={{ gap: 10 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 550 }}>{g.name}</div>
                  <div className="tiny muted num">{money(round2(g.target - g.saved))} to go</div>
                </div>
                <Toggle on={!!r} onChange={on => setGoal(g.id, on ? {} : null)} />
              </div>
              {r && (
                <div className="row" style={{ gap: 8 }}>
                  <Segmented value={r.mode} onChange={mode => setGoal(g.id, { mode })} style={{ width: 170, flex: 'none' }}
                    options={[{ value: 'share', label: 'Share' }, { value: 'eur', label: '€' }, { value: 'pct', label: '%' }]} />
                  <input className="input num" inputMode="decimal" aria-label={`${g.name} amount`} value={r.value}
                    onChange={e => setGoal(g.id, { value: e.target.value })} style={{ height: 44 }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="tiny faint" style={{ padding: '6px 4px 0' }}>€ and % come first. Share: what's left is split between these by their numbers (1 and 1 = half each).</div>

      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={save}>Save</button>
        <button className="btn secondary" onClick={back}>Back</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- forecast

/** The forecast on its own, from anywhere (e.g. the Goals card). */
export function ForecastSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title="Pay forecast">{open && <ForecastBody />}</Sheet>;
}

function ForecastBody({ back }: { back?: () => void }) {
  const f = useForecast(true);
  const prefs = useStore(s => s.prefs.paySplit?.forecast);
  const [until, setUntil] = useState(prefs?.until ?? '');
  const [bonus, setBonus] = useState(String(prefs?.bonusPerShift ?? DEFAULT_BONUS_PER_SHIFT));
  const [tips, setTips] = useState(String(prefs?.tipsPerShift ?? DEFAULT_TIPS_PER_SHIFT));
  const save = (patch: { until?: string | null; bonusPerShift?: number; tipsPerShift?: number }) =>
    setSplitPrefs({ forecast: { ...(getState().prefs.paySplit?.forecast ?? {}), ...patch } });
  if (!f) return null;
  return (
    <div className="sheet-body">
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow" style={{ minWidth: 0 }}><label>Until</label>
          <input className="input" type="date" value={until || f.until} min={todayISO()} onChange={e => { setUntil(e.target.value); save({ until: e.target.value || null }); }} style={{ height: 44 }} /></div>
        <div className="field" style={{ width: 92 }}><label>Bonus/shift</label>
          <input className="input num" inputMode="decimal" aria-label="Bonus per shift" value={bonus} onChange={e => setBonus(e.target.value)} onBlur={() => save({ bonusPerShift: Math.max(0, parseNum(bonus)) })} style={{ height: 44 }} /></div>
        <div className="field" style={{ width: 92 }}><label>Tips/shift</label>
          <input className="input num" inputMode="decimal" aria-label="Tips per shift" value={tips} onChange={e => setTips(e.target.value)} onBlur={() => save({ tipsPerShift: Math.max(0, parseNum(tips)) })} style={{ height: 44 }} /></div>
      </div>
      {until && <button className="tiny" style={{ color: 'var(--accent)', padding: '0 4px 10px' }} onClick={() => { setUntil(''); save({ until: null }); }}>Back to: as far as your shifts go</button>}

      {f.goals.length > 0 && (
        <div className="card" style={{ padding: '10px 14px' }}>
          {f.goals.map(g => (
            <div key={g.id} className="row" style={{ justifyContent: 'space-between', padding: '5px 0', gap: 8 }}>
              <span className="small ellipsis" style={{ fontWeight: 600 }}>{g.name} <span className="tiny muted num">{money(g.left)} to go</span></span>
              <span className="small num" style={{ fontWeight: 650, color: g.closes ? 'var(--income)' : 'var(--ink-3)', flex: 'none' }}>{g.closes ? shortDate(g.closes) : 'not by then'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <div className="section-head"><span className="section-title">Pays until {shortDate(f.until)}</span></div>
        {f.events.length === 0 && <div className="tiny muted" style={{ padding: '0 4px' }}>No pays expected by then — declare your shifts in the Tracker.</div>}
        <div className="list">
          {f.events.map((e, i) => (
            <motion.div key={e.date + e.label} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease, delay: Math.min(i * 0.03, 0.3) }}>
              <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                <span className="small num muted" style={{ width: 52, flex: 'none' }}>{e.today ? 'Today' : shortDate(e.date)}</span>
                <span className="grow ellipsis" style={{ fontWeight: 550 }}>{e.today ? 'This pay' : e.label}</span>
                <span className="num small" style={{ fontWeight: 650 }}>{money(e.amount)}</span>
              </div>
              <div className="tiny muted" style={{ paddingLeft: 60 }}>
                {e.moves.length
                  ? e.moves.map(m => `${m.label.replace(' · matching', '')} ${money(m.amount)}`).join(' · ')
                  : e.spare < 0 ? `all of it stays · month short ${money(-e.spare)}` : 'all of it stays for the month'}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      <div className="tiny faint" style={{ padding: '8px 4px 0' }}>
        Assumes you spend what your budgets (and your usual for the rest) say, every declared shift happens, {money(f.tips)} tips per evening shift, the bonus per morning shift above, and your partner matches what you put into the shared goal. The credit card is paid off once from today's money. Morning pays on the 10th, evening on the 16th and the 1st.
      </div>
      {back && <button className="btn secondary" style={{ marginTop: 16 }} onClick={back}>Back</button>}
    </div>
  );
}
