-- Pull summaries: each group member's damage meter totals for one boss pull, as the uploader's addon recorded them
-- (docs/design/specs/2026-11-02-pull-and-run-records-design.md). Additive: two new tables, three functions and one
-- trigger. Apply before setting EVERLOOT_PULL_SUMMARIES=1; until then the site never calls anything here and drops
-- every pull_summary row at intake.
--
-- These rows are not in the upload objects or the corpus snapshot: they live here, so a hidden character can be
-- deleted from them. A member is one row in pull_members, keyed the way character_suppressions and the players table
-- key a character (public.link_realm_key, lower-case name). A hidden character is refused on write, whichever spelling of
-- the realm the hide was recorded under (a verified owner's opt-out keeps the realm only lower-cased), and hiding a
-- character deletes its member rows, whichever form recorded the hide (the trigger below). A pull left with no
-- member is deleted with its last one. Every pull is deleted a year after it was received. Nothing reads these
-- tables for a page yet.

create table if not exists public.pull_summaries (
  id bigint generated always as identity primary key,
  install_id text not null check (char_length(install_id) between 8 and 64),
  event_id text not null check (char_length(event_id) between 3 and 96),
  received_at timestamptz not null default now(),
  captured_at timestamptz not null,
  -- The pull without its members: encounter, instance, difficulty, size, kill or wipe, start, length, run, realm.
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and not summary ? 'members'),
  unique (install_id, event_id)
);
create index if not exists pull_summaries_received on public.pull_summaries (received_at);
alter table public.pull_summaries enable row level security;
revoke all on public.pull_summaries from public, anon, authenticated, service_role;

create table if not exists public.pull_members (
  pull_id bigint not null references public.pull_summaries (id) on delete cascade,
  realm_key text not null check (realm_key = public.link_realm_key(realm_key) and char_length(realm_key) between 2 and 40),
  name_key text not null check (name_key = lower(name_key) and char_length(name_key) between 2 and 12),
  -- name, realm, class, self, role, roleSource and the four totals, as the protocol's pullMember.
  member jsonb not null check (jsonb_typeof(member) = 'object'),
  primary key (pull_id, realm_key, name_key)
);
create index if not exists pull_members_character on public.pull_members (realm_key, name_key);
alter table public.pull_members enable row level security;
revoke all on public.pull_members from public, anon, authenticated, service_role;

-- 1. Write: the pull rows of one upload, as jsonb [{installId, eventId, capturedAt, summary, members: [{name, realm,
-- ...}]}], every member's realm filled in by the site. A hidden character is skipped; a pull with no member left is
-- not written. A pull already stored (same install and event) is left as it is. The caller has validated every
-- field; the tables' checks are the last line. At most 2,000 pulls a call. Returns the pulls written.
create or replace function public.insert_pull_summaries(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  r jsonb;
  pull bigint;
  written integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Invalid pull batch';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r->'members') <> 'array' then raise exception 'Invalid pull batch'; end if;
    pull := null;
    if exists (
      select 1 from jsonb_array_elements(r->'members') m
      where not exists (select 1 from public.character_suppressions s
        where public.link_realm_key(s.realm) = public.link_realm_key(m->>'realm') and s.character = lower(m->>'name'))
    ) then
      insert into public.pull_summaries (install_id, event_id, captured_at, summary)
        values (r->>'installId', r->>'eventId', (r->>'capturedAt')::timestamptz, r->'summary')
        on conflict (install_id, event_id) do nothing
        returning id into pull;
    end if;
    if pull is not null then
      insert into public.pull_members (pull_id, realm_key, name_key, member)
        select pull, public.link_realm_key(m->>'realm'), lower(m->>'name'), m
        from jsonb_array_elements(r->'members') m
        where not exists (select 1 from public.character_suppressions s
          where public.link_realm_key(s.realm) = public.link_realm_key(m->>'realm') and s.character = lower(m->>'name'))
        on conflict do nothing;
      written := written + 1;
    end if;
  end loop;
  return written;
end;
$$;
revoke all on function public.insert_pull_summaries(jsonb) from public, anon, authenticated;
grant execute on function public.insert_pull_summaries(jsonb) to service_role;

-- 2. Forget a character: delete its member rows, and every pull left with no member. Safe to repeat. The hide form
-- calls it after recording the hide; the trigger below calls it for every hide however it is recorded.
create or replace function public.forget_pull_member(p_realm text, p_name text)
returns void
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  touched bigint[];
begin
  if p_realm is null or p_name is null then raise exception 'Invalid character'; end if;
  with gone as (
    delete from public.pull_members
    where realm_key = public.link_realm_key(p_realm) and name_key = lower(btrim(p_name))
    returning pull_id
  )
  select array_agg(distinct pull_id) into touched from gone;
  if touched is not null then
    delete from public.pull_summaries p
    where p.id = any (touched) and not exists (select 1 from public.pull_members m where m.pull_id = p.id);
  end if;
end;
$$;
revoke all on function public.forget_pull_member(text, text) from public, anon, authenticated;
grant execute on function public.forget_pull_member(text, text) to service_role;

-- 3. Every hide reaches the pulls: the player hide form (suppress_player), a verified owner's opt-out and a row the
-- owner adds by hand all insert into character_suppressions.
create or replace function public.forget_pulls_of_suppressed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.forget_pull_member(new.realm, new.character);
  return new;
end;
$$;
revoke all on function public.forget_pulls_of_suppressed() from public, anon, authenticated;
drop trigger if exists character_suppressions_forget_pulls on public.character_suppressions;
create trigger character_suppressions_forget_pulls
  after insert on public.character_suppressions
  for each row execute function public.forget_pulls_of_suppressed();

-- 4. Retention, run by the snapshot cron: a pull is deleted a year after it was received, its members with it.
create or replace function public.prune_pull_summaries()
returns void
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  delete from public.pull_summaries where received_at < now() - interval '365 days';
end;
$$;
revoke all on function public.prune_pull_summaries() from public, anon, authenticated;
grant execute on function public.prune_pull_summaries() to service_role;
notify pgrst, 'reload schema';

-- Everything stored about one character: select p.*, m.member from public.pull_members m join public.pull_summaries p
--   on p.id = m.pull_id where m.realm_key = public.link_realm_key('<realm>') and m.name_key = '<name, lower case>';
-- Switch the feature off for good and delete every row: delete from public.pull_summaries;  (and unset EVERLOOT_PULL_SUMMARIES)
-- Rollback (run by hand; this deletes every pull row):
--   drop trigger if exists character_suppressions_forget_pulls on public.character_suppressions;
--   drop function if exists public.forget_pulls_of_suppressed();
--   drop function if exists public.prune_pull_summaries();
--   drop function if exists public.forget_pull_member(text, text);
--   drop function if exists public.insert_pull_summaries(jsonb);
--   drop table if exists public.pull_members;
--   drop table if exists public.pull_summaries;
--   notify pgrst, 'reload schema';
