-- Draft only: applying this migration and enabling EVERLOOT_BOSS_KILL_SYNC need maintainer approval.
-- Always private; consent is independent of public raid/collection visibility.
create table if not exists public.character_boss_kills (
  link_id uuid primary key references public.character_links(id) on delete cascade,
  consented boolean not null default false,
  captured_at timestamptz,
  kills jsonb check (jsonb_typeof(kills) = 'array' and jsonb_array_length(kills) <= 2000 and octet_length(kills::text) <= 262144),
  source_ref text check (source_ref ~ '^[a-f0-9]{64}$'),
  check ((captured_at is null and kills is null and source_ref is null) or
    (consented and captured_at is not null and kills is not null and source_ref is not null))
);
alter table public.character_boss_kills enable row level security;
revoke all on public.character_boss_kills from public, anon, authenticated, service_role;
grant select on public.character_boss_kills to backup_exporter;
drop policy if exists backup_exporter_select on public.character_boss_kills;
create policy backup_exporter_select on public.character_boss_kills for select to backup_exporter using (true);

create or replace function public.set_boss_kill_consent(p_user_id uuid, p_link_id uuid, p_granted boolean)
returns text language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare v_link public.character_links%rowtype;
begin
  if p_user_id is null or p_link_id is null or p_granted is null then raise exception 'Invalid consent'; end if;
  select * into v_link from public.character_links where id = p_link_id and user_id = p_user_id for update;
  if not found then return 'not_found'; end if;
  if p_granted and v_link.status <> 'linked' then return 'frozen'; end if;
  insert into public.character_boss_kills (link_id, consented) values (p_link_id, p_granted)
    on conflict (link_id) do update set consented = p_granted,
      captured_at = case when p_granted then public.character_boss_kills.captured_at end,
      kills = case when p_granted then public.character_boss_kills.kills end,
      source_ref = case when p_granted then public.character_boss_kills.source_ref end;
  return null;
end $$;
revoke all on function public.set_boss_kill_consent(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_boss_kill_consent(uuid, uuid, boolean) to service_role;

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
  if not found or not v_old.consented then return 'no_consent'; end if;
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
  update public.character_boss_kills set captured_at = p_captured_at, kills = p_kills, source_ref = p_source_ref where link_id = v_link.id;
  return 'stored';
end $$;
revoke all on function public.sync_boss_kills(uuid, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.sync_boss_kills(uuid, text, text, text, text, timestamptz, jsonb) to service_role;

create or replace function public.own_boss_kills(p_user_id uuid, p_link_id uuid)
returns jsonb language sql stable security definer set search_path = '' set lock_timeout = '3s' as $$
  select jsonb_build_object('sync', coalesce(b.consented, false),
    'capturedAt', case when l.status = 'linked' and b.consented then b.captured_at end,
    'kills', case when l.status = 'linked' and b.consented then b.kills end)
  from public.character_links l left join public.character_boss_kills b on b.link_id = l.id
  where l.id = p_link_id and l.user_id = p_user_id;
$$;
revoke all on function public.own_boss_kills(uuid, uuid) from public, anon, authenticated;
grant execute on function public.own_boss_kills(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
