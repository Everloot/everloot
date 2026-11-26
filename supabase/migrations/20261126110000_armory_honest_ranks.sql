-- Ranks that tell the truth (site v5, lane 5).
--
-- 1. armory_rank gains one column, tied: how many other characters on the same board (region and ruleset, hidden ones
--    out) have exactly the character's value. rank stays 1 + the count strictly above, so ten characters on item level
--    61 all read "#1 (tied with 9)" instead of each reading "#1". A function's returned columns cannot change in place,
--    so it is dropped and created again in one transaction, with its grants. The body reads the board once and counts
--    every metric from that one pass, rather than two subqueries per metric.
-- 2. armory_guild_directory gains a seven-argument form with p_min_read: guilds with fewer members read are left out
--    before the sort, the limit and the total, so the /rankings guild gear board keeps ten rows of guilds with at least
--    that many read. A null p_min_read lists every guild, as the six-argument form does. The six-argument form is left
--    exactly as it is, so /guilds and every caller that does not pass p_min_read reads as before.
--
-- Nothing new is read or published: both answer from the columns the armory already stores. Safe to apply twice. Apply
-- after 20261121100000_armory_play_history.sql and 20261118120000_armory_disbanded_guilds.sql. The owner applies this:
-- the site never applies a migration. Until it is applied, rank pages show "#n of N" as today (no tied column), and the
-- guild gear board reads the six-argument directory as today.
set lock_timeout = '3s';

begin;

drop function if exists public.armory_rank(text, text);

create function public.armory_rank(p_region text, p_slug text)
returns table (metric text, rank integer, "of" integer, tied integer)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with target as (
  select t.* from public.armory_characters t where t.region=p_region and t.slug=p_slug
    and not exists(select 1 from public.armory_hides h where h.region=t.region and h.slug=t.slug)
), mine as (
  select m.metric,m.value from target t cross join lateral (values
    ('item_level',t.item_level),('gear_score',t.gear_score),('honorable_kills',t.honorable_kills::numeric),
    ('quests_completed',t.quests_completed::numeric),('creatures_killed',t.creatures_killed::numeric),('fish_caught',t.fish_caught::numeric),
    ('flight_paths',t.flight_paths::numeric),('dungeons_entered',t.dungeons_entered::numeric),('total_deaths',t.total_deaths::numeric)
  ) as m(metric,value) where m.value is not null
), board as (
  select b.metric,b.value from target t
  join public.armory_characters c on c.region=t.region and c.ruleset_id=t.ruleset_id
  cross join lateral (values
    ('item_level',c.item_level),('gear_score',c.gear_score),('honorable_kills',c.honorable_kills::numeric),
    ('quests_completed',c.quests_completed::numeric),('creatures_killed',c.creatures_killed::numeric),('fish_caught',c.fish_caught::numeric),
    ('flight_paths',c.flight_paths::numeric),('dungeons_entered',c.dungeons_entered::numeric),('total_deaths',c.total_deaths::numeric)
  ) as b(metric,value)
  where b.value is not null and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
)
select m.metric,
  (1+count(*) filter (where b.value>m.value))::integer,
  count(*)::integer,
  -- The character itself is on the board with its own value; the others on that value are the tie.
  (count(*) filter (where b.value=m.value)-1)::integer
from mine m join board b on b.metric=m.metric
group by m.metric
order by array_position(array['item_level','gear_score','honorable_kills','quests_completed','creatures_killed','fish_caught',
  'flight_paths','dungeons_entered','total_deaths'],m.metric);
$$;
revoke all on function public.armory_rank(text, text) from public, anon, authenticated;
grant execute on function public.armory_rank(text, text) to service_role;

create or replace function public.armory_guild_directory(p_prefix text, p_region text, p_ruleset_id smallint, p_sort text, p_limit integer, p_offset integer, p_min_read integer)
returns table (region text, slug text, name text, faction text, ruleset_id smallint, ruleset text, member_count integer,
  members_read integer, average_item_level numeric, level_60 integer, fetched_at timestamptz, total integer)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with read as (
  select c.region,c.guild_slug,count(*)::integer as members_read,round(avg(c.item_level),1) as average_item_level,
    (count(*) filter (where c.level=60))::integer as level_60,max(c.fetched_at) as newest
  from public.armory_characters c
  where c.guild_slug is not null and (p_region is null or c.region=p_region)
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
  group by c.region,c.guild_slug
), listed as (
  select g.region,g.slug,g.name,g.faction,g.ruleset_id,g.ruleset,g.member_count,coalesce(r.members_read,0) as members_read,
    r.average_item_level,coalesce(r.level_60,0) as level_60,greatest(g.fetched_at,r.newest) as fetched_at
  from public.armory_guilds g left join read r on r.region=g.region and r.guild_slug=g.slug
  where (p_region is null or g.region=p_region) and (p_ruleset_id is null or g.ruleset_id=p_ruleset_id)
    and g.name<>'DELETED'
    and (p_min_read is null or coalesce(r.members_read,0)>=p_min_read)
    and (p_prefix is null or (char_length(p_prefix)>=2 and p_prefix ~ '^[^%_\\]+$' and lower(g.name) like lower(p_prefix)||'%'))
    and not exists(select 1 from public.guild_suppressions s
      where s.guild_key=lower(g.name) and s.realm_key ~ ('(^| )' || g.region || '[0-9]*( |$)'))
)
select l.region,l.slug,l.name,l.faction,l.ruleset_id,l.ruleset,l.member_count,l.members_read,l.average_item_level,l.level_60,
  l.fetched_at,(count(*) over())::integer
from listed l
order by case p_sort when 'item_level' then l.average_item_level when 'level_60' then l.level_60 else l.members_read end desc nulls last,
  l.members_read desc,l.name,l.region,l.slug
limit least(greatest(coalesce(p_limit,50),0),100) offset greatest(coalesce(p_offset,0),0);
$$;
revoke all on function public.armory_guild_directory(text, text, smallint, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.armory_guild_directory(text, text, smallint, text, integer, integer, integer) to service_role;

commit;

notify pgrst, 'reload schema';
reset lock_timeout;

-- Readback (every row t):
--   select exists(select 1 from pg_proc where oid='public.armory_rank(text,text)'::regprocedure
--     and pg_get_function_result(oid) like '%tied integer%') as ok;
--   select to_regprocedure('public.armory_guild_directory(text,text,smallint,text,integer,integer,integer)') is not null as ok;
--   select has_function_privilege('service_role','public.armory_rank(text,text)','EXECUTE')
--     and not has_function_privilege('anon','public.armory_rank(text,text)','EXECUTE')
--     and has_function_privilege('service_role','public.armory_guild_directory(text,text,smallint,text,integer,integer,integer)','EXECUTE')
--     and not has_function_privilege('anon','public.armory_guild_directory(text,text,smallint,text,integer,integer,integer)','EXECUTE') as ok;
--   select coalesce(min(members_read),5)>=5 as ok from public.armory_guild_directory(null,null,null,'item_level',10,0,5);
--   select count(*)>=0 as ok from public.armory_rank('us','kaz-sneaks');
-- Rollback: drop function public.armory_guild_directory(text,text,smallint,text,integer,integer,integer); then drop
--   public.armory_rank(text,text) and create 20261121100000_armory_play_history.sql's armory_rank again, with its grants.
