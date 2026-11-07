-- The profile pipeline's first step (design docs/design/2026-11-07-profile-pipeline.md; leaderboards plan and decision
-- of 2026-11-06): the gear boards are scored by a cron every 30 minutes and stored, and each ranked character keeps a
-- history of its numbers, one point per day. Additive: one new table, three new functions, and ranked_gear_board
-- replaced by a version that reads incrementally and names each row's link. Needs 20261107120000_gear_board.sql
-- first. Named after 20261107140000_private_sync_stats_pvp.sql, which production already has, so it sorts after it. Apply before setting EVERLOOT_LEADERBOARDS=1; until then the site never calls anything here. Safe to apply twice.
--
-- The rule for who is on a board lives in one place, ranked_gear_links(): a live link (linked, not frozen, and no
-- frozen link claims it), page public and "Rank my gear" on, gear sync on, not hidden, gear captured in the last 30
-- days. The board rows, the points the cron may write and the points a page may read all go through it, and each page
-- request reads it once to filter the stored board, so turning any of them off takes the character off on the next
-- request, not at the next cron run.

do $$
begin
  if to_regprocedure('public.ranked_gear_board()') is null and to_regprocedure('public.ranked_gear_board(timestamptz, uuid[])') is null then
    raise exception 'Apply 20261107120000_gear_board.sql first';
  end if;
end $$;

-- 1. Who may be on the gear boards right now: link ids only. Each board request reads this once. With p_link_id, the
-- same rule for that one link (a character page's history read), so the rule still lives in one place.
create or replace function public.ranked_gear_links(p_link_id uuid default null)
returns table (link_id uuid)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select l.id
  from public.character_links l
  join public.character_visibility v on v.link_id = l.id
  join public.character_facts f on f.link_id = l.id and f.category = 'gear'
  join public.character_sync_consent c on c.link_id = l.id and c.category = 'gear' and c.revoked_at is null
  where l.status = 'linked' and v.page_public and v.ranked_gear
    and (p_link_id is null or l.id = p_link_id)
    and f.captured_at >= now() - interval '30 days'
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = l.realm_key and s.character = l.name_key)
    and not exists (select 1 from public.character_links o where o.id <> l.id and o.status = 'frozen'
      and (o.link_key = l.link_key or (o.ruleset = l.ruleset and o.realm_key = l.realm_key and o.name_key = l.name_key)));
$$;
revoke all on function public.ranked_gear_links(uuid) from public, anon, authenticated;
grant execute on function public.ranked_gear_links(uuid) to service_role;

-- 2. The board rows the cron scores. With no arguments, every eligible character (the daily full pass); with
-- p_since, only gear received since then, plus any link in p_link_ids (one that came back onto the board without new
-- gear). The zero-argument version from 20261107120000 is replaced; calling it with no arguments still works. No row
-- cap: a capped read could drop changed rows while the cron's watermark moved past them. Oldest arrival first.
drop function if exists public.ranked_gear_board();
create or replace function public.ranked_gear_board(p_since timestamptz default null, p_link_ids uuid[] default null)
returns table (link_id uuid, ruleset text, realm text, name text, race text, class text, faction text, level smallint,
  captured_at timestamptz, received_at timestamptz, data jsonb)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select l.id, l.ruleset, l.realm, l.name, l.race, l.class, l.faction, l.level, f.captured_at, f.received_at, f.data
  from public.ranked_gear_links() r
  join public.character_links l on l.id = r.link_id
  join public.character_facts f on f.link_id = l.id and f.category = 'gear'
  where p_since is null or f.received_at >= p_since or l.id = any(coalesce(p_link_ids, '{}'::uuid[]))
  order by f.received_at, l.id;
$$;
revoke all on function public.ranked_gear_board(timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.ranked_gear_board(timestamptz, uuid[]) to service_role;

-- 3. Tracking: a ranked character's numbers over time, at most one point per link, day and metric. `source` says
-- where the number came from (owner_sync now; addon_pvp and blizzard_api when those land), `version` the formula's
-- version where there is one (Gear Score). Unlinking deletes the history (on delete cascade). Closed to every role:
-- written and read only through the two functions below.
create table if not exists public.character_track (
  link_id uuid not null references public.character_links(id) on delete cascade,
  day date not null,
  metric text not null check (metric in ('level', 'item_level', 'gear_score', 'achievement_points', 'honorable_kills')),
  value numeric not null check (value >= 0),
  source text not null check (source in ('owner_sync', 'addon_pvp', 'blizzard_api')),
  version text check (version is null or length(version) between 1 and 32),
  primary key (link_id, day, metric)
);
alter table public.character_track enable row level security;
revoke all on public.character_track from public, anon, authenticated, service_role;

-- Write points: a jsonb array of { link_id, day, metric, value, source, version? }. A point for a link that is not on
-- the boards right now is skipped; a second point for the same link, day and metric replaces the first (the newest
-- capture of the day wins). Returns how many were written. A day more than one ahead of the server's raises.
create or replace function public.record_character_track(p_points jsonb)
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  written integer;
begin
  if p_points is null or jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 20000 then
    raise exception 'Invalid points';
  end if;
  if exists (select 1 from jsonb_array_elements(p_points) p where (p ->> 'day')::date > current_date + 1) then
    raise exception 'Invalid points';
  end if;
  insert into public.character_track (link_id, day, metric, value, source, version)
    select distinct on (link_id, day, metric) link_id, day, metric, value, source, version
    from (
      select (p ->> 'link_id')::uuid as link_id, (p ->> 'day')::date as day, p ->> 'metric' as metric,
        (p ->> 'value')::numeric as value, p ->> 'source' as source, p ->> 'version' as version, o as ord
      from jsonb_array_elements(p_points) with ordinality as t(p, o)
    ) points
    where points.link_id in (select r.link_id from public.ranked_gear_links() r)
    order by link_id, day, metric, ord desc
  on conflict (link_id, day, metric) do update set value = excluded.value, source = excluded.source, version = excluded.version;
  get diagnostics written = row_count;
  return written;
end;
$$;
revoke all on function public.record_character_track(jsonb) from public, anon, authenticated;
grant execute on function public.record_character_track(jsonb) to service_role;

-- Read one character's points, oldest first, the last 400 days; nothing while it is not on the boards.
create or replace function public.character_track_points(p_link_id uuid)
returns table (day date, metric text, value numeric, source text, version text)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select t.day, t.metric, t.value, t.source, t.version
  from public.character_track t
  where t.link_id = p_link_id and t.day >= current_date - 400
    and exists (select 1 from public.ranked_gear_links(p_link_id))
  order by t.day, t.metric;
$$;
revoke all on function public.character_track_points(uuid) from public, anon, authenticated;
grant execute on function public.character_track_points(uuid) to service_role;
notify pgrst, 'reload schema';

-- Readback (every row t):
--   select 'links' as check, has_function_privilege('service_role', 'public.ranked_gear_links(uuid)', 'EXECUTE') as ok
--   union all select 'board', has_function_privilege('service_role', 'public.ranked_gear_board(timestamptz, uuid[])', 'EXECUTE')
--   union all select 'old board gone', to_regprocedure('public.ranked_gear_board()') is null
--   union all select 'track closed', not has_table_privilege('service_role', 'public.character_track', 'SELECT')
--     and not has_table_privilege('anon', 'public.character_track', 'SELECT')
--     and not has_table_privilege('authenticated', 'public.character_track', 'SELECT')
--   union all select 'write', has_function_privilege('service_role', 'public.record_character_track(jsonb)', 'EXECUTE')
--     and not has_function_privilege('anon', 'public.record_character_track(jsonb)', 'EXECUTE')
--   union all select 'read', has_function_privilege('service_role', 'public.character_track_points(uuid)', 'EXECUTE')
--     and not has_function_privilege('authenticated', 'public.character_track_points(uuid)', 'EXECUTE');
-- Rollback (run by hand; deletes every tracked point, then puts back 20261107120000's board):
--   drop function if exists public.character_track_points(uuid);
--   drop function if exists public.record_character_track(jsonb);
--   drop table if exists public.character_track;
--   drop function if exists public.ranked_gear_board(timestamptz, uuid[]);
--   drop function if exists public.ranked_gear_links(uuid);
--   then run 20261107120000_gear_board.sql again; notify pgrst, 'reload schema';
