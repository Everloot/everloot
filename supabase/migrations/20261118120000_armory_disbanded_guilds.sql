-- Disbanded guilds leave the guild directory on /guilds (its sorts are the guild rankings) and the armory's guild counts.
-- Apply after 20261117170000_armory_guild_directory.sql. The maintainer applies it; safe to apply twice.
--
-- Blizzard answers a disbanded guild with a record named "DELETED", and the crawler stores that name as it comes
-- (kb/src/armory/parse.ts parseGuild). A guild whose stored name is exactly 'DELETED' (case as Blizzard writes it) is
-- read as disbanded: not listed, not counted. The row stays in armory_guilds; nothing is deleted. The website applies
-- the same rule (web/src/lib/armory-guilds.ts isDisbandedGuild), so pages are right before this is applied, except
-- the directory's total, which counts them until then.
set lock_timeout = '3s';

do $$
begin
  if to_regprocedure('public.armory_guild_directory(text,text,smallint,text,integer,integer)') is null then
    raise exception 'Apply 20261117170000_armory_guild_directory.sql first';
  end if;
end $$;

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
    and g.name<>'DELETED'
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

create or replace function public.armory_counts()
returns table (region text, ruleset_id smallint, ruleset text, characters integer, guilds integer, newest timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with populations as (
  select c.region,c.ruleset_id,c.ruleset,1 as characters,0 as guilds,c.fetched_at
  from public.armory_characters c where not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
  union all select g.region,g.ruleset_id,g.ruleset,0,1,g.fetched_at from public.armory_guilds g where g.name<>'DELETED'
)
select p.region,p.ruleset_id,p.ruleset,sum(p.characters)::integer,sum(p.guilds)::integer,max(p.fetched_at)
from populations p group by p.region,p.ruleset_id,p.ruleset order by p.region,p.ruleset_id;
$$;
revoke all on function public.armory_counts() from public, anon, authenticated;
grant execute on function public.armory_counts() to service_role;

notify pgrst, 'reload schema';
reset lock_timeout;

-- Readback (every row t):
--   select not exists(select 1 from public.armory_guild_directory(null,null,null,'members',100,0) where name='DELETED') as ok;
--   select has_function_privilege('service_role','public.armory_counts()','EXECUTE')
--     and not has_function_privilege('anon','public.armory_counts()','EXECUTE') as ok;
-- Rollback: apply 20261117170000_armory_guild_directory.sql again, and the armory_counts definition of
--   20261109120000_armory.sql (its create or replace function public.armory_counts() block and its grants).
