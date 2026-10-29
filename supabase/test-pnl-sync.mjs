// node supabase/test-pnl-sync.mjs — the "pnl-sync" Edge Function's rules, with Supabase mocked
import { build } from 'rolldown';
const out = '/tmp/claude-0/pnlsync.mjs';
await build({ input: 'supabase/functions/pnl-sync/index.ts', output: { file: out, format: 'esm' }, logLevel: 'silent' });
const { handle } = await import(out + '?' + Date.now());
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); };
const KEY = 'k'.repeat(32);
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_1"}', PNL_SYNC_KEY: KEY };
function world({ owners = ['teo'], strategies = [{ id: 's1', name: 'DEEP DIP GOLD' }, { id: 's2', name: 'Gold Sniper' }], writeStatus = 201 } = {}) {
  const w = { calls: [], written: null };
  w.f = async (url, init = {}) => {
    w.calls.push({ url, init });
    if (url.includes('/rest/v1/user_prefs')) return new Response(JSON.stringify(owners.map(user_id => ({ user_id }))), { status: 200 });
    if (url.includes('/rest/v1/strategies')) { w.stratUrl = url; return new Response(JSON.stringify(strategies), { status: 200 }); }
    if (url.includes('/rest/v1/pnl') && init.method === 'POST') { w.written = JSON.parse(init.body); w.writeInit = init; return new Response('', { status: writeStatus }); }
    return new Response('?', { status: 404 });
  };
  return w;
}
const req = (body, key = KEY) => new Request('https://fn/pnl-sync', { method: 'POST', headers: { 'x-sync-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const days = [{ strategy: 'DEEP DIP GOLD', date: '2026-10-28', pnl: -12.404 }, { strategy: 'gold  sniper', date: '2026-10-28', pnl: 8 }, { strategy: 'Nope', date: '2026-10-28', pnl: 1 }, { strategy: 'DEEP DIP GOLD', date: '28/10', pnl: 1 }];

let w = world(); let r = await handle(req({ days }), env, w.f); let j = await r.json();
ok(r.status === 200 && j.saved === 2, 'saves the known strategies: ' + JSON.stringify(j));
ok(w.written[0].id === 's1:2026-10-28' && w.written[0].pnl === -12.4 && w.written[0].owner_id === 'teo' && w.written[0].deleted_at === null, 'row id strategy:date, rounded, owner Teo, undeleted');
ok(w.written[1].strategy_id === 's2', 'name match ignores case and extra spaces');
ok(/merge-duplicates/.test(w.writeInit.headers.Prefer) && /on_conflict=id/.test(w.calls.at(-1).url), 'replaces the day, never adds');
ok(j.unknown_strategies.join() === 'Nope' && j.bad === 1, 'reports unknown strategy names and bad rows');
ok(/owner_id=eq\.teo/.test(w.stratUrl) && /deleted_at=is\.null/.test(w.stratUrl), 'only Teo\'s live strategies');
w = world(); r = await handle(req({ days }, 'wrong'.padEnd(32, 'x')), env, w.f);
ok(r.status === 401 && !w.written, 'wrong key refused, nothing written');
w = world(); r = await handle(req({ days }, ''), env, w.f);
ok(r.status === 401, 'no key refused');
w = world(); r = await handle(req({ days }), { ...env, PNL_SYNC_KEY: undefined }, w.f);
ok(r.status === 503, 'secret not set → clear error');
w = world({ owners: ['a', 'b'] }); r = await handle(req({ days }), env, w.f);
ok(r.status === 409 && !w.written, 'two analytics accounts → refuses rather than guess');
w = world(); r = await handle(req({ days: [] }), env, w.f); j = await r.json();
ok(r.status === 200 && j.saved === 0 && !w.written, 'nothing to save is fine');
w = world({ writeStatus: 400 }); r = await handle(req({ days }), env, w.f);
ok(r.status === 502, 'database error passed on');
w = world(); r = await handle(new Request('https://fn/pnl-sync', { method: 'GET' }), env, w.f);
ok(r.status === 405, 'only POST');
console.log(fail ? `${fail} failed` : `all ${pass} passed`);
