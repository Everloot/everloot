-- The guild directory on /guilds: every armory guild with what the armory has read of its members.
-- Apply after 20261109120000_armory.sql and 20261025120000_guilds.sql. The maintainer applies it; safe to apply twice.
-- Until it is applied the site lists armory guilds by name only (armory_search_guilds) and says the directory is not
-- ready; nothing else depends on it.
--
-- One row per armory guild: the roster size Blizzard reports, how many of its characters the armory has read, their
-- average item level and how many are level 60, and the newest read of the guild or any of them. Hidden characters
-- are left out of every count (armory hide rule, repeated at read time). A guild hidden through /guilds/hide is left
-- out in the region its realm names: the hide form asks for a realm, the armory keys guilds by region, so a hide on
-- any realm of a region hides the armory guild of that name in that region. That may hide more, never less.
set lock_timeout = '3s';

do $$
begin
  if to_regclass('public.armory_guilds') is null or to_regclass('public.guild_suppressions') is null then
    raise exception 'Apply 20261109120000_armory.sql and 20261025120000_guilds.sql first';
  end if;
end $$;

-- The per-guild counts read the characters of one region by guild without touching the table rows.
create index if not exists armory_characters_guild_directory on public.armory_characters(region,guild_slug)
  include (slug,level,item_level,fetched_at) where guild_slug is not null;

-- Filters: a literal guild-name prefix (2 characters or more, as armory_search_guilds), a region, a ruleset.
-- Sort: 'members' (characters read, the default), 'item_level' (their average) or 'level_60' (how many are 60).
-- At most 100 rows a page; `total` is the number of guilds the filters match, repeated on every row.
create or replace function public.armory_guild_directory(p_prefix text, p_region text, p_ruleset_id smallint, p_sort text, p_limit integer, p_offset integer)
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
revoke all on function public.armory_guild_directory(text, text, smallint, text, integer, integer) from public, anon, authenticated;
grant execute on function public.armory_guild_directory(text, text, smallint, text, integer, integer) to service_role;
notify pgrst, 'reload schema';
reset lock_timeout;

-- Readback (every row t):
--   select has_function_privilege('service_role','public.armory_guild_directory(text,text,smallint,text,integer,integer)','EXECUTE')
--     and not has_function_privilege('anon','public.armory_guild_directory(text,text,smallint,text,integer,integer)','EXECUTE') as ok;
--   select count(*) >= 0 as ok from public.armory_guild_directory(null,null,null,'members',1,0);
-- Rollback:
--   drop function if exists public.armory_guild_directory(text, text, smallint, text, integer, integer);
--   drop index if exists public.armory_characters_guild_directory;
--   notify pgrst, 'reload schema';
