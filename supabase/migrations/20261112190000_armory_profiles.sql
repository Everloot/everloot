-- Lightweight profiles; keep Blizzard fields inside the existing retention and hide boundary.
-- Apply this migration before deploying the richer crawler and refresh controls.
alter table public.armory_characters add column if not exists details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object' and octet_length(details::text)<=65536);
alter table public.armory_characters add column if not exists addon_seen date;
alter table public.armory_queue add column if not exists addon_seen date;

create or replace function public.armory_refresh(p_region text, p_slug text)
returns text language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare checked timestamptz;
begin
  perform pg_advisory_xact_lock(71409120000);
  select checked_at into checked from public.armory_characters where region=p_region and slug=p_slug;
  if checked is null or exists(select 1 from public.armory_hides where region=p_region and slug=p_slug) then return 'unavailable'; end if;
  if exists(select 1 from public.armory_queue where region=p_region and kind='character' and slug=p_slug) then return 'queued-already'; end if;
  if checked>now()-interval '1 hour' then return 'cooldown'; end if;
  insert into public.armory_queue(region,kind,slug,source) values(p_region,'character',p_slug,'refresh');
  return 'queued';
end $$;
revoke all on function public.armory_refresh(text,text) from public,anon,authenticated;
grant execute on function public.armory_refresh(text,text) to service_role;

-- An explicit association is a player's claim, never inferred from first-name sightings.
create table if not exists public.armory_links (
  link_id uuid primary key references public.character_links(id) on delete cascade,
  region text not null,
  slug text not null,
  unique(region,slug),
  foreign key(region,slug) references public.armory_characters(region,slug) on delete cascade
);
alter table public.armory_links enable row level security;
revoke all on public.armory_links from public,anon,authenticated,service_role;
do $$ begin
  if exists(select 1 from pg_roles where rolname='backup_exporter') then
    grant select on public.armory_links to backup_exporter;
    drop policy if exists backup_exporter_select on public.armory_links;
    create policy backup_exporter_select on public.armory_links for select to backup_exporter using (true);
  end if;
end $$;

create or replace function public.armory_associate(p_user_id uuid,p_link_id uuid,p_region text,p_slug text)
returns boolean language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare l public.character_links%rowtype; c public.armory_characters%rowtype;
begin
  perform pg_advisory_xact_lock(71409120000);
  select * into l from public.character_links where id=p_link_id and user_id=p_user_id for update;
  if not found or l.status<>'linked' then return false; end if;
  if p_slug is null then delete from public.armory_links where link_id=p_link_id; return true; end if;
  select * into c from public.armory_characters where region=p_region and slug=p_slug;
  if not found or exists(select 1 from public.armory_hides where region=p_region and slug=p_slug)
    or exists(select 1 from public.character_suppressions s where public.link_realm_key(s.realm)=l.realm_key and s.character=l.name_key)
    or lower(c.name)<>l.name_key or c.faction<>l.faction
    or upper(replace(c.class,' ',''))<>l.class
    or lower(replace(c.race,' ',''))<>(case lower(l.race) when 'scourge' then 'undead' else lower(l.race) end)
    or l.realm !~* ('(^|[ -])' || p_region || '[0-9]*([ -]|$)')
    or c.ruleset_id<>(case when l.realm ~* '(rp[ -]?pvp|roleplay[ -]pvp)$' then 15 when l.realm ~* '[ -]pvp$' then 1 when l.realm ~* '[ -](pve|normal)$' then 2 when l.realm ~* '[ -](rp|roleplay)$' then 3 else -1 end)
  then return false; end if;
  if exists(select 1 from public.armory_links where region=p_region and slug=p_slug and link_id<>p_link_id) then return false; end if;
  insert into public.armory_links(link_id,region,slug) values(p_link_id,p_region,p_slug)
  on conflict(link_id) do update set region=excluded.region,slug=excluded.slug;
  return true;
end $$;
revoke all on function public.armory_associate(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.armory_associate(uuid,uuid,text,text) to service_role;

-- Return only the already-public character address; no account, install, hash or private fact.
create or replace function public.armory_public_link(p_region text,p_slug text)
returns table(ruleset text,realm text,name text)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select l.ruleset,l.realm,l.name
  from public.armory_links a join public.character_links l on l.id=a.link_id
  join public.armory_characters c on c.region=a.region and c.slug=a.slug
  cross join lateral public.public_character(l.ruleset,l.realm,l.name) p
  where a.region=p_region and a.slug=p_slug and l.status='linked'
    and lower(c.name)=l.name_key and upper(replace(c.class,' ',''))=l.class
    and c.faction=l.faction
    and lower(replace(c.race,' ',''))=(case lower(l.race) when 'scourge' then 'undead' else lower(l.race) end)
    and l.realm ~* ('(^|[ -])' || a.region || '[0-9]*([ -]|$)')
    and c.ruleset_id=(case when l.realm ~* '(rp[ -]?pvp|roleplay[ -]pvp)$' then 15 when l.realm ~* '[ -]pvp$' then 1 when l.realm ~* '[ -](pve|normal)$' then 2 when l.realm ~* '[ -](rp|roleplay)$' then 3 else -1 end)
    and not exists(select 1 from public.armory_hides h where h.region=a.region and h.slug=a.slug)
  limit 1;
$$;
revoke all on function public.armory_public_link(text,text) from public,anon,authenticated;
grant execute on function public.armory_public_link(text,text) to service_role;

create or replace function public.armory_own_links(p_user_id uuid)
returns table(link_id uuid,region text,slug text)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select a.link_id,a.region,a.slug from public.armory_links a
  join public.character_links l on l.id=a.link_id where l.user_id=p_user_id;
$$;
revoke all on function public.armory_own_links(uuid) from public,anon,authenticated;
grant execute on function public.armory_own_links(uuid) to service_role;

-- Named uploads supply full identities for direct discovery, including guildless characters.
-- Keep this atomic with the existing player write so a failed queue write is retried, not acknowledged away.
create or replace function public.upsert_players_armory(p_ruleset text,p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare written integer; legacy_rows jsonb; r record; region_name text; character_slug text; observed date;
begin
  perform pg_advisory_xact_lock(71409120000);
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 then raise exception 'Invalid player batch'; end if;
  -- The legacy sighting table cannot distinguish two surnames with the same first name.
  -- Full identities go only to armory discovery; never collapse them into a first-name sighting.
  select coalesce(jsonb_agg(x),'[]'::jsonb) into legacy_rows from jsonb_array_elements(p_rows) x where nullif(x->>'surname','') is null;
  written:=public.upsert_players(p_ruleset,legacy_rows);
  for r in select distinct x->>'name' as name,x->>'surname' as surname,x->>'realm' as realm,x->>'seen' as seen from jsonb_array_elements(p_rows) x loop
    if r.name is null or r.surname is null or r.name !~ '^[[:alpha:]]{2,12}$' or r.surname !~ '^[[:alpha:]]{2,24}$' then continue; end if;
    region_name:=lower((regexp_match(r.realm,'(^|[ -])(US|EU)[0-9]*([ -]|$)','i'))[2]);
    if region_name is null then continue; end if;
    if exists(select 1 from public.character_suppressions s where public.link_realm_key(s.realm)=public.link_realm_key(r.realm) and s.character=lower(r.name)) then continue; end if;
    character_slug:=lower(r.name || '-' || r.surname);
    observed:=least(r.seen::date,current_date);
    if observed is null or observed<current_date-30 then continue; end if;
    perform public.armory_enqueue(region_name,'character',character_slug,'addon');
    update public.armory_queue set addon_seen=greatest(addon_seen,observed) where region=region_name and kind='character' and slug=character_slug;
    update public.armory_characters set addon_seen=greatest(addon_seen,observed) where region=region_name and slug=character_slug
      and not exists(select 1 from public.armory_hides h where h.region=region_name and h.slug=character_slug);
    if exists(select 1 from public.armory_characters where region=region_name and slug=character_slug and checked_at::date<observed) then
      perform public.armory_refresh(region_name,character_slug);
    end if;
  end loop;
  return written;
end $$;
revoke all on function public.upsert_players_armory(text,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_players_armory(text,jsonb) to service_role;

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
    insert into public.armory_characters(region,slug,character_id,name,surname,level,ruleset_id,ruleset,race_id,race,class_id,class,faction,gender,guild_slug,guild_name,guild_id,last_login,equipped_item_level,average_item_level,item_level,gear_score,honorable_kills,pvp_rank,equipment,details,addon_seen,last_modified,fetched_at,checked_at)
    select distinct on (r.slug) p_region,r.slug,r.character_id,r.name,r.surname,r.level,r.ruleset_id,r.ruleset,r.race_id,r.race,r.class_id,r.class,r.faction,r.gender,r.guild_slug,r.guild_name,r.guild_id,r.last_login,r.equipped_item_level,r.average_item_level,r.item_level,r.gear_score,r.honorable_kills,r.pvp_rank,coalesce(r.equipment,'[]'::jsonb),coalesce(r.details,'{}'::jsonb),(select q.addon_seen from public.armory_queue q where q.region=p_region and q.kind='character' and q.slug=r.slug),r.last_modified,now(),now()
    from jsonb_to_recordset(p_rows) as r(slug text,character_id bigint,name text,surname text,level smallint,ruleset_id smallint,ruleset text,race_id smallint,race text,class_id smallint,class text,faction text,gender text,guild_slug text,guild_name text,guild_id bigint,last_login timestamptz,equipped_item_level smallint,average_item_level smallint,item_level numeric,gear_score numeric,honorable_kills integer,pvp_rank smallint,equipment jsonb,details jsonb,last_modified text)
    where not exists (select 1 from public.armory_hides h where h.region=p_region and h.slug=r.slug) -- hide write guard
    on conflict(region,slug) do update set
      character_id=excluded.character_id,name=excluded.name,surname=excluded.surname,level=excluded.level,ruleset_id=excluded.ruleset_id,ruleset=excluded.ruleset,race_id=excluded.race_id,race=excluded.race,class_id=excluded.class_id,class=excluded.class,faction=excluded.faction,gender=excluded.gender,guild_slug=excluded.guild_slug,guild_name=excluded.guild_name,guild_id=excluded.guild_id,last_login=excluded.last_login,equipped_item_level=excluded.equipped_item_level,average_item_level=excluded.average_item_level,item_level=excluded.item_level,gear_score=excluded.gear_score,honorable_kills=excluded.honorable_kills,pvp_rank=excluded.pvp_rank,equipment=excluded.equipment,details=excluded.details,addon_seen=greatest(armory_characters.addon_seen,excluded.addon_seen),last_modified=excluded.last_modified, fetched_at=now(),checked_at=now()
    returning slug,guild_slug
  ), consumed as (
    delete from public.armory_queue q using written_rows w where q.region=p_region and q.kind='character' and q.slug=w.slug
  ), discovered_guilds as (
    insert into public.armory_queue(region,kind,slug,source)
    select distinct p_region,'guild',w.guild_slug,'character' from written_rows w
    where w.guild_slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$' and char_length(w.guild_slug)<=64
      and not exists(select 1 from public.armory_guilds g where g.region=p_region and g.slug=w.guild_slug and g.checked_at>now()-interval '20 days')
    on conflict do nothing
  )
  select count(*)::integer into written from written_rows;
  return written;
end;
$$;

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
    where p_kind='character' and c.region=p_region and (
      c.checked_at<now()-interval '20 days'
      or (c.details->>'revision' is distinct from '1')
      or (c.details->>'retry'='true' and c.checked_at<now()-interval '1 hour')
      or (c.checked_at<now()-interval '1 day' and exists(select 1 from public.armory_links a where a.region=c.region and a.slug=c.slug))
    )
      and not exists(select 1 from public.armory_queue q where q.region=c.region and q.kind=p_kind and q.slug=c.slug)
      and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
    union all
    select g.slug, 0::smallint, true, 1, g.checked_at from public.armory_guilds g
    where p_kind='guild' and g.region=p_region and g.checked_at<now()-interval '20 days'
      and not exists(select 1 from public.armory_queue q where q.region=g.region and q.kind=p_kind and q.slug=g.slug)
  )
  select c.slug,c.tries,c.stored from candidates c order by c.priority,c.at,c.slug limit greatest(coalesce(p_limit,0),0);
$$;


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
    where section.key in ('statistics','talents','professions','avatar')
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
