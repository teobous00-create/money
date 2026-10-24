// Tests schema.sql in PGlite with a mocked Supabase auth schema.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const db = new PGlite();
const q = (s, p) => db.query(s, p);
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  ', m); };
const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);

// simulate an existing v1 database (account sharing) being upgraded
await db.exec(`
  create table public.account_members (account_id uuid, user_id uuid);
  create function public.can_see_account(acc uuid) returns boolean language sql as $$ select true $$;
`);
for (const run of [1, 2]) {
  try { await db.exec(schema); } catch (e) { console.error('SCHEMA ERROR (run ' + run + '):', e.message, e.where ?? ''); process.exit(1); }
}
console.log('ok   schema runs twice (and upgrades v1)');
ok((await q(`select to_regclass('public.account_members') r`)).rows[0].r === null, 'old account_members table removed');

const TEO = '11111111-1111-1111-1111-111111111111';
const GF = '22222222-2222-2222-2222-222222222222';
await q(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'teo@x.com','{"display_name":"Teo"}'),($2,'eva@x.com','{"display_name":"Eva"}')`, [TEO, GF]);

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role;`); }
}
const fails = async (fn) => { try { await fn(); return false; } catch { return true; } };

const T = await as(TEO, async () => {
  const cash = (await q(`insert into accounts (name) values ('Cash') returning id`)).rows[0].id;
  const home = (await q(`insert into categories (type,name) values ('expense','Home') returning id`)).rows[0].id;
  const sm = (await q(`insert into categories (type,name,parent_id) values ('expense','Supermarket',$1) returning id`, [home])).rows[0].id;
  const smoke = (await q(`insert into categories (type,name) values ('expense','Cigarettes') returning id`)).rows[0].id;
  await q(`insert into transactions (type,date,amount,account_id,category_id) values ('expense','2026-10-01',10,$1,$2)`, [cash, smoke]);
  await q(`insert into transactions (type,date,amount,account_id,category_id,note) values ('expense','2026-10-02',25,$1,$2,'shop')`, [cash, sm]);
  ok((await q(`select share_category($1,' EVA@x.com') r`, [sm])).rows[0].r === 'ok', 'share (via a subcategory id → shares the top category)');
  ok((await q(`select share_category($1,'nobody@x.com') r`, [home])).rows[0].r === 'no_user', 'unknown email → no_user');
  ok((await q(`select share_category($1,'teo@x.com') r`, [home])).rows[0].r === 'self', 'sharing with yourself → self');
  return { cash, home, sm, smoke };
});

const G = await as(GF, async () => {
  ok((await q(`select count(*)::int c from accounts`)).rows[0].c === 0, 'Eva sees none of Teo\'s accounts');
  const cats = (await q(`select name from categories order by name`)).rows.map(r => r.name);
  ok(JSON.stringify(cats) === '["Home","Supermarket"]', 'Eva sees shared category + subcategory only: ' + cats);
  const txs = (await q(`select amount from transactions`)).rows.map(r => Number(r.amount));
  ok(JSON.stringify(txs) === '[25]', 'Eva sees Teo\'s shared-category expense, not the private one: ' + txs);
  ok((await q(`select count(*)::int c from category_people($1)`, [T.home])).rows[0].c === 2, 'category_people lists both');
  const names = (await q(`select display_name from profiles order by display_name`)).rows.map(r => r.display_name);
  ok(JSON.stringify(names) === '["Eva","Teo"]', 'Eva can read Teo\'s name');

  const mine = (await q(`insert into accounts (name) values ('Eva cash') returning id`)).rows[0].id;
  ok(!(await fails(() => q(`insert into transactions (type,date,amount,account_id,category_id) values ('expense','2026-10-03',30,$1,$2)`, [mine, T.sm]))), 'Eva adds her part into the shared subcategory');
  ok(await fails(() => q(`insert into transactions (type,date,amount,account_id,category_id) values ('expense','2026-10-03',5,$1,$2)`, [T.cash, T.sm])), 'Eva cannot use Teo\'s account');
  ok(await fails(() => q(`insert into transactions (type,date,amount,account_id,category_id) values ('expense','2026-10-03',5,$1,$2)`, [mine, T.smoke])), 'Eva cannot use Teo\'s private category');
  ok(((await q(`update transactions set amount = 1 where owner_id = $1`, [TEO])).affectedRows ?? 0) === 0, 'Eva cannot edit Teo\'s entries');
  ok(((await q(`delete from transactions where owner_id = $1`, [TEO])).affectedRows ?? 0) === 0, 'Eva cannot delete Teo\'s entries');
  ok(((await q(`update categories set name = 'Σπίτι' where id = $1`, [T.home])).affectedRows ?? 0) === 1, 'Eva can rename the shared category');
  const rent = await q(`insert into categories (type,name,parent_id) values ('expense','Rent',$1) returning id`, [T.home]).then(r => r.rows[0].id, () => null);
  ok(!!rent, 'Eva can add a subcategory to the shared category');
  // upsert path used by the app (insert ... on conflict do update) on Teo's row
  ok(!(await fails(() => q(`insert into categories (id,owner_id,type,name,parent_id,archived) values ($1,$2,'expense','Supermarket',$3,true) on conflict (id) do update set archived = excluded.archived`, [T.sm, TEO, T.home]))), 'Eva can hide a shared subcategory via upsert');
  ok(await fails(() => q(`insert into categories (type,name,parent_id) values ('expense','X',$1)`, [T.smoke])), 'Eva cannot add under Teo\'s private category');
  ok(((await q(`update categories set name = 'hack' where id = $1`, [T.smoke])).affectedRows ?? 0) === 0, 'Eva cannot touch Teo\'s private category');
  // her own category shared back
  const hers = (await q(`insert into categories (type,name) values ('expense','Groceries') returning id`)).rows[0].id;
  ok((await q(`select share_category($1,'teo@x.com') r`, [hers])).rows[0].r === 'ok', 'Eva shares her own category with Teo');
  ok((await q(`select share_category($1,'teo@x.com') r`, [T.smoke])).rows[0].r === 'not_allowed', 'Eva cannot share Teo\'s private category');
  return { mine, rent, hers };
});

await as(TEO, async () => {
  ok((await q(`select count(*)::int c from accounts`)).rows[0].c === 1, 'Teo still sees only his own account');
  const amounts = (await q(`select amount from transactions where category_id = $1 order by amount`, [T.sm])).rows.map(r => Number(r.amount));
  ok(JSON.stringify(amounts) === '[25,30]', 'Teo sees both entries in the shared subcategory: ' + amounts);
  const cats = (await q(`select name from categories order by name`)).rows.map(r => r.name);
  ok(cats.includes('Rent') && cats.includes('Groceries') && cats.includes('Σπίτι'), 'Teo sees Eva\'s subcategory, rename, and her shared category');
  ok(await fails(() => q(`insert into transactions (type,date,amount,account_id,category_id) values ('expense','2026-10-05',5,$1,$2)`, [G.mine, T.sm])), 'Teo cannot use Eva\'s account');
  ok(!(await fails(() => q(`insert into transactions (type,date,amount,account_id,category_id) values ('expense','2026-10-05',7,$1,$2)`, [T.cash, G.hers]))), 'Teo can add into Eva\'s shared category');
  // stop sharing
  await q(`delete from category_members where category_id = $1 and user_id = $2`, [T.home, GF]);
});

await as(GF, async () => {
  const txs = (await q(`select owner_id from transactions where owner_id = $1`, [TEO])).rows;
  ok(txs.length === 1, 'after unsharing Home, Eva only sees Teo\'s entry in HER shared category (' + txs.length + ')');
  ok((await q(`select count(*)::int c from transactions where owner_id = $1`, [GF])).rows[0].c === 1, 'Eva keeps her own entry');
});

await as(TEO, async () => {
  await q(`insert into recurring (type,amount,account_id,category_id,note,freq,anchor_day,next_date) values ('expense',12.49,$1,$2,'Netflix','monthly',31,current_date - 70)`, [T.cash, T.home]);
  const n = (await q(`select post_due_recurring() n`)).rows[0].n;
  ok(n >= 2 && n <= 4, 'recurring catch-up posted ' + n);
  ok((await q(`select post_due_recurring() n`)).rows[0].n === 0, 'recurring is idempotent');
  ok(await fails(() => q(`select post_due_recurring_core(null)`)), 'cron function not callable by users');
});

const rn = (await q(`select recurring_next('2026-01-31','monthly',31)::text a, recurring_next('2026-02-28','monthly',31)::text b`)).rows[0];
ok(rn.a === '2026-02-28' && rn.b === '2026-03-31', 'month-end anchoring');
