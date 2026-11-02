-- Planned builds on a linked character's public page (showcase plan, slice S4; identity ADR, "Compatibility migration
-- for build labels and profiles", step 1). Additive: one nullable column on build_characters and two functions.
-- Needs 20261021150000_saved_builds.sql and 20261021190000_character_links.sql first. Apply before setting
-- EVERLOOT_SHOWCASE_BUILDS=1; until then the site never calls anything here. Safe to apply twice.
--
-- A build label (what the player typed on My builds) is tied to a link only when its owner says so, through
-- attach_build_label. Nothing matches a label to a link by name. One label per link and one link per label. Unlinking
-- a character sets link_id to null and keeps the label and its builds; deleting the label leaves the link.

alter table public.build_characters
  add column if not exists link_id uuid references public.character_links(id) on delete set null;
create unique index if not exists build_characters_link_idx on public.build_characters (link_id) where link_id is not null;

-- 1. Attach one of the owner's labels to one of the owner's links, or with p_label_id null take the link's label off.
-- The link must be live (not frozen) and the label of the link's class. A label already on another of the owner's
-- links moves; the link's previous label comes off. Returns null when done, or a refusal: not_found (the link or the
-- label is not the owner's), frozen, class_mismatch. Nothing is written on a refusal.
create or replace function public.attach_build_label(p_user_id uuid, p_link_id uuid, p_label_id uuid)
returns text
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_link public.character_links%rowtype;
  v_label public.build_characters%rowtype;
begin
  if p_user_id is null or p_link_id is null then raise exception 'Invalid label'; end if;
  -- The user row is locked so two attaches on one account cannot cross.
  perform 1 from public.users where id = p_user_id for update;
  if not found then return 'not_found'; end if;
  select * into v_link from public.character_links l where l.id = p_link_id and l.user_id = p_user_id;
  if not found then return 'not_found'; end if;
  if v_link.status <> 'linked' then return 'frozen'; end if;
  if p_label_id is not null then
    select * into v_label from public.build_characters c where c.id = p_label_id and c.user_id = p_user_id;
    if not found then return 'not_found'; end if;
    if v_label.class_slug <> lower(v_link.class) then return 'class_mismatch'; end if;
  end if;
  update public.build_characters c set link_id = null, updated_at = now()
    where c.user_id = p_user_id and c.link_id = p_link_id and c.id is distinct from p_label_id;
  if p_label_id is not null then
    update public.build_characters c set link_id = p_link_id, updated_at = now()
      where c.id = p_label_id and c.user_id = p_user_id and c.link_id is distinct from p_link_id;
  end if;
  return null;
end;
$$;
revoke all on function public.attach_build_label(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.attach_build_label(uuid, uuid, uuid) to service_role;

-- 2. The planned builds on a public character page: the shared builds filed under the label its owner attached, the
-- one marked active first, then newest first, at most 20. The character must pass exactly what public_character asks
-- (live link, page on, not hidden, not claimed by a frozen link), so a page that is a 404 has no builds either. Only a
-- build's name, short link slug and date: never its notes, codes, label name, owner or ids.
create or replace function public.public_character_builds(p_ruleset text, p_realm_slug text, p_name text)
returns table (name text, slug text, updated_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select b.name, b.slug, b.updated_at
  from public.character_links l
  join public.character_visibility v on v.link_id = l.id
  join public.build_characters c on c.link_id = l.id and c.user_id = l.user_id
  join public.saved_builds b on b.character_id = c.id and b.user_id = l.user_id
  where l.ruleset = p_ruleset and l.name_key = lower(p_name) and l.realm_key = public.link_realm_key(p_realm_slug)
    and l.status = 'linked' and v.page_public and b.shared
    -- A label's class can change once its builds are gone; a build of another class never shows.
    and b.class_slug = lower(l.class)
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = l.realm_key and s.character = l.name_key)
    and not exists (select 1 from public.character_links o where o.id <> l.id and o.status = 'frozen'
      and (o.link_key = l.link_key or (o.ruleset = l.ruleset and o.realm_key = l.realm_key and o.name_key = l.name_key)))
  order by b.active desc, b.updated_at desc, b.id
  limit 20;
$$;
revoke all on function public.public_character_builds(text, text, text) from public, anon, authenticated;
grant execute on function public.public_character_builds(text, text, text) to service_role;
notify pgrst, 'reload schema';

-- Readback (every row t):
--   select 'column' as check, exists (select 1 from information_schema.columns where table_schema = 'public'
--       and table_name = 'build_characters' and column_name = 'link_id') as ok
--   union all select 'attach', has_function_privilege('service_role', 'public.attach_build_label(uuid, uuid, uuid)', 'EXECUTE')
--   union all select 'read', has_function_privilege('service_role', 'public.public_character_builds(text, text, text)', 'EXECUTE')
--   union all select 'closed', not has_function_privilege('anon', 'public.public_character_builds(text, text, text)', 'EXECUTE');
-- Rollback (run by hand; labels and builds stay, only their links to characters go):
--   drop function if exists public.public_character_builds(text, text, text);
--   drop function if exists public.attach_build_label(uuid, uuid, uuid);
--   drop index if exists public.build_characters_link_idx;
--   alter table public.build_characters drop column if exists link_id;
--   notify pgrst, 'reload schema';
