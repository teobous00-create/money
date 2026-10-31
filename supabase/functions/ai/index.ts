// Supabase Edge Function "ai": the app's only door to Claude.
// - Signed-in users whose settings have analytics = true (Teo): 60 calls a day.
// - People who share a category with such a user (his girlfriend): 20 calls a day, for the voice commands.
// - Anyone else is refused. Models and answer length are fixed here, not by the app.
// - Questions from Teo (the app sends tier "ask") go to Opus; commands and everything else to Sonnet.
// - The Anthropic key lives in the secret ANTHROPIC_API_KEY and never reaches the phone.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via Editor → name "ai" → paste this file.

const MODEL = 'claude-sonnet-5-5';       // commands, short asks, his girlfriend's voice entries
const MODEL_ASK = 'claude-opus-5-5';     // Teo's questions
const DAILY_LIMIT = 60;
const PARTNER_LIMIT = 20;
const MAX_TOKENS = 4000;

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** New projects expose keys as JSON dictionaries; older ones as single legacy keys. */
function pickKey(env: Env, dict: string, legacy: string): string | undefined {
  try { const d = JSON.parse(env[dict] ?? ''); if (d && typeof d === 'object') return d.default ?? Object.values(d)[0] as string; } catch { /* not set */ }
  return env[legacy];
}
const adminHeaders = (key: string) => ({ apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' });

export async function handle(req: Request, env: Env, f: Fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });

  const url = env.SUPABASE_URL;
  const pub = pickKey(env, 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const secret = pickKey(env, 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  const anthropic = env.ANTHROPIC_API_KEY;
  if (!url || !pub || !secret) return json(500, { error: 'server_env' });
  if (!anthropic) return json(503, { error: 'no_key' });

  // who is calling
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || token === pub) return json(401, { error: 'auth' });
  const who = await f(`${url}/auth/v1/user`, { headers: { apikey: pub, Authorization: `Bearer ${token}` } });
  if (!who.ok) return json(401, { error: 'auth' });
  const user = await who.json() as { id?: string };
  if (!user.id) return json(401, { error: 'auth' });

  // allowed + under today's limit
  const prefRes = await f(`${url}/rest/v1/user_prefs?select=prefs&user_id=eq.${user.id}`, { headers: adminHeaders(secret) });
  const rows = prefRes.ok ? await prefRes.json() as Array<{ prefs: Record<string, unknown> }> : [];
  const prefs = rows[0]?.prefs ?? {};
  let limit = DAILY_LIMIT;
  if (prefs.analytics !== true) {
    if (!(await isPartner(url, secret, user.id, f))) return json(403, { error: 'not_allowed' });
    limit = PARTNER_LIMIT;
  }
  const day = new Date().toISOString().slice(0, 10);
  const usage = prefs.aiUsage as { day?: string; count?: number } | undefined;
  const used = usage?.day === day ? usage.count ?? 0 : 0;
  if (used >= limit) return json(429, { error: 'limit', remaining: 0 });

  // what the app asks
  let body: { system?: unknown; messages?: unknown; tools?: unknown; tier?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: 'body' }); }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-40) : null;
  if (!messages || !messages.length) return json(400, { error: 'messages' });
  if (JSON.stringify(body).length > 200_000) return json(413, { error: 'too_big' });
  const tools = Array.isArray(body.tools) ? body.tools.slice(0, 5) : undefined;
  const model = body.tier === 'ask' && prefs.analytics === true ? MODEL_ASK : MODEL;

  const res = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropic, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: body.system, messages, ...(tools ? { tools } : {}) }),
  });
  const out = await res.json().catch(() => ({})) as { content?: unknown; stop_reason?: string; usage?: unknown; error?: { message?: string } };
  if (!res.ok) return json(502, { error: 'claude', status: res.status, message: out.error?.message ?? '' });

  // count it (she may have no settings row yet)
  await f(`${url}/rest/v1/user_prefs?on_conflict=user_id`, {
    method: 'POST', headers: { ...adminHeaders(secret), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: user.id, prefs: { ...prefs, aiUsage: { day, count: used + 1 } } }),
  }).catch(() => {});

  return json(200, { content: out.content, stop_reason: out.stop_reason, usage: out.usage, model, remaining: limit - used - 1 });
}

/** Shares at least one category (either way round) with a user who has analytics on. */
async function isPartner(url: string, secret: string, id: string, f: Fetch): Promise<boolean> {
  const h = { headers: adminHeaders(secret) };
  const get = async (path: string) => { const r = await f(`${url}/rest/v1/${path}`, h); return r.ok ? await r.json() as Array<Record<string, unknown>> : []; };
  const leads = (await get('user_prefs?select=user_id&prefs->>analytics=eq.true')).map(r => r.user_id as string).filter(x => x && x !== id);
  if (!leads.length) return false;
  const list = leads.join(',');
  // she is a member of his category, or he is a member of hers
  const a = await get(`category_members?select=category_id,categories!inner(owner_id)&user_id=eq.${id}&categories.owner_id=in.(${list})&limit=1`);
  if (a.length) return true;
  const b = await get(`category_members?select=category_id,categories!inner(owner_id)&user_id=in.(${list})&categories.owner_id=eq.${id}&limit=1`);
  return b.length > 0;
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D?.serve) D.serve((req: Request) => handle(req, D.env.toObject()));
