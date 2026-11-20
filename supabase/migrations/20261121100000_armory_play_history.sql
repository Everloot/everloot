-- Lifetime stats, part 1 (docs/superpowers/specs/2026-11-20-lifetime-stats-design.md): Blizzard's play history,
-- crawled into armory_characters.details.playHistory (kb/src/armory/details.ts), ranked on six boards.
-- Production application requires the owner's explicit OK.
--
-- 1. Six stored generated columns read the ranked counts from details.playHistory.ranked, so no upsert changes. A value
--    that is not a JSON number gives null, never a failed row write.
-- 2. The board and rank functions take the six columns as metrics; signatures, grants and ordering are unchanged.
-- 3. character_visibility.show_history, off by default: a linked character's page shows play history only with it on.
set lock_timeout = '3s';

-- 1. Ranked columns.
alter table public.armory_characters
  add column if not exists quests_completed numeric generated always as (case when jsonb_typeof(details #> '{playHistory,ranked,quests}') = 'number'
    then (details #>> '{playHistory,ranked,quests}')::numeric end) stored,
  add column if not exists creatures_killed numeric generated always as (case when jsonb_typeof(details #> '{playHistory,ranked,creatures}') = 'number'
    then (details #>> '{playHistory,ranked,creatures}')::numeric end) stored,
  add column if not exists fish_caught numeric generated always as (case when jsonb_typeof(details #> '{playHistory,ranked,fish}') = 'number'
    then (details #>> '{playHistory,ranked,fish}')::numeric end) stored,
  add column if not exists flight_paths numeric generated always as (case when jsonb_typeof(details #> '{playHistory,ranked,flights}') = 'number'
    then (details #>> '{playHistory,ranked,flights}')::numeric end) stored,
  add column if not exists dungeons_entered numeric generated always as (case when jsonb_typeof(details #> '{playHistory,ranked,dungeons}') = 'number'
    then (details #>> '{playHistory,ranked,dungeons}')::numeric end) stored,
  add column if not exists total_deaths numeric generated always as (case when jsonb_typeof(details #> '{playHistory,ranked,deaths}') = 'number'
    then (details #>> '{playHistory,ranked,deaths}')::numeric end) stored;
create index if not exists armory_characters_quests_completed on public.armory_characters(region,ruleset_id,quests_completed desc);
create index if not exists armory_characters_creatures_killed on public.armory_characters(region,ruleset_id,creatures_killed desc);
create index if not exists armory_characters_fish_caught on public.armory_characters(region,ruleset_id,fish_caught desc);
create index if not exists armory_characters_flight_paths on public.armory_characters(region,ruleset_id,flight_paths desc);
create index if not exists armory_characters_dungeons_entered on public.armory_characters(region,ruleset_id,dungeons_entered desc);
create index if not exists armory_characters_total_deaths on public.armory_characters(region,ruleset_id,total_deaths desc);

-- 2. Boards and ranks.
create or replace function public.armory_board(p_metric text, p_region text, p_ruleset_id smallint, p_limit integer)
returns table (rank integer, region text, slug text, name text, surname text, level smallint, class text, race text, faction text, ruleset text, ruleset_id smallint, guild_name text, value numeric, fetched_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with scores as (
  select c.*,case p_metric when 'item_level' then c.item_level when 'gear_score' then c.gear_score when 'honorable_kills' then c.honorable_kills::numeric
    when 'quests_completed' then c.quests_completed when 'creatures_killed' then c.creatures_killed when 'fish_caught' then c.fish_caught when 'flight_paths' then c.flight_paths when 'dungeons_entered' then c.dungeons_entered when 'total_deaths' then c.total_deaths end as value
  from public.armory_characters c where (p_region is null or c.region=p_region) and (p_ruleset_id is null or c.ruleset_id=p_ruleset_id)
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
)
select row_number() over(order by s.value desc,s.last_login desc nulls last,s.region,s.slug)::integer,
  s.region,s.slug,s.name,s.surname,s.level,s.class,s.race,s.faction,s.ruleset,s.ruleset_id,s.guild_name,s.value,s.fetched_at
from scores s where s.value is not null order by s.value desc,s.last_login desc nulls last,s.region,s.slug
limit least(greatest(coalesce(p_limit,100),0),100);
$$;
revoke all on function public.armory_board(text, text, smallint, integer) from public, anon, authenticated;
grant execute on function public.armory_board(text, text, smallint, integer) to service_role;

create or replace function public.armory_board_filtered(p_metric text, p_region text, p_ruleset_id smallint, p_class text, p_faction text, p_limit integer)
returns table (rank integer, region text, slug text, name text, surname text, level smallint, class text, race text, faction text, ruleset text, ruleset_id smallint, guild_name text, guild_slug text, value numeric, fetched_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with scores as (
  select c.*,case p_metric when 'item_level' then c.item_level when 'gear_score' then c.gear_score when 'honorable_kills' then c.honorable_kills::numeric
    when 'quests_completed' then c.quests_completed when 'creatures_killed' then c.creatures_killed when 'fish_caught' then c.fish_caught when 'flight_paths' then c.flight_paths when 'dungeons_entered' then c.dungeons_entered when 'total_deaths' then c.total_deaths end as value
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
  select c.*,case p_metric when 'item_level' then c.item_level when 'gear_score' then c.gear_score when 'honorable_kills' then c.honorable_kills::numeric
    when 'quests_completed' then c.quests_completed when 'creatures_killed' then c.creatures_killed when 'fish_caught' then c.fish_caught when 'flight_paths' then c.flight_paths when 'dungeons_entered' then c.dungeons_entered when 'total_deaths' then c.total_deaths end as value
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

create or replace function public.armory_rank(p_region text, p_slug text)
returns table (metric text, rank integer, "of" integer)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with target as (
  select t.* from public.armory_characters t where t.region=p_region and t.slug=p_slug
    and not exists(select 1 from public.armory_hides h where h.region=t.region and h.slug=t.slug)
)
select 'item_level'::text,
  (1+(select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.item_level>t.item_level))::integer,
  (select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.item_level is not null)::integer
from target t where t.item_level is not null
union all
select 'gear_score'::text,
  (1+(select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.gear_score>t.gear_score))::integer,
  (select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.gear_score is not null)::integer
from target t where t.gear_score is not null
union all
select 'honorable_kills'::text,
  (1+(select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.honorable_kills>t.honorable_kills))::integer,
  (select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.honorable_kills is not null)::integer
from target t where t.honorable_kills is not null
union all
select 'quests_completed'::text,
  (1+(select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.quests_completed>t.quests_completed))::integer,
  (select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.quests_completed is not null)::integer
from target t where t.quests_completed is not null
union all
select 'creatures_killed'::text,
  (1+(select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.creatures_killed>t.creatures_killed))::integer,
  (select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.creatures_killed is not null)::integer
from target t where t.creatures_killed is not null
union all
select 'fish_caught'::text,
  (1+(select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.fish_caught>t.fish_caught))::integer,
  (select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.fish_caught is not null)::integer
from target t where t.fish_caught is not null
union all
select 'flight_paths'::text,
  (1+(select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.flight_paths>t.flight_paths))::integer,
  (select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.flight_paths is not null)::integer
from target t where t.flight_paths is not null
union all
select 'dungeons_entered'::text,
  (1+(select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.dungeons_entered>t.dungeons_entered))::integer,
  (select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.dungeons_entered is not null)::integer
from target t where t.dungeons_entered is not null
union all
select 'total_deaths'::text,
  (1+(select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.total_deaths>t.total_deaths))::integer,
  (select count(*) from public.armory_characters c where c.region=t.region and c.ruleset_id=t.ruleset_id
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug) and c.total_deaths is not null)::integer
from target t where t.total_deaths is not null;
$$;
revoke all on function public.armory_rank(text, text) from public, anon, authenticated;
grant execute on function public.armory_rank(text, text) to service_role;

-- 3. The show_history switch.
alter table public.character_visibility add column if not exists show_history boolean not null default false;

create or replace function public.set_visibility(p_user_id uuid, p_id uuid, p_flags jsonb)
returns boolean
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  flag text;
  updated integer;
begin
  if p_flags is null or jsonb_typeof(p_flags) <> 'object' then raise exception 'Invalid visibility'; end if;
  for flag in select jsonb_object_keys(p_flags) loop
    if flag not in ('page_public', 'show_gear', 'show_collections', 'show_gold', 'show_guild', 'show_talents', 'show_professions',
        'show_reputations', 'show_raids', 'show_stats', 'show_pvp', 'show_history', 'ranked_gear', 'ranked_achievements', 'ranked_gold', 'indexable')
      or jsonb_typeof(p_flags -> flag) <> 'boolean' then
      raise exception 'Invalid visibility';
    end if;
  end loop;
  update public.character_visibility v set
      page_public = coalesce((p_flags ->> 'page_public')::boolean, v.page_public),
      show_gear = coalesce((p_flags ->> 'show_gear')::boolean, v.show_gear),
      show_collections = coalesce((p_flags ->> 'show_collections')::boolean, v.show_collections),
      show_gold = coalesce((p_flags ->> 'show_gold')::boolean, v.show_gold),
      show_guild = coalesce((p_flags ->> 'show_guild')::boolean, v.show_guild),
      show_talents = coalesce((p_flags ->> 'show_talents')::boolean, v.show_talents),
      show_professions = coalesce((p_flags ->> 'show_professions')::boolean, v.show_professions),
      show_reputations = coalesce((p_flags ->> 'show_reputations')::boolean, v.show_reputations),
      show_raids = coalesce((p_flags ->> 'show_raids')::boolean, v.show_raids),
      show_stats = coalesce((p_flags ->> 'show_stats')::boolean, v.show_stats),
      show_pvp = coalesce((p_flags ->> 'show_pvp')::boolean, v.show_pvp),
      show_history = coalesce((p_flags ->> 'show_history')::boolean, v.show_history),
      ranked_gear = coalesce((p_flags ->> 'ranked_gear')::boolean, v.ranked_gear),
      ranked_achievements = coalesce((p_flags ->> 'ranked_achievements')::boolean, v.ranked_achievements),
      ranked_gold = coalesce((p_flags ->> 'ranked_gold')::boolean, v.ranked_gold),
      indexable = coalesce((p_flags ->> 'indexable')::boolean, v.indexable),
      updated_at = now()
    from public.character_links l
    where v.link_id = l.id and l.id = p_id and l.user_id = p_user_id;
  get diagnostics updated = row_count;
  return updated = 1;
end;
$$;
revoke all on function public.set_visibility(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_visibility(uuid, uuid, jsonb) to service_role;

-- Its return type gains a column, so it is dropped first.
drop function if exists public.public_character_armory(text, text, text);
create or replace function public.public_character_armory(p_ruleset text, p_realm_slug text, p_name text)
returns table (region text, slug text, show_gear boolean, show_stats boolean, show_talents boolean, show_pvp boolean,
  show_professions boolean, show_reputations boolean, show_collections boolean, show_history boolean)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select a.region, a.slug, v.show_gear, v.show_stats, v.show_talents, v.show_pvp, v.show_professions,
    v.show_reputations, v.show_collections, v.show_history
  from public.character_links l
  join public.character_visibility v on v.link_id = l.id
  join public.armory_links a on a.link_id = l.id
  where l.ruleset = p_ruleset and l.name_key = lower(p_name) and l.realm_key = public.link_realm_key(p_realm_slug)
    and l.status = 'linked' and v.page_public
    and exists (select 1 from public.armory_public_link(a.region, a.slug) p where p.ruleset = l.ruleset and p.name = l.name)
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = l.realm_key and s.character = l.name_key)
    and not exists (select 1 from public.character_links o where o.id <> l.id and o.status = 'frozen'
      and (o.link_key = l.link_key or (o.ruleset = l.ruleset and o.realm_key = l.realm_key and o.name_key = l.name_key)))
  limit 1;
$$;
revoke all on function public.public_character_armory(text, text, text) from public, anon, authenticated;
grant execute on function public.public_character_armory(text, text, text) to service_role;
notify pgrst, 'reload schema';

notify pgrst, 'reload schema';
