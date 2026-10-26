// Runs schema.sql + the work import in PGlite and checks the result.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const db = new PGlite();
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const U = '33333333-3333-3333-3333-333333333333';
await db.query(`insert into auth.users (id,email) values ($1,'teobous00@gmail.com')`, [U]);
// jobs the app created (no rates yet)
await db.query(`insert into jobs (owner_id,name,kind,pay,rates,created_at) values ($1,'Morning','daily','monthly','[]', now() - interval '1 hour'),($1,'Evening','hourly','semimonthly','[]', now() - interval '1 hour')`, [U]);
const imp = fs.readFileSync(new URL('./imports/work-import.sql', import.meta.url), 'utf8');
await db.exec(imp); await db.exec(imp);
const q = async s => (await db.query(s)).rows;
ok((await q(`select count(*)::int c from jobs`))[0].c === 2, 'no duplicate jobs (used the existing Morning/Evening)');
const m = await q(`select s.* from shifts s join jobs j on j.id=s.job_id where j.kind='daily' order by date`);
const e = await q(`select s.* from shifts s join jobs j on j.id=s.job_id where j.kind='hourly' order by date`);
ok(m.length === 25 && e.length === 134, `imported ${m.length} morning days and ${e.length} evening shifts (run twice, no duplicates)`);
ok(Number(m.find(r => r.date.toISOString().startsWith('2026-09-0')).base) === 70, '8 Sep day pay 70 € kept');
ok(Number(e.find(r => r.date.toISOString().slice(0, 10) === '2026-05-27').hours) === 7, '27 May 22:00–05:00 = 7h');
const rates = (await q(`select rates from jobs where kind='daily'`))[0].rates;
ok(rates[0].day === 35, 'Morning usual day pay set to 35 €');
const po = await q(`select p.period_start, j.kind from payouts p join jobs j on j.id=p.job_id where settled order by 1`);
ok(po.length === 12 && po.filter(p => p.kind === 'hourly').length === 11, 'paid periods: Morning Sep + Evening 1 May–15 Oct');
// owed (same rules as the app): morning October up to 26 Oct
const today = '2026-10-26';
const octM = m.filter(r => { const d = r.date.toISOString().slice(0, 10); return d >= '2026-10-01' && d <= today; });
const owed = octM.reduce((s, r) => s + Number(r.base) + Number(r.bonus), 0);
ok(owed === 697, `Morning owed for October so far: ${owed} € (455 € days + 242 € bonus)`);
const ev = e.filter(r => { const d = r.date.toISOString().slice(0, 10); return d >= '2026-10-16' && d <= today; });
ok(ev.reduce((s, r) => s + Number(r.hours), 0) === 46.5, 'Evening from 16 Oct: 46,5 hours (× your hourly rate)');
