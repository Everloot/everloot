-- Owner decision, 2026-11-19: a linked character's synced boss kills are public.
-- Deployment migration only; do not apply to production from a development checkout.
alter table public.character_boss_kills alter column consented set default true;
update public.character_boss_kills set consented=true where not consented;

create or replace function public.sync_boss_kills(p_user_id uuid, p_ruleset text, p_realm text, p_name text,
  p_source_ref text, p_captured_at timestamptz, p_kills jsonb)
returns text language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare v_link public.character_links%rowtype; v_old public.character_boss_kills%rowtype; k jsonb;
begin
  if p_user_id is null or p_source_ref is null or p_source_ref !~ '^[a-f0-9]{64}$'
    or p_captured_at is null or p_captured_at > now() + interval '1 day'
    or p_kills is null or jsonb_typeof(p_kills) <> 'array' or jsonb_array_length(p_kills) not between 1 and 2000
    or octet_length(p_kills::text) > 262144 then raise exception 'Invalid kills'; end if;
  -- Exact server-owned shape: never accept a raw character key, install id or extra identity field.
  for k in select value from jsonb_array_elements(p_kills) loop
    if jsonb_typeof(k) <> 'object' or (select count(*) from jsonb_object_keys(k)) <> 6
      or not (k ?& array['encounterId','instanceMapId','difficulty','firstKillAt','lastKillAt','killCount'])
      or jsonb_typeof(k->'encounterId') <> 'number' or (k->>'encounterId')::numeric not between 1 and 2000000000
      or (k->>'encounterId')::numeric <> trunc((k->>'encounterId')::numeric)
      or jsonb_typeof(k->'instanceMapId') <> 'number' or (k->>'instanceMapId')::numeric not between 1 and 2000000000
      or (k->>'instanceMapId')::numeric <> trunc((k->>'instanceMapId')::numeric)
      or jsonb_typeof(k->'difficulty') <> 'number' or (k->>'difficulty')::numeric not between 0 and 1000
      or (k->>'difficulty')::numeric <> trunc((k->>'difficulty')::numeric)
      or jsonb_typeof(k->'killCount') <> 'number' or (k->>'killCount')::numeric not between 1 and 2000000000
      or (k->>'killCount')::numeric <> trunc((k->>'killCount')::numeric)
      or jsonb_typeof(k->'firstKillAt') <> 'string' or jsonb_typeof(k->'lastKillAt') <> 'string'
      or (k->>'firstKillAt')::timestamptz > (k->>'lastKillAt')::timestamptz
      or (k->>'lastKillAt')::timestamptz > p_captured_at
    then raise exception 'Invalid kills'; end if;
  end loop;
  select * into v_link from public.character_links where user_id = p_user_id and ruleset = p_ruleset
    and realm_key = public.link_realm_key(p_realm) and name_key = lower(btrim(p_name)) for update;
  if not found or v_link.status <> 'linked' then return 'not_linked'; end if;
  select * into v_old from public.character_boss_kills where link_id = v_link.id;

  if v_old.captured_at = p_captured_at and v_old.kills = p_kills then return 'duplicate'; end if;
  if v_old.captured_at > p_captured_at then return 'older'; end if;
  if v_old.captured_at = p_captured_at then
    -- Addon timestamps have second precision. A later same-second cumulative snapshot is valid only from
    -- the same source, retaining every old encounter without decreasing its count or last-kill time.
    if v_old.source_ref <> p_source_ref or exists (
      select 1 from jsonb_array_elements(v_old.kills) old_kill where not exists (
        select 1 from jsonb_array_elements(p_kills) new_kill
        where new_kill->'encounterId' = old_kill->'encounterId'
          and new_kill->'instanceMapId' = old_kill->'instanceMapId'
          and new_kill->'difficulty' = old_kill->'difficulty'
          and (new_kill->>'killCount')::bigint >= (old_kill->>'killCount')::bigint
          and (new_kill->>'lastKillAt')::timestamptz >= (old_kill->>'lastKillAt')::timestamptz
          and (new_kill->>'firstKillAt')::timestamptz <= (old_kill->>'firstKillAt')::timestamptz
      )
    ) then return 'older'; end if;
  end if;
  insert into public.character_boss_kills(link_id,consented,captured_at,kills,source_ref)
    values(v_link.id,true,p_captured_at,p_kills,p_source_ref)
    on conflict(link_id) do update set consented=true,captured_at=excluded.captured_at,
      kills=excluded.kills,source_ref=excluded.source_ref;
  return 'stored';
end $$;
revoke all on function public.sync_boss_kills(uuid, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.sync_boss_kills(uuid, text, text, text, text, timestamptz, jsonb) to service_role;

-- Only the site's server can read these. Never return account ids, link ids or source hashes.
-- Addresses may be linked identities or explicit armory associations; never match on names alone.
create or replace function public.public_boss_kills(p_characters jsonb)
returns table(region text,slug text,ruleset text,realm text,name text,kills jsonb)
language sql stable security definer set search_path = '' set lock_timeout = '3s' as $$
  select a.region,a.slug,l.ruleset,l.realm,l.name,b.kills
  from public.character_links l
  join public.character_boss_kills b on b.link_id=l.id
  join public.armory_links a on a.link_id=l.id
  join public.armory_characters c on c.region=a.region and c.slug=a.slug and lower(c.name)=l.name_key
  where l.status='linked' and b.captured_at is not null
    and upper(replace(c.class,' ',''))=l.class and c.faction=l.faction
    and lower(replace(c.race,' ',''))=(case lower(l.race) when 'scourge' then 'undead' else lower(l.race) end)
    and l.realm ~* ('(^|[ -])' || a.region || '[0-9]*([ -]|$)')
    and c.ruleset_id=(case when l.realm ~* '(rp[ -]?pvp|roleplay[ -]pvp)$' then 15 when l.realm ~* '[ -]pvp$' then 1 when l.realm ~* '[ -](pve|normal)$' then 2 when l.realm ~* '[ -](rp|roleplay)$' then 3 else -1 end)
    and jsonb_typeof(p_characters)='array' and jsonb_array_length(p_characters)<=1000
    and exists(select 1 from jsonb_array_elements(p_characters) p where
      (p->>'region'=a.region and p->>'slug'=a.slug) or
      (p->>'ruleset'=l.ruleset and public.link_realm_key(p->>'realm')=l.realm_key and lower(btrim(p->>'name'))=l.name_key))
    and not exists(select 1 from public.armory_hides h where h.region=a.region and h.slug=a.slug)
    and not exists(select 1 from public.character_suppressions s where public.link_realm_key(s.realm)=l.realm_key and s.character=l.name_key);
$$;
revoke all on function public.public_boss_kills(jsonb) from public,anon,authenticated;
grant execute on function public.public_boss_kills(jsonb) to service_role;

-- One batched regional read for rankings. Membership comes exclusively from Blizzard's roster.
create index if not exists armory_members_character_progression on public.armory_members(region,character_slug);
create or replace function public.public_boss_kill_characters(p_region text)
returns table(region text,slug text,guild_slug text,guild_name text,kills jsonb)
language sql stable security definer set search_path = '' set lock_timeout = '3s' as $$
  select a.region,a.slug,g.slug,g.name,b.kills
  from public.character_links l
  join public.character_boss_kills b on b.link_id=l.id
  join public.armory_links a on a.link_id=l.id
  join public.armory_characters c on c.region=a.region and c.slug=a.slug and lower(c.name)=l.name_key
  join public.armory_members m on m.region=a.region and m.character_slug=a.slug
  join public.armory_guilds g on g.region=m.region and g.slug=m.guild_slug
  where l.status='linked' and b.captured_at is not null and (p_region is null or a.region=p_region)
    and upper(replace(c.class,' ',''))=l.class and c.faction=l.faction
    and lower(replace(c.race,' ',''))=(case lower(l.race) when 'scourge' then 'undead' else lower(l.race) end)
    and l.realm ~* ('(^|[ -])' || a.region || '[0-9]*([ -]|$)')
    and c.ruleset_id=(case when l.realm ~* '(rp[ -]?pvp|roleplay[ -]pvp)$' then 15 when l.realm ~* '[ -]pvp$' then 1 when l.realm ~* '[ -](pve|normal)$' then 2 when l.realm ~* '[ -](rp|roleplay)$' then 3 else -1 end)
    and g.name<>'DELETED'
    and not exists(select 1 from public.armory_hides h where h.region=a.region and h.slug=a.slug)
    and not exists(select 1 from public.character_suppressions s where public.link_realm_key(s.realm)=l.realm_key and s.character=l.name_key)
    and not exists(select 1 from public.guild_suppressions s where s.guild_key=lower(g.name)
      and s.realm_key ~ ('(^| )' || g.region || '[0-9]*( |$)'));
$$;
revoke all on function public.public_boss_kill_characters(text) from public,anon,authenticated;
grant execute on function public.public_boss_kill_characters(text) to service_role;

-- Preserve the existing owner's reader, reporting link status rather than a retired category consent.
create or replace function public.own_boss_kills(p_user_id uuid,p_link_id uuid)
returns jsonb language sql stable security definer set search_path = '' set lock_timeout = '3s' as $$
  select jsonb_build_object('sync',l.status='linked',
    'capturedAt',case when l.status='linked' then b.captured_at end,
    'kills',case when l.status='linked' then b.kills end)
  from public.character_links l left join public.character_boss_kills b on b.link_id=l.id
  where l.id=p_link_id and l.user_id=p_user_id;
$$;
revoke all on function public.own_boss_kills(uuid,uuid) from public,anon,authenticated;
grant execute on function public.own_boss_kills(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
