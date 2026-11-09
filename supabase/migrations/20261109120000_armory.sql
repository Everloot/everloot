-- Blizzard Forever armory: isolated API data, never part of addon data or exports.
-- Apply 20261021130000_players.sql and 20261022160000_players_realm_key.sql first (guild seeds).
-- Safe to apply twice: tables/indexes are conditional, functions and privileges are replaced.
set lock_timeout = '3s';

create table if not exists public.armory_characters (
  region text check (region in ('us','eu')),
  slug text,
  character_id bigint not null, name text not null, surname text not null,
  level smallint not null check (level between 1 and 60),
  ruleset_id smallint not null, ruleset text not null, race_id smallint not null, race text not null,
  class_id smallint not null, class text not null, faction text not null check (faction in ('Alliance','Horde')),
  gender text, guild_slug text, guild_name text, guild_id bigint, last_login timestamptz,
  equipped_item_level smallint, average_item_level smallint, item_level numeric(6,2), gear_score numeric(6,2),
  honorable_kills integer, pvp_rank smallint, equipment jsonb not null default '[]'::jsonb,
  last_modified text, first_seen timestamptz not null default now(),
  fetched_at timestamptz not null, checked_at timestamptz not null,
  primary key (region,slug)
);
create table if not exists public.armory_guilds (
  region text check (region in ('us','eu')),
  slug text,
  guild_id bigint not null, name text not null, faction text not null, ruleset_id smallint not null, ruleset text not null,
  member_count integer not null default 0, created_at timestamptz, last_modified text,
  first_seen timestamptz not null default now(), fetched_at timestamptz not null, checked_at timestamptz not null,
  primary key(region,slug)
);
create table if not exists public.armory_members (
  region text check (region in ('us','eu')), guild_slug text, character_slug text,
  name text, surname text, level smallint, class_id smallint, race_id smallint, rank smallint,
  fetched_at timestamptz not null,
  primary key(region,guild_slug,character_slug),
  foreign key(region,guild_slug) references public.armory_guilds(region,slug) on delete cascade
);
create table if not exists public.armory_queue (
  region text check (region in ('us','eu')), kind text check(kind in ('character','guild')),
  slug text,
  source text not null, added_at timestamptz not null default now(), tries smallint not null default 0,
  next_at timestamptz not null default now(), primary key(region,kind,slug)
);
create table if not exists public.armory_hides (
  region text check (region in ('us','eu')),
  slug text,
  hidden_at timestamptz not null default now(), primary key(region,slug)
);

-- Replace the checks on reapply too; character surname validation belongs to the crawler.
alter table public.armory_characters drop constraint if exists armory_characters_slug_check;
alter table public.armory_characters add constraint armory_characters_slug_check
  check (slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$' and slug = lower(slug) and char_length(slug) <= 64);
alter table public.armory_guilds drop constraint if exists armory_guilds_slug_check;
alter table public.armory_guilds add constraint armory_guilds_slug_check
  check (slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$' and slug = lower(slug) and char_length(slug) <= 64);
alter table public.armory_queue drop constraint if exists armory_queue_slug_check;
alter table public.armory_queue add constraint armory_queue_slug_check
  check (slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$' and slug = lower(slug) and char_length(slug) <= 64);
alter table public.armory_hides drop constraint if exists armory_hides_slug_check;
alter table public.armory_hides add constraint armory_hides_slug_check
  check (slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$' and slug = lower(slug) and char_length(slug) <= 64);

create index if not exists armory_characters_checked on public.armory_characters(checked_at);
create index if not exists armory_characters_item_level on public.armory_characters(region,ruleset_id,item_level desc);
create index if not exists armory_characters_gear_score on public.armory_characters(region,ruleset_id,gear_score desc);
create index if not exists armory_characters_kills on public.armory_characters(region,ruleset_id,honorable_kills desc);
create index if not exists armory_characters_name on public.armory_characters(lower(name) text_pattern_ops);
create index if not exists armory_characters_guild on public.armory_characters(region,guild_slug);
create index if not exists armory_guilds_checked on public.armory_guilds(checked_at);
create index if not exists armory_guilds_name on public.armory_guilds(lower(name) text_pattern_ops);
create index if not exists armory_queue_due on public.armory_queue(next_at,added_at);

alter table public.armory_characters enable row level security;
revoke all on public.armory_characters from public, anon, authenticated, service_role;

alter table public.armory_guilds enable row level security;
revoke all on public.armory_guilds from public, anon, authenticated, service_role;

alter table public.armory_members enable row level security;
revoke all on public.armory_members from public, anon, authenticated, service_role;

alter table public.armory_queue enable row level security;
revoke all on public.armory_queue from public, anon, authenticated, service_role;

alter table public.armory_hides enable row level security;
revoke all on public.armory_hides from public, anon, authenticated, service_role;


-- Queue discovery; a fresh or hidden character cannot be queued.
create or replace function public.armory_enqueue(p_region text, p_kind text, p_slug text, p_source text)
returns boolean
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare written integer;
begin
  -- Serialize hide with character, roster and queue writes, including concurrent crawlers.
  perform pg_advisory_xact_lock(71409120000);
  if p_region is null or p_region not in ('us','eu') or p_kind is null or p_kind not in ('character','guild') then raise exception 'Invalid armory queue identity'; end if;
  if p_kind='character' then
    if exists(select 1 from public.armory_hides where region=p_region and slug=p_slug)
      or exists(select 1 from public.armory_characters where region=p_region and slug=p_slug and checked_at > now()-interval '20 days') then return false; end if;
  else
    if exists(select 1 from public.armory_guilds where region=p_region and slug=p_slug and checked_at > now()-interval '20 days') then return false; end if;
  end if;
  insert into public.armory_queue(region,kind,slug,source) values(p_region,p_kind,p_slug,p_source) on conflict do nothing;
  get diagnostics written = row_count;
  return written=1;
end;
$$;
revoke all on function public.armory_enqueue(text, text, text, text) from public, anon, authenticated;
grant execute on function public.armory_enqueue(text, text, text, text) to service_role;


-- Seed guild guesses from addon players; unknown realm prefixes seed both regions.
create or replace function public.armory_seed_from_players()
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare r record; written integer := 0;
begin
  for r in
    select distinct region, replace(replace(lower(btrim(p.guild)), '''', ''), ' ', '-') as slug
    from public.players p
    cross join lateral unnest(case when p.realm like 'US%' then array['us'] when p.realm like 'EU%' then array['eu'] else array['us','eu'] end) region
    where p.guild is not null
  loop
    if r.slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$' and r.slug = lower(r.slug) and char_length(r.slug)<=64
      and not exists(select 1 from public.armory_guilds g where g.region=r.region and g.slug=r.slug) then
      if public.armory_enqueue(r.region,'guild',r.slug,'players') then written:=written+1; end if;
    end if;
  end loop;
  return written;
end;
$$;
revoke all on function public.armory_seed_from_players() from public, anon, authenticated;
grant execute on function public.armory_seed_from_players() to service_role;


-- Queue first, then stale rows. A deferred queue row must not bypass its backoff via stale selection.
create or replace function public.armory_take(p_region text, p_kind text, p_limit integer)
returns table (slug text, tries smallint, stored boolean)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with candidates as (
    select q.slug, q.tries,
      case q.kind when 'character' then exists(select 1 from public.armory_characters c where c.region=q.region and c.slug=q.slug)
        else exists(select 1 from public.armory_guilds g where g.region=q.region and g.slug=q.slug) end as stored,
      0 as priority, q.added_at as at
    from public.armory_queue q where q.region=p_region and q.kind=p_kind and q.next_at<=now()
      and (p_kind<>'character' or not exists(select 1 from public.armory_hides h where h.region=q.region and h.slug=q.slug))
    union all
    select c.slug, 0::smallint, true, 1, c.checked_at from public.armory_characters c
    where p_kind='character' and c.region=p_region and c.checked_at<now()-interval '20 days'
      and not exists(select 1 from public.armory_queue q where q.region=c.region and q.kind=p_kind and q.slug=c.slug)
      and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
    union all
    select g.slug, 0::smallint, true, 1, g.checked_at from public.armory_guilds g
    where p_kind='guild' and g.region=p_region and g.checked_at<now()-interval '20 days'
      and not exists(select 1 from public.armory_queue q where q.region=g.region and q.kind=p_kind and q.slug=g.slug)
  )
  select c.slug,c.tries,c.stored from candidates c order by c.priority,c.at,c.slug limit greatest(coalesce(p_limit,0),0);
$$;
revoke all on function public.armory_take(text, text, integer) from public, anon, authenticated;
grant execute on function public.armory_take(text, text, integer) to service_role;


-- At most 500 API characters; preserve first_seen and refuse every hidden slug.
-- The crawler validates API fields before calling. Invalid typed values or constraints abort the batch;
-- duplicate slugs are collapsed here so repeated discovery cannot abort a valid batch.
create or replace function public.armory_upsert_characters(p_region text, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare written integer;
begin
  -- Serialize hide with character, roster and queue writes, including concurrent crawlers.
  perform pg_advisory_xact_lock(71409120000);
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Invalid armory character batch'; end if;
  with written_rows as (
    insert into public.armory_characters(region,slug,character_id,name,surname,level,ruleset_id,ruleset,race_id,race,class_id,class,faction,gender,guild_slug,guild_name,guild_id,last_login,equipped_item_level,average_item_level,item_level,gear_score,honorable_kills,pvp_rank,equipment,last_modified,fetched_at,checked_at)
    select distinct on (r.slug) p_region,r.slug,r.character_id,r.name,r.surname,r.level,r.ruleset_id,r.ruleset,r.race_id,r.race,r.class_id,r.class,r.faction,r.gender,r.guild_slug,r.guild_name,r.guild_id,r.last_login,r.equipped_item_level,r.average_item_level,r.item_level,r.gear_score,r.honorable_kills,r.pvp_rank,coalesce(r.equipment,'[]'::jsonb),r.last_modified,now(),now()
    from jsonb_to_recordset(p_rows) as r(slug text,character_id bigint,name text,surname text,level smallint,ruleset_id smallint,ruleset text,race_id smallint,race text,class_id smallint,class text,faction text,gender text,guild_slug text,guild_name text,guild_id bigint,last_login timestamptz,equipped_item_level smallint,average_item_level smallint,item_level numeric,gear_score numeric,honorable_kills integer,pvp_rank smallint,equipment jsonb,last_modified text)
    where not exists (select 1 from public.armory_hides h where h.region=p_region and h.slug=r.slug) -- hide write guard
    on conflict(region,slug) do update set
      character_id=excluded.character_id,name=excluded.name,surname=excluded.surname,level=excluded.level,ruleset_id=excluded.ruleset_id,ruleset=excluded.ruleset,race_id=excluded.race_id,race=excluded.race,class_id=excluded.class_id,class=excluded.class,faction=excluded.faction,gender=excluded.gender,guild_slug=excluded.guild_slug,guild_name=excluded.guild_name,guild_id=excluded.guild_id,last_login=excluded.last_login,equipped_item_level=excluded.equipped_item_level,average_item_level=excluded.average_item_level,item_level=excluded.item_level,gear_score=excluded.gear_score,honorable_kills=excluded.honorable_kills,pvp_rank=excluded.pvp_rank,equipment=excluded.equipment,last_modified=excluded.last_modified, fetched_at=now(),checked_at=now()
    returning slug
  ), consumed as (
    delete from public.armory_queue q using written_rows w where q.region=p_region and q.kind='character' and q.slug=w.slug
  )
  select count(*)::integer into written from written_rows;
  return written;
end;
$$;
revoke all on function public.armory_upsert_characters(text, jsonb) from public, anon, authenticated;
grant execute on function public.armory_upsert_characters(text, jsonb) to service_role;


-- Replace one roster and queue unknown or stale members, leaving hidden members out.
-- The crawler validates typed guild/member fields; malformed member slug guesses are skipped.
create or replace function public.armory_upsert_guild(p_region text, p_guild jsonb, p_members jsonb)
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare m record; enqueued integer := 0; v_guild_slug text := p_guild->>'slug';
begin
  -- Serialize hide with character, roster and queue writes, including concurrent crawlers.
  perform pg_advisory_xact_lock(71409120000);
  insert into public.armory_guilds(region,slug,guild_id,name,faction,ruleset_id,ruleset,member_count,created_at,last_modified,fetched_at,checked_at)
  values(p_region,v_guild_slug,(p_guild->>'guild_id')::bigint,p_guild->>'name',p_guild->>'faction',(p_guild->>'ruleset_id')::smallint,
    p_guild->>'ruleset',coalesce((p_guild->>'member_count')::integer,0),(p_guild->>'created_at')::timestamptz,p_guild->>'last_modified',now(),now())
  on conflict(region,slug) do update set guild_id=excluded.guild_id,name=excluded.name,faction=excluded.faction,
    ruleset_id=excluded.ruleset_id,ruleset=excluded.ruleset,member_count=excluded.member_count,created_at=excluded.created_at,
    last_modified=excluded.last_modified,fetched_at=now(),checked_at=now();
  delete from public.armory_members existing where existing.region=p_region and existing.guild_slug=v_guild_slug;
  for m in select * from jsonb_to_recordset(p_members) as r(character_slug text,name text,surname text,level smallint,class_id smallint,race_id smallint,rank smallint)
    where r.character_slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$'
      and r.character_slug=lower(r.character_slug) and char_length(r.character_slug)<=64 loop
    if not exists(select 1 from public.armory_hides h where h.region=p_region and h.slug=m.character_slug) then
      insert into public.armory_members(region,guild_slug,character_slug,name,surname,level,class_id,race_id,rank,fetched_at) values(p_region,v_guild_slug,m.character_slug,m.name,m.surname,m.level,m.class_id,m.race_id,m.rank,now());
      if public.armory_enqueue(p_region,'character',m.character_slug,'roster') then enqueued:=enqueued+1; end if;
    end if;
  end loop;
  delete from public.armory_queue where region=p_region and kind='guild' and slug=v_guild_slug;
  return enqueued;
end;
$$;
revoke all on function public.armory_upsert_guild(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.armory_upsert_guild(text, jsonb, jsonb) to service_role;


-- 304 confirms current data under the retention policy: refresh both timestamps.
create or replace function public.armory_touch(p_region text, p_kind text, p_slugs text[])
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare written integer;
begin
  if p_kind='character' then
    update public.armory_characters set fetched_at=now(),checked_at=now() where region=p_region and slug=any(p_slugs);
  elsif p_kind='guild' then
    update public.armory_guilds set fetched_at=now(),checked_at=now() where region=p_region and slug=any(p_slugs);
  else raise exception 'Invalid armory kind'; end if;
  get diagnostics written = row_count;
  delete from public.armory_queue where region=p_region and kind=p_kind and slug=any(p_slugs);
  return written;
end;
$$;
revoke all on function public.armory_touch(text, text, text[]) from public, anon, authenticated;
grant execute on function public.armory_touch(text, text, text[]) to service_role;


-- 404 deletes stored data; guesses back off seven days, then remain tombstoned for a quarter.
create or replace function public.armory_missing(p_region text, p_kind text, p_slug text)
returns void
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare removed integer;
begin
  if p_kind='character' then
    delete from public.armory_characters where region=p_region and slug=p_slug;
    get diagnostics removed = row_count;
    if removed>0 then
      delete from public.armory_members where region=p_region and character_slug=p_slug;
    end if;
  elsif p_kind='guild' then
    delete from public.armory_guilds where region=p_region and slug=p_slug;
    get diagnostics removed = row_count;
  else raise exception 'Invalid armory kind'; end if;
  if removed>0 then
    delete from public.armory_queue where region=p_region and kind=p_kind and slug=p_slug;
  else
    update public.armory_queue set tries=tries+1,
      next_at=now()+case when tries+1>=3 then interval '90 days' else interval '7 days' end
    where region=p_region and kind=p_kind and slug=p_slug;
  end if;
end;
$$;
revoke all on function public.armory_missing(text, text, text) from public, anon, authenticated;
grant execute on function public.armory_missing(text, text, text) to service_role;


-- Defer transient failures, including stale stored rows selected outside the queue.
create or replace function public.armory_retry(p_region text, p_kind text, p_slug text, p_delay interval)
returns void
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  perform pg_advisory_xact_lock(71409120000);
  -- Stored stale rows may not have a queue entry yet.
  insert into public.armory_queue(region,kind,slug,source,tries,next_at)
  select p_region,p_kind,p_slug,'retry',1,now()+p_delay
  where p_kind<>'character' or not exists(select 1 from public.armory_hides h where h.region=p_region and h.slug=p_slug)
  on conflict(region,kind,slug) do update set tries=public.armory_queue.tries+1,next_at=now()+p_delay;
end;
$$;
revoke all on function public.armory_retry(text, text, text, interval) from public, anon, authenticated;
grant execute on function public.armory_retry(text, text, text, interval) to service_role;


-- Thirty-day retention follows the newest fetch or 304 refresh. Failed guesses stay for 90 days.
-- Return deleted characters, guilds and queue rows.
create or replace function public.armory_purge()
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare n integer := 0; removed integer;
begin
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


-- Permanent opt-out, safe to repeat; shares the write lock so a concurrent upsert cannot resurrect it.
create or replace function public.armory_hide(p_region text, p_slug text)
returns void
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  -- Serialize hide with character, roster and queue writes, including concurrent crawlers.
  perform pg_advisory_xact_lock(71409120000);
  insert into public.armory_hides(region,slug) values(p_region,p_slug) on conflict do nothing;
  delete from public.armory_characters where region=p_region and slug=p_slug;
  delete from public.armory_members where region=p_region and character_slug=p_slug;
  delete from public.armory_queue where region=p_region and kind='character' and slug=p_slug;
end;
$$;
revoke all on function public.armory_hide(text, text) from public, anon, authenticated;
grant execute on function public.armory_hide(text, text) to service_role;


-- One character, with the hide rule repeated at read time.
create or replace function public.armory_character(p_region text, p_slug text)
returns setof public.armory_characters
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
select c.* from public.armory_characters c where c.region=p_region and c.slug=p_slug
  and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug);
$$;
revoke all on function public.armory_character(text, text) from public, anon, authenticated;
grant execute on function public.armory_character(text, text) to service_role;


-- One guild.
create or replace function public.armory_guild(p_region text, p_slug text)
returns setof public.armory_guilds
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
select g.* from public.armory_guilds g where g.region=p_region and g.slug=p_slug;
$$;
revoke all on function public.armory_guild(text, text) from public, anon, authenticated;
grant execute on function public.armory_guild(text, text) to service_role;


-- Roster members plus available character scores; hidden members are absent.
create or replace function public.armory_roster(p_region text, p_slug text)
returns table (character_slug text, name text, surname text, level smallint, class_id smallint, race_id smallint, rank smallint, item_level numeric, gear_score numeric, stored boolean)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
select m.character_slug,m.name,m.surname,m.level,m.class_id,m.race_id,m.rank,c.item_level,c.gear_score,c.slug is not null
from public.armory_members m left join public.armory_characters c on c.region=m.region and c.slug=m.character_slug
where m.region=p_region and m.guild_slug=p_slug
  and not exists(select 1 from public.armory_hides h where h.region=m.region and h.slug=m.character_slug)
order by m.rank,m.name,m.surname;
$$;
revoke all on function public.armory_roster(text, text) from public, anon, authenticated;
grant execute on function public.armory_roster(text, text) to service_role;


-- Literal name prefix, at least two characters, in name and surname order.
create or replace function public.armory_search(p_prefix text, p_limit integer)
returns table (region text, slug text, name text, surname text, level smallint, class text, race text, ruleset text, guild_name text)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
select c.region,c.slug,c.name,c.surname,c.level,c.class,c.race,c.ruleset,c.guild_name
from public.armory_characters c where char_length(p_prefix)>=2 and p_prefix ~ '^[^%_\\]+$' and lower(c.name) like lower(p_prefix)||'%'
  and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
order by c.name,c.surname,c.region,c.slug limit least(greatest(coalesce(p_limit,25),0),100);
$$;
revoke all on function public.armory_search(text, integer) from public, anon, authenticated;
grant execute on function public.armory_search(text, integer) to service_role;


-- Literal guild-name prefix, at least two characters.
create or replace function public.armory_search_guilds(p_prefix text, p_limit integer)
returns table (region text, slug text, name text, faction text, ruleset text, member_count integer)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
select g.region,g.slug,g.name,g.faction,g.ruleset,g.member_count from public.armory_guilds g
where char_length(p_prefix)>=2 and p_prefix ~ '^[^%_\\]+$' and lower(g.name) like lower(p_prefix)||'%'
order by g.name,g.region,g.slug limit least(greatest(coalesce(p_limit,25),0),100);
$$;
revoke all on function public.armory_search_guilds(text, integer) from public, anon, authenticated;
grant execute on function public.armory_search_guilds(text, integer) to service_role;


-- Top 100 scores, latest login breaks ties; optional region and ruleset filters.
create or replace function public.armory_board(p_metric text, p_region text, p_ruleset_id smallint, p_limit integer)
returns table (rank integer, region text, slug text, name text, surname text, level smallint, class text, race text, faction text, ruleset text, ruleset_id smallint, guild_name text, value numeric, fetched_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with scores as (
  select c.*,case p_metric when 'item_level' then c.item_level when 'gear_score' then c.gear_score when 'honorable_kills' then c.honorable_kills::numeric end as value
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


-- Count strictly greater values within the target's region/ruleset. Ties share rank; no population sort.
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
from target t where t.honorable_kills is not null;
$$;
revoke all on function public.armory_rank(text, text) from public, anon, authenticated;
grant execute on function public.armory_rank(text, text) to service_role;


-- Population and newest fetched payload per region and ruleset, including guild-only groups.
create or replace function public.armory_counts()
returns table (region text, ruleset_id smallint, ruleset text, characters integer, guilds integer, newest timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
with populations as (
  select c.region,c.ruleset_id,c.ruleset,1 as characters,0 as guilds,c.fetched_at
  from public.armory_characters c where not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
  union all select g.region,g.ruleset_id,g.ruleset,0,1,g.fetched_at from public.armory_guilds g
)
select p.region,p.ruleset_id,p.ruleset,sum(p.characters)::integer,sum(p.guilds)::integer,max(p.fetched_at)
from populations p group by p.region,p.ruleset_id,p.ruleset order by p.region,p.ruleset_id;
$$;
revoke all on function public.armory_counts() from public, anon, authenticated;
grant execute on function public.armory_counts() to service_role;


notify pgrst, 'reload schema';

reset lock_timeout;

-- Owner readback before rollout (the non-ASCII rule needs a Unicode-aware database ctype):
-- select datctype from pg_database where datname=current_database();
-- select relname,relrowsecurity from pg_class where oid in
--   ('public.armory_characters'::regclass,'public.armory_guilds'::regclass,
--    'public.armory_members'::regclass,'public.armory_queue'::regclass,'public.armory_hides'::regclass);
-- select p.oid::regprocedure,p.prosecdef,p.proconfig,p.proacl from pg_proc p
--   join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'armory_%';
-- select table_name,grantee,privilege_type from information_schema.role_table_grants
--   where table_schema='public' and table_name like 'armory_%'
--     and grantee in ('anon','authenticated','service_role','PUBLIC'); -- expect no rows

-- Rollback by hand only: deletes all armory data and opt-outs.
-- drop function if exists public.armory_counts();
-- drop function if exists public.armory_rank(text, text);
-- drop function if exists public.armory_board(text, text, smallint, integer);
-- drop function if exists public.armory_search_guilds(text, integer);
-- drop function if exists public.armory_search(text, integer);
-- drop function if exists public.armory_roster(text, text);
-- drop function if exists public.armory_guild(text, text);
-- drop function if exists public.armory_character(text, text);
-- drop function if exists public.armory_hide(text, text);
-- drop function if exists public.armory_purge();
-- drop function if exists public.armory_retry(text, text, text, interval);
-- drop function if exists public.armory_missing(text, text, text);
-- drop function if exists public.armory_touch(text, text, text[]);
-- drop function if exists public.armory_upsert_guild(text, jsonb, jsonb);
-- drop function if exists public.armory_upsert_characters(text, jsonb);
-- drop function if exists public.armory_take(text, text, integer);
-- drop function if exists public.armory_seed_from_players();
-- drop function if exists public.armory_enqueue(text, text, text, text);
-- drop table if exists public.armory_members;
-- drop table if exists public.armory_guilds;
-- drop table if exists public.armory_characters;
-- drop table if exists public.armory_queue;
-- drop table if exists public.armory_hides;
-- notify pgrst, 'reload schema';
