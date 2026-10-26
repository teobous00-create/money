-- ============================================================
-- Money app — database schema for Supabase
-- Paste the whole file into Supabase → SQL Editor → Run.
-- Safe to run more than once.
-- ============================================================

-- gen_random_uuid() is built in (Postgres 13+)

-- ---------- tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  kind text not null default 'regular' check (kind in ('regular','credit','savings')),
  icon text not null default 'wallet',
  color text not null default '#64748b',
  opening_balance numeric(14,2) not null default 0,
  credit_limit numeric(14,2),
  goal numeric(14,2),
  archived boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  type text not null check (type in ('expense','income')),
  name text not null,
  parent_id uuid references public.categories on delete cascade,
  icon text not null default 'circle',
  color text not null default '#64748b',
  sort integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- v2: categories are shared (not accounts). Remove the old account-sharing objects if present.
drop function if exists public.share_account(uuid, text);
drop function if exists public.account_member_list(uuid);
drop table if exists public.account_members cascade;

create table if not exists public.category_members (
  category_id uuid not null references public.categories on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (category_id, user_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  type text not null check (type in ('expense','income','transfer')),
  date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  account_id uuid not null references public.accounts on delete cascade,
  to_account_id uuid references public.accounts on delete cascade,
  category_id uuid references public.categories on delete set null,
  note text,
  recurring_id uuid,
  seq integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((type = 'transfer') = (to_account_id is not null))
);

create table if not exists public.recurring (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  type text not null check (type in ('expense','income','transfer')),
  amount numeric(14,2) not null check (amount >= 0),
  account_id uuid not null references public.accounts on delete cascade,
  to_account_id uuid references public.accounts on delete cascade,
  category_id uuid references public.categories on delete set null,
  note text,
  freq text not null check (freq in ('weekly','monthly','yearly')),
  anchor_day integer not null default 1,
  next_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- v3: recurring end date and skipped occurrences
alter table public.recurring add column if not exists end_date date;
alter table public.recurring add column if not exists skip_dates date[] not null default '{}';

create index if not exists tx_owner_updated on public.transactions (owner_id, updated_at);
create index if not exists tx_account on public.transactions (account_id);
create index if not exists tx_to_account on public.transactions (to_account_id);
create index if not exists tx_category on public.transactions (category_id);
create index if not exists cat_owner on public.categories (owner_id);
create index if not exists acc_owner on public.accounts (owner_id);
create index if not exists catmem_user on public.category_members (user_id);

-- v4: personal settings (budgets, analytics) — visible only to their owner
create table if not exists public.user_prefs (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  prefs jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------- updated_at trigger ----------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','recurring'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- profile on sign-up ----------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill profiles for users who signed up before this script ran
insert into public.profiles (id, email, display_name)
select id, lower(email), coalesce(raw_user_meta_data->>'display_name', split_part(email, '@', 1))
from auth.users on conflict (id) do nothing;

-- ---------- access helpers (security definer avoids RLS recursion) ----------

create or replace function public.owns_account(acc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from accounts where id = acc and owner_id = auth.uid());
$$;

-- top-level category of a category (itself if it has no parent)
create or replace function public.cat_root(cat uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(parent_id, id) from categories where id = cat;
$$;

-- true if I own the category's top-level category, or it is shared with me
create or replace function public.can_use_category(cat uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select cat is not null and exists (
    select 1 from categories r
    where r.id = public.cat_root(cat)
      and (r.owner_id = auth.uid()
           or exists (select 1 from category_members m where m.category_id = r.id and m.user_id = auth.uid()))
  );
$$;

-- the people I share at least one category with (either direction)
create or replace function public.shares_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from category_members m join categories c on c.id = m.category_id
    where (c.owner_id = auth.uid() and m.user_id = other)
       or (c.owner_id = other and m.user_id = auth.uid())
       or (m.user_id = other and exists (select 1 from category_members m2 where m2.category_id = m.category_id and m2.user_id = auth.uid()))
  );
$$;

-- drop helpers from v1
drop function if exists public.can_see_account(uuid) cascade;
drop function if exists public.can_see_category(uuid) cascade;

-- ---------- row level security ----------

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.category_members enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring enable row level security;
alter table public.user_prefs enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_with(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- accounts are always private
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select
  using (owner_id = auth.uid());
drop policy if exists accounts_write on public.accounts;
create policy accounts_write on public.accounts for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists catmem_select on public.category_members;
create policy catmem_select on public.category_members for select
  using (user_id = auth.uid() or public.can_use_category(category_id));
drop policy if exists catmem_delete on public.category_members;
create policy catmem_delete on public.category_members for delete
  using (user_id = auth.uid() or public.can_use_category(category_id));
-- inserts go through share_category() below

-- categories: everyone in a shared category can see and edit it and its subcategories
drop policy if exists categories_write on public.categories;
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select
  using (owner_id = auth.uid() or public.can_use_category(id));
drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories for insert
  with check (
    (owner_id = auth.uid() and (parent_id is null or public.can_use_category(parent_id)))
    or public.can_use_category(id)
  );
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update
  using (owner_id = auth.uid() or public.can_use_category(id))
  with check (owner_id = auth.uid() or public.can_use_category(id) or public.can_use_category(parent_id));
drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories for delete
  using (owner_id = auth.uid());

-- transactions: mine, plus everyone's entries in categories shared with me (view only)
drop policy if exists tx_select on public.transactions;
create policy tx_select on public.transactions for select
  using (owner_id = auth.uid() or public.can_use_category(category_id));
drop policy if exists tx_write on public.transactions;
create policy tx_write on public.transactions for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and public.owns_account(account_id)
    and (to_account_id is null or public.owns_account(to_account_id))
    and (category_id is null or public.can_use_category(category_id))
  );

drop policy if exists prefs_all on public.user_prefs;
create policy prefs_all on public.user_prefs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists recurring_all on public.recurring;
create policy recurring_all on public.recurring for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------- sharing categories ----------

create or replace function public.share_category(cat uuid, member_email text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid; root uuid;
begin
  root := public.cat_root(cat);
  if root is null or not public.can_use_category(root) then return 'not_allowed'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(member_email));
  if uid is null then return 'no_user'; end if;
  if uid = auth.uid() or uid = (select owner_id from categories where id = root) then return 'self'; end if;
  insert into category_members (category_id, user_id) values (root, uid) on conflict do nothing;
  return 'ok';
end $$;

-- everyone in a category: owner first, then members
create or replace function public.category_people(cat uuid)
returns table (user_id uuid, email text, display_name text, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.display_name, true
  from categories c join profiles p on p.id = c.owner_id
  where c.id = public.cat_root(cat) and public.can_use_category(cat)
  union all
  select p.id, p.email, p.display_name, false
  from category_members m join profiles p on p.id = m.user_id
  where m.category_id = public.cat_root(cat) and public.can_use_category(cat);
$$;

-- ---------- recurring transactions ----------

create or replace function public.recurring_next(d date, freq text, anchor integer) returns date
language plpgsql immutable as $$
declare n date; last_day integer;
begin
  if freq = 'weekly' then return d + 7; end if;
  if freq = 'monthly' then n := (date_trunc('month', d) + interval '1 month')::date;
  else n := (date_trunc('month', d) + interval '1 year')::date;
  end if;
  last_day := extract(day from (date_trunc('month', n) + interval '1 month - 1 day'))::integer;
  return make_date(extract(year from n)::integer, extract(month from n)::integer, least(anchor, last_day));
end $$;

-- posts every due occurrence (for one user, or all users when only_owner is null)
create or replace function public.post_due_recurring_core(only_owner uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  today date := (now() at time zone 'Europe/Athens')::date;
  posted integer := 0;
begin
  for r in
    select * from recurring
    where active and deleted_at is null and next_date <= today
      and (only_owner is null or owner_id = only_owner)
    for update skip locked
  loop
    while r.next_date <= today and (r.end_date is null or r.next_date <= r.end_date) loop
      if not (r.next_date = any(r.skip_dates)) then
        insert into transactions (owner_id, type, date, amount, account_id, to_account_id, category_id, note, recurring_id)
        values (r.owner_id, r.type, r.next_date, r.amount, r.account_id, r.to_account_id, r.category_id, r.note, r.id);
        posted := posted + 1;
      end if;
      r.next_date := public.recurring_next(r.next_date, r.freq, r.anchor_day);
    end loop;
    update recurring set next_date = r.next_date where id = r.id;
  end loop;
  return posted;
end $$;

-- called by the app on open (only touches your own rules)
create or replace function public.post_due_recurring() returns integer
language sql security definer set search_path = public as $$
  select public.post_due_recurring_core(auth.uid());
$$;

-- ---------- permissions ----------

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke execute on function public.post_due_recurring_core(uuid) from public, anon, authenticated;
grant execute on function public.post_due_recurring() to authenticated;
grant execute on function public.share_category(uuid, text) to authenticated;
grant execute on function public.category_people(uuid) to authenticated;

-- ---------- daily schedule (posts recurring entries even if nobody opens the app) ----------

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'post-recurring';
  -- 22:05 UTC = 00:05 / 01:05 Athens
  perform cron.schedule('post-recurring', '5 22 * * *', 'select public.post_due_recurring_core(null)');
exception when others then
  raise notice 'pg_cron not available (%). Recurring entries will post when the app is opened.', sqlerrm;
end $$;

-- ---------- analytics is switched on only for Teo's account ----------
insert into public.user_prefs (user_id, prefs)
select id, '{"analytics": true}'::jsonb from auth.users where lower(email) = 'teobous00@gmail.com'
on conflict (user_id) do update set prefs = public.user_prefs.prefs || '{"analytics": true}'::jsonb;

-- ============================================================
-- v5: personal tracker — work shifts and trading results (private to each user)
-- ============================================================

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  kind text not null default 'hourly' check (kind in ('daily','hourly')),
  pay text not null default 'monthly' check (pay in ('monthly','semimonthly')),
  rates jsonb not null default '[]',
  color text not null default '#3E63DD',
  salary_category_id uuid references public.categories on delete set null,
  tips_category_id uuid references public.categories on delete set null,
  tips_account_id uuid references public.accounts on delete set null,
  sort integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.shifts (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  job_id uuid not null references public.jobs on delete cascade,
  date date not null,
  hours numeric(6,2) not null default 0,
  sales integer not null default 0,
  tips_tx_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.payouts (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  job_id uuid not null references public.jobs on delete cascade,
  period_start date not null,
  period_end date not null,
  amount numeric(14,2) not null default 0,
  tx_id uuid,
  date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  color text not null default '#30A46C',
  goal numeric(14,2),
  sort integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.pnl (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  strategy_id uuid not null references public.strategies on delete cascade,
  date date not null,
  pnl numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists shifts_owner on public.shifts (owner_id, updated_at);
create index if not exists pnl_owner on public.pnl (owner_id, updated_at);

do $$
declare t text;
begin
  foreach t in array array['jobs','shifts','payouts','strategies','pnl'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
