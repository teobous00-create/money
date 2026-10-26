-- ============================================================
-- Import of your old work log (Morning: day pay + bonus · Evening: hours)
-- Paste into Supabase → SQL Editor → Run. Safe to run more than once.
-- Morning: September is marked paid. Evening: everything up to 15 Oct is marked paid.
-- Tips are not imported (you add them by hand from now on).
-- ============================================================

-- make sure the latest columns exist
alter table public.shifts add column if not exists base numeric(14,2);
alter table public.shifts add column if not exists bonus numeric(14,2);
alter table public.payouts add column if not exists settled boolean not null default false;
alter table public.payouts add column if not exists bonus numeric(14,2) not null default 0;
alter table public.payouts add column if not exists bonus_tx_id uuid;

do $$
declare uid uuid; jm uuid; je uuid;
begin
  select id into uid from auth.users where lower(email) = 'teobous00@gmail.com';
  if uid is null then raise exception 'No account with email teobous00@gmail.com'; end if;

  -- use the jobs the app already created (oldest day-rate job = Morning, oldest hourly job = Evening)
  select id into jm from public.jobs where owner_id = uid and deleted_at is null and kind = 'daily' order by created_at limit 1;
  if jm is null then
    insert into public.jobs (owner_id, name, kind, pay, rates, color, sort)
    values (uid, 'Morning', 'daily', 'monthly', '[{"from":"0000-01-01","day":35}]', '#E8A33D', 0) returning id into jm;
  end if;
  update public.jobs set rates = '[{"from":"0000-01-01","day":35}]', pay = 'monthly'
    where id = jm and (rates is null or rates = '[]'::jsonb);

  select id into je from public.jobs where owner_id = uid and deleted_at is null and kind = 'hourly' order by created_at limit 1;
  if je is null then
    insert into public.jobs (owner_id, name, kind, pay, rates, color, sort)
    values (uid, 'Evening', 'hourly', 'semimonthly', '[]', '#5B5BD6', 1) returning id into je;
  end if;
  update public.jobs set pay = 'semimonthly' where id = je;

  -- Morning: 25 days
  insert into public.shifts (id, owner_id, job_id, date, hours, sales, base, bonus) values
    (jm::text || ':2026-09-08', uid, jm, '2026-09-08', 1, 0, 70.00, 0.00),
    (jm::text || ':2026-09-16', uid, jm, '2026-09-16', 1, 0, 35.00, 15.00),
    (jm::text || ':2026-09-17', uid, jm, '2026-09-17', 1, 0, 35.00, 6.00),
    (jm::text || ':2026-09-22', uid, jm, '2026-09-22', 1, 0, 35.00, 3.00),
    (jm::text || ':2026-09-23', uid, jm, '2026-09-23', 1, 0, 35.00, 6.00),
    (jm::text || ':2026-09-24', uid, jm, '2026-09-24', 1, 0, 35.00, 3.00),
    (jm::text || ':2026-10-05', uid, jm, '2026-10-05', 1, 0, 35.00, 12.00),
    (jm::text || ':2026-10-06', uid, jm, '2026-10-06', 1, 0, 35.00, 24.00),
    (jm::text || ':2026-10-07', uid, jm, '2026-10-07', 1, 0, 35.00, 20.00),
    (jm::text || ':2026-10-08', uid, jm, '2026-10-08', 1, 0, 35.00, 15.00),
    (jm::text || ':2026-10-09', uid, jm, '2026-10-09', 1, 0, 35.00, 7.00),
    (jm::text || ':2026-10-12', uid, jm, '2026-10-12', 1, 0, 35.00, 15.00),
    (jm::text || ':2026-10-13', uid, jm, '2026-10-13', 1, 0, 35.00, 18.00),
    (jm::text || ':2026-10-14', uid, jm, '2026-10-14', 1, 0, 35.00, 18.00),
    (jm::text || ':2026-10-15', uid, jm, '2026-10-15', 1, 0, 35.00, 13.00),
    (jm::text || ':2026-10-20', uid, jm, '2026-10-20', 1, 0, 35.00, 33.00),
    (jm::text || ':2026-10-21', uid, jm, '2026-10-21', 1, 0, 35.00, 47.00),
    (jm::text || ':2026-10-22', uid, jm, '2026-10-22', 1, 0, 35.00, 20.00),
    (jm::text || ':2026-10-26', uid, jm, '2026-10-26', 1, 0, 35.00, 0.00),
    (jm::text || ':2026-10-27', uid, jm, '2026-10-27', 1, 0, 35.00, 0.00),
    (jm::text || ':2026-10-30', uid, jm, '2026-10-30', 1, 0, 35.00, 0.00),
    (jm::text || ':2026-11-02', uid, jm, '2026-11-02', 1, 0, 35.00, 0.00),
    (jm::text || ':2026-11-03', uid, jm, '2026-11-03', 1, 0, 35.00, 0.00),
    (jm::text || ':2026-11-04', uid, jm, '2026-11-04', 1, 0, 35.00, 0.00),
    (jm::text || ':2026-11-05', uid, jm, '2026-11-05', 1, 0, 35.00, 0.00)
  on conflict (id) do update set hours = excluded.hours, base = excluded.base, bonus = excluded.bonus, deleted_at = null;

  -- Evening: 134 shifts
  insert into public.shifts (id, owner_id, job_id, date, hours, sales) values
    (je::text || ':2026-05-01', uid, je, '2026-05-01', 6.5, 0),
    (je::text || ':2026-05-02', uid, je, '2026-05-02', 8.0, 0),
    (je::text || ':2026-05-03', uid, je, '2026-05-03', 7.5, 0),
    (je::text || ':2026-05-05', uid, je, '2026-05-05', 6.5, 0),
    (je::text || ':2026-05-06', uid, je, '2026-05-06', 6.5, 0),
    (je::text || ':2026-05-07', uid, je, '2026-05-07', 7.0, 0),
    (je::text || ':2026-05-08', uid, je, '2026-05-08', 7.0, 0),
    (je::text || ':2026-05-09', uid, je, '2026-05-09', 7.5, 0),
    (je::text || ':2026-05-10', uid, je, '2026-05-10', 7.0, 0),
    (je::text || ':2026-05-11', uid, je, '2026-05-11', 6.5, 0),
    (je::text || ':2026-05-12', uid, je, '2026-05-12', 6.0, 0),
    (je::text || ':2026-05-13', uid, je, '2026-05-13', 6.5, 0),
    (je::text || ':2026-05-14', uid, je, '2026-05-14', 6.0, 0),
    (je::text || ':2026-05-16', uid, je, '2026-05-16', 8.0, 0),
    (je::text || ':2026-05-17', uid, je, '2026-05-17', 7.0, 0),
    (je::text || ':2026-05-18', uid, je, '2026-05-18', 6.0, 0),
    (je::text || ':2026-05-19', uid, je, '2026-05-19', 5.0, 0),
    (je::text || ':2026-05-20', uid, je, '2026-05-20', 6.0, 0),
    (je::text || ':2026-05-21', uid, je, '2026-05-21', 6.5, 0),
    (je::text || ':2026-05-23', uid, je, '2026-05-23', 8.0, 0),
    (je::text || ':2026-05-24', uid, je, '2026-05-24', 10.5, 0),
    (je::text || ':2026-05-25', uid, je, '2026-05-25', 7.0, 0),
    (je::text || ':2026-05-26', uid, je, '2026-05-26', 7.0, 0),
    (je::text || ':2026-05-27', uid, je, '2026-05-27', 7.0, 0),
    (je::text || ':2026-05-28', uid, je, '2026-05-28', 5.5, 0),
    (je::text || ':2026-05-30', uid, je, '2026-05-30', 8.0, 0),
    (je::text || ':2026-05-31', uid, je, '2026-05-31', 7.5, 0),
    (je::text || ':2026-06-01', uid, je, '2026-06-01', 6.5, 0),
    (je::text || ':2026-06-02', uid, je, '2026-06-02', 5.5, 0),
    (je::text || ':2026-06-03', uid, je, '2026-06-03', 6.0, 0),
    (je::text || ':2026-06-04', uid, je, '2026-06-04', 10.5, 0),
    (je::text || ':2026-06-06', uid, je, '2026-06-06', 8.0, 0),
    (je::text || ':2026-06-07', uid, je, '2026-06-07', 7.0, 0),
    (je::text || ':2026-06-08', uid, je, '2026-06-08', 7.5, 0),
    (je::text || ':2026-06-09', uid, je, '2026-06-09', 6.5, 0),
    (je::text || ':2026-06-11', uid, je, '2026-06-11', 7.0, 0),
    (je::text || ':2026-06-12', uid, je, '2026-06-12', 7.0, 0),
    (je::text || ':2026-06-13', uid, je, '2026-06-13', 8.0, 0),
    (je::text || ':2026-06-14', uid, je, '2026-06-14', 8.5, 0),
    (je::text || ':2026-06-15', uid, je, '2026-06-15', 7.0, 0),
    (je::text || ':2026-06-16', uid, je, '2026-06-16', 8.0, 0),
    (je::text || ':2026-06-17', uid, je, '2026-06-17', 6.5, 0),
    (je::text || ':2026-06-18', uid, je, '2026-06-18', 7.5, 0),
    (je::text || ':2026-06-20', uid, je, '2026-06-20', 7.0, 0),
    (je::text || ':2026-06-21', uid, je, '2026-06-21', 7.5, 0),
    (je::text || ':2026-06-22', uid, je, '2026-06-22', 6.5, 0),
    (je::text || ':2026-06-23', uid, je, '2026-06-23', 7.5, 0),
    (je::text || ':2026-06-24', uid, je, '2026-06-24', 7.5, 0),
    (je::text || ':2026-06-27', uid, je, '2026-06-27', 8.0, 0),
    (je::text || ':2026-06-28', uid, je, '2026-06-28', 7.5, 0),
    (je::text || ':2026-06-29', uid, je, '2026-06-29', 7.0, 0),
    (je::text || ':2026-06-30', uid, je, '2026-06-30', 6.5, 0),
    (je::text || ':2026-07-01', uid, je, '2026-07-01', 6.5, 0),
    (je::text || ':2026-07-02', uid, je, '2026-07-02', 7.0, 0),
    (je::text || ':2026-07-04', uid, je, '2026-07-04', 5.5, 0),
    (je::text || ':2026-07-05', uid, je, '2026-07-05', 6.5, 0),
    (je::text || ':2026-07-06', uid, je, '2026-07-06', 6.5, 0),
    (je::text || ':2026-07-08', uid, je, '2026-07-08', 8.0, 0),
    (je::text || ':2026-07-11', uid, je, '2026-07-11', 5.5, 0),
    (je::text || ':2026-07-12', uid, je, '2026-07-12', 6.5, 0),
    (je::text || ':2026-07-14', uid, je, '2026-07-14', 7.0, 0),
    (je::text || ':2026-07-15', uid, je, '2026-07-15', 7.5, 0),
    (je::text || ':2026-07-16', uid, je, '2026-07-16', 8.0, 0),
    (je::text || ':2026-07-17', uid, je, '2026-07-17', 8.0, 0),
    (je::text || ':2026-07-18', uid, je, '2026-07-18', 9.0, 0),
    (je::text || ':2026-07-19', uid, je, '2026-07-19', 9.0, 0),
    (je::text || ':2026-07-20', uid, je, '2026-07-20', 8.5, 0),
    (je::text || ':2026-07-23', uid, je, '2026-07-23', 7.5, 0),
    (je::text || ':2026-07-24', uid, je, '2026-07-24', 7.0, 0),
    (je::text || ':2026-07-25', uid, je, '2026-07-25', 7.5, 0),
    (je::text || ':2026-07-26', uid, je, '2026-07-26', 6.5, 0),
    (je::text || ':2026-07-28', uid, je, '2026-07-28', 7.5, 0),
    (je::text || ':2026-07-30', uid, je, '2026-07-30', 8.5, 0),
    (je::text || ':2026-07-31', uid, je, '2026-07-31', 8.0, 0),
    (je::text || ':2026-08-01', uid, je, '2026-08-01', 7.0, 0),
    (je::text || ':2026-08-02', uid, je, '2026-08-02', 7.5, 0),
    (je::text || ':2026-08-06', uid, je, '2026-08-06', 8.0, 0),
    (je::text || ':2026-08-07', uid, je, '2026-08-07', 8.5, 0),
    (je::text || ':2026-08-08', uid, je, '2026-08-08', 8.0, 0),
    (je::text || ':2026-08-09', uid, je, '2026-08-09', 7.0, 0),
    (je::text || ':2026-08-12', uid, je, '2026-08-12', 7.0, 0),
    (je::text || ':2026-08-04', uid, je, '2026-08-04', 9.0, 0),
    (je::text || ':2026-08-10', uid, je, '2026-08-10', 8.5, 0),
    (je::text || ':2026-08-16', uid, je, '2026-08-16', 2.0, 0),
    (je::text || ':2026-08-28', uid, je, '2026-08-28', 5.0, 0),
    (je::text || ':2026-08-29', uid, je, '2026-08-29', 8.0, 0),
    (je::text || ':2026-08-30', uid, je, '2026-08-30', 8.5, 0),
    (je::text || ':2026-08-31', uid, je, '2026-08-31', 6.5, 0),
    (je::text || ':2026-09-01', uid, je, '2026-09-01', 6.0, 0),
    (je::text || ':2026-09-02', uid, je, '2026-09-02', 6.0, 0),
    (je::text || ':2026-09-03', uid, je, '2026-09-03', 6.5, 0),
    (je::text || ':2026-09-04', uid, je, '2026-09-04', 7.0, 0),
    (je::text || ':2026-09-05', uid, je, '2026-09-05', 7.5, 0),
    (je::text || ':2026-09-06', uid, je, '2026-09-06', 6.0, 0),
    (je::text || ':2026-09-08', uid, je, '2026-09-08', 6.0, 0),
    (je::text || ':2026-09-09', uid, je, '2026-09-09', 6.5, 0),
    (je::text || ':2026-09-10', uid, je, '2026-09-10', 8.0, 0),
    (je::text || ':2026-09-11', uid, je, '2026-09-11', 6.5, 0),
    (je::text || ':2026-09-12', uid, je, '2026-09-12', 8.0, 0),
    (je::text || ':2026-09-13', uid, je, '2026-09-13', 6.0, 0),
    (je::text || ':2026-09-15', uid, je, '2026-09-15', 6.5, 0),
    (je::text || ':2026-09-16', uid, je, '2026-09-16', 6.0, 0),
    (je::text || ':2026-09-17', uid, je, '2026-09-17', 6.0, 0),
    (je::text || ':2026-09-18', uid, je, '2026-09-18', 6.5, 0),
    (je::text || ':2026-09-19', uid, je, '2026-09-19', 8.0, 0),
    (je::text || ':2026-09-20', uid, je, '2026-09-20', 6.5, 0),
    (je::text || ':2026-09-21', uid, je, '2026-09-21', 6.0, 0),
    (je::text || ':2026-09-22', uid, je, '2026-09-22', 5.5, 0),
    (je::text || ':2026-09-24', uid, je, '2026-09-24', 5.5, 0),
    (je::text || ':2026-09-25', uid, je, '2026-09-25', 6.5, 0),
    (je::text || ':2026-09-27', uid, je, '2026-09-27', 3.0, 0),
    (je::text || ':2026-10-01', uid, je, '2026-10-01', 5.5, 0),
    (je::text || ':2026-10-02', uid, je, '2026-10-02', 6.0, 0),
    (je::text || ':2026-10-03', uid, je, '2026-10-03', 8.0, 0),
    (je::text || ':2026-10-04', uid, je, '2026-10-04', 5.5, 0),
    (je::text || ':2026-10-05', uid, je, '2026-10-05', 5.5, 0),
    (je::text || ':2026-10-06', uid, je, '2026-10-06', 5.5, 0),
    (je::text || ':2026-10-08', uid, je, '2026-10-08', 6.0, 0),
    (je::text || ':2026-10-09', uid, je, '2026-10-09', 6.0, 0),
    (je::text || ':2026-10-10', uid, je, '2026-10-10', 6.0, 0),
    (je::text || ':2026-10-11', uid, je, '2026-10-11', 5.5, 0),
    (je::text || ':2026-10-15', uid, je, '2026-10-15', 5.5, 0),
    (je::text || ':2026-10-16', uid, je, '2026-10-16', 6.0, 0),
    (je::text || ':2026-10-17', uid, je, '2026-10-17', 6.0, 0),
    (je::text || ':2026-10-20', uid, je, '2026-10-20', 6.0, 0),
    (je::text || ':2026-10-21', uid, je, '2026-10-21', 5.5, 0),
    (je::text || ':2026-10-22', uid, je, '2026-10-22', 6.0, 0),
    (je::text || ':2026-10-23', uid, je, '2026-10-23', 6.5, 0),
    (je::text || ':2026-10-24', uid, je, '2026-10-24', 6.0, 0),
    (je::text || ':2026-10-25', uid, je, '2026-10-25', 4.5, 0),
    (je::text || ':2026-10-27', uid, je, '2026-10-27', 5.5, 0),
    (je::text || ':2026-10-28', uid, je, '2026-10-28', 8.0, 0),
    (je::text || ':2026-10-30', uid, je, '2026-10-30', 6.0, 0),
    (je::text || ':2026-10-31', uid, je, '2026-10-31', 7.0, 0)
  on conflict (id) do update set hours = excluded.hours, deleted_at = null;

  -- periods already paid
  insert into public.payouts (id, owner_id, job_id, period_start, period_end, amount, bonus, settled, date) values
    (jm::text || ':2026-09-01', uid, jm, '2026-09-01', '2026-09-30', 0, 0, true, '2026-09-30'),
    (je::text || ':2026-05-01', uid, je, '2026-05-01', '2026-05-15', 0, 0, true, '2026-05-15'),
    (je::text || ':2026-05-16', uid, je, '2026-05-16', '2026-05-31', 0, 0, true, '2026-05-31'),
    (je::text || ':2026-06-01', uid, je, '2026-06-01', '2026-06-15', 0, 0, true, '2026-06-15'),
    (je::text || ':2026-06-16', uid, je, '2026-06-16', '2026-06-30', 0, 0, true, '2026-06-30'),
    (je::text || ':2026-07-01', uid, je, '2026-07-01', '2026-07-15', 0, 0, true, '2026-07-15'),
    (je::text || ':2026-07-16', uid, je, '2026-07-16', '2026-07-31', 0, 0, true, '2026-07-31'),
    (je::text || ':2026-08-01', uid, je, '2026-08-01', '2026-08-15', 0, 0, true, '2026-08-15'),
    (je::text || ':2026-08-16', uid, je, '2026-08-16', '2026-08-31', 0, 0, true, '2026-08-31'),
    (je::text || ':2026-09-01', uid, je, '2026-09-01', '2026-09-15', 0, 0, true, '2026-09-15'),
    (je::text || ':2026-09-16', uid, je, '2026-09-16', '2026-09-30', 0, 0, true, '2026-09-30'),
    (je::text || ':2026-10-01', uid, je, '2026-10-01', '2026-10-15', 0, 0, true, '2026-10-15')
  on conflict (id) do update set settled = true, deleted_at = null;
end $$;
