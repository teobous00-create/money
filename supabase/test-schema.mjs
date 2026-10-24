// Tests schema.sql in PGlite with a mocked Supabase auth schema.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const db = new PGlite();
const q = (s, p) => db.query(s, p);
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  ', m); };

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);
try { await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')); } catch (e) { console.error('SCHEMA ERROR:', e.message, e.where ?? ''); process.exit(1); }
await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')); // idempotent
console.log('ok   schema runs twice');

const TEO = '11111111-1111-1111-1111-111111111111';
const GF = '22222222-2222-2222-2222-222222222222';
await q(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'teo@x.com','{"display_name":"Teo"}'),($2,'gf@x.com','{}')`, [TEO, GF]);
ok((await q('select count(*)::int c from profiles')).rows[0].c === 2, 'profiles created on sign-up');

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role;`); }
}

// Teo creates data
const ids = await as(TEO, async () => {
  const cash = (await q(`insert into accounts (name) values ('Cash') returning id`)).rows[0].id;
  const joint = (await q(`insert into accounts (name) values ('Joint') returning id`)).rows[0].id;
  const home = (await q(`insert into categories (type,name) values ('expense','Home') returning id`)).rows[0].id;
  const sm = (await q(`insert into categories (type,name,parent_id) values ('expense','Supermarket',$1) returning id`, [home])).rows[0].id;
  const smoke = (await q(`insert into categories (type,name) values ('expense','Cigarettes') returning id`)).rows[0].id;
  await q(`insert into transactions (type,date,amount,account_id,category_id) values ('expense','2026-10-01',10,$1,$2)`, [cash, smoke]);
  await q(`insert into transactions (type,date,amount,account_id,category_id,note) values ('expense','2026-10-02',25,$1,$2,'joint shop')`, [joint, sm]);
  await q(`insert into transactions (type,date,amount,account_id,to_account_id) values ('transfer','2026-10-03',100,$1,$2)`, [cash, joint]);
  const r = (await q(`select share_account($1,'GF@x.com ') r`, [joint])).rows[0].r;
  ok(r === 'ok', 'share_account by email (case/space-insensitive)');
  ok((await q(`select share_account($1,'nobody@x.com') r`, [joint])).rows[0].r === 'no_user', 'share to unknown email -> no_user');
  ok((await q(`select count(*)::int c from account_member_list($1)`, [joint])).rows[0].c === 1, 'owner sees member list');
  return { cash, joint, home, sm, smoke };
});

await as(GF, async () => {
  const accs = (await q(`select name from accounts order by name`)).rows.map(r => r.name);
  ok(JSON.stringify(accs) === '["Joint"]', 'gf sees only Joint account: ' + accs);
  const txs = (await q(`select type, amount from transactions order by date`)).rows;
  ok(txs.length === 2, 'gf sees joint expense + transfer into joint (' + txs.length + ')');
  const cats = (await q(`select name from categories order by name`)).rows.map(r => r.name);
  ok(JSON.stringify(cats) === '["Home","Supermarket"]', 'gf sees only categories used on joint: ' + cats);
  ok((await q(`select count(*)::int c from profiles`)).rows[0].c === 2, 'gf sees Teo profile (shared)');
  // write attempts
  let blocked = false;
  try { await q(`insert into transactions (type,date,amount,account_id) values ('expense','2026-10-05',5,$1)`, [ids.joint]); } catch { blocked = true; }
  ok(blocked, 'gf cannot add to joint (view only)');
  const upd = await q(`update transactions set amount = 1 where account_id = $1`, [ids.joint]);
  ok((upd.affectedRows ?? 0) === 0, 'gf cannot edit joint transactions');
  const upa = await q(`update accounts set name = 'hack' where id = $1`, [ids.joint]);
  ok((upa.affectedRows ?? 0) === 0, 'gf cannot edit joint account');
  ok((await q(`select share_account($1,'teo@x.com') r`, [ids.joint])).rows[0].r === 'not_owner', 'gf cannot share Teo account');
  ok((await q(`select count(*)::int c from account_member_list($1)`, [ids.joint])).rows[0].c === 0, 'gf cannot list members');
  // her own personal data
  const mine = (await q(`insert into accounts (name) values ('Her cash') returning id`)).rows[0].id;
  await q(`insert into transactions (type,date,amount,account_id) values ('income','2026-10-05',50,$1)`, [mine]);
});

await as(TEO, async () => {
  const accs = (await q(`select name from accounts order by name`)).rows.map(r => r.name);
  ok(!accs.includes('Her cash'), 'Teo cannot see gf personal account');
  ok((await q(`select count(*)::int c from transactions`)).rows[0].c === 3, 'Teo sees only his 3 transactions');
  let blocked = false;
  try { await q(`insert into transactions (type,date,amount,account_id) values ('expense','2026-10-05',5,$1)`, [ids.joint]); } catch (e) { blocked = true; }
  ok(!blocked, 'Teo can add to joint');
  let bad = false;
  try { await q(`insert into transactions (type,date,amount,account_id,to_account_id) values ('expense','2026-10-05',5,$1,$2)`, [ids.cash, ids.joint]); } catch { bad = true; }
  ok(bad, 'expense with to_account rejected by check');
  // recurring: monthly anchored on 31st, started in the past
  await q(`insert into recurring (type,amount,account_id,category_id,note,freq,anchor_day,next_date) values ('expense',12.49,$1,$2,'Netflix','monthly',31,current_date - 70)`, [ids.cash, ids.home]);
  const n = (await q(`select post_due_recurring() n`)).rows[0].n;
  ok(n >= 2 && n <= 4, 'recurring catch-up posted ' + n + ' entries');
  const n2 = (await q(`select post_due_recurring() n`)).rows[0].n;
  ok(n2 === 0, 'recurring is idempotent');
  const nd = (await q(`select next_date from recurring`)).rows[0].next_date;
  ok(new Date(nd) > new Date(), 'next_date moved into the future: ' + nd.toISOString?.().slice(0,10));
  let denied = false;
  try { await q(`select post_due_recurring_core(null)`); } catch { denied = true; }
  ok(denied, 'core cron function not callable by users');
});

const rn = (await q(`select recurring_next('2026-01-31','monthly',31)::text a, recurring_next('2026-02-28','monthly',31)::text b, recurring_next('2024-02-29','yearly',29)::text c`)).rows[0];
ok(rn.a === '2026-02-28' && rn.b === '2026-03-31' && rn.c === '2025-02-28', 'month-end anchoring ' + JSON.stringify(rn));
