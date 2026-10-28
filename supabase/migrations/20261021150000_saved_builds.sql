-- Saved talent builds: a signed-in player's builds from the talent calculator, each filed under an optional
-- character label, with a short link (/b/<slug>) that works while sharing is on. Additive: two new tables and
-- seven functions; api_key_usage gains a 'builds' surface and create_api_key an optional scopes argument.
-- Apply before setting EVERLOOT_SAVED_BUILDS=1; until then the site never calls anything here
-- (docs/design/specs/2026-10-20-saved-builds-design.md). Safe to apply twice.
-- users.name is optional: accounts v2 is not a prerequisite. Battle.net accounts have no public owner name.
-- An email-only account's sign-up name appears only with show_name on; never substitute a BattleTag.
--
-- Only what the player typed and the share codes they built are stored. A character label is not checked
-- against the game or the census and is not linked to player pages. The server reads with the service role
-- and writes only through the functions below, so a bug in the server cannot pass the limits:
-- 200 builds and 30 characters per account, 300 saves a day per account.

create table if not exists public.build_characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  class_slug text not null
    check (class_slug in ('warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid')),
  realm text check (realm is null or char_length(realm) between 1 and 32),
  note text check (note is null or char_length(note) between 1 and 140),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists build_characters_user_idx on public.build_characters (user_id);
alter table public.build_characters enable row level security;
revoke all on public.build_characters from public, anon, authenticated, service_role;
grant select on public.build_characters to service_role;

create table if not exists public.saved_builds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  character_id uuid references public.build_characters(id) on delete set null,
  slug text not null unique check (slug ~ '^[A-Za-z0-9]{8}$'),
  name text not null check (char_length(name) between 1 and 60),
  notes text check (notes is null or char_length(notes) between 1 and 1000),
  class_slug text not null
    check (class_slug in ('warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid')),
  code text not null check (char_length(code) <= 400 and code ~ '^EL1-[a-z]+-[0-9]+-[0-9.]+-[A-Za-z0-9_-]+$'),
  code2 text check (code2 is null or (char_length(code2) <= 400 and code2 ~ '^EL1-[a-z]+-[0-9]+-[0-9.]+-[A-Za-z0-9_-]+$')),
  game_build text not null check (game_build ~ '^[0-9]+(\.[0-9]+)*$'),
  shared boolean not null default true,
  show_name boolean not null default false,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_builds_user_idx on public.saved_builds (user_id, updated_at desc);
create index if not exists saved_builds_character_idx on public.saved_builds (character_id);
-- "The one I'm running": at most one per character.
create unique index if not exists saved_builds_one_active on public.saved_builds (character_id) where active;
alter table public.saved_builds enable row level security;
revoke all on public.saved_builds from public, anon, authenticated, service_role;
grant select on public.saved_builds to service_role;

-- One save of a build or a character label, counted against the account's 300 a day. Called only by the
-- functions below; nobody else may execute it.
create or replace function public.take_build_save(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  bucket_name text := 'builds:' || p_user_id::text;
  current_bucket public.intake_quota_buckets%rowtype;
  time_now timestamptz := clock_timestamp();
begin
  insert into public.intake_quota_buckets values (bucket_name, 0, time_now + interval '1 day')
    on conflict (bucket) do update set bucket = excluded.bucket
    returning * into current_bucket;
  if current_bucket.reset_at <= time_now then
    update public.intake_quota_buckets set count = 0, reset_at = time_now + interval '1 day' where bucket = bucket_name;
    current_bucket.count := 0;
  end if;
  if current_bucket.count >= 300 then return false; end if;
  update public.intake_quota_buckets set count = count + 1 where bucket = bucket_name;
  return true;
end;
$$;
revoke all on function public.take_build_save(uuid) from public, anon, authenticated, service_role;

-- 1. Save a build: create (p_id null, with a fresh p_slug from the server) or update one of the owner's builds.
-- Class and game build come from the first code; the second code must be the same class. A character must be
-- the owner's and of the same class. Marking a build active unmarks the character's other one; a build with no
-- character is never active. On update, a null p_shared, p_active or p_show_name keeps the stored value, except
-- that a build moved to another character is not active there unless p_active is true.
-- Refusals (no row written): not_found (build or character is not the owner's), class_mismatch, build_limit,
-- daily_limit, slug_taken (the server retries with another slug). Malformed input raises: the server validates first.
create or replace function public.save_build(
  p_user_id uuid, p_id uuid, p_slug text, p_character_id uuid, p_name text, p_notes text,
  p_code text, p_code2 text, p_shared boolean, p_active boolean, p_show_name boolean)
returns table (build_ref uuid, build_slug text, refusal text)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  code_shape constant text := '^EL1-[a-z]+-[0-9]+-[0-9.]+-[A-Za-z0-9_-]+$';
  v_name text := btrim(p_name);
  v_notes text := nullif(btrim(p_notes), '');
  v_class text;
  v_game_build text;
  v_character public.build_characters%rowtype;
  v_existing public.saved_builds%rowtype;
  v_active boolean;
  v_count integer;
begin
  build_ref := null;
  build_slug := null;
  if p_user_id is null or v_name is null or char_length(v_name) not between 1 and 60
    or (v_notes is not null and char_length(v_notes) > 1000)
    or p_code is null or char_length(p_code) > 400 or p_code !~ code_shape
    or (p_code2 is not null and (char_length(p_code2) > 400 or p_code2 !~ code_shape)) then
    raise exception 'Invalid build';
  end if;
  v_class := split_part(p_code, '-', 2);
  v_game_build := split_part(p_code, '-', 4);
  if v_class not in ('warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid')
    or v_game_build !~ '^[0-9]+(\.[0-9]+)*$'
    or (p_code2 is not null and split_part(p_code2, '-', 2) <> v_class) then
    raise exception 'Invalid build';
  end if;
  -- The user row is locked so two saves cannot both pass the counts.
  perform 1 from public.users where id = p_user_id for update;
  if not found then raise exception 'Unknown user'; end if;

  if p_id is not null then
    select * into v_existing from public.saved_builds b where b.id = p_id and b.user_id = p_user_id for update;
    if not found then refusal := 'not_found'; return next; return; end if;
  elsif p_slug is null or p_slug !~ '^[A-Za-z0-9]{8}$' then
    raise exception 'Invalid slug';
  end if;
  if p_character_id is not null then
    select * into v_character from public.build_characters c where c.id = p_character_id and c.user_id = p_user_id;
    if not found then refusal := 'not_found'; return next; return; end if;
    if v_character.class_slug <> v_class then refusal := 'class_mismatch'; return next; return; end if;
  end if;
  if p_id is null then
    select count(*) into v_count from public.saved_builds b where b.user_id = p_user_id;
    if v_count >= 200 then refusal := 'build_limit'; return next; return; end if;
    -- Before anything is counted or changed, so a taken slug costs nothing.
    if exists (select 1 from public.saved_builds b where b.slug = p_slug) then refusal := 'slug_taken'; return next; return; end if;
  end if;
  if not public.take_build_save(p_user_id) then refusal := 'daily_limit'; return next; return; end if;

  -- A build that moves to another character arrives there unmarked unless p_active says otherwise, so it never
  -- takes the mark from that character's active build by accident.
  v_active := p_character_id is not null and coalesce(p_active,
    case when p_character_id is not distinct from v_existing.character_id then v_existing.active end, false);
  if v_active then
    update public.saved_builds set active = false
      where character_id = p_character_id and active and id is distinct from p_id;
  end if;
  if p_id is null then
    insert into public.saved_builds (user_id, character_id, slug, name, notes, class_slug, code, code2, game_build, shared, show_name, active)
      values (p_user_id, p_character_id, p_slug, v_name, v_notes, v_class, p_code, p_code2, v_game_build,
        coalesce(p_shared, true), coalesce(p_show_name, false), v_active)
      on conflict (slug) do nothing
      returning id, slug into build_ref, build_slug;
    if build_ref is null then refusal := 'slug_taken'; return next; return; end if;
  else
    update public.saved_builds b set character_id = p_character_id, name = v_name, notes = v_notes, class_slug = v_class,
      code = p_code, code2 = p_code2, game_build = v_game_build, shared = coalesce(p_shared, b.shared),
      show_name = coalesce(p_show_name, b.show_name), active = v_active, updated_at = now()
      where b.id = p_id and b.user_id = p_user_id
      returning b.id, b.slug into build_ref, build_slug;
  end if;
  refusal := null;
  return next;
end;
$$;
revoke all on function public.save_build(uuid, uuid, text, uuid, text, text, text, text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.save_build(uuid, uuid, text, uuid, text, text, text, text, boolean, boolean, boolean) to service_role;

-- 2. Delete one of the owner's builds. False when there is none with that id on the account. Its short link stops at once.
create or replace function public.delete_build(p_user_id uuid, p_id uuid)
returns boolean
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  deleted integer;
begin
  delete from public.saved_builds where id = p_id and user_id = p_user_id;
  get diagnostics deleted = row_count;
  return deleted = 1;
end;
$$;
revoke all on function public.delete_build(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_build(uuid, uuid) to service_role;

-- 3. Save a character label: create (p_id null) or update one of the owner's. Its class cannot change while
-- builds are filed under it. Refusals: not_found, has_builds, character_limit, daily_limit.
create or replace function public.save_build_character(
  p_user_id uuid, p_id uuid, p_name text, p_class_slug text, p_realm text, p_note text)
returns table (character_ref uuid, refusal text)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_name text := btrim(p_name);
  v_realm text := nullif(btrim(p_realm), '');
  v_note text := nullif(btrim(p_note), '');
  v_existing public.build_characters%rowtype;
  v_count integer;
begin
  character_ref := null;
  if p_user_id is null or v_name is null or char_length(v_name) not between 1 and 24
    or p_class_slug is null or p_class_slug not in ('warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid')
    or (v_realm is not null and char_length(v_realm) > 32) or (v_note is not null and char_length(v_note) > 140) then
    raise exception 'Invalid character';
  end if;
  perform 1 from public.users where id = p_user_id for update;
  if not found then raise exception 'Unknown user'; end if;
  if p_id is not null then
    select * into v_existing from public.build_characters c where c.id = p_id and c.user_id = p_user_id for update;
    if not found then refusal := 'not_found'; return next; return; end if;
    if v_existing.class_slug <> p_class_slug and exists (select 1 from public.saved_builds b where b.character_id = p_id) then
      refusal := 'has_builds'; return next; return;
    end if;
  else
    select count(*) into v_count from public.build_characters c where c.user_id = p_user_id;
    if v_count >= 30 then refusal := 'character_limit'; return next; return; end if;
  end if;
  if not public.take_build_save(p_user_id) then refusal := 'daily_limit'; return next; return; end if;
  if p_id is null then
    insert into public.build_characters (user_id, name, class_slug, realm, note)
      values (p_user_id, v_name, p_class_slug, v_realm, v_note)
      returning id into character_ref;
  else
    update public.build_characters c set name = v_name, class_slug = p_class_slug, realm = v_realm, note = v_note, updated_at = now()
      where c.id = p_id and c.user_id = p_user_id
      returning c.id into character_ref;
  end if;
  refusal := null;
  return next;
end;
$$;
revoke all on function public.save_build_character(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_build_character(uuid, uuid, text, text, text, text) to service_role;

-- 4. Delete one of the owner's character labels. Its builds stay, with no character and no active mark.
create or replace function public.delete_build_character(p_user_id uuid, p_id uuid)
returns boolean
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  deleted integer;
begin
  update public.saved_builds set active = false where character_id = p_id and user_id = p_user_id and active;
  delete from public.build_characters where id = p_id and user_id = p_user_id;
  get diagnostics deleted = row_count;
  return deleted = 1;
end;
$$;
revoke all on function public.delete_build_character(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_build_character(uuid, uuid) to service_role;

-- 5. The public read behind /b/<slug>: a shared build, or no row. The owner's name only when they chose to show it.
-- Read optional fields through the row so this compiles before accounts v2. Battle.net account names can
-- contain a current or stale BattleTag; their public profile display name belongs to a separate feature.
create or replace function public.shared_build(p_slug text)
returns table (name text, notes text, class_slug text, code text, code2 text, game_build text,
  character_name text, character_class text, owner_name text, updated_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select b.name, b.notes, b.class_slug, b.code, b.code2, b.game_build, c.name, c.class_slug,
    case when b.show_name and to_jsonb(u) ->> 'bnet_id' is null then to_jsonb(u) ->> 'name' end, b.updated_at
  from public.saved_builds b
  join public.users u on u.id = b.user_id
  left join public.build_characters c on c.id = b.character_id
  where p_slug ~ '^[A-Za-z0-9]{8}$' and b.slug = p_slug and b.shared
  limit 1;
$$;
revoke all on function public.shared_build(text) from public, anon, authenticated;
grant execute on function public.shared_build(text) to service_role;

-- 6. Keyed reads count per key under their own surface.
alter table public.api_key_usage drop constraint if exists api_key_usage_surface_check;
alter table public.api_key_usage add constraint api_key_usage_surface_check
  check (surface in ('corpus', 'drops', 'market', 'mcp', 'builds'));

-- 7. The owner's builds and characters for a key (the Desktop App, MCP, scripts). Only a live key with
-- read:own gets them; the request counts against the account's hourly allowance, as consume_api_key does.
-- refusal: unknown_key (unknown, revoked or expired), no_scope (live, without read:own), limited (allowance
-- spent; retry_after in seconds). characters and builds are null on a refusal. p_count false is for a request
-- the data guard has already counted against the same allowance (consume_api_key on the MCP mount), so one
-- MCP call is one request.
drop function if exists public.own_builds_for_key(text);
create or replace function public.own_builds_for_key(p_token_hash text, p_count boolean default true)
returns table (refusal text, retry_after integer, characters jsonb, builds jsonb)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  found_key public.api_keys%rowtype;
  current_bucket public.intake_quota_buckets%rowtype;
  bucket_name text;
  time_now timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid key'; end if;
  characters := null;
  builds := null;
  retry_after := 0;
  select * into found_key from public.api_keys k
    where k.token_hash = p_token_hash and k.revoked_at is null and (k.expires_at is null or k.expires_at > now());
  if not found then refusal := 'unknown_key'; return next; return; end if;
  if not ('read:own' = any(found_key.scopes)) then refusal := 'no_scope'; return next; return; end if;
  if p_count is distinct from false then
  bucket_name := 'user:' || found_key.user_id::text;
  time_now := clock_timestamp();
  insert into public.intake_quota_buckets values (bucket_name, 0, time_now + interval '1 hour')
    on conflict (bucket) do update set bucket = excluded.bucket
    returning * into current_bucket;
  time_now := clock_timestamp();
  if current_bucket.reset_at <= time_now then
    update public.intake_quota_buckets set count = 0, reset_at = time_now + interval '1 hour' where bucket = bucket_name;
    current_bucket.count := 0;
    current_bucket.reset_at := time_now + interval '1 hour';
  end if;
  if current_bucket.count >= 2000 then
    refusal := 'limited';
    retry_after := greatest(1, ceil(extract(epoch from current_bucket.reset_at - time_now))::integer);
    return next;
    return;
  end if;
  update public.intake_quota_buckets set count = count + 1 where bucket = bucket_name;
  insert into public.api_key_usage as u (day, key_id, surface, count)
    values ((now() at time zone 'utc')::date, found_key.id, 'builds', 1)
    on conflict on constraint api_key_usage_pkey do update set count = u.count + 1;
  update public.api_keys set last_used_at = now()
    where id = found_key.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'class_slug', c.class_slug, 'realm', c.realm, 'note', c.note)
      order by lower(c.name), c.id), '[]'::jsonb)
    into characters from public.build_characters c where c.user_id = found_key.user_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'notes', b.notes, 'class_slug', b.class_slug,
      'character_id', b.character_id, 'code', b.code, 'code2', b.code2, 'game_build', b.game_build, 'shared', b.shared,
      'show_name', b.show_name, 'active', b.active, 'updated_at', b.updated_at)
      order by b.updated_at desc, b.id), '[]'::jsonb)
    into builds from public.saved_builds b where b.user_id = found_key.user_id;
  refusal := null;
  return next;
end;
$$;
revoke all on function public.own_builds_for_key(text, boolean) from public, anon, authenticated;
grant execute on function public.own_builds_for_key(text, boolean) to service_role;

-- 8. Keys may now be made with read:own as well ("Read my saved builds"). Without p_scopes a key is
-- read:public, as before. The four-argument version is dropped first so a call by name has one match
-- (re-running 20261019120000_data_guard.sql after this file brings it back; drop it again if that happens).
drop function if exists public.create_api_key(uuid, text, text, text);
create or replace function public.create_api_key(p_user_id uuid, p_token_hash text, p_hint text, p_label text,
  p_scopes text[] default array['read:public']::text[])
returns table (key_ref uuid, refusal text)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  live integer;
  made public.intake_quota_buckets%rowtype;
  bucket_name text;
  time_now timestamptz;
begin
  if p_scopes is null or cardinality(p_scopes) = 0 or not (p_scopes <@ array['read:public', 'read:own']::text[]) then
    raise exception 'Invalid scopes';
  end if;
  perform 1 from public.users where id = p_user_id for update;
  if not found then raise exception 'Unknown user'; end if;
  key_ref := null;
  select count(*) into live from public.api_keys k
    where k.user_id = p_user_id and k.revoked_at is null and (k.expires_at is null or k.expires_at > now());
  if live >= 5 then
    refusal := 'live_limit';
    return next;
    return;
  end if;
  bucket_name := 'keys_made:' || p_user_id::text;
  time_now := clock_timestamp();
  insert into public.intake_quota_buckets values (bucket_name, 0, time_now + interval '1 day')
    on conflict (bucket) do update set bucket = excluded.bucket
    returning * into made;
  if made.reset_at <= time_now then
    update public.intake_quota_buckets set count = 0, reset_at = time_now + interval '1 day' where bucket = bucket_name;
    made.count := 0;
  end if;
  if made.count >= 10 then
    refusal := 'daily_limit';
    return next;
    return;
  end if;
  update public.intake_quota_buckets set count = count + 1 where bucket = bucket_name;
  insert into public.api_keys (user_id, token_hash, hint, label, scopes)
    values (p_user_id, p_token_hash, p_hint, coalesce(p_label, ''), array(select distinct s from unnest(p_scopes) s order by s))
    returning id into key_ref;
  refusal := null;
  return next;
end;
$$;
revoke all on function public.create_api_key(uuid, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.create_api_key(uuid, text, text, text, text[]) to service_role;
notify pgrst, 'reload schema';

-- Everything one account saved: select * from public.saved_builds where user_id = '<id>';
--   select * from public.build_characters where user_id = '<id>';
-- Take one shared link down by hand (the owner's tool for abuse): update public.saved_builds set shared = false where slug = '<slug>';
-- Rollback (run by hand; this deletes every saved build and label):
--   drop function if exists public.own_builds_for_key(text, boolean);
--   drop function if exists public.shared_build(text);
--   drop function if exists public.delete_build_character(uuid, uuid);
--   drop function if exists public.save_build_character(uuid, uuid, text, text, text, text);
--   drop function if exists public.delete_build(uuid, uuid);
--   drop function if exists public.save_build(uuid, uuid, text, uuid, text, text, text, text, boolean, boolean, boolean);
--   drop function if exists public.take_build_save(uuid);
--   drop table if exists public.saved_builds;
--   drop table if exists public.build_characters;
--   delete from public.api_key_usage where surface = 'builds';
--   alter table public.api_key_usage drop constraint if exists api_key_usage_surface_check;
--   alter table public.api_key_usage add constraint api_key_usage_surface_check check (surface in ('corpus', 'drops', 'market', 'mcp'));
--   update public.api_keys set scopes = array['read:public'] where 'read:own' = any(scopes);
--   drop function if exists public.create_api_key(uuid, text, text, text, text[]);
--   then re-run section 2 of 20261019120000_data_guard.sql for the four-argument create_api_key.
--   notify pgrst, 'reload schema';
