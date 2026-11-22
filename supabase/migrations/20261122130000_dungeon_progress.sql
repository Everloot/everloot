-- The tooltip's full names are reported by the linked owner's addon, never from Blizzard's API.
alter table public.character_boss_kills
  add column if not exists addon_surname text,
  add column if not exists addon_identity_source text;

create or replace function public.sync_dungeon_progress(p_user_id uuid,p_ruleset text,p_realm text,p_name text,
  p_source_ref text,p_captured_at timestamptz,p_kills jsonb,p_surname text)
returns text
language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare outcome text;
begin
  if p_surname is null or p_surname !~ '^[[:alpha:]]{2,24}$' then raise exception 'Invalid surname'; end if;
  outcome:=public.sync_boss_kills(p_user_id,p_ruleset,p_realm,p_name,p_source_ref,p_captured_at,p_kills);
  if outcome in ('stored','duplicate') then
    update public.character_boss_kills b set addon_surname=p_surname,addon_identity_source=p_source_ref
    from public.character_links l
    where b.link_id=l.id and l.user_id=p_user_id and l.status='linked' and l.ruleset=p_ruleset
      and l.realm_key=public.link_realm_key(p_realm) and l.name_key=lower(btrim(p_name))
      and b.captured_at=p_captured_at and b.source_ref=p_source_ref;
  end if;
  return outcome;
end $$;
revoke all on function public.sync_dungeon_progress(uuid,text,text,text,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.sync_dungeon_progress(uuid,text,text,text,text,timestamptz,jsonb,text) to service_role;

-- Owner-scoped suggestions use the same identity checks as armory_associate.
create or replace function public.armory_match_candidates(p_user_id uuid,p_link_id uuid)
returns table(region text,slug text,surname text)
language sql stable security definer set search_path = '' set lock_timeout = '3s' as $$
  select c.region,c.slug,c.surname
  from public.character_links l
  join public.armory_characters c on lower(c.name)=l.name_key
  left join public.character_boss_kills b on b.link_id=l.id and b.addon_identity_source=b.source_ref
  where l.user_id=p_user_id and l.id=p_link_id and l.status='linked'
    and (b.addon_surname is null or lower(c.surname)=lower(b.addon_surname))
    and c.faction=l.faction and upper(replace(c.class,' ',''))=l.class
    and lower(replace(c.race,' ',''))=(case lower(l.race) when 'scourge' then 'undead' else lower(l.race) end)
    and l.realm ~* ('(^|[ -])' || c.region || '[0-9]*([ -]|$)')
    and c.ruleset_id=(case when l.realm ~* '(rp[ -]?pvp|roleplay[ -]pvp)$' then 15 when l.realm ~* '[ -]pvp$' then 1 when l.realm ~* '[ -](pve|normal)$' then 2 when l.realm ~* '[ -](rp|roleplay)$' then 3 else -1 end)
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
    and not exists(select 1 from public.character_suppressions s where public.link_realm_key(s.realm)=l.realm_key and s.character=l.name_key)
    and not exists(select 1 from public.armory_links a where a.region=c.region and a.slug=c.slug and a.link_id<>l.id)
  order by c.region,c.slug limit 20;
$$;
revoke all on function public.armory_match_candidates(uuid,uuid) from public,anon,authenticated;
grant execute on function public.armory_match_candidates(uuid,uuid) to service_role;

-- Choose a bounded page on one realm. Use the existing public history read to enforce
-- every identity and hide check. Keep a separate cursor so a filtered page still advances.
create index if not exists dungeon_progress_link_realm on public.character_links(realm_key,id) where status='linked';
create or replace function public.dungeon_progress_page(p_realm text,p_offset integer,p_maps integer[])
returns jsonb
language sql stable security definer set search_path = '' set lock_timeout = '3s' as $$
  with page as materialized (
    select a.region,a.slug,b.addon_surname
    from public.character_links l
    join public.armory_links a on a.link_id=l.id
    join public.character_boss_kills b on b.link_id=l.id
    where l.realm_key=public.link_realm_key(p_realm) and l.status='linked' and b.captured_at is not null
      and b.addon_surname is not null and b.addon_identity_source=b.source_ref
    order by l.id limit 200 offset greatest(p_offset,0)
  ), history as (
    select h.name,p.addon_surname as surname,coalesce((
      select jsonb_agg(distinct jsonb_build_object('instanceMapId',k->'instanceMapId','encounterId',k->'encounterId'))
      from jsonb_array_elements(h.kills) k where (k->>'instanceMapId')::integer=any(p_maps)
    ),'[]'::jsonb) as kills
    from public.public_boss_kills(
      coalesce((select jsonb_agg(jsonb_build_object('region',p.region,'slug',p.slug)) from page p),'[]'::jsonb)
    ) h join page p on p.region=h.region and p.slug=h.slug
      join public.armory_characters c on c.region=h.region and c.slug=h.slug and lower(c.surname)=lower(p.addon_surname)
    where public.link_realm_key(h.realm)=public.link_realm_key(p_realm)
  )
  select jsonb_build_object(
    'next',(select case when count(*)=200 then p_offset+200 end from page),
    'rows',coalesce((select jsonb_agg(to_jsonb(h)) from history h),'[]'::jsonb)
  );
$$;
revoke all on function public.dungeon_progress_page(text,integer,integer[]) from public,anon,authenticated;
grant execute on function public.dungeon_progress_page(text,integer,integer[]) to service_role;
