-- Two more private-sync categories, `stats` (the character sheet's numbers) and `pvp` (PvP rank and honorable kills),
-- each behind its own owner switch, show_stats and show_pvp, off until turned on. Additive to
-- 20261106120000_private_sync.sql, which stays as applied: the two category checks are widened, two columns are added to
-- character_visibility, and the five functions that name the categories are replaced with their full new bodies. Every
-- other line of each function is the original's. Needs 20261106120000_private_sync.sql first. Safe to apply twice.
-- NOT applied to prod by the change that adds it; Carlos applies it (prod SQL via the preview SQL editor) before any
-- stats or pvp row is sent. Until then the site only lists the two categories; the database refuses to consent to them.
--
-- Everything the first migration says holds here: nothing about stats or pvp is public until the owner turns the page
-- on and the section's own switch on, only for a live, unhidden link, and revoking consent deletes the category's facts.

do $$
begin
  if to_regclass('public.character_sync_consent') is null or to_regclass('public.character_facts') is null
    or to_regprocedure('public.sync_character_facts(uuid, text, text, text, text, text, jsonb)') is null then
    raise exception 'Apply 20261106120000_private_sync.sql first';
  end if;
end $$;

-- The categories a link can sync, and the section each one publishes under:
--   gear -> show_gear, stats -> show_stats, talents -> show_talents, pvp -> show_pvp, professions -> show_professions,
--   reputations -> show_reputations, raids -> show_raids (this character's lockouts),
--   achievements -> show_collections (achievements and titles).

-- 1. The category checks, widened. These are the names Postgres gave the inline column checks of the first migration.
alter table public.character_sync_consent drop constraint if exists character_sync_consent_category_check;
alter table public.character_sync_consent add constraint character_sync_consent_category_check
  check (category in ('gear', 'stats', 'talents', 'pvp', 'professions', 'reputations', 'raids', 'achievements'));
alter table public.character_facts drop constraint if exists character_facts_category_check;
alter table public.character_facts add constraint character_facts_category_check
  check (category in ('gear', 'stats', 'talents', 'pvp', 'professions', 'reputations', 'raids', 'achievements'));

-- 2. The two section switches. Off by default, like the others.
alter table public.character_visibility add column if not exists show_stats boolean not null default false;
alter table public.character_visibility add column if not exists show_pvp boolean not null default false;

-- 3. set_visibility as in 20261106120000_private_sync.sql, with the two new switches.
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
        'show_reputations', 'show_raids', 'show_stats', 'show_pvp', 'ranked_gear', 'ranked_achievements', 'ranked_gold', 'indexable')
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

-- 4. set_sync_consent as before, with the two new categories.
create or replace function public.set_sync_consent(p_user_id uuid, p_link_id uuid, p_category text, p_granted boolean)
returns text
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_link public.character_links%rowtype;
begin
  if p_user_id is null or p_link_id is null or p_granted is null
    or p_category is null or p_category not in ('gear', 'stats', 'talents', 'pvp', 'professions', 'reputations', 'raids', 'achievements') then
    raise exception 'Invalid consent';
  end if;
  select * into v_link from public.character_links l where l.id = p_link_id and l.user_id = p_user_id for update;
  if not found then return 'not_found'; end if;
  if p_granted then
    if v_link.status <> 'linked' then return 'frozen'; end if;
    insert into public.character_sync_consent (link_id, category) values (p_link_id, p_category)
      on conflict (link_id, category) do update set granted_at = now(), revoked_at = null
      where public.character_sync_consent.revoked_at is not null;
  else
    update public.character_sync_consent c set revoked_at = now()
      where c.link_id = p_link_id and c.category = p_category and c.revoked_at is null;
    delete from public.character_facts f where f.link_id = p_link_id and f.category = p_category;
  end if;
  return null;
end;
$$;
revoke all on function public.set_sync_consent(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_sync_consent(uuid, uuid, text, boolean) to service_role;

-- 5. sync_character_facts as before, with the two new categories and room for one fact per category (eight, was six).
create or replace function public.sync_character_facts(p_user_id uuid, p_ruleset text, p_realm text, p_name text,
  p_class text, p_source_ref text, p_facts jsonb)
returns table (category text, outcome text)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
#variable_conflict use_column
declare
  v_link public.character_links%rowtype;
  v_fact jsonb;
  v_category text;
  v_captured timestamptz;
  v_data jsonb;
  v_hash text;
  v_old public.character_facts%rowtype;
begin
  if p_user_id is null or p_ruleset is null or p_realm is null or p_name is null
    or p_source_ref is null or p_source_ref !~ '^[a-f0-9]{64}$'
    or p_facts is null or jsonb_typeof(p_facts) <> 'array' or jsonb_array_length(p_facts) > 8 then
    raise exception 'Invalid facts';
  end if;
  -- The link row is locked, so two syncs of one character, or a sync and an unlink, take turns.
  select * into v_link from public.character_links l
    where l.user_id = p_user_id and l.ruleset = p_ruleset and l.realm_key = public.link_realm_key(p_realm)
      and l.name_key = lower(btrim(p_name))
    for update;
  if not found or v_link.status <> 'linked' then
    category := null; outcome := 'not_linked'; return next; return;
  end if;
  if p_class is not null and upper(p_class) <> v_link.class then
    category := null; outcome := 'mismatch'; return next; return;
  end if;
  for v_fact in select value from jsonb_array_elements(p_facts) loop
    v_category := v_fact ->> 'category';
    v_data := v_fact -> 'data';
    if v_category is null or v_category not in ('gear', 'stats', 'talents', 'pvp', 'professions', 'reputations', 'raids', 'achievements')
      or v_data is null or jsonb_typeof(v_data) <> 'object' or (v_fact ->> 'captured_at') is null then
      raise exception 'Invalid facts';
    end if;
    v_captured := (v_fact ->> 'captured_at')::timestamptz;
    if v_captured > now() + interval '1 day' then raise exception 'Invalid facts'; end if;
    category := v_category;
    if not exists (select 1 from public.character_sync_consent c
        where c.link_id = v_link.id and c.category = v_category and c.revoked_at is null) then
      outcome := 'no_consent'; return next; continue;
    end if;
    v_hash := encode(sha256(convert_to(v_data::text, 'UTF8')), 'hex');
    select * into v_old from public.character_facts f where f.link_id = v_link.id and f.category = v_category;
    if found and v_old.captured_at = v_captured and v_old.data_hash = v_hash then
      outcome := 'duplicate'; return next; continue;
    end if;
    if found and v_old.captured_at >= v_captured then
      outcome := 'older'; return next; continue;
    end if;
    insert into public.character_facts (link_id, category, captured_at, data, data_hash, source_ref)
      values (v_link.id, v_category, v_captured, v_data, v_hash, p_source_ref)
      on conflict (link_id, category) do update set captured_at = excluded.captured_at, data = excluded.data,
        data_hash = excluded.data_hash, source_ref = excluded.source_ref, key_version = excluded.key_version, received_at = now();
    outcome := 'stored'; return next;
  end loop;
end;
$$;
revoke all on function public.sync_character_facts(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_character_facts(uuid, text, text, text, text, text, jsonb) to service_role;

-- 6. own_character_facts as before, one row per category, now eight.
create or replace function public.own_character_facts(p_user_id uuid, p_link_id uuid)
returns table (category text, consented boolean, captured_at timestamptz, data jsonb)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select k.category,
    exists (select 1 from public.character_sync_consent c where c.link_id = l.id and c.category = k.category and c.revoked_at is null),
    case when l.status = 'linked' then f.captured_at end,
    case when l.status = 'linked' then f.data end
  from public.character_links l
  cross join unnest(array['gear', 'stats', 'talents', 'pvp', 'professions', 'reputations', 'raids', 'achievements']) as k(category)
  left join public.character_facts f on f.link_id = l.id and f.category = k.category
  where l.id = p_link_id and l.user_id = p_user_id;
$$;
revoke all on function public.own_character_facts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.own_character_facts(uuid, uuid) to service_role;

-- 7. public_character_facts as before, with the two new switches.
create or replace function public.public_character_facts(p_ruleset text, p_realm_slug text, p_name text)
returns table (category text, captured_at timestamptz, data jsonb)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select f.category, f.captured_at, f.data
  from public.character_links l
  join public.character_visibility v on v.link_id = l.id
  join public.character_facts f on f.link_id = l.id
  join public.character_sync_consent c on c.link_id = l.id and c.category = f.category and c.revoked_at is null
  where l.ruleset = p_ruleset and l.name_key = lower(p_name) and l.realm_key = public.link_realm_key(p_realm_slug)
    and l.status = 'linked' and v.page_public
    and case f.category
      when 'gear' then v.show_gear
      when 'stats' then v.show_stats
      when 'talents' then v.show_talents
      when 'pvp' then v.show_pvp
      when 'professions' then v.show_professions
      when 'reputations' then v.show_reputations
      when 'raids' then v.show_raids
      when 'achievements' then v.show_collections
      else false
    end
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = l.realm_key and s.character = l.name_key)
    and not exists (select 1 from public.character_links o where o.id <> l.id and o.status = 'frozen'
      and (o.link_key = l.link_key or (o.ruleset = l.ruleset and o.realm_key = l.realm_key and o.name_key = l.name_key)))
  order by f.category;
$$;
revoke all on function public.public_character_facts(text, text, text) from public, anon, authenticated;
grant execute on function public.public_character_facts(text, text, text) to service_role;
notify pgrst, 'reload schema';

-- Readback (every row t):
--   select 'switches' as check, (select count(*) = 2 from information_schema.columns where table_schema = 'public'
--       and table_name = 'character_visibility' and column_name in ('show_stats', 'show_pvp')) as ok
--   union all select 'consent check', pg_get_constraintdef((select oid from pg_constraint where conname = 'character_sync_consent_category_check')) like '%pvp%'
--   union all select 'facts check', pg_get_constraintdef((select oid from pg_constraint where conname = 'character_facts_category_check')) like '%stats%'
--   union all select 'visibility', pg_get_functiondef('public.set_visibility(uuid, uuid, jsonb)'::regprocedure) like '%show_pvp%'
--   union all select 'consent', pg_get_functiondef('public.set_sync_consent(uuid, uuid, text, boolean)'::regprocedure) like '%''pvp''%'
--   union all select 'sync', pg_get_functiondef('public.sync_character_facts(uuid, text, text, text, text, text, jsonb)'::regprocedure) like '%> 8%'
--   union all select 'own', pg_get_functiondef('public.own_character_facts(uuid, uuid)'::regprocedure) like '%''stats''%'
--   union all select 'public', pg_get_functiondef('public.public_character_facts(text, text, text)'::regprocedure) like '%show_stats%'
--   union all select 'closed', not has_function_privilege('anon', 'public.public_character_facts(text, text, text)', 'EXECUTE')
--     and has_function_privilege('service_role', 'public.own_character_facts(uuid, uuid)', 'EXECUTE');
-- Rollback (run by hand; this deletes every stats and pvp fact and consent): re-run sections 3 (set_visibility), 5 (set_sync_consent),
-- 6 (sync_character_facts), 7 (own_character_facts) and 8 (public_character_facts) of 20261106120000_private_sync.sql, after:
--   delete from public.character_facts where category in ('stats', 'pvp');
--   delete from public.character_sync_consent where category in ('stats', 'pvp');
--   alter table public.character_sync_consent drop constraint if exists character_sync_consent_category_check;
--   alter table public.character_sync_consent add constraint character_sync_consent_category_check
--     check (category in ('gear', 'talents', 'professions', 'reputations', 'raids', 'achievements'));
--   alter table public.character_facts drop constraint if exists character_facts_category_check;
--   alter table public.character_facts add constraint character_facts_category_check
--     check (category in ('gear', 'talents', 'professions', 'reputations', 'raids', 'achievements'));
--   alter table public.character_visibility drop column if exists show_stats, drop column if exists show_pvp;
--   notify pgrst, 'reload schema';
