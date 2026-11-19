-- Server sessions authenticate the caller before passing p_user_id. Browser roles never execute writes.
set lock_timeout = '3s';
-- Reuse the existing guild hide rule without changing the hide flow.
create or replace function public.guild_profile_visible(p_region text,p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.armory_guilds g where g.region=p_region and g.slug=p_slug and g.name<>'DELETED'
    and not exists(select 1 from public.guild_suppressions s where s.guild_key=lower(g.name)
      and s.realm_key ~ ('(^| )' || g.region || '[0-9]*( |$)')));
$$;
revoke all on function public.guild_profile_visible(text,text) from public,anon,authenticated;
grant execute on function public.guild_profile_visible(text,text) to anon,authenticated,service_role;
create table if not exists public.guild_profiles (
  region text not null, slug text not null,
  owner_user_id uuid references public.users(id) on delete set null,
  owner_character_slug text,
  bio text not null default '' check (char_length(bio)<=1000),
  details jsonb not null default '{"raidDays":"","discord":"","website":""}',
  recruiting jsonb not null default '{"on":false,"lookingFor":"","classes":[]}',
  updated_at timestamptz not null default now(), updated_by uuid references public.users(id) on delete set null,
  primary key(region,slug),
  foreign key(region,slug) references public.armory_guilds(region,slug) on delete cascade
);
create table if not exists public.guild_editors (
  region text not null, slug text not null, user_id uuid references public.users(id) on delete cascade,
  appointed_by uuid references public.users(id) on delete set null, appointed_at timestamptz not null default now(),
  primary key(region,slug,user_id),
  foreign key(region,slug) references public.guild_profiles(region,slug) on delete cascade
);
alter table public.guild_profiles enable row level security;
alter table public.guild_editors enable row level security;
revoke all on public.guild_profiles,public.guild_editors from public,anon,authenticated,service_role;
grant select on public.guild_profiles,public.guild_editors to anon,authenticated,service_role;
drop policy if exists guild_profiles_read on public.guild_profiles;
create policy guild_profiles_read on public.guild_profiles for select using(public.guild_profile_visible(region,slug));
drop policy if exists guild_editors_read on public.guild_editors;
create policy guild_editors_read on public.guild_editors for select using(public.guild_profile_visible(region,slug));
-- No direct write grants/policies: every mutation must pass the functions' current-roster checks.

create or replace function public.guild_linked_members(p_region text,p_slug text)
returns table(user_id uuid,character_slug text,name text,rank smallint)
language sql stable security definer set search_path = '' as $$
  select l.user_id,c.slug,c.name || ' ' || c.surname,m.rank
  from public.armory_members m
  join public.armory_characters c on c.region=m.region and c.slug=m.character_slug and c.guild_slug=m.guild_slug
  join public.armory_links a on a.region=c.region and a.slug=c.slug
  join public.character_links l on l.id=a.link_id and l.status='linked'
  where m.region=p_region and m.guild_slug=p_slug
    and public.guild_profile_visible(p_region,p_slug)
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
    and not exists(select 1 from public.character_suppressions s where public.link_realm_key(s.realm)=l.realm_key and s.character=l.name_key);
$$;
create or replace function public.guild_owner_valid(p_region text,p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.guild_profiles p join public.guild_linked_members(p_region,p_slug) m
    on m.user_id=p.owner_user_id and m.character_slug=p.owner_character_slug and m.rank=0
    where p.region=p_region and p.slug=p_slug);
$$;
create or replace function public.guild_profile_access(p_user_id uuid,p_region text,p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'owner',coalesce(p.owner_user_id=p_user_id and public.guild_owner_valid(p_region,p_slug),false),
    'editor',public.guild_owner_valid(p_region,p_slug) and exists(select 1 from public.guild_editors e
      join public.guild_linked_members(p_region,p_slug) m on m.user_id=e.user_id
      where e.region=p_region and e.slug=p_slug and e.user_id=p_user_id),
    'eligible',exists(select 1 from public.guild_linked_members(p_region,p_slug) m where m.user_id=p_user_id and m.rank=0)
      and (not public.guild_owner_valid(p_region,p_slug) or p.owner_user_id=p_user_id),
    'stale',p.owner_user_id is not null and not public.guild_owner_valid(p_region,p_slug),
    'members',case when p.owner_user_id=p_user_id and public.guild_owner_valid(p_region,p_slug)
      then coalesce((select jsonb_agg(m) from public.guild_linked_members(p_region,p_slug) m where m.user_id<>p_user_id),'[]') else '[]'::jsonb end,
    'editors',case when p.owner_user_id=p_user_id and public.guild_owner_valid(p_region,p_slug)
      then coalesce((select jsonb_agg(e.user_id) from public.guild_editors e where e.region=p_region and e.slug=p_slug),'[]') else '[]'::jsonb end)
  from (select 1) singleton left join public.guild_profiles p on p.region=p_region and p.slug=p_slug;
$$;
create or replace function public.claim_guild(p_user_id uuid,p_region text,p_slug text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare character_slug text;
begin
  perform pg_advisory_xact_lock(71409120000);
  select m.character_slug into character_slug from public.guild_linked_members(p_region,p_slug) m
    where m.user_id=p_user_id and m.rank=0 order by m.character_slug limit 1;
  if character_slug is null then return false; end if;
  if public.guild_owner_valid(p_region,p_slug) then
    return exists(select 1 from public.guild_profiles where region=p_region and slug=p_slug and owner_user_id=p_user_id);
  end if;
  delete from public.guild_editors where region=p_region and slug=p_slug;
  insert into public.guild_profiles(region,slug,owner_user_id,owner_character_slug,updated_by)
    values(p_region,p_slug,p_user_id,character_slug,p_user_id)
    on conflict(region,slug) do update set owner_user_id=excluded.owner_user_id,
      owner_character_slug=excluded.owner_character_slug,updated_at=now(),updated_by=p_user_id;
  return true;
end $$;
create or replace function public.release_guild(p_user_id uuid,p_region text,p_slug text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(71409120000);
  if not exists(select 1 from public.guild_profiles where region=p_region and slug=p_slug and owner_user_id=p_user_id)
    or not public.guild_owner_valid(p_region,p_slug) then return false; end if;
  delete from public.guild_editors where region=p_region and slug=p_slug;
  update public.guild_profiles set owner_user_id=null,owner_character_slug=null,updated_at=now(),updated_by=p_user_id
    where region=p_region and slug=p_slug;
  return true;
end $$;
create or replace function public.appoint_guild_editor(p_user_id uuid,p_region text,p_slug text,p_editor_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(71409120000);
  if p_user_id=p_editor_id or not exists(select 1 from public.guild_profiles where region=p_region and slug=p_slug and owner_user_id=p_user_id)
    or not public.guild_owner_valid(p_region,p_slug)
    or not exists(select 1 from public.guild_linked_members(p_region,p_slug) m where m.user_id=p_editor_id) then return false; end if;
  insert into public.guild_editors(region,slug,user_id,appointed_by) values(p_region,p_slug,p_editor_id,p_user_id) on conflict do nothing;
  update public.guild_profiles set updated_at=now(),updated_by=p_user_id where region=p_region and slug=p_slug;
  return true;
end $$;
create or replace function public.remove_guild_editor(p_user_id uuid,p_region text,p_slug text,p_editor_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(71409120000);
  if not exists(select 1 from public.guild_profiles where region=p_region and slug=p_slug and owner_user_id=p_user_id)
    or not public.guild_owner_valid(p_region,p_slug) then return false; end if;
  delete from public.guild_editors where region=p_region and slug=p_slug and user_id=p_editor_id;
  update public.guild_profiles set updated_at=now(),updated_by=p_user_id where region=p_region and slug=p_slug;
  return true;
end $$;
create or replace function public.save_guild_profile(p_user_id uuid,p_region text,p_slug text,p_bio text,p_details jsonb,p_recruiting jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare access jsonb; bucket_name text := 'guild-save:' || p_user_id::text; used integer;
begin
  perform pg_advisory_xact_lock(71409120000);
  access := public.guild_profile_access(p_user_id,p_region,p_slug);
  if not ((access->>'owner')::boolean or (access->>'editor')::boolean) then return 'forbidden'; end if;
  if p_bio is null or char_length(p_bio)>1000 or p_details is null or p_recruiting is null
    or jsonb_typeof(p_details)<>'object' or jsonb_typeof(p_recruiting)<>'object'
    or not p_details ?& array['raidDays','discord','website'] or p_details-array['raidDays','discord','website']<>'{}'
    or not p_recruiting ?& array['on','lookingFor','classes'] or p_recruiting-array['on','lookingFor','classes']<>'{}'
    or jsonb_typeof(p_details->'raidDays')<>'string' or char_length(p_details->>'raidDays')>200
    or jsonb_typeof(p_recruiting->'on')<>'boolean' or jsonb_typeof(p_recruiting->'lookingFor')<>'string'
    or char_length(p_recruiting->>'lookingFor')>200 or jsonb_typeof(p_recruiting->'classes')<>'array'
  then return 'invalid'; end if;
  if exists(select 1 from jsonb_each(p_details) e where e.key in ('discord','website') and
    (jsonb_typeof(e.value)<>'string' or char_length(e.value#>>'{}')>500 or
      ((e.value#>>'{}')<>'' and (e.value#>>'{}') !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]\\]*)?$')))
    or jsonb_array_length(p_recruiting->'classes')>9
    or exists(select 1 from jsonb_array_elements(p_recruiting->'classes') c where jsonb_typeof(c)<>'string'
      or (c#>>'{}') not in ('WARRIOR','PALADIN','HUNTER','ROGUE','PRIEST','SHAMAN','MAGE','WARLOCK','DRUID'))
  then return 'invalid'; end if;
  -- Reuse the site's quota buckets, with a separate per-user scope: 30 saves per hour.
  insert into public.intake_quota_buckets(bucket,count,reset_at) values(bucket_name,1,now()+interval '1 hour')
    on conflict(bucket) do update set count=case when intake_quota_buckets.reset_at<=now() then 1 else intake_quota_buckets.count+1 end,
      reset_at=case when intake_quota_buckets.reset_at<=now() then now()+interval '1 hour' else intake_quota_buckets.reset_at end
    returning count into used;
  if used>30 then return 'limited'; end if;
  update public.guild_profiles set bio=p_bio,details=p_details,recruiting=p_recruiting,updated_at=now(),updated_by=p_user_id
    where region=p_region and slug=p_slug;
  return 'saved';
end $$;
do $$ declare f regprocedure; begin
  foreach f in array array[
    'public.guild_linked_members(text,text)'::regprocedure,'public.guild_owner_valid(text,text)'::regprocedure,
    'public.guild_profile_access(uuid,text,text)'::regprocedure,'public.claim_guild(uuid,text,text)'::regprocedure,
    'public.release_guild(uuid,text,text)'::regprocedure,'public.appoint_guild_editor(uuid,text,text,uuid)'::regprocedure,
    'public.remove_guild_editor(uuid,text,text,uuid)'::regprocedure,'public.save_guild_profile(uuid,text,text,text,jsonb,jsonb)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;

alter table public.armory_guilds add column if not exists crest jsonb;
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
  update public.armory_guilds set crest=p_guild->'crest' where region=p_region and slug=v_guild_slug;
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
notify pgrst, 'reload schema';
reset lock_timeout;
