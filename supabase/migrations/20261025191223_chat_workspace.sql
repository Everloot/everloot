-- The private Chat workspace: a signed-in player's projects, conversations and saved entries (builds, pages,
-- answers, notes), kept on their account (docs/superpowers/specs/2026-10-25-chat-projects-design.md). Additive:
-- five new tables and twenty functions; nothing existing changes. Needs only public.users
-- (20261003000000_auth_schema.sql). A saved-build entry also needs public.saved_builds
-- (20261021150000_saved_builds.sql); without it such an entry is refused as build_not_found, and nothing else
-- depends on it. Apply before setting EVERLOOT_CHAT_WORKSPACE=1; until then the site never calls anything here.
-- Safe to apply twice.
--
-- Records are keyed by (user_id, id), so an id names a record only inside its own account, and a chat or entry
-- can be filed only under a project of the same account (the foreign keys say so). The server reads and writes
-- with the service role, through the functions below only; each one takes the owner's id from the server's
-- session, never from the request body, and checks every referenced project and build against that owner.
-- Each record has a revision: 0 asks to create, an update or delete must name the current one, and anything
-- else is refused as revision_conflict, so one device never overwrites another's newer save.
-- Limits, held under a lock on the user row so concurrent saves cannot pass them: 100 projects, 500
-- conversations, 1000 entries and 10 MiB per account; 200 messages and 1 MiB per conversation; 300 saves a day
-- per account. Deletes are not counted. Nothing saved is ever pruned to make room.

create table if not exists public.chat_projects (
  user_id uuid not null references public.users(id) on delete cascade,
  id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  description text check (description is null or char_length(description) between 1 and 1000),
  revision integer not null check (revision >= 1),
  bytes integer not null check (bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.chat_projects enable row level security;
revoke all on public.chat_projects from public, anon, authenticated, service_role;
grant select on public.chat_projects to service_role;

-- A conversation's messages are the chat transcript the server already checked, as one JSON list. A project is
-- unfiled by chat_delete_project before it goes, so this foreign key never needs an action of its own.
create table if not exists public.chat_conversations (
  user_id uuid not null references public.users(id) on delete cascade,
  id uuid not null,
  project_id uuid,
  title text not null check (char_length(title) between 1 and 100),
  pinned boolean not null default false,
  messages jsonb not null check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 200),
  revision integer not null check (revision >= 1),
  bytes integer not null check (bytes between 0 and 1048576),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, project_id) references public.chat_projects (user_id, id)
);
create index if not exists chat_conversations_list on public.chat_conversations (user_id, pinned desc, updated_at desc, id desc);
create index if not exists chat_conversations_project on public.chat_conversations (user_id, project_id);
alter table public.chat_conversations enable row level security;
revoke all on public.chat_conversations from public, anon, authenticated, service_role;
grant select on public.chat_conversations to service_role;

-- A build is its owner's saved build by id (never a copy); a page is a same-site path; an answer or a note is
-- plain text the player chose. Names and tooltips of game things are never stored here.
create table if not exists public.chat_entries (
  user_id uuid not null references public.users(id) on delete cascade,
  id uuid not null,
  project_id uuid,
  kind text not null check (kind in ('build', 'page', 'answer', 'note')),
  title text not null check (char_length(title) <= 100),
  build_id uuid,
  href text check (href is null or (char_length(href) <= 2048 and href ~ '^/[^/\\]')),
  text text check (text is null or char_length(text) <= 20000),
  sources text[] not null default '{}' check (cardinality(sources) <= 20),
  revision integer not null check (revision >= 1),
  bytes integer not null check (bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, project_id) references public.chat_projects (user_id, id),
  check (case kind
    when 'build' then build_id is not null and href is null and text is null
    when 'page' then href is not null and build_id is null and text is null
    else text is not null and build_id is null and href is null end)
);
create index if not exists chat_entries_list on public.chat_entries (user_id, updated_at desc, id desc);
create index if not exists chat_entries_project on public.chat_entries (user_id, project_id);
alter table public.chat_entries enable row level security;
revoke all on public.chat_entries from public, anon, authenticated, service_role;
grant select on public.chat_entries to service_role;

-- Which browser chat became which account conversation: one row per account, browser (source) and local id,
-- so a repeated import answers with the same conversation. Deleting that conversation deletes the row.
create table if not exists public.chat_imports (
  user_id uuid not null references public.users(id) on delete cascade,
  source_id uuid not null,
  legacy_id text not null check (char_length(legacy_id) between 1 and 200),
  conversation_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, source_id, legacy_id),
  foreign key (user_id, conversation_id) references public.chat_conversations (user_id, id) on delete cascade
);
create index if not exists chat_imports_conversation on public.chat_imports (user_id, conversation_id);
alter table public.chat_imports enable row level security;
revoke all on public.chat_imports from public, anon, authenticated, service_role;
grant select on public.chat_imports to service_role;

-- The day's saves per account. Its own table, so the workspace needs nothing but users.
create table if not exists public.chat_daily_saves (
  user_id uuid primary key references public.users(id) on delete cascade,
  count integer not null check (count >= 0),
  reset_at timestamptz not null
);
alter table public.chat_daily_saves enable row level security;
revoke all on public.chat_daily_saves from public, anon, authenticated, service_role;
grant select on public.chat_daily_saves to service_role;

-- The records as the API returns them. Times are kept to the millisecond, so they round-trip through
-- JavaScript and a page cursor names a row exactly.
create or replace function public.chat_project_json(p public.chat_projects)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'revision', p.revision, 'updatedAt', p.updated_at);
$$;
create or replace function public.chat_conversation_json(c public.chat_conversations, p_messages boolean)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'updatedAt', c.updated_at, 'projectId', c.project_id,
    'pinned', c.pinned, 'revision', c.revision) || case when p_messages then jsonb_build_object('messages', c.messages) else '{}'::jsonb end;
$$;
create or replace function public.chat_entry_json(e public.chat_entries)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('id', e.id, 'projectId', e.project_id, 'kind', e.kind, 'title', e.title, 'buildId', e.build_id,
    'href', e.href, 'text', e.text, 'sources', to_jsonb(e.sources), 'revision', e.revision, 'updatedAt', e.updated_at);
$$;
revoke all on function public.chat_project_json(public.chat_projects) from public, anon, authenticated;
revoke all on function public.chat_conversation_json(public.chat_conversations, boolean) from public, anon, authenticated;
revoke all on function public.chat_entry_json(public.chat_entries) from public, anon, authenticated;

-- Internal: lock the owner (every change to one account runs one at a time), the account's stored bytes, and
-- one save against the day's 300. Nobody may execute these directly.
create or replace function public.chat_lock_owner(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  perform 1 from public.users where id = p_user_id for update;
  if not found then raise exception 'Unknown user'; end if;
end;
$$;
revoke all on function public.chat_lock_owner(uuid) from public, anon, authenticated, service_role;

create or replace function public.chat_account_bytes(p_user_id uuid)
returns bigint language sql stable security definer set search_path = ''
as $$
  select (select coalesce(sum(bytes), 0) from public.chat_projects where user_id = p_user_id)
    + (select coalesce(sum(bytes), 0) from public.chat_conversations where user_id = p_user_id)
    + (select coalesce(sum(bytes), 0) from public.chat_entries where user_id = p_user_id);
$$;
revoke all on function public.chat_account_bytes(uuid) from public, anon, authenticated, service_role;

create or replace function public.chat_take_mutation(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  saves public.chat_daily_saves%rowtype;
  time_now timestamptz := clock_timestamp();
begin
  insert into public.chat_daily_saves values (p_user_id, 0, time_now + interval '1 day')
    on conflict (user_id) do update set user_id = excluded.user_id
    returning * into saves;
  if saves.reset_at <= time_now then
    update public.chat_daily_saves set count = 0, reset_at = time_now + interval '1 day' where user_id = p_user_id;
    saves.count := 0;
  end if;
  if saves.count >= 300 then return false; end if;
  update public.chat_daily_saves set count = count + 1 where user_id = p_user_id;
  return true;
end;
$$;
revoke all on function public.chat_take_mutation(uuid) from public, anon, authenticated, service_role;

-- 1. Save a project: create (p_expected_revision 0) or update one of the owner's.
-- Refusals (nothing written): not_found, revision_conflict, quota_exceeded, size_exceeded, daily_limit.
-- Malformed input raises: the server validates first.
create or replace function public.chat_save_project(p_user_id uuid, p_id uuid, p_expected_revision integer, p_name text, p_description text)
returns table (refusal text, project jsonb)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_name text := btrim(p_name);
  v_description text := nullif(btrim(p_description), '');
  v_bytes integer;
  v_existing public.chat_projects%rowtype;
  v_found boolean;
  v_row public.chat_projects%rowtype;
  v_now timestamptz := date_trunc('milliseconds', clock_timestamp());
begin
  project := null;
  if p_user_id is null or p_id is null or p_expected_revision is null or p_expected_revision < 0
    or v_name is null or char_length(v_name) not between 1 and 100 or char_length(coalesce(v_description, '')) > 1000 then
    raise exception 'Invalid project';
  end if;
  v_bytes := octet_length(v_name) + coalesce(octet_length(v_description), 0);
  perform public.chat_lock_owner(p_user_id);
  select * into v_existing from public.chat_projects where user_id = p_user_id and id = p_id for update;
  v_found := found;
  if p_expected_revision = 0 and v_found then refusal := 'revision_conflict'; return next; return; end if;
  if p_expected_revision > 0 and not v_found then refusal := 'not_found'; return next; return; end if;
  if v_found and v_existing.revision <> p_expected_revision then refusal := 'revision_conflict'; return next; return; end if;
  if not v_found and (select count(*) from public.chat_projects where user_id = p_user_id) >= 100 then
    refusal := 'quota_exceeded'; return next; return;
  end if;
  if public.chat_account_bytes(p_user_id) - coalesce(v_existing.bytes, 0) + v_bytes > 10485760 then
    refusal := 'size_exceeded'; return next; return;
  end if;
  if not public.chat_take_mutation(p_user_id) then refusal := 'daily_limit'; return next; return; end if;
  if v_found then
    update public.chat_projects set name = v_name, description = v_description, bytes = v_bytes, revision = revision + 1, updated_at = v_now
      where user_id = p_user_id and id = p_id returning * into v_row;
  else
    insert into public.chat_projects (user_id, id, name, description, revision, bytes, created_at, updated_at)
      values (p_user_id, p_id, v_name, v_description, 1, v_bytes, v_now, v_now) returning * into v_row;
  end if;
  refusal := null;
  project := public.chat_project_json(v_row);
  return next;
end;
$$;
revoke all on function public.chat_save_project(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.chat_save_project(uuid, uuid, integer, text, text) to service_role;

-- 2. Remove a project. Its chats and entries move to Unfiled, each with a new revision; nothing else is deleted.
-- Returns null when done, else not_found or revision_conflict.
create or replace function public.chat_delete_project(p_user_id uuid, p_id uuid, p_expected_revision integer)
returns text
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_existing public.chat_projects%rowtype;
begin
  perform public.chat_lock_owner(p_user_id);
  select * into v_existing from public.chat_projects where user_id = p_user_id and id = p_id for update;
  if not found then return 'not_found'; end if;
  if v_existing.revision is distinct from p_expected_revision then return 'revision_conflict'; end if;
  update public.chat_conversations set project_id = null, revision = revision + 1 where user_id = p_user_id and project_id = p_id;
  update public.chat_entries set project_id = null, revision = revision + 1 where user_id = p_user_id and project_id = p_id;
  delete from public.chat_projects where user_id = p_user_id and id = p_id;
  return null;
end;
$$;
revoke all on function public.chat_delete_project(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.chat_delete_project(uuid, uuid, integer) to service_role;

-- Internal: whether a conversation's title and messages have the stored shape. The server checks each message.
create or replace function public.chat_conversation_ok(p_title text, p_messages jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select p_title is not null and char_length(p_title) between 1 and 100 and p_messages is not null
    and jsonb_typeof(p_messages) = 'array' and jsonb_array_length(p_messages) <= 200
    and not exists (select 1 from jsonb_array_elements(p_messages) m where jsonb_typeof(m) <> 'object');
$$;
revoke all on function public.chat_conversation_ok(text, jsonb) from public, anon, authenticated, service_role;

-- 3. Save a conversation: create or update, optionally filed under one of the owner's projects.
-- Refusals: not_found, project_not_found, revision_conflict, quota_exceeded, size_exceeded, daily_limit.
create or replace function public.chat_save_conversation(
  p_user_id uuid, p_id uuid, p_expected_revision integer, p_title text, p_project_id uuid, p_pinned boolean, p_messages jsonb)
returns table (refusal text, conversation jsonb)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_title text := btrim(p_title);
  v_bytes integer;
  v_existing public.chat_conversations%rowtype;
  v_found boolean;
  v_row public.chat_conversations%rowtype;
  v_now timestamptz := date_trunc('milliseconds', clock_timestamp());
begin
  conversation := null;
  if p_user_id is null or p_id is null or p_expected_revision is null or p_expected_revision < 0 or p_pinned is null
    or not public.chat_conversation_ok(v_title, p_messages) then
    raise exception 'Invalid conversation';
  end if;
  v_bytes := octet_length(v_title) + octet_length(p_messages::text);
  perform public.chat_lock_owner(p_user_id);
  if v_bytes > 1048576 then refusal := 'size_exceeded'; return next; return; end if;
  select * into v_existing from public.chat_conversations where user_id = p_user_id and id = p_id for update;
  v_found := found;
  if p_expected_revision = 0 and v_found then refusal := 'revision_conflict'; return next; return; end if;
  if p_expected_revision > 0 and not v_found then refusal := 'not_found'; return next; return; end if;
  if v_found and v_existing.revision <> p_expected_revision then refusal := 'revision_conflict'; return next; return; end if;
  if p_project_id is not null and not exists (select 1 from public.chat_projects where user_id = p_user_id and id = p_project_id) then
    refusal := 'project_not_found'; return next; return;
  end if;
  if not v_found and (select count(*) from public.chat_conversations where user_id = p_user_id) >= 500 then
    refusal := 'quota_exceeded'; return next; return;
  end if;
  if public.chat_account_bytes(p_user_id) - coalesce(v_existing.bytes, 0) + v_bytes > 10485760 then
    refusal := 'size_exceeded'; return next; return;
  end if;
  if not public.chat_take_mutation(p_user_id) then refusal := 'daily_limit'; return next; return; end if;
  if v_found then
    update public.chat_conversations set title = v_title, project_id = p_project_id, pinned = p_pinned, messages = p_messages,
      bytes = v_bytes, revision = revision + 1, updated_at = v_now
      where user_id = p_user_id and id = p_id returning * into v_row;
  else
    insert into public.chat_conversations (user_id, id, project_id, title, pinned, messages, revision, bytes, created_at, updated_at)
      values (p_user_id, p_id, p_project_id, v_title, p_pinned, p_messages, 1, v_bytes, v_now, v_now) returning * into v_row;
  end if;
  refusal := null;
  conversation := public.chat_conversation_json(v_row, true);
  return next;
end;
$$;
revoke all on function public.chat_save_conversation(uuid, uuid, integer, text, uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.chat_save_conversation(uuid, uuid, integer, text, uuid, boolean, jsonb) to service_role;

-- 4. Delete one of the owner's conversations (its import record goes with it). Null, not_found or revision_conflict.
create or replace function public.chat_delete_conversation(p_user_id uuid, p_id uuid, p_expected_revision integer)
returns text
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_revision integer;
begin
  perform public.chat_lock_owner(p_user_id);
  select revision into v_revision from public.chat_conversations where user_id = p_user_id and id = p_id for update;
  if not found then return 'not_found'; end if;
  if v_revision is distinct from p_expected_revision then return 'revision_conflict'; end if;
  delete from public.chat_conversations where user_id = p_user_id and id = p_id;
  return null;
end;
$$;
revoke all on function public.chat_delete_conversation(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.chat_delete_conversation(uuid, uuid, integer) to service_role;

-- 5. Save an entry: create or update. A build must be one of the owner's saved builds, checked on every save.
-- Refusals: not_found, project_not_found, build_not_found, revision_conflict, quota_exceeded, size_exceeded, daily_limit.
create or replace function public.chat_save_entry(
  p_user_id uuid, p_id uuid, p_expected_revision integer, p_project_id uuid, p_kind text, p_title text,
  p_build_id uuid, p_href text, p_text text, p_sources text[])
returns table (refusal text, entry jsonb)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_bytes integer;
  v_existing public.chat_entries%rowtype;
  v_found boolean;
  v_owned boolean;
  v_row public.chat_entries%rowtype;
  v_now timestamptz := date_trunc('milliseconds', clock_timestamp());
begin
  entry := null;
  if p_user_id is null or p_id is null or p_expected_revision is null or p_expected_revision < 0
    or char_length(v_title) > 100 or p_sources is null or cardinality(p_sources) > 20
    or exists (select 1 from unnest(p_sources) s where s is null or char_length(s) not between 1 and 512)
    or (p_text is not null and char_length(p_text) > 20000)
    or (p_href is not null and (char_length(p_href) > 2048 or p_href !~ '^/[^/\\]' or p_href ~ '[[:space:][:cntrl:]]'))
    or p_kind is null or not (case p_kind
      when 'build' then p_build_id is not null and p_href is null and p_text is null
      when 'page' then p_href is not null and p_build_id is null and p_text is null
      when 'answer' then p_text is not null and p_build_id is null and p_href is null
      when 'note' then p_text is not null and p_build_id is null and p_href is null
      else false end) then
    raise exception 'Invalid entry';
  end if;
  v_bytes := octet_length(v_title) + coalesce(octet_length(p_href), 0) + coalesce(octet_length(p_text), 0)
    + coalesce((select sum(octet_length(s)) from unnest(p_sources) s), 0)::integer;
  perform public.chat_lock_owner(p_user_id);
  select * into v_existing from public.chat_entries where user_id = p_user_id and id = p_id for update;
  v_found := found;
  if p_expected_revision = 0 and v_found then refusal := 'revision_conflict'; return next; return; end if;
  if p_expected_revision > 0 and not v_found then refusal := 'not_found'; return next; return; end if;
  if v_found and v_existing.revision <> p_expected_revision then refusal := 'revision_conflict'; return next; return; end if;
  if p_project_id is not null and not exists (select 1 from public.chat_projects where user_id = p_user_id and id = p_project_id) then
    refusal := 'project_not_found'; return next; return;
  end if;
  if p_build_id is not null then
    -- Saved builds are a separate migration; without it no build can be the owner's.
    v_owned := false;
    if to_regclass('public.saved_builds') is not null then
      execute 'select exists (select 1 from public.saved_builds where id = $1 and user_id = $2)' into v_owned using p_build_id, p_user_id;
    end if;
    if not v_owned then refusal := 'build_not_found'; return next; return; end if;
  end if;
  if not v_found and (select count(*) from public.chat_entries where user_id = p_user_id) >= 1000 then
    refusal := 'quota_exceeded'; return next; return;
  end if;
  if public.chat_account_bytes(p_user_id) - coalesce(v_existing.bytes, 0) + v_bytes > 10485760 then
    refusal := 'size_exceeded'; return next; return;
  end if;
  if not public.chat_take_mutation(p_user_id) then refusal := 'daily_limit'; return next; return; end if;
  if v_found then
    update public.chat_entries set project_id = p_project_id, kind = p_kind, title = v_title, build_id = p_build_id, href = p_href,
      text = p_text, sources = p_sources, bytes = v_bytes, revision = revision + 1, updated_at = v_now
      where user_id = p_user_id and id = p_id returning * into v_row;
  else
    insert into public.chat_entries (user_id, id, project_id, kind, title, build_id, href, text, sources, revision, bytes, created_at, updated_at)
      values (p_user_id, p_id, p_project_id, p_kind, v_title, p_build_id, p_href, p_text, p_sources, 1, v_bytes, v_now, v_now)
      returning * into v_row;
  end if;
  refusal := null;
  entry := public.chat_entry_json(v_row);
  return next;
end;
$$;
revoke all on function public.chat_save_entry(uuid, uuid, integer, uuid, text, text, uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.chat_save_entry(uuid, uuid, integer, uuid, text, text, uuid, text, text, text[]) to service_role;

-- 6. Delete one of the owner's entries. A build entry's saved build stays. Null, not_found or revision_conflict.
create or replace function public.chat_delete_entry(p_user_id uuid, p_id uuid, p_expected_revision integer)
returns text
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_revision integer;
begin
  perform public.chat_lock_owner(p_user_id);
  select revision into v_revision from public.chat_entries where user_id = p_user_id and id = p_id for update;
  if not found then return 'not_found'; end if;
  if v_revision is distinct from p_expected_revision then return 'revision_conflict'; end if;
  delete from public.chat_entries where user_id = p_user_id and id = p_id;
  return null;
end;
$$;
revoke all on function public.chat_delete_entry(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.chat_delete_entry(uuid, uuid, integer) to service_role;

-- 7. Import one browser chat. The first import for (owner, source, legacy id) makes an unfiled conversation;
-- every later one returns that conversation unchanged, with created false, and costs no save.
-- Refusals: quota_exceeded, size_exceeded, daily_limit.
create or replace function public.chat_import_conversation(p_user_id uuid, p_source_id uuid, p_legacy_id text, p_title text, p_messages jsonb)
returns table (refusal text, conversation jsonb, created boolean)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_title text := btrim(p_title);
  v_bytes integer;
  v_row public.chat_conversations%rowtype;
  v_now timestamptz := date_trunc('milliseconds', clock_timestamp());
begin
  conversation := null;
  created := false;
  if p_user_id is null or p_source_id is null or p_legacy_id is null or char_length(p_legacy_id) not between 1 and 200
    or not public.chat_conversation_ok(v_title, p_messages) then
    raise exception 'Invalid import';
  end if;
  v_bytes := octet_length(v_title) + octet_length(p_messages::text);
  perform public.chat_lock_owner(p_user_id);
  select c.* into v_row from public.chat_imports i
    join public.chat_conversations c on c.user_id = i.user_id and c.id = i.conversation_id
    where i.user_id = p_user_id and i.source_id = p_source_id and i.legacy_id = p_legacy_id;
  if found then
    refusal := null;
    conversation := public.chat_conversation_json(v_row, true);
    return next;
    return;
  end if;
  if v_bytes > 1048576 then refusal := 'size_exceeded'; return next; return; end if;
  if (select count(*) from public.chat_conversations where user_id = p_user_id) >= 500 then
    refusal := 'quota_exceeded'; return next; return;
  end if;
  if public.chat_account_bytes(p_user_id) + v_bytes > 10485760 then refusal := 'size_exceeded'; return next; return; end if;
  if not public.chat_take_mutation(p_user_id) then refusal := 'daily_limit'; return next; return; end if;
  insert into public.chat_conversations (user_id, id, project_id, title, pinned, messages, revision, bytes, created_at, updated_at)
    values (p_user_id, gen_random_uuid(), null, v_title, false, p_messages, 1, v_bytes, v_now, v_now) returning * into v_row;
  insert into public.chat_imports (user_id, source_id, legacy_id, conversation_id) values (p_user_id, p_source_id, p_legacy_id, v_row.id);
  refusal := null;
  conversation := public.chat_conversation_json(v_row, true);
  created := true;
  return next;
end;
$$;
revoke all on function public.chat_import_conversation(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.chat_import_conversation(uuid, uuid, text, text, jsonb) to service_role;

-- 8. Reads, always for one owner. Lists are pages of at most 51 (the server shows 50 and uses the 51st to
-- know there is more); the cursor is the last row shown. Conversations: pinned first, then newest; the title
-- search is a plain substring, never a pattern.
create or replace function public.chat_list_projects(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(public.chat_project_json(p) order by lower(p.name), p.id), '[]'::jsonb)
  from public.chat_projects p where p.user_id = p_user_id;
$$;
revoke all on function public.chat_list_projects(uuid) from public, anon, authenticated;
grant execute on function public.chat_list_projects(uuid) to service_role;

create or replace function public.chat_list_conversations(
  p_user_id uuid, p_project_id uuid, p_query text, p_after_pinned boolean, p_after_updated_at timestamptz, p_after_id uuid, p_limit integer)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(public.chat_conversation_json(c, false) order by c.pinned desc, c.updated_at desc, c.id desc), '[]'::jsonb)
  from (
    select * from public.chat_conversations c
    where c.user_id = p_user_id
      and (p_project_id is null or c.project_id = p_project_id)
      and (coalesce(p_query, '') = '' or strpos(lower(c.title), lower(p_query)) > 0)
      and (p_after_id is null or (c.pinned, c.updated_at, c.id) < (p_after_pinned, p_after_updated_at, p_after_id))
    order by c.pinned desc, c.updated_at desc, c.id desc
    limit least(greatest(coalesce(p_limit, 51), 1), 51)
  ) c;
$$;
revoke all on function public.chat_list_conversations(uuid, uuid, text, boolean, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.chat_list_conversations(uuid, uuid, text, boolean, timestamptz, uuid, integer) to service_role;

create or replace function public.chat_get_conversation(p_user_id uuid, p_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select public.chat_conversation_json(c, true) from public.chat_conversations c where c.user_id = p_user_id and c.id = p_id;
$$;
revoke all on function public.chat_get_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_get_conversation(uuid, uuid) to service_role;

create or replace function public.chat_list_entries(p_user_id uuid, p_project_id uuid, p_after_updated_at timestamptz, p_after_id uuid, p_limit integer)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(public.chat_entry_json(e) order by e.updated_at desc, e.id desc), '[]'::jsonb)
  from (
    select * from public.chat_entries e
    where e.user_id = p_user_id
      and (p_project_id is null or e.project_id = p_project_id)
      and (p_after_id is null or (e.updated_at, e.id) < (p_after_updated_at, p_after_id))
    order by e.updated_at desc, e.id desc
    limit least(greatest(coalesce(p_limit, 51), 1), 51)
  ) e;
$$;
revoke all on function public.chat_list_entries(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.chat_list_entries(uuid, uuid, timestamptz, uuid, integer) to service_role;

-- 9. Everything in one account's workspace, for its download. No owner id, import records or counters.
create or replace function public.chat_export(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'projects', (select coalesce(jsonb_agg(public.chat_project_json(p) order by lower(p.name), p.id), '[]'::jsonb)
      from public.chat_projects p where p.user_id = p_user_id),
    'conversations', (select coalesce(jsonb_agg(public.chat_conversation_json(c, true) order by c.updated_at desc, c.id desc), '[]'::jsonb)
      from public.chat_conversations c where c.user_id = p_user_id),
    'entries', (select coalesce(jsonb_agg(public.chat_entry_json(e) order by e.updated_at desc, e.id desc), '[]'::jsonb)
      from public.chat_entries e where e.user_id = p_user_id));
$$;
revoke all on function public.chat_export(uuid) from public, anon, authenticated;
grant execute on function public.chat_export(uuid) to service_role;

-- 10. Clear one account's workspace: its projects, conversations, entries and import records. The account,
-- its sign-in, its saved builds and the day's save count stay.
create or replace function public.chat_clear_workspace(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  perform public.chat_lock_owner(p_user_id);
  delete from public.chat_imports where user_id = p_user_id;
  delete from public.chat_conversations where user_id = p_user_id;
  delete from public.chat_entries where user_id = p_user_id;
  delete from public.chat_projects where user_id = p_user_id;
  return true;
end;
$$;
revoke all on function public.chat_clear_workspace(uuid) from public, anon, authenticated;
grant execute on function public.chat_clear_workspace(uuid) to service_role;
notify pgrst, 'reload schema';

-- One account's workspace, by hand: select public.chat_export('<user id>');
-- Rollback (run by hand; this deletes every account's workspace):
--   drop function if exists public.chat_clear_workspace(uuid);
--   drop function if exists public.chat_export(uuid);
--   drop function if exists public.chat_list_entries(uuid, uuid, timestamptz, uuid, integer);
--   drop function if exists public.chat_get_conversation(uuid, uuid);
--   drop function if exists public.chat_list_conversations(uuid, uuid, text, boolean, timestamptz, uuid, integer);
--   drop function if exists public.chat_list_projects(uuid);
--   drop function if exists public.chat_import_conversation(uuid, uuid, text, text, jsonb);
--   drop function if exists public.chat_delete_entry(uuid, uuid, integer);
--   drop function if exists public.chat_save_entry(uuid, uuid, integer, uuid, text, text, uuid, text, text, text[]);
--   drop function if exists public.chat_delete_conversation(uuid, uuid, integer);
--   drop function if exists public.chat_save_conversation(uuid, uuid, integer, text, uuid, boolean, jsonb);
--   drop function if exists public.chat_conversation_ok(text, jsonb);
--   drop function if exists public.chat_delete_project(uuid, uuid, integer);
--   drop function if exists public.chat_save_project(uuid, uuid, integer, text, text);
--   drop function if exists public.chat_take_mutation(uuid);
--   drop function if exists public.chat_account_bytes(uuid);
--   drop function if exists public.chat_lock_owner(uuid);
--   drop function if exists public.chat_entry_json(public.chat_entries);
--   drop function if exists public.chat_conversation_json(public.chat_conversations, boolean);
--   drop function if exists public.chat_project_json(public.chat_projects);
--   drop table if exists public.chat_imports, public.chat_entries, public.chat_conversations, public.chat_projects, public.chat_daily_saves;
--   notify pgrst, 'reload schema';
