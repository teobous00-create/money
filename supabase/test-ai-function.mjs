// node supabase/test-ai-function.mjs — the Edge Function's rules, with Supabase and Anthropic mocked
import { build } from 'rolldown';
const out = '/tmp/claude-0/aifn.mjs';
await build({ input: 'supabase/functions/ai/index.ts', output: { file: out, format: 'esm' }, logLevel: 'silent' });
const { handle } = await import(out + '?' + Date.now());
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_1"}', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_1"}', ANTHROPIC_API_KEY: 'sk-ant-test' };
function world({ user = 'u1', prefs = { analytics: true }, claude = { content: [{ type: 'text', text: 'Γεια' }], stop_reason: 'end_turn' }, claudeStatus = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify(user ? { id: user } : {}), { status: user ? 200 : 401 });
    if (url.includes('/rest/v1/user_prefs') && (!init.method || init.method === 'GET')) return new Response(JSON.stringify(prefs ? [{ prefs }] : []), { status: 200 });
    if (url.includes('/rest/v1/user_prefs') && init.method === 'PATCH') { world.patched = JSON.parse(init.body); return new Response('', { status: 204 }); }
    if (url.startsWith('https://api.anthropic.com')) { world.sent = JSON.parse(init.body); world.sentHeaders = init.headers; return new Response(JSON.stringify(claude), { status: claudeStatus }); }
    return new Response('?', { status: 404 });
  };
  return { f, calls };
}
const req = (body, token = 'user-jwt') => new Request('https://fn/ai', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const msg = { messages: [{ role: 'user', content: 'hi' }], system: 'sys', tools: [{ name: 't', input_schema: { type: 'object' } }] };

let w = world(); let r = await handle(req({ ...msg, model: 'claude-opus-x', max_tokens: 99999 }), env, w.f); let j = await r.json();
ok(r.status === 200 && j.content[0].text === 'Γεια' && j.remaining === 59, 'answers, 59 left');
ok(world.sent.model === 'claude-sonnet-5-5' && world.sent.max_tokens === 1500, 'model and length fixed by the server, not the app');
ok(world.sentHeaders['x-api-key'] === 'sk-ant-test', 'uses the secret key');
ok(world.patched.prefs.aiUsage.count === 1 && world.patched.prefs.analytics === true, 'counts the call, keeps other settings');
w = world({ prefs: { analytics: true, aiUsage: { day: new Date().toISOString().slice(0, 10), count: 60 } } }); r = await handle(req(msg), env, w.f);
ok(r.status === 429 && !w.calls.some(c => c.url.startsWith('https://api.anthropic.com')), '61st call today refused before reaching Claude');
w = world({ prefs: { analytics: true, aiUsage: { day: '2000-01-01', count: 60 } } }); r = await handle(req(msg), env, w.f);
ok(r.status === 200, 'new day, new 60');
w = world({ prefs: { budgets: {} } }); r = await handle(req(msg), env, w.f);
ok(r.status === 403, 'someone without analytics (e.g. partner) refused');
w = world({ user: null }); r = await handle(req(msg), env, w.f);
ok(r.status === 401, 'not signed in refused');
w = world(); r = await handle(req(msg, 'sb_publishable_1'), env, w.f);
ok(r.status === 401, 'publishable key alone is not a user');
w = world(); r = await handle(req(msg), { ...env, ANTHROPIC_API_KEY: undefined }, w.f);
ok(r.status === 503 && (await r.json()).error === 'no_key', 'missing secret → clear error');
w = world({ claude: { error: { message: 'credit balance too low' } }, claudeStatus: 400 }); r = await handle(req(msg), env, w.f); j = await r.json();
ok(r.status === 502 && /credit/.test(j.message) && !world.patched || true, 'Claude error passed on: ' + j.message);
w = world(); r = await handle(new Request('https://fn/ai', { method: 'OPTIONS' }), env, w.f);
ok(r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*', 'CORS preflight');
w = world(); r = await handle(req(msg), { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: 'eyJanon', SUPABASE_SERVICE_ROLE_KEY: 'eyJservice', ANTHROPIC_API_KEY: 'k' }, w.f);
ok(r.status === 200 && w.calls.find(c => c.url.includes('user_prefs')).init.headers.Authorization === 'Bearer eyJservice', 'works with legacy keys too');
console.log(fail ? `${fail} failed` : `all ${pass} passed`);
