-- Armory discovery: spider the guilds stored characters name, refresh active and top characters daily, and count
-- runs that made no Blizzard call so the hourly job can fail when the crawl starves.
-- Apply after 20261112190000_armory_profiles.sql and before the crawler that calls armory_spider_guilds and
-- armory_record_run ships; until then each crawl still reads, then fails naming this file. Safe to apply twice.
set lock_timeout = '3s';

-- 1. Run-to-run state: one row per region, the number of consecutive runs with zero Blizzard calls.
create table if not exists public.armory_runs (
  region text primary key check (region in ('us','eu')),
  calls integer not null check (calls >= 0),
  zero_runs integer not null default 0 check (zero_runs >= 0),
  ran_at timestamptz not null
);
alter table public.armory_runs enable row level security;
revoke all on public.armory_runs from public, anon, authenticated, service_role;
do $$ begin
  if exists(select 1 from pg_roles where rolname='backup_exporter') then
    grant select on public.armory_runs to backup_exporter;
    drop policy if exists backup_exporter_select on public.armory_runs;
    create policy backup_exporter_select on public.armory_runs for select to backup_exporter using (true);
  end if;
end $$;

-- Record one finished run; returns how many runs in a row, this one included, made no call.
create or replace function public.armory_record_run(p_region text, p_calls integer)
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare streak integer;
begin
  if p_region is null or p_region not in ('us','eu') or p_calls is null or p_calls < 0 then
    raise exception 'Invalid armory run';
  end if;
  insert into public.armory_runs(region,calls,zero_runs,ran_at)
  values(p_region,p_calls,case when p_calls=0 then 1 else 0 end,now())
  on conflict(region) do update set calls=excluded.calls,ran_at=excluded.ran_at,
    zero_runs=case when excluded.calls=0 then public.armory_runs.zero_runs+1 else 0 end
  returning zero_runs into streak;
  return streak;
end $$;
revoke all on function public.armory_record_run(text, integer) from public, anon, authenticated;
grant execute on function public.armory_record_run(text, integer) to service_role;

-- 2. Roster spider: queue every guild a stored character names that was never read and is not queued yet,
-- guilds with the most stored characters first, at most p_limit. Freshly read characters already queue their
-- guild in armory_upsert_characters; this also covers rows stored before that, and a guild whose queue row was
-- dropped. Roster members are queued by armory_upsert_guild, which skips hidden characters.
create or replace function public.armory_spider_guilds(p_region text, p_limit integer)
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare written integer;
begin
  perform pg_advisory_xact_lock(71409120000);
  if p_region is null or p_region not in ('us','eu') then raise exception 'Invalid armory region'; end if;
  insert into public.armory_queue(region,kind,slug,source)
  select p_region,'guild',s.guild_slug,'spider' from (
    select c.guild_slug from public.armory_characters c
    where c.region=p_region and c.guild_slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$'
      and c.guild_slug=lower(c.guild_slug) and char_length(c.guild_slug)<=64
      and not exists(select 1 from public.armory_guilds g where g.region=p_region and g.slug=c.guild_slug)
      and not exists(select 1 from public.armory_queue q where q.region=p_region and q.kind='guild' and q.slug=c.guild_slug)
    group by c.guild_slug
    order by count(*) desc, c.guild_slug
    limit greatest(coalesce(p_limit,0),0)
  ) s
  on conflict do nothing;
  get diagnostics written = row_count;
  return written;
end $$;
revoke all on function public.armory_spider_guilds(text, integer) from public, anon, authenticated;
grant execute on function public.armory_spider_guilds(text, integer) to service_role;

-- 3. Take order:
--   0. stored rows checked 25+ days ago, so retention (30 days, armory_purge) never deletes a row the queue starved;
--   1. the queue: for guilds, never-read ones before stored ones; then oldest first;
--   2. due refreshes, oldest check first. A character is due after 20 days, or after 1 day when it is "hot":
--      it logged in or was seen by the addon in the last 3 days (last_login, addon_seen), or it is in the top 100
--      of its region and ruleset by item level, gear score or honorable kills. Linked characters stay daily, and
--      the details revision and retry rules are unchanged. A daily refresh of an unchanged character is one 304.
create or replace function public.armory_take(p_region text, p_kind text, p_limit integer)
returns table (slug text, tries smallint, stored boolean)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with recursive rulesets(id) as (
    -- The distinct rulesets of the region, one index probe each.
    select min(c.ruleset_id) from public.armory_characters c where p_kind='character' and c.region=p_region
    union all
    select (select min(c.ruleset_id) from public.armory_characters c where c.region=p_region and c.ruleset_id>r.id)
    from rulesets r where r.id is not null
  ), ranked as (
    select t.slug from rulesets r cross join lateral (
      (select c.slug from public.armory_characters c where c.region=p_region and c.ruleset_id=r.id and c.item_level is not null
        order by c.item_level desc limit 100)
      union
      (select c.slug from public.armory_characters c where c.region=p_region and c.ruleset_id=r.id and c.gear_score is not null
        order by c.gear_score desc limit 100)
      union
      (select c.slug from public.armory_characters c where c.region=p_region and c.ruleset_id=r.id and c.honorable_kills is not null
        order by c.honorable_kills desc limit 100)
    ) t
    where r.id is not null
  ), queued as (
    select q.slug, q.tries, q.added_at,
      case q.kind when 'character' then exists(select 1 from public.armory_characters c where c.region=q.region and c.slug=q.slug)
        else exists(select 1 from public.armory_guilds g where g.region=q.region and g.slug=q.slug) end as stored
    from public.armory_queue q where q.region=p_region and q.kind=p_kind and q.next_at<=now()
      and (p_kind<>'character' or not exists(select 1 from public.armory_hides h where h.region=q.region and h.slug=q.slug))
  ), candidates as (
    select q.slug, q.tries, q.stored, 1 as priority, case when p_kind='guild' and q.stored then 1 else 0 end as tier, q.added_at as at
    from queued q
    union all
    select c.slug, 0::smallint, true, case when c.checked_at<now()-interval '25 days' then 0 else 2 end, 0, c.checked_at
    from public.armory_characters c
    where p_kind='character' and c.region=p_region and (
      c.checked_at<now()-interval '20 days'
      or (c.details->>'revision' is distinct from '1')
      or (c.details->>'retry'='true' and c.checked_at<now()-interval '1 hour')
      or (c.checked_at<now()-interval '1 day' and (
        exists(select 1 from public.armory_links a where a.region=c.region and a.slug=c.slug)
        or c.last_login>now()-interval '3 days'
        or c.addon_seen>=current_date-3
        or c.slug in (select k.slug from ranked k)))
    )
      and not exists(select 1 from public.armory_queue q where q.region=c.region and q.kind=p_kind and q.slug=c.slug)
      and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
    union all
    select g.slug, 0::smallint, true, case when g.checked_at<now()-interval '25 days' then 0 else 2 end, 0, g.checked_at
    from public.armory_guilds g
    where p_kind='guild' and g.region=p_region and g.checked_at<now()-interval '20 days'
      and not exists(select 1 from public.armory_queue q where q.region=g.region and q.kind=p_kind and q.slug=g.slug)
  )
  select c.slug,c.tries,c.stored from candidates c order by c.priority,c.tier,c.at,c.slug limit greatest(coalesce(p_limit,0),0);
$$;
revoke all on function public.armory_take(text, text, integer) from public, anon, authenticated;
grant execute on function public.armory_take(text, text, integer) to service_role;

-- Rollback: re-run the armory_take definition in 20261112190000_armory_profiles.sql, then
-- drop function if exists public.armory_spider_guilds(text, integer);
-- drop function if exists public.armory_record_run(text, integer);
-- drop table if exists public.armory_runs;
