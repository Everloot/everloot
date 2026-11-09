-- Private sync of a linked character's own facts, and the owner's switches that publish them (identity ADR section 4,
-- accepted with D1 and D9 on 2026-11-06; showcase plan S5 and S6). Additive: two new tables, four new columns on
-- character_visibility, five new functions, set_visibility widened, and api_keys may now hold a 'sync:own' scope.
-- Needs 20261021190000_character_links.sql and 20261022120000_api_key_expiry.sql first. Apply before setting
-- EVERLOOT_PRIVATE_SYNC=1; until then the site never calls anything here. Safe to apply twice.
--
-- The rule (D9, "follow the link, not the machine"): any signed-in account may send facts from any install, and a
-- fact about a character is kept only when the sending account holds that character's live link (linked, not frozen)
-- and has turned on sync for that category. A frozen link takes nothing and shows nothing. The install a fact came
-- from is kept only as a keyed hash (`source_ref`, made by the server from the install id with the `source:` prefix),
-- for provenance and deletion; it never owns anything and is never shown.
--
-- Stored: per link and category, the latest state only. A capture replaces the stored one only when it is newer; the
-- same capture again is a duplicate and changes nothing; an older one never overwrites. Unlinking deletes the link's
-- consent and facts at once (on delete cascade; D3 default). Revoking a category's consent deletes that category's
-- facts at once. Nothing here is public until the owner turns the page on and the section's switch on, and only for a
-- live, unhidden link.

do $$
begin
  if to_regclass('public.character_visibility') is null or to_regprocedure('public.link_realm_key(text)') is null then
    raise exception 'Apply 20261021190000_character_links.sql first';
  end if;
  if to_regprocedure('public.issue_api_key(uuid, text, text, text, text, text[], timestamptz)') is null then
    raise exception 'Apply 20261022120000_api_key_expiry.sql first';
  end if;
end $$;

-- The categories a link can sync, and the section each one publishes under:
--   gear -> show_gear, talents -> show_talents, professions -> show_professions, reputations -> show_reputations,
--   raids -> show_raids (this character's lockouts), achievements -> show_collections (achievements and titles).

-- 1. Consent: per link and category, granted and revoked by the signed-in owner only (set_sync_consent).
create table if not exists public.character_sync_consent (
  link_id uuid not null references public.character_links(id) on delete cascade,
  category text not null check (category in ('gear', 'talents', 'professions', 'reputations', 'raids', 'achievements')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (link_id, category)
);
alter table public.character_sync_consent enable row level security;
revoke all on public.character_sync_consent from public, anon, authenticated, service_role;

-- 2. Facts: the latest state of one category of one link, as the server built it from the account's own rows.
-- `data` is the server's shape, never a raw upload: no install id, character key, name or GUID is in it.
-- `source_ref` = HMAC(secret, 'source:' || install id), `key_version` the secret's version (ADR section 7).
create table if not exists public.character_facts (
  link_id uuid not null references public.character_links(id) on delete cascade,
  category text not null check (category in ('gear', 'talents', 'professions', 'reputations', 'raids', 'achievements')),
  captured_at timestamptz not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 262144),
  data_hash text not null check (data_hash ~ '^[a-f0-9]{64}$'),
  source_ref text not null check (source_ref ~ '^[a-f0-9]{64}$'),
  key_version smallint not null default 1 check (key_version >= 1),
  received_at timestamptz not null default now(),
  primary key (link_id, category)
);
create index if not exists character_facts_source_idx on public.character_facts (source_ref);
alter table public.character_facts enable row level security;
revoke all on public.character_facts from public, anon, authenticated, service_role;

-- 3. The section switches S6 adds. show_gear and show_collections already exist and are reused.
alter table public.character_visibility add column if not exists show_talents boolean not null default false;
alter table public.character_visibility add column if not exists show_professions boolean not null default false;
alter table public.character_visibility add column if not exists show_reputations boolean not null default false;
alter table public.character_visibility add column if not exists show_raids boolean not null default false;

-- set_visibility as before, with the four new switches. An unknown flag or a value that is not a boolean raises.
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
        'show_reputations', 'show_raids', 'ranked_gear', 'ranked_achievements', 'ranked_gold', 'indexable')
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

-- 4. Keys may now carry sync:own ("Sync my linked characters"): it sends facts for links the key's account holds
-- live and has consented for, and nothing else. It cannot grant consent, change a switch or list anything; those
-- take a signed-in session. issue_api_key reads the table check, so widening the check is all it needs.
-- create_api_key (the older call) keeps its own list and never makes a sync:own key.
alter table public.api_keys drop constraint if exists api_keys_scopes_check;
alter table public.api_keys add constraint api_keys_scopes_check
  check (cardinality(scopes) > 0 and scopes <@ array['read:public', 'read:own', 'link:own', 'sync:own']::text[]);

-- The account behind a key that may sync. refusal: unknown_key (unknown, revoked or expired), no_scope (live,
-- without sync:own); account is null on a refusal.
create or replace function public.sync_account_for_key(p_token_hash text)
returns table (account uuid, refusal text)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  found_key public.api_keys%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid key'; end if;
  account := null;
  select * into found_key from public.api_keys k
    where k.token_hash = p_token_hash and k.revoked_at is null and (k.expires_at is null or k.expires_at > now());
  if not found then refusal := 'unknown_key'; return next; return; end if;
  if not ('sync:own' = any(found_key.scopes)) then refusal := 'no_scope'; return next; return; end if;
  update public.api_keys set last_used_at = now()
    where id = found_key.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  account := found_key.user_id;
  refusal := null;
  return next;
end;
$$;
revoke all on function public.sync_account_for_key(text) from public, anon, authenticated;
grant execute on function public.sync_account_for_key(text) to service_role;

-- 5. Grant or revoke one category's sync for one of the owner's links. Returns null when done, or a refusal:
-- not_found (not the owner's link), frozen (a frozen link cannot be granted; revoking always works). Revoking deletes
-- that category's stored facts in the same transaction.
create or replace function public.set_sync_consent(p_user_id uuid, p_link_id uuid, p_category text, p_granted boolean)
returns text
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_link public.character_links%rowtype;
begin
  if p_user_id is null or p_link_id is null or p_granted is null
    or p_category is null or p_category not in ('gear', 'talents', 'professions', 'reputations', 'raids', 'achievements') then
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

-- 6. Store one character's facts, sent by the account through a sync:own key. The character is found among the
-- account's own links only, by ruleset, realm and name; p_class, when given, must be the link's class. p_facts is a
-- jsonb array of { category, captured_at, data }, at most one per category. Returns one row per fact with its
-- outcome: stored, duplicate (the same capture again), older (the stored capture is as new or newer), no_consent.
-- When the account has no live link of that character (none, or frozen) the one row is (null, 'not_linked'); with
-- another class, (null, 'mismatch'). Nothing about another account's links is read or told. A capture more than a
-- day ahead of the server's clock raises: the site drops such rows first, so one cannot block every later capture.
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
    or p_facts is null or jsonb_typeof(p_facts) <> 'array' or jsonb_array_length(p_facts) > 6 then
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
    if v_category is null or v_category not in ('gear', 'talents', 'professions', 'reputations', 'raids', 'achievements')
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

-- 7. The owner's own read of one link, for the signed-in preview and the owner's switches: one row per category with
-- whether sync is on, and the stored capture when there is one. Nothing for a link that is not the account's, and no
-- facts for a frozen one (D2): its rows come back with consent only. Never the source, hash or another account.
create or replace function public.own_character_facts(p_user_id uuid, p_link_id uuid)
returns table (category text, consented boolean, captured_at timestamptz, data jsonb)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select k.category,
    exists (select 1 from public.character_sync_consent c where c.link_id = l.id and c.category = k.category and c.revoked_at is null),
    case when l.status = 'linked' then f.captured_at end,
    case when l.status = 'linked' then f.data end
  from public.character_links l
  cross join unnest(array['gear', 'talents', 'professions', 'reputations', 'raids', 'achievements']) as k(category)
  left join public.character_facts f on f.link_id = l.id and f.category = k.category
  where l.id = p_link_id and l.user_id = p_user_id;
$$;
revoke all on function public.own_character_facts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.own_character_facts(uuid, uuid) to service_role;

-- 8. The public sections of one character page: exactly the link public_character returns (live, page on, not hidden,
-- not claimed by a frozen link), and of its facts only the categories whose switch is on and whose sync is still
-- consented. No account, key, source or hash comes out of here.
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
      when 'talents' then v.show_talents
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
--   select 'consent table' as check, to_regclass('public.character_sync_consent') is not null as ok
--   union all select 'facts table', to_regclass('public.character_facts') is not null
--   union all select 'switches', (select count(*) = 4 from information_schema.columns where table_schema = 'public'
--       and table_name = 'character_visibility' and column_name in ('show_talents', 'show_professions', 'show_reputations', 'show_raids'))
--   union all select 'scope', pg_get_constraintdef((select oid from pg_constraint where conname = 'api_keys_scopes_check')) like '%sync:own%'
--   union all select 'key', has_function_privilege('service_role', 'public.sync_account_for_key(text)', 'EXECUTE')
--   union all select 'consent', has_function_privilege('service_role', 'public.set_sync_consent(uuid, uuid, text, boolean)', 'EXECUTE')
--   union all select 'sync', has_function_privilege('service_role', 'public.sync_character_facts(uuid, text, text, text, text, text, jsonb)', 'EXECUTE')
--   union all select 'own', has_function_privilege('service_role', 'public.own_character_facts(uuid, uuid)', 'EXECUTE')
--   union all select 'public', has_function_privilege('service_role', 'public.public_character_facts(text, text, text)', 'EXECUTE')
--   union all select 'closed', not has_function_privilege('anon', 'public.public_character_facts(text, text, text)', 'EXECUTE')
--     and not has_table_privilege('service_role', 'public.character_facts', 'SELECT,INSERT,UPDATE,DELETE')
--     and not has_table_privilege('service_role', 'public.character_sync_consent', 'SELECT,INSERT,UPDATE,DELETE');
-- What one account syncs: select l.name, l.realm, f.category, f.captured_at, f.received_at from public.character_facts f
--   join public.character_links l on l.id = f.link_id where l.user_id = '<id>' order by 1, 3;
-- Forget everything one install sent (an owner removes a machine): delete from public.character_facts where source_ref = '<hmac>';
-- Rollback (run by hand; this deletes every synced fact and consent, and turns every new section switch off):
--   drop function if exists public.public_character_facts(text, text, text);
--   drop function if exists public.own_character_facts(uuid, uuid);
--   drop function if exists public.sync_character_facts(uuid, text, text, text, text, text, jsonb);
--   drop function if exists public.set_sync_consent(uuid, uuid, text, boolean);
--   drop function if exists public.sync_account_for_key(text);
--   drop table if exists public.character_facts;
--   drop table if exists public.character_sync_consent;
--   delete from public.api_keys where scopes = array['sync:own']::text[];
--   update public.api_keys set scopes = array_remove(scopes, 'sync:own') where 'sync:own' = any(scopes);
--   alter table public.api_keys drop constraint if exists api_keys_scopes_check;
--   alter table public.api_keys add constraint api_keys_scopes_check check (cardinality(scopes) > 0 and scopes <@ array['read:public', 'read:own', 'link:own']::text[]);
--   then re-run section 4 of 20261021190000_character_links.sql (set_visibility), and:
--   alter table public.character_visibility drop column if exists show_talents, drop column if exists show_professions,
--     drop column if exists show_reputations, drop column if exists show_raids;
--   notify pgrst, 'reload schema';
