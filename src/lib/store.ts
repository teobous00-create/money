import { useSyncExternalStore, useRef } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Session } from '@supabase/supabase-js';
import { supabase, REMOTE } from './supabase';
import type { Account, Category, Member, Person, Profile, Recurring, Table, TableRow, Tx } from './types';
import { addDays, todayISO, fromISO, toISO, uuid } from './format';
import type { Period } from './period';

type Rec<T> = Record<string, T>;

export interface State {
  phase: 'loading' | 'auth' | 'ready';
  user: { id: string; email: string | null } | null;
  accounts: Rec<Account>;
  categories: Rec<Category>;
  transactions: Rec<Tx>;
  recurring: Rec<Recurring>;
  profiles: Rec<Profile>;
  members: Member[]; // shared category memberships visible to me
  pending: number;
  failed: number;
  syncing: boolean;
  online: boolean;
  lastSync: string | null;
  // UI state (per device)
  period: Period;
  accountFilter: string[] | null; // null = default selection
}

interface Op { table: Table; row: Record<string, unknown> }

let state: State = {
  phase: 'loading',
  user: null,
  accounts: {}, categories: {}, transactions: {}, recurring: {}, profiles: {}, members: [],
  pending: 0, failed: 0, syncing: false, online: navigator.onLine, lastSync: null,
  period: { mode: 'month', anchor: todayISO() },
  accountFilter: null,
};

const listeners = new Set<() => void>();
export const getState = () => state;
function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** Subscribe to a slice of state. The selector result is compared shallowly by identity. */
export function useStore<T>(selector: (s: State) => T): T {
  const sel = useRef(selector);
  sel.current = selector;
  return useSyncExternalStore(subscribe, () => sel.current(state));
}

// ---------------------------------------------------------------- persistence

let queue: Op[] = [];
let failedOps: Op[] = [];
const cacheKey = () => `money:v1:${state.user?.id ?? 'none'}`;
const queueKey = () => `money:queue:${state.user?.id ?? 'none'}`;
const uiKey = 'money:ui';

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
async function saveNow() {
  if (!state.user) return;
  const { accounts, categories, transactions, recurring, profiles, members, lastSync } = state;
  await idbSet(cacheKey(), { accounts, categories, transactions, recurring, profiles, members, lastSync });
  await idbSet(queueKey(), { queue, failedOps });
}

function saveUi() {
  try { localStorage.setItem(uiKey, JSON.stringify({ accountFilter: state.accountFilter, mode: state.period.mode })); } catch { /* ignore */ }
}
function loadUi() {
  try {
    const raw = localStorage.getItem(uiKey);
    if (!raw) return;
    const v = JSON.parse(raw);
    setState({ accountFilter: v.accountFilter ?? null, period: { mode: v.mode ?? 'month', anchor: todayISO() } });
  } catch { /* ignore */ }
}

async function loadCache() {
  const c = await idbGet(cacheKey());
  const q = await idbGet(queueKey());
  queue = q?.queue ?? [];
  failedOps = q?.failedOps ?? [];
  if (c) {
    setState({
      accounts: c.accounts ?? {}, categories: c.categories ?? {}, transactions: c.transactions ?? {},
      recurring: c.recurring ?? {}, profiles: c.profiles ?? {}, members: c.members ?? [], lastSync: c.lastSync ?? null,
    });
  } else {
    setState({ accounts: {}, categories: {}, transactions: {}, recurring: {}, profiles: {}, members: [], lastSync: null });
  }
  setState({ pending: queue.length, failed: failedOps.length });
}

// ---------------------------------------------------------------- auth / boot

export async function boot() {
  loadUi();
  window.addEventListener('online', () => { setState({ online: true }); void sync(); });
  window.addEventListener('offline', () => setState({ online: false }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void sync(); });

  if (!REMOTE) {
    setState({ user: { id: 'local', email: null } });
    await loadCache();
    setState({ phase: 'ready' });
    runLocalRecurring();
    return;
  }
  const { data } = await supabase!.auth.getSession();
  await onSession(data.session);
  supabase!.auth.onAuthStateChange((_e, session) => {
    if ((session?.user.id ?? null) !== (state.user?.id ?? null)) void onSession(session);
  });
}

async function onSession(session: Session | null) {
  if (!session) {
    queue = []; failedOps = [];
    setState({ user: null, phase: 'auth', accounts: {}, categories: {}, transactions: {}, recurring: {}, profiles: {}, members: [], lastSync: null });
    return;
  }
  setState({ user: { id: session.user.id, email: session.user.email ?? null } });
  await loadCache();
  setState({ phase: 'ready' });
  void sync();
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}
export async function signUp(email: string, password: string, name: string) {
  const { data, error } = await supabase!.auth.signUp({
    email: email.trim(), password,
    options: { data: { display_name: name.trim() || undefined }, emailRedirectTo: window.location.href.split('#')[0] },
  });
  if (error) throw error;
  if (!data.session) throw new Error('Account created. Open the confirmation email from Supabase, tap the link, then sign in here.');
}
export async function signOut() {
  await saveNow();
  await supabase?.auth.signOut();
}

// ---------------------------------------------------------------- mutations

const now = () => new Date().toISOString();

export function put<K extends Table>(table: K, row: TableRow[K]) {
  putMany(table, [row]);
}

export function putMany<K extends Table>(table: K, rows: TableRow[K][]) {
  if (!rows.length) return;
  const next = { ...(state[table] as Rec<TableRow[K]>) };
  for (const r of rows) {
    const row = { ...r, owner_id: r.owner_id || state.user!.id, updated_at: now() } as TableRow[K];
    next[row.id] = row;
    if (REMOTE) queue.push({ table, row: toDb(table, row) });
  }
  setState({ [table]: next, pending: queue.length } as Partial<State>);
  scheduleSave();
  scheduleFlush();
}

export function remove(table: Table, id: string) {
  const row = (state[table] as Rec<{ id: string }>)[id];
  if (!row) return;
  const del = now();
  if (table === 'accounts') {
    const txs = Object.values(state.transactions).filter(t => !t.deleted_at && (t.account_id === id || t.to_account_id === id));
    putMany('transactions', txs.map(t => ({ ...t, deleted_at: del })));
    const recs = Object.values(state.recurring).filter(r => !r.deleted_at && (r.account_id === id || r.to_account_id === id));
    putMany('recurring', recs.map(r => ({ ...r, deleted_at: del })));
  }
  if (table === 'categories') {
    const kids = Object.values(state.categories).filter(c => c.parent_id === id && !c.deleted_at);
    putMany('categories', kids.map(c => ({ ...c, deleted_at: del })));
  }
  put(table, { ...(row as object), deleted_at: del } as never);
}

export function restore(table: Table, id: string) {
  const row = (state[table] as Rec<{ id: string }>)[id];
  if (row) put(table, { ...(row as object), deleted_at: null } as never);
}

/** Removes every row you own (used before re-importing). */
export function wipeMyData() {
  const del = now();
  const me = state.user!.id;
  (['transactions', 'recurring', 'categories', 'accounts'] as Table[]).forEach(t => {
    const rows = Object.values(state[t] as Rec<TableRow[Table]>).filter(r => r.owner_id === me && !r.deleted_at);
    putMany(t, rows.map(r => ({ ...r, deleted_at: del })) as never);
  });
}

export function setPeriod(period: Period) { setState({ period }); saveUi(); }
export function setAccountFilter(ids: string[] | null) { setState({ accountFilter: ids }); saveUi(); }

// columns that exist in the database, per table
const COLS: Record<Table, string[]> = {
  accounts: ['id', 'owner_id', 'name', 'kind', 'icon', 'color', 'opening_balance', 'credit_limit', 'goal', 'archived', 'sort', 'deleted_at'],
  categories: ['id', 'owner_id', 'type', 'name', 'parent_id', 'icon', 'color', 'sort', 'archived', 'deleted_at'],
  transactions: ['id', 'owner_id', 'type', 'date', 'amount', 'account_id', 'to_account_id', 'category_id', 'note', 'recurring_id', 'seq', 'deleted_at'],
  recurring: ['id', 'owner_id', 'type', 'amount', 'account_id', 'to_account_id', 'category_id', 'note', 'freq', 'anchor_day', 'next_date', 'active', 'end_date', 'skip_dates', 'deleted_at'],
};
function toDb(table: Table, row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of COLS[table]) out[c] = (row as Record<string, unknown>)[c] ?? (c === 'skip_dates' ? [] : null);
  return out;
}
const NUMERIC = ['opening_balance', 'credit_limit', 'goal', 'amount'];
function fromDb<T>(row: Record<string, unknown>): T {
  for (const k of NUMERIC) if (row[k] != null) row[k] = Number(row[k]);
  return row as T;
}

// ---------------------------------------------------------------- sync

let flushTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleFlush() {
  if (!REMOTE) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), 600);
}

let flushing: Promise<void> | null = null;
async function flush(): Promise<void> {
  if (!REMOTE || !state.user || !queue.length) return;
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const order: Table[] = ['accounts', 'categories', 'transactions', 'recurring'];
      while (queue.length && navigator.onLine) {
        const snapshot = queue.slice();
        // coalesce: last write per (table,id) wins
        const latest = new Map<string, Op>();
        for (const op of snapshot) latest.set(op.table + ':' + op.row.id, op);
        let failedThisRound = false;
        for (const table of order) {
          const rows = [...latest.values()].filter(o => o.table === table).map(o => o.row);
          for (let i = 0; i < rows.length; i += 500) {
            const batch = rows.slice(i, i + 500);
            const { error } = await supabase!.from(table).upsert(batch, { onConflict: 'id' });
            if (error) {
              if (isNetworkError(error)) { failedThisRound = true; break; }
              // rejected by the database (permissions / validation): park these so the queue can't get stuck
              console.warn('sync rejected', table, error);
              failedOps.push(...batch.map(row => ({ table, row })));
            }
          }
          if (failedThisRound) break;
        }
        if (failedThisRound) break;
        queue = queue.slice(snapshot.length);
        setState({ pending: queue.length, failed: failedOps.length });
        await saveNow();
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

function isNetworkError(e: { message?: string; code?: string }) {
  return !navigator.onLine || /fetch|network|Failed to|timeout|Load failed/i.test(e.message ?? '') || e.code === '';
}

export function discardFailed() {
  failedOps = [];
  setState({ failed: 0 });
  scheduleSave();
}

let syncing: Promise<void> | null = null;
export function sync(): Promise<void> {
  if (!REMOTE || !state.user || !navigator.onLine) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    setState({ syncing: true });
    try {
      await flush();
      await runRemoteRecurring();
      await pull();
    } catch (e) {
      console.warn('sync failed', e);
    } finally {
      setState({ syncing: false });
      syncing = null;
    }
  })();
  return syncing;
}

async function fetchAll(table: string, since: string | null) {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase!.from(table).select('*').order('updated_at', { ascending: true }).range(from, from + 999);
    if (since) q = q.gte('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function pull() {
  const { data: mem, error: memErr } = await supabase!.from('category_members').select('category_id,user_id');
  if (memErr) throw memErr;
  const members = (mem ?? []) as Member[];
  const fp = (ms: Member[]) => ms.map(m => m.category_id + m.user_id).sort().join('|');
  // if sharing changed, rows that are "old" may have become visible → full pull
  const full = !state.lastSync || fp(members) !== fp(state.members);
  const since = full ? null : new Date(new Date(state.lastSync!).getTime() - 120_000).toISOString();

  const [acc, cat, tx, rec, prof] = await Promise.all([
    fetchAll('accounts', since), fetchAll('categories', since), fetchAll('transactions', since),
    fetchAll('recurring', since), supabase!.from('profiles').select('id,email,display_name'),
  ]);
  const pendingIds = new Set(queue.map(o => o.table + ':' + o.row.id));
  let maxTs = state.lastSync ?? '';
  const merge = <T extends { id: string; updated_at?: string }>(table: Table, current: Rec<T>, rows: Record<string, unknown>[]) => {
    const next: Rec<T> = full ? {} : { ...current };
    if (full) for (const [id, r] of Object.entries(current)) if (pendingIds.has(table + ':' + id)) next[id] = r;
    for (const raw of rows) {
      const r = fromDb<T>(raw);
      if (r.updated_at && r.updated_at > maxTs) maxTs = r.updated_at;
      if (pendingIds.has(table + ':' + r.id)) continue;
      next[r.id] = r;
    }
    return next;
  };
  const profiles: Rec<Profile> = {};
  for (const p of (prof.data ?? []) as Profile[]) profiles[p.id] = p;
  setState({
    accounts: merge('accounts', state.accounts, acc),
    categories: merge('categories', state.categories, cat),
    transactions: merge('transactions', state.transactions, tx),
    recurring: merge('recurring', state.recurring, rec),
    profiles, members, lastSync: maxTs || state.lastSync || new Date().toISOString(),
  });
  scheduleSave();
}

// ---------------------------------------------------------------- recurring

let lastRecurringRun = '';
async function runRemoteRecurring() {
  const t = todayISO();
  if (lastRecurringRun === t) return;
  const { error } = await supabase!.rpc('post_due_recurring');
  if (!error) lastRecurringRun = t;
}

export function nextOccurrence(date: string, freq: Recurring['freq'], anchor: number): string {
  if (freq === 'weekly') return addDays(date, 7);
  const d = fromISO(date);
  const n = freq === 'monthly' ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : new Date(d.getFullYear() + 1, d.getMonth(), 1);
  const last = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
  return toISO(new Date(n.getFullYear(), n.getMonth(), Math.min(anchor, last)));
}

/** Local-only mode: post due recurring entries on the device. */
function runLocalRecurring() {
  const t = todayISO();
  const txs: Tx[] = [];
  const recs: Recurring[] = [];
  for (const r of Object.values(state.recurring)) {
    if (!r.active || r.deleted_at || r.next_date > t) continue;
    let next = r.next_date;
    while (next <= t && (!r.end_date || next <= r.end_date)) {
      if ((r.skip_dates ?? []).includes(next)) { next = nextOccurrence(next, r.freq, r.anchor_day); continue; }
      txs.push({
        id: uuid(), owner_id: r.owner_id, type: r.type, date: next, amount: r.amount, account_id: r.account_id,
        to_account_id: r.to_account_id, category_id: r.category_id, note: r.note, recurring_id: r.id, seq: 0,
      });
      next = nextOccurrence(next, r.freq, r.anchor_day);
    }
    recs.push({ ...r, next_date: next });
  }
  putMany('transactions', txs);
  putMany('recurring', recs);
}

// ---------------------------------------------------------------- sharing

export async function shareCategory(categoryId: string, email: string): Promise<string> {
  await flush(); // the category must exist on the server first
  const { data, error } = await supabase!.rpc('share_category', { cat: categoryId, member_email: email });
  if (error) throw error;
  await pull();
  return data as string;
}

export async function unshareCategory(categoryId: string, userId: string) {
  const { error } = await supabase!.from('category_members').delete().match({ category_id: categoryId, user_id: userId });
  if (error) throw error;
  await pull();
}

export async function categoryPeople(categoryId: string): Promise<Person[]> {
  const { data, error } = await supabase!.rpc('category_people', { cat: categoryId });
  if (error) throw error;
  return ((data ?? []) as Array<{ user_id: string; email: string; display_name: string; is_owner: boolean }>)
    .map(r => ({ id: r.user_id, email: r.email, display_name: r.display_name, is_owner: r.is_owner }));
}

/** Saves a new display order (sort = position) for categories, writing only those that moved. */
export function saveCategoryOrder(ids: string[]) {
  const rows = ids.map((id, i) => ({ c: state.categories[id], i }))
    .filter(({ c, i }) => c && c.sort !== i)
    .map(({ c, i }) => ({ ...c, sort: i }));
  putMany('categories', rows);
}
