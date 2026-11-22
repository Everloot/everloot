-- The armory's two whole-table reads stop unpacking every character's details (lifetime stats follow-up).
-- Production application requires the owner's explicit OK.
-- Why: armory_purge and armory_take read small fields (each section's asOf, revision, retry) out of details, so every
-- run decompressed every row's details. With play history the table grew from 89 MB to 157 MB and armory_purge passed
-- the API's 8 s statement timeout on 2026-11-22 (both regions' runs failed with "Armory RPC HTTP 500"; armory_take
-- peaked at 6 s). Three stored generated columns carry those fields, so both functions read only small columns.
-- Also: armory_purge's 30-day section expiry now covers playHistory, which 20261121100000 left out.
-- Applying it rewrites armory_characters under an exclusive lock (seconds at 157 MB): pause the Armory workflow first.
set lock_timeout = '3s';

alter table public.armory_characters
  add column if not exists details_oldest text generated always as (least(details #>> '{statistics,asOf}', details #>> '{talents,asOf}', details #>> '{professions,asOf}', details #>> '{avatar,asOf}', details #>> '{achievements,asOf}', details #>> '{reputations,asOf}', details #>> '{quests,asOf}', details #>> '{playHistory,asOf}')) stored,
  add column if not exists details_revision text generated always as (details ->> 'revision') stored,
  add column if not exists details_retry boolean generated always as (coalesce(details ->> 'retry' = 'true', false)) stored;
create index if not exists armory_characters_details_oldest on public.armory_characters(details_oldest) where details_oldest is not null;

-- Only rows whose oldest section is past 30 days are unpacked; play history expires like the other sections.
create or replace function public.armory_purge()
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare n integer := 0; removed integer;
begin
  update public.armory_characters set addon_seen=null where addon_seen<current_date-30;
  update public.armory_queue set addon_seen=null where addon_seen<current_date-30;
  -- Optional sections have independent capture dates; refreshing the base profile must not extend them.
  with expired as (
    select c.region,c.slug,array_agg(section.key) as keys
    from public.armory_characters c cross join lateral jsonb_each(c.details) section
    where c.details_oldest<to_char(now() at time zone 'UTC'-interval '30 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      and section.key in ('statistics','talents','professions','avatar','achievements','reputations','quests','playHistory')
      and section.value->>'asOf'<to_char(now() at time zone 'UTC'-interval '30 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    group by c.region,c.slug
  )
  update public.armory_characters c set details=c.details-e.keys from expired e where c.region=e.region and c.slug=e.slug;
  delete from public.armory_members where fetched_at<now()-interval '30 days';
  delete from public.armory_characters where fetched_at<now()-interval '30 days';
  get diagnostics removed = row_count; n:=n+removed;
  delete from public.armory_guilds where fetched_at<now()-interval '30 days';
  get diagnostics removed = row_count; n:=n+removed;
  delete from public.armory_queue where tries>=3 and added_at<now()-interval '90 days';
  get diagnostics removed = row_count;
  return n+removed;
end;
$$;
revoke all on function public.armory_purge() from public, anon, authenticated;
grant execute on function public.armory_purge() to service_role;

-- The same queue and order as before, read from the small columns.
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
      or (c.details_revision is distinct from '1')
      or (c.details_retry and c.checked_at<now()-interval '1 hour')
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

notify pgrst, 'reload schema';
