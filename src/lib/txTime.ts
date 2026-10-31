import { useSyncExternalStore } from 'react';
import { todayISO } from './format';
import type { Tx } from './types';

/**
 * Optional time of day ("HH:MM") when a transaction kicks in.
 * Kept only on this device (localStorage): a convenience, not data.
 *   tx:   one transaction by id
 *   rule: every occurrence of a repeating rule (a tx's own time wins)
 * Until that time on its date the transaction counts as Planned.
 */
type Times = { tx: Record<string, string>; rule: Record<string, string> };
const KEY = 'money:txtimes';

let times: Times = load();
let version = 0;
const subs = new Set<() => void>();

function load(): Times {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') return { tx: v.tx ?? {}, rule: v.rule ?? {} };
  } catch { /* ignore */ }
  return { tx: {}, rule: {} };
}

function bump() {
  version++;
  subs.forEach(f => f());
  schedule();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(times)); } catch { /* ignore */ }
  bump();
}

export function timeOf(t: Pick<Tx, 'id' | 'recurring_id' | 'virtual'>): string | null {
  if (!t.virtual && times.tx[t.id]) return times.tx[t.id];
  return t.recurring_id ? times.rule[t.recurring_id] ?? null : null;
}

export function setTxTime(id: string, time: string | null) {
  if ((times.tx[id] ?? null) === time) return;
  const tx = { ...times.tx };
  if (time) tx[id] = time; else delete tx[id];
  times = { ...times, tx };
  save();
}

export function setRuleTime(id: string, time: string | null) {
  if ((times.rule[id] ?? null) === time) return;
  const rule = { ...times.rule };
  if (time) rule[id] = time; else delete rule[id];
  times = { ...times, rule };
  save();
}

const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** Planned = dated after today, or today with a time that hasn't come yet. */
export function isPending(t: Tx, today = todayISO()): boolean {
  if (t.date > today) return true;
  if (t.date < today) return false;
  if (today !== todayISO()) return false;   // a past day (month ends for levels): its entries all happened
  const tm = timeOf(t);
  return !!tm && nowHM() < tm;
}

// ---- re-render the moment a timed entry kicks in

let timer: ReturnType<typeof setTimeout> | undefined;
function schedule() {
  clearTimeout(timer);
  const now = new Date();
  const hm = nowHM();
  const later = [...Object.values(times.tx), ...Object.values(times.rule)].filter(x => x > hm).sort()[0];
  // next due time today, else just after midnight
  const at = new Date(now);
  if (later) { const [h, m] = later.split(':').map(Number); at.setHours(h, m, 0, 50); }
  else { at.setDate(at.getDate() + 1); at.setHours(0, 0, 1, 0); }
  timer = setTimeout(bump, Math.min(at.getTime() - now.getTime(), 6 * 3600e3));
}
if (typeof window !== 'undefined') {
  schedule();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) bump(); });
  window.addEventListener('storage', e => { if (e.key === KEY) { times = load(); bump(); } });
}

/** Changes whenever a time is set or one comes due — use it as a memo dependency. */
export function useTimesVersion() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => version);
}
