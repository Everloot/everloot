-- Classification boards; production application requires the owner's explicit OK.
set lock_timeout = '3s';
create or replace function public.armory_board_filtered(p_metric text, p_region text, p_ruleset_id smallint, p_class text, p_faction text, p_limit integer)
returns table (rank integer, region text, slug text, name text, surname text, level smallint, class text, race text, faction text, ruleset text, ruleset_id smallint, guild_name text, guild_slug text, value numeric, fetched_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with scores as (
  select c.*,case p_metric when 'item_level' then c.item_level when 'gear_score' then c.gear_score when 'honorable_kills' then c.honorable_kills::numeric end as value
  from public.armory_characters c where (p_region is null or c.region=p_region) and (p_ruleset_id is null or c.ruleset_id=p_ruleset_id)
    and (p_class is null or c.class=p_class) and (p_faction is null or c.faction=p_faction)
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
)
select row_number() over(order by s.value desc,s.last_login desc nulls last,s.region,s.slug)::integer,
  s.region,s.slug,s.name,s.surname,s.level,s.class,s.race,s.faction,s.ruleset,s.ruleset_id,s.guild_name,s.guild_slug,s.value,s.fetched_at
from scores s where s.value is not null order by s.value desc,s.last_login desc nulls last,s.region,s.slug
limit least(greatest(coalesce(p_limit,100),0),100);
$$;
revoke all on function public.armory_board_filtered(text, text, smallint, text, text, integer) from public, anon, authenticated;
grant execute on function public.armory_board_filtered(text, text, smallint, text, text, integer) to service_role;

create or replace function public.armory_board_top_per_class(p_metric text, p_region text, p_ruleset_id smallint)
returns table (rank integer, region text, slug text, name text, surname text, level smallint, class text, race text, faction text, ruleset text, ruleset_id smallint, guild_name text, guild_slug text, value numeric, fetched_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with scores as (
  select c.*,case p_metric when 'item_level' then c.item_level when 'gear_score' then c.gear_score when 'honorable_kills' then c.honorable_kills::numeric end as value
  from public.armory_characters c where (p_region is null or c.region=p_region) and (p_ruleset_id is null or c.ruleset_id=p_ruleset_id)
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
), winners as (
  select s.*,row_number() over(partition by s.class order by s.value desc,s.last_login desc nulls last,s.region,s.slug) as place
  from scores s where s.value is not null
)
select 1,
  s.region,s.slug,s.name,s.surname,s.level,s.class,s.race,s.faction,s.ruleset,s.ruleset_id,s.guild_name,s.guild_slug,s.value,s.fetched_at
from winners s where s.place=1 order by s.class;
$$;
revoke all on function public.armory_board_top_per_class(text, text, smallint) from public, anon, authenticated;
grant execute on function public.armory_board_top_per_class(text, text, smallint) to service_role;

notify pgrst, 'reload schema';
