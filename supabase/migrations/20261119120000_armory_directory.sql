-- /players: stored Blizzard profiles, with optional classifications and gear sorting.
-- Apply after 20261117140000_armory_full_name_search.sql. The owner applies production SQL with explicit OK.
-- Safe twice. Existing name, surname, full-name and region/ruleset/gear indexes cover those filters.
set lock_timeout = '3s';
create index if not exists armory_characters_directory_class on public.armory_characters(lower(class));
create index if not exists armory_characters_directory_race on public.armory_characters(lower(race));
create index if not exists armory_characters_directory_faction on public.armory_characters(lower(faction));
create index if not exists armory_characters_directory_level on public.armory_characters(level);
create index if not exists armory_characters_directory_guild on public.armory_characters(lower(guild_name) text_pattern_ops);
create index if not exists armory_characters_directory_read on public.armory_characters(fetched_at desc);

-- Prefix matches first name, surname or full name, literally; null lists every visible character.
-- Sort descending with missing gear last; name sorts ascending. Identity breaks every tie for stable paging.
-- total repeats the filtered count on every row, before limit/offset (as armory_guild_directory).
create or replace function public.armory_directory(
  p_prefix text, p_class text, p_race text, p_faction text, p_region text, p_ruleset_id smallint,
  p_min_level integer, p_max_level integer, p_guild_prefix text, p_sort text, p_limit integer, p_offset integer)
returns table (region text, slug text, name text, surname text, level smallint, class text, race text,
  faction text, ruleset_id smallint, ruleset text, guild_name text, gear_score numeric, item_level numeric,
  fetched_at timestamptz, total integer)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
select c.region,c.slug,c.name,c.surname,c.level,c.class,c.race,c.faction,c.ruleset_id,c.ruleset,c.guild_name,
  c.gear_score,c.item_level,c.fetched_at,(count(*) over())::integer
from public.armory_characters c
where not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
  and (p_prefix is null or (p_prefix ~ '^[[:alpha:]]{1,24}( [[:alpha:]]{1,24})?$' and
    (lower(c.name) like lower(p_prefix)||'%' or lower(c.surname) like lower(p_prefix)||'%'
      or lower(c.name||' '||c.surname) like lower(p_prefix)||'%')))
  and (p_class is null or lower(c.class)=lower(p_class))
  and (p_race is null or lower(c.race)=lower(p_race))
  and (p_faction is null or lower(c.faction)=lower(p_faction))
  and (p_region is null or c.region=p_region)
  and (p_ruleset_id is null or c.ruleset_id=p_ruleset_id)
  and (p_min_level is null or c.level>=p_min_level)
  and (p_max_level is null or c.level<=p_max_level)
  and (p_guild_prefix is null or (char_length(p_guild_prefix) between 1 and 80
    and p_guild_prefix ~ '^[^%_\\]+$' and lower(c.guild_name) like lower(p_guild_prefix)||'%'))
order by
  case when p_sort='item_level' then c.item_level when p_sort='level' then c.level
    when p_sort in ('name','fetched_at') then null else c.gear_score end desc nulls last,
  case when p_sort='fetched_at' then c.fetched_at end desc nulls last,
  c.name,c.surname,c.region,c.slug
limit least(greatest(coalesce(p_limit,25),0),100) offset greatest(coalesce(p_offset,0),0);
$$;
revoke all on function public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer) to service_role;
notify pgrst, 'reload schema';
reset lock_timeout;

-- Readback:
-- select * from public.armory_directory(null,null,null,null,null,null,null,null,null,'gear_score',1,0);
-- Rollback: drop function public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer);
-- Drop only armory_characters_directory_* indexes from this migration, then notify pgrst, 'reload schema'.
