/** Saves voice/typed commands right away (with Undo), or tells the caller which form to open. */
import { useMemo } from 'react';
import { getState, put, remove, nextOccurrence, useStore } from './store';
import { setUi } from './ui';
import { addDays, fromISO, money, num, relativeDay, todayISO, uuid, round2 } from './format';
import { catName, alive } from './calc';
import { complete, type Cmd, type VoiceCtx } from './voice';
import { loadLearned } from './quickparse';
import { payPeriods, periodToPay, periodLabel, rateAt, savePnl, shiftId, writePayout, writeShift } from './tracker';
import { toast } from '../components/ui';
import type { Recurring, Tx, TxType } from './types';

// ---------------------------------------------------------------- settings + 🎤 marks (this device)

const AUTO = 'money:voice-auto';
export const voiceAutoSave = () => { try { return localStorage.getItem(AUTO) !== '0'; } catch { return true; } };
export const setVoiceAutoSave = (on: boolean) => { try { localStorage.setItem(AUTO, on ? '1' : '0'); } catch { /* ignore */ } };

const MARKS = 'money:voice-ids';
const marks = (): string[] => { try { return JSON.parse(localStorage.getItem(MARKS) ?? '[]'); } catch { return []; } };
const saveMarks = (ids: string[]) => { try { localStorage.setItem(MARKS, JSON.stringify(ids.slice(-300))); } catch { /* ignore */ } };
export const isVoiceMarked = (id: string) => marks().includes(id);
export const unmarkVoice = (id: string) => { const m = marks(); if (m.includes(id)) saveMarks(m.filter(x => x !== id)); };
const mark = (id: string) => saveMarks([...marks().filter(x => x !== id), id]);
export function useVoiceMarks() {
  const tick = useStore(s => s.transactions); // re-read when transactions change
  return useMemo(() => new Set(marks()), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------- context

export function useVoiceCtx(): Omit<VoiceCtx, 'learned' | 'today'> {
  const accounts = useStore(s => s.accounts);
  const categories = useStore(s => s.categories);
  const txs = useStore(s => s.transactions);
  const jobs = useStore(s => s.jobs);
  const strategies = useStore(s => s.strategies);
  const me = useStore(s => s.user?.id);
  const analytics = useStore(s => !!s.prefs.analytics);
  return useMemo(() => {
    const live = Object.values(categories).filter(c => !c.deleted_at);
    const visible = live.filter(c => !c.archived && !(c.parent_id && categories[c.parent_id]?.archived));
    const since = addDays(todayISO(), -120);
    const usage = new Map<string, number>();
    for (const t of Object.values(txs)) {
      if (t.deleted_at || t.owner_id !== me || !t.category_id || t.date < since) continue;
      usage.set(t.category_id, (usage.get(t.category_id) ?? 0) + 1);
      const p = categories[t.category_id]?.parent_id;
      if (p) usage.set(p, (usage.get(p) ?? 0) + 1);
    }
    return {
      accounts: Object.values(accounts).filter(a => !a.deleted_at && !a.archived && a.owner_id === me),
      categories: visible, usage,
      // work + trading only for the account that has the Tracker
      jobs: analytics ? alive(jobs).filter(j => !j.archived) : [],
      strategies: analytics ? alive(strategies).filter(s => !s.archived) : [],
      hasShift: (jobId: string, date: string) => { const sh = getState().shifts[shiftId(jobId, date)]; return !!sh && !sh.deleted_at; },
    };
  }, [accounts, categories, txs, jobs, strategies, me, analytics]);
}
export const fullCtx = (c: Omit<VoiceCtx, 'learned' | 'today'>): VoiceCtx => ({ ...c, learned: loadLearned(), today: todayISO() });

// ---------------------------------------------------------------- run

function defaultAccount(type: TxType, not?: string | null): string | null {
  const st = getState();
  const mine = Object.values(st.accounts).filter(a => !a.deleted_at && !a.archived && a.owner_id === st.user?.id && a.id !== not);
  let last: string | null = null;
  try { last = localStorage.getItem('money:lastacc:' + type); } catch { /* ignore */ }
  return (last && mine.some(a => a.id === last) ? last : null) ?? mine.find(a => a.kind !== 'savings')?.id ?? mine[0]?.id ?? null;
}
const nextSeq = (d: string) => Math.max(0, ...Object.values(getState().transactions).filter(t => t.date === d && !t.deleted_at).map(t => t.seq)) + 1;
const when = (d: string) => (d === todayISO() ? '' : ` · ${relativeDay(d).replace(/^(Today|Yesterday|Tomorrow)$/, m => m.toLowerCase())}`);
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v));

interface Done { label: string; amount: number; undo: () => void; edit?: () => void }

function saveTx(c: Extract<Cmd, { kind: 'tx' }>): Done | null {
  const st = getState();
  const p = c.p;
  const type: TxType = p.type ?? 'expense';
  const to = type === 'transfer' ? p.toAccountId : null;
  const account = p.accountId ?? defaultAccount(type, to);
  if (!account) return null;
  const date = p.date ?? todayISO();
  const tx: Tx = {
    id: uuid(), owner_id: st.user!.id, type, date, amount: round2(p.amount!), account_id: account, to_account_id: to,
    category_id: type === 'transfer' ? null : p.categoryId, note: p.note.trim() || null, recurring_id: null, seq: nextSeq(date),
  };
  let rule: Recurring | null = null;
  if (c.repeat) {
    const anchor = fromISO(date).getDate();
    let next = nextOccurrence(date, c.repeat, anchor);
    for (let i = 0; next <= todayISO() && i < 1000; i++) next = nextOccurrence(next, c.repeat, anchor);
    rule = {
      id: uuid(), owner_id: st.user!.id, type, amount: tx.amount, account_id: account, to_account_id: to, category_id: tx.category_id,
      note: tx.note, freq: c.repeat, anchor_day: anchor, next_date: next, active: true, end_date: c.until, skip_dates: [],
    };
    tx.recurring_id = rule.id;
    put('recurring', rule);
  }
  put('transactions', tx);
  mark(tx.id);
  const what = type === 'transfer' ? `${st.accounts[account]?.name} → ${st.accounts[to!]?.name}` : `${catName(tx.category_id, st.categories, false)} · ${st.accounts[account]?.name}`;
  const rep = c.repeat ? ` · ${c.repeat === 'monthly' ? 'every month' : c.repeat === 'weekly' ? 'every week' : 'every year'}` : '';
  return {
    label: `${what} ${money(tx.amount)}${when(date)}${rep}`, amount: tx.amount,
    undo: () => { remove('transactions', tx.id); if (rule) remove('recurring', rule.id); unmarkVoice(tx.id); },
    edit: () => setUi({ addTx: { editId: tx.id } }),
  };
}

function saveShift(c: Extract<Cmd, { kind: 'shift' }>): Done | null {
  const st = getState();
  const { job, date } = c;
  const prev = st.shifts[shiftId(job.id, date)];
  const existing = prev && !prev.deleted_at ? prev : null;
  const tip = existing?.tips_tx_id ? st.transactions[existing.tips_tx_id] : null;
  const liveTip = tip && !tip.deleted_at ? tip : null;
  const hours = c.hours ?? existing?.hours ?? 0;
  if (job.kind === 'hourly' && hours <= 0) return null;
  const mine = Object.values(st.accounts).filter(a => !a.deleted_at && !a.archived && a.owner_id === st.user?.id);
  const tips = c.tips ?? liveTip?.amount ?? 0;
  const base = job.kind === 'daily' ? c.base ?? existing?.base ?? rateAt(job, date).day ?? 0 : null;
  const bonus = job.kind === 'daily' ? c.bonus ?? existing?.bonus ?? 0 : null;
  const undo = writeShift(job, date, {
    worked: true, hours, base, bonus, tips,
    tipsAccount: liveTip?.account_id ?? job.tips_account_id ?? mine.find(a => /μετρητ|cash/i.test(a.name))?.id ?? mine[0]?.id ?? null,
  });
  const detail = job.kind === 'daily' ? (bonus ? `bonus ${money(bonus)}` : 'worked') : `${num(hours)}h${tips ? ` · tips ${money(tips)}` : ''}`;
  return { label: `${job.name} · ${detail}${when(date)}`, amount: 0, undo, edit: () => setUi({ tab: 'tracker', shiftDay: date }) };
}

function savePnlCmd(c: Extract<Cmd, { kind: 'pnl' }>): Done {
  const prev = savePnl(c.strategy.id, c.date, c.value);
  return {
    label: `${c.strategy.name} ${signed(c.value!)} €${when(c.date)}${prev ? ` (was ${signed(prev.pnl)} €)` : ''}`, amount: 0,
    undo: () => { if (prev) put('pnl', prev); else savePnl(c.strategy.id, c.date, null); },
  };
}

function savePayout(c: Extract<Cmd, { kind: 'payout' }>): Done | null {
  const st = getState();
  const { job } = c;
  const { list } = payPeriods(job, alive(st.shifts), st.payouts, st.transactions);
  const period = periodToPay(list);
  if (!period) { toast(`Nothing owed for ${job.name}`); return { label: '', amount: 0, undo: () => {} }; }
  const owedBase = round2(period.base - period.paidBase), owedBonus = round2(period.bonus - period.paidBonus);
  let amt: number, bon: number;
  const split = job.kind === 'daily' && !!job.bonus_category_id;
  if (c.amount === null && c.bonus === null) { amt = split ? owedBase : period.owed; bon = split ? owedBonus : 0; }
  else if (split && c.bonus === null) { amt = Math.min(c.amount!, Math.max(0, owedBase)); bon = round2(c.amount! - amt); }   // "πρωινή 706" → salary first, the rest is bonus
  else { amt = c.amount ?? 0; bon = split ? c.bonus ?? 0 : 0; if (!split && c.bonus) amt += c.bonus; }
  if (amt <= 0 && bon <= 0) return null;
  let account: string | null = null;
  try { account = localStorage.getItem('money:payacc:' + job.id); } catch { /* ignore */ }
  const mine = Object.values(st.accounts).filter(a => !a.deleted_at && !a.archived && a.owner_id === st.user?.id);
  if (!account || !mine.some(a => a.id === account)) account = mine.find(a => /eurobank|τράπεζ|bank/i.test(a.name))?.id ?? mine[0]?.id ?? null;
  const r = writePayout(job, period, amt, bon, account, c.date);
  const parts = split ? `${money(amt)} + ${money(bon)}` : money(round2(amt + bon));
  return { label: `${job.name} paid ${parts} · ${periodLabel(period)}`, amount: round2(amt + bon), undo: r.undo, edit: () => setUi({ tab: 'tracker' }) };
}

/** Saves what's complete; returns the first command that still needs you (for the caller to open its form). */
export function runVoice(cmds: Cmd[], auto = voiceAutoSave()): Cmd | null {
  if (!cmds.length) return null;
  if (!auto) return cmds[0];
  const done: Done[] = [];
  let open: Cmd | null = null;
  for (const c of cmds) {
    let d: Done | null = null;
    if (complete(c)) d = c.kind === 'tx' ? saveTx(c) : c.kind === 'shift' ? saveShift(c) : c.kind === 'pnl' ? savePnlCmd(c) : savePayout(c);
    if (d) { if (d.label) done.push(d); } else open = open ?? c;
  }
  if (done.length === 1) toast(`✓ ${done[0].label}`, { label: 'Undo', run: done[0].undo }, { onTap: done[0].edit, ms: 6000 });
  else if (done.length > 1) {
    const total = round2(done.reduce((s, d) => s + d.amount, 0));
    toast(`✓ ${done.length} entries${total ? ` · ${money(total)}` : ''}${open ? ' · one needs you' : ''}`, { label: 'Undo', run: () => done.forEach(d => d.undo()) }, { ms: 6000 });
  }
  return open;
}

/** Did the phrase say anything we can use? */
export const understood = (cmds: Cmd[]) => cmds.some(c => c.kind !== 'tx' || c.p.amount !== null || !!c.p.categoryId || !!c.p.accountId || !!c.p.toAccountId);

/** Opens the right place for a command that couldn't be saved by itself. */
export function openFor(c: Cmd) {
  if (c.kind === 'shift') setUi({ addTx: null, tab: 'tracker', shiftDay: c.date });
  else if (c.kind === 'payout') setUi({ addTx: null, tab: 'tracker', payJob: c.job.id });
  else if (c.kind === 'pnl') { setUi({ addTx: null, tab: 'tracker' }); toast(`Say the amount too, e.g. “${c.strategy.name} +8”`); }
}

