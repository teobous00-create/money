// Supabase Edge Function "pnl-sync": the MoneySync EA in MT5 sends each day's closed P&L per strategy here.
// - The EA proves itself with the secret PNL_SYNC_KEY (header x-sync-key). No user login, so "Verify JWT" must be off.
// - It can only write trading P&L, for the one account with analytics on (Teo). It cannot read anything.
// - Each (strategy, day) is replaced, never added to, so sending the same day again is harmless.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via Editor → name "pnl-sync" → paste this file.
// Then: Edge Functions → Secrets → add PNL_SYNC_KEY. In the function's settings, turn "Verify JWT" off.

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function pickKey(env: Env, dict: string, legacy: string): string | undefined {
  try { const d = JSON.parse(env[dict] ?? ''); if (d && typeof d === 'object') return d.default ?? Object.values(d)[0] as string; } catch { /* not set */ }
  return env[legacy];
}
const adminHeaders = (key: string) => ({ apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' });

/** same length, same characters — without stopping at the first difference */
function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export async function handle(req: Request, env: Env, f: Fetch = fetch): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const url = env.SUPABASE_URL;
  const secret = pickKey(env, 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  const key = env.PNL_SYNC_KEY;
  if (!url || !secret) return json(500, { error: 'server_env' });
  if (!key || key.length < 20) return json(503, { error: 'no_sync_key' });
  if (!sameSecret(req.headers.get('x-sync-key') ?? '', key)) return json(401, { error: 'bad_key' });

  let body: { days?: Array<{ strategy?: unknown; date?: unknown; pnl?: unknown }> };
  try { body = await req.json(); } catch { return json(400, { error: 'body' }); }
  const days = Array.isArray(body.days) ? body.days : null;
  if (!days) return json(400, { error: 'days' });
  if (days.length > 500) return json(413, { error: 'too_many' });

  const h = { headers: adminHeaders(secret) };
  const get = async (path: string) => { const r = await f(`${url}/rest/v1/${path}`, h); return r.ok ? await r.json() as Array<Record<string, unknown>> : null; };

  // whose P&L: the one account with analytics on
  const owners = await get('user_prefs?select=user_id&prefs->>analytics=eq.true');
  if (!owners) return json(502, { error: 'db' });
  if (owners.length !== 1) return json(409, { error: 'owner', found: owners.length });
  const owner = owners[0].user_id as string;

  const strategies = await get(`strategies?select=id,name&owner_id=eq.${owner}&deleted_at=is.null`);
  if (!strategies) return json(502, { error: 'db' });
  const byName = new Map(strategies.map(s => [norm(String(s.name)), String(s.id)]));

  const rows: Array<Record<string, unknown>> = [];
  const unknown = new Set<string>();
  const bad: unknown[] = [];
  for (const d of days) {
    const name = typeof d.strategy === 'string' ? d.strategy : '';
    const date = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null;
    const pnl = typeof d.pnl === 'number' && Number.isFinite(d.pnl) && Math.abs(d.pnl) < 1e9 ? Math.round(d.pnl * 100) / 100 : null;
    if (!name || !date || pnl == null) { bad.push(d); continue; }
    const sid = byName.get(norm(name));
    if (!sid) { unknown.add(name); continue; }
    rows.push({ id: `${sid}:${date}`, owner_id: owner, strategy_id: sid, date, pnl, deleted_at: null });
  }

  if (rows.length) {
    const r = await f(`${url}/rest/v1/pnl?on_conflict=id`, {
      method: 'POST', headers: { ...adminHeaders(secret), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
    });
    if (!r.ok) return json(502, { error: 'db_write', status: r.status, message: (await r.text()).slice(0, 300) });
  }
  return json(200, { saved: rows.length, unknown_strategies: [...unknown], bad: bad.length });
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D?.serve) D.serve((req: Request) => handle(req, D.env.toObject()));
