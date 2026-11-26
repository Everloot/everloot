-- Comments on entity pages: a signed-in player with a profile handle comments on an item, quest, NPC, spell, zone or
-- instance page; other players report; moderators hide. Additive: three new tables and eleven functions. Needs
-- 20261021170000_account_profiles.sql first (a comment names its author by profile handle). Apply before setting
-- EVERLOOT_COMMENTS=1; until then the site never calls anything here. Safe to apply twice.
--
-- Comments are site-only (docs/DATA_POLICY.md, "Comments"): nothing here is read by the open data, the API, the MCP
-- server, chat answers, exports or sitemaps. Each table has row security on and grants nothing to the browser roles or
-- to the service role: the server reads and writes only through the functions below, which hold the owner, the
-- statuses and the limits: 20 comments, 30 edits and 30 reports an account a day; edits for 15 minutes after posting.
--
-- A comment is visible, hidden (by a moderator, who can restore it) or deleted (by its author; the words are wiped and
-- the row stays as a tombstone, and nothing brings it back). A hidden or deleted comment is read back with no words and
-- no name. A comment names its author by the handle on their profile now, read at display time, so a handle change
-- follows the account and a freed handle never points at someone else's words. Never the BattleTag, the account name
-- or the email.
--
-- Moderators are the rows of comment_moderators, any number of them; the operator adds them by hand. Reports are read
-- by moderators as reasons and notes, never with who sent them.

do $$
begin
  if to_regclass('public.user_profiles') is null then
    raise exception 'Apply 20261021170000_account_profiles.sql first';
  end if;
end $$;

-- Who may hide, restore and dismiss. Any number of accounts; empty, nobody moderates.
create table if not exists public.comment_moderators (
  user_id uuid primary key references public.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text check (note is null or char_length(note) between 1 and 200)
);
alter table public.comment_moderators enable row level security;
revoke all on public.comment_moderators from public, anon, authenticated, service_role;

create table if not exists public.entity_comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('item', 'quest', 'npc', 'spell', 'zone', 'instance')),
  entity_id integer not null check (entity_id > 0),
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'visible' check (status in ('visible', 'hidden', 'deleted')),
  body text not null check (char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  moderated_at timestamptz,
  moderated_by uuid references public.users(id) on delete set null,
  deleted_at timestamptz,
  -- Deleted is a tombstone: no words. Anything else has words.
  check ((status = 'deleted') = (deleted_at is not null)),
  check (case when status = 'deleted' then body = '' else body ~ '[^[:space:]]' end)
);
create index if not exists entity_comments_entity_idx on public.entity_comments (entity_type, entity_id, created_at desc);
create index if not exists entity_comments_user_idx on public.entity_comments (user_id, created_at desc);
alter table public.entity_comments enable row level security;
revoke all on public.entity_comments from public, anon, authenticated, service_role;

-- One report per account per comment. Open until a moderator hides or dismisses, or the author deletes.
create table if not exists public.entity_comment_reports (
  comment_id uuid not null references public.entity_comments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'spoiler', 'off_topic', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (comment_id, user_id)
);
create index if not exists entity_comment_reports_open_idx on public.entity_comment_reports (comment_id) where resolved_at is null;
create index if not exists entity_comment_reports_user_idx on public.entity_comment_reports (user_id);
alter table public.entity_comment_reports enable row level security;
revoke all on public.entity_comment_reports from public, anon, authenticated, service_role;

-- The nightly backup reads every ordinary table through its own role (20261110180000_backup_exporter_role.sql), and a
-- new table is closed to it until a migration opens it. Comments are backed up like the rest of the players' data.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'backup_exporter') then
    grant select on public.comment_moderators, public.entity_comments, public.entity_comment_reports to backup_exporter;
    drop policy if exists backup_exporter_select on public.comment_moderators;
    create policy backup_exporter_select on public.comment_moderators for select to backup_exporter using (true);
    drop policy if exists backup_exporter_select on public.entity_comments;
    create policy backup_exporter_select on public.entity_comments for select to backup_exporter using (true);
    drop policy if exists backup_exporter_select on public.entity_comment_reports;
    create policy backup_exporter_select on public.entity_comment_reports for select to backup_exporter using (true);
  end if;
end $$;

-- 1. A deleted comment stays deleted: its words are gone and no update brings them or its status back. Its row goes
-- only with its author's account.
create or replace function public.entity_comment_stays_deleted()
returns trigger
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if old.status = 'deleted' then
    raise exception 'A deleted comment stays deleted';
  end if;
  if (new.id, new.entity_type, new.entity_id, new.user_id, new.created_at)
    is distinct from (old.id, old.entity_type, old.entity_id, old.user_id, old.created_at) then
    raise exception 'A comment keeps its page, author and time';
  end if;
  return new;
end;
$$;
revoke all on function public.entity_comment_stays_deleted() from public, anon, authenticated, service_role;
drop trigger if exists entity_comments_stay_deleted on public.entity_comments;
create trigger entity_comments_stay_deleted
  before update on public.entity_comments
  for each row execute function public.entity_comment_stays_deleted();

-- 2. One count against an account's day: 'comment_posts:<id>', 'comment_edits:<id>', 'comment_reports:<id>'. Called
-- only by the functions below.
create or replace function public.take_comment_count(p_bucket text, p_limit integer)
returns boolean
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  current_bucket public.intake_quota_buckets%rowtype;
  time_now timestamptz := clock_timestamp();
begin
  insert into public.intake_quota_buckets values (p_bucket, 0, time_now + interval '1 day')
    on conflict (bucket) do update set bucket = excluded.bucket
    returning * into current_bucket;
  if current_bucket.reset_at <= time_now then
    update public.intake_quota_buckets set count = 0, reset_at = time_now + interval '1 day' where bucket = p_bucket;
    current_bucket.count := 0;
  end if;
  if current_bucket.count >= p_limit then return false; end if;
  update public.intake_quota_buckets set count = count + 1 where bucket = p_bucket;
  return true;
end;
$$;
revoke all on function public.take_comment_count(text, integer) from public, anon, authenticated, service_role;

-- 3. Words as the server cleaned them: 1 to 2000 characters, not only spaces, no control character but the line break.
-- Called only by the functions below.
create or replace function public.entity_comment_body_ok(p_body text)
returns boolean
language sql immutable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select p_body is not null and char_length(p_body) between 1 and 2000 and p_body ~ '[^[:space:]]'
    and p_body !~ '[\x01-\x09\x0b-\x1f\x7f]';
$$;
revoke all on function public.entity_comment_body_ok(text) from public, anon, authenticated, service_role;

-- 4. Post a comment. Returns {comment_ref, refusal}. Refusals (nothing written, nothing counted unless posted):
-- needs_handle, daily_limit (20 a day). Malformed input raises 'Invalid comment': the server validates first.
create or replace function public.post_entity_comment(p_user_id uuid, p_entity_type text, p_entity_id integer, p_body text)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or p_entity_type is null or p_entity_type not in ('item', 'quest', 'npc', 'spell', 'zone', 'instance')
    or p_entity_id is null or p_entity_id < 1 or not public.entity_comment_body_ok(p_body) then
    raise exception 'Invalid comment';
  end if;
  -- The account's row is locked so two posts cannot both pass the count, and the handle cannot go between the check
  -- and the write.
  perform 1 from public.users where id = p_user_id for update;
  if not found then raise exception 'Unknown user'; end if;
  if not exists (select 1 from public.user_profiles p where p.user_id = p_user_id and p.handle is not null) then
    return jsonb_build_object('comment_ref', null, 'refusal', 'needs_handle');
  end if;
  if not public.take_comment_count('comment_posts:' || p_user_id::text, 20) then
    return jsonb_build_object('comment_ref', null, 'refusal', 'daily_limit');
  end if;
  insert into public.entity_comments (entity_type, entity_id, user_id, body) values (p_entity_type, p_entity_id, p_user_id, p_body)
    returning id into v_id;
  return jsonb_build_object('comment_ref', v_id, 'refusal', null);
end;
$$;
revoke all on function public.post_entity_comment(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.post_entity_comment(uuid, text, integer, text) to service_role;

-- 5. Edit the author's own visible comment within 15 minutes of posting. Returns {comment_ref, refusal}. Refusals:
-- not_found (no comment of the author's with that id), not_editable (hidden, deleted or past 15 minutes), daily_limit
-- (30 edits a day).
create or replace function public.edit_entity_comment(p_user_id uuid, p_comment_id uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v public.entity_comments%rowtype;
begin
  if p_user_id is null or p_comment_id is null or not public.entity_comment_body_ok(p_body) then raise exception 'Invalid comment'; end if;
  select * into v from public.entity_comments c where c.id = p_comment_id and c.user_id = p_user_id for update;
  if not found then return jsonb_build_object('comment_ref', null, 'refusal', 'not_found'); end if;
  if v.status <> 'visible' or v.created_at < now() - interval '15 minutes' then
    return jsonb_build_object('comment_ref', null, 'refusal', 'not_editable');
  end if;
  if not public.take_comment_count('comment_edits:' || p_user_id::text, 30) then
    return jsonb_build_object('comment_ref', null, 'refusal', 'daily_limit');
  end if;
  update public.entity_comments set body = p_body, edited_at = now() where id = p_comment_id;
  return jsonb_build_object('comment_ref', p_comment_id, 'refusal', null);
end;
$$;
revoke all on function public.edit_entity_comment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.edit_entity_comment(uuid, uuid, text) to service_role;

-- 6. Delete the author's own comment, visible or hidden: the words are wiped, a tombstone stays and its open reports
-- close. Returns {comment_ref, refusal}. Refusal: not_found (none of the author's, or already deleted).
create or replace function public.delete_entity_comment(p_user_id uuid, p_comment_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if p_user_id is null or p_comment_id is null then raise exception 'Invalid comment'; end if;
  update public.entity_comments set status = 'deleted', body = '', deleted_at = now()
    where id = p_comment_id and user_id = p_user_id and status in ('visible', 'hidden');
  if not found then return jsonb_build_object('comment_ref', null, 'refusal', 'not_found'); end if;
  update public.entity_comment_reports set resolved_at = now() where comment_id = p_comment_id and resolved_at is null;
  return jsonb_build_object('comment_ref', p_comment_id, 'refusal', null);
end;
$$;
revoke all on function public.delete_entity_comment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_entity_comment(uuid, uuid) to service_role;

-- 7. Report a visible comment. Returns {comment_ref, refusal}. Refusals: not_found (no visible comment with that id),
-- own_comment, already_reported, daily_limit (30 a day). A reason not on the list, or a note over 300 characters or with
-- control characters, raises 'Invalid report'.
create or replace function public.report_entity_comment(p_user_id uuid, p_comment_id uuid, p_reason text, p_note text)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_author uuid;
begin
  if p_user_id is null or p_comment_id is null or p_reason is null or p_reason not in ('spam', 'abuse', 'spoiler', 'off_topic', 'other')
    or p_note is null or char_length(p_note) > 300 or p_note ~ '[\x01-\x1f\x7f]' then
    raise exception 'Invalid report';
  end if;
  select c.user_id into v_author from public.entity_comments c where c.id = p_comment_id and c.status = 'visible';
  if not found then return jsonb_build_object('comment_ref', null, 'refusal', 'not_found'); end if;
  if v_author = p_user_id then return jsonb_build_object('comment_ref', null, 'refusal', 'own_comment'); end if;
  if exists (select 1 from public.entity_comment_reports r where r.comment_id = p_comment_id and r.user_id = p_user_id) then
    return jsonb_build_object('comment_ref', null, 'refusal', 'already_reported');
  end if;
  if not public.take_comment_count('comment_reports:' || p_user_id::text, 30) then
    return jsonb_build_object('comment_ref', null, 'refusal', 'daily_limit');
  end if;
  insert into public.entity_comment_reports (comment_id, user_id, reason, note) values (p_comment_id, p_user_id, p_reason, p_note)
    on conflict do nothing;
  return jsonb_build_object('comment_ref', p_comment_id, 'refusal', null);
end;
$$;
revoke all on function public.report_entity_comment(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_entity_comment(uuid, uuid, text, text) to service_role;

-- 8. Whether an account moderates comments.
create or replace function public.is_comment_moderator(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select p_user_id is not null and exists (select 1 from public.comment_moderators m where m.user_id = p_user_id);
$$;
revoke all on function public.is_comment_moderator(uuid) from public, anon, authenticated;
grant execute on function public.is_comment_moderator(uuid) to service_role;

-- 9. A moderator's action: hide (visible to hidden, open reports closed), restore (hidden to visible) or dismiss (a
-- visible comment's open reports closed, the comment kept). Returns {comment_ref, status, refusal}. Refusals:
-- not_moderator, not_found, wrong_status. Another action raises 'Invalid moderation'.
create or replace function public.moderate_entity_comment(p_moderator_id uuid, p_comment_id uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_status text;
  v_next text;
begin
  if p_moderator_id is null or p_comment_id is null or p_action is null or p_action not in ('hide', 'restore', 'dismiss') then
    raise exception 'Invalid moderation';
  end if;
  if not public.is_comment_moderator(p_moderator_id) then
    return jsonb_build_object('comment_ref', null, 'status', null, 'refusal', 'not_moderator');
  end if;
  select c.status into v_status from public.entity_comments c where c.id = p_comment_id for update;
  if not found then return jsonb_build_object('comment_ref', null, 'status', null, 'refusal', 'not_found'); end if;
  v_next := case
    when p_action = 'hide' and v_status = 'visible' then 'hidden'
    when p_action = 'restore' and v_status = 'hidden' then 'visible'
    when p_action = 'dismiss' and v_status = 'visible' then 'visible'
  end;
  if v_next is null then return jsonb_build_object('comment_ref', null, 'status', v_status, 'refusal', 'wrong_status'); end if;
  if p_action <> 'dismiss' then
    update public.entity_comments set status = v_next, moderated_at = now(), moderated_by = p_moderator_id where id = p_comment_id;
  end if;
  if p_action <> 'restore' then
    update public.entity_comment_reports set resolved_at = now() where comment_id = p_comment_id and resolved_at is null;
  end if;
  return jsonb_build_object('comment_ref', p_comment_id, 'status', v_next, 'refusal', null);
end;
$$;
revoke all on function public.moderate_entity_comment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.moderate_entity_comment(uuid, uuid, text) to service_role;

-- 10. One page's comments, newest first, at most 200: words and the author's handle for a visible comment, a tombstone
-- (no words, no name) for a hidden or deleted one. With a viewer: which are theirs, which they may still edit, and which
-- they reported.
create or replace function public.entity_comments_for(p_entity_type text, p_entity_id integer, p_viewer uuid)
returns table (id uuid, author text, body text, status text, created_at timestamptz, edited_at timestamptz, mine boolean,
  editable boolean, reported boolean)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select c.id,
    case when c.status = 'visible' then p.handle end,
    case when c.status = 'visible' then c.body else '' end,
    c.status, c.created_at, c.edited_at,
    p_viewer is not null and c.user_id = p_viewer,
    p_viewer is not null and c.user_id = p_viewer and c.status = 'visible' and c.created_at >= now() - interval '15 minutes',
    p_viewer is not null and exists (select 1 from public.entity_comment_reports r where r.comment_id = c.id and r.user_id = p_viewer)
  from public.entity_comments c
  left join public.user_profiles p on p.user_id = c.user_id
  where c.entity_type = p_entity_type and c.entity_id = p_entity_id
  order by c.created_at desc, c.id
  limit 200;
$$;
revoke all on function public.entity_comments_for(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.entity_comments_for(text, integer, uuid) to service_role;

-- 11. The moderators' queue: visible comments with open reports, most reported first, then comments hidden in the last
-- 30 days (to restore). Reasons and notes, never who reported. Raises 'Not a moderator' for anyone else.
create or replace function public.comment_moderation_queue(p_moderator_id uuid)
returns table (id uuid, entity_type text, entity_id integer, author text, body text, status text, created_at timestamptz,
  edited_at timestamptz, moderated_at timestamptz, open_reports integer, reasons text[], notes text[])
language plpgsql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if not public.is_comment_moderator(p_moderator_id) then raise exception 'Not a moderator'; end if;
  return query
    select c.id, c.entity_type, c.entity_id, p.handle, c.body, c.status, c.created_at, c.edited_at, c.moderated_at,
      count(r.user_id) filter (where r.resolved_at is null)::integer,
      coalesce(array_agg(distinct r.reason) filter (where r.resolved_at is null), '{}'),
      coalesce(array_agg(r.note order by r.created_at) filter (where r.resolved_at is null and r.note <> ''), '{}')
    from public.entity_comments c
    left join public.user_profiles p on p.user_id = c.user_id
    left join public.entity_comment_reports r on r.comment_id = c.id
    where (c.status = 'visible' and exists (select 1 from public.entity_comment_reports o where o.comment_id = c.id and o.resolved_at is null))
      or (c.status = 'hidden' and c.moderated_at >= now() - interval '30 days')
    group by c.id, p.handle
    order by (c.status = 'visible') desc, count(r.user_id) filter (where r.resolved_at is null) desc, c.created_at desc
    limit 200;
end;
$$;
revoke all on function public.comment_moderation_queue(uuid) from public, anon, authenticated;
grant execute on function public.comment_moderation_queue(uuid) to service_role;
notify pgrst, 'reload schema';

-- A moderator, once their account id is read from public.users (docs/2026-11-25-comments-activation.md):
--   insert into public.comment_moderators (user_id, note) values ('<their id>', '<who>');
-- Rollback (run by hand; this deletes every comment, report and moderator):
--   drop function if exists public.comment_moderation_queue(uuid);
--   drop function if exists public.entity_comments_for(text, integer, uuid);
--   drop function if exists public.moderate_entity_comment(uuid, uuid, text);
--   drop function if exists public.is_comment_moderator(uuid);
--   drop function if exists public.report_entity_comment(uuid, uuid, text, text);
--   drop function if exists public.delete_entity_comment(uuid, uuid);
--   drop function if exists public.edit_entity_comment(uuid, uuid, text);
--   drop function if exists public.post_entity_comment(uuid, text, integer, text);
--   drop function if exists public.entity_comment_body_ok(text);
--   drop function if exists public.take_comment_count(text, integer);
--   drop table if exists public.entity_comment_reports;
--   drop table if exists public.entity_comments;
--   drop function if exists public.entity_comment_stays_deleted();
--   drop table if exists public.comment_moderators;
--   delete from public.intake_quota_buckets where bucket like 'comment\_posts:%' or bucket like 'comment\_edits:%'
--     or bucket like 'comment\_reports:%';
--   notify pgrst, 'reload schema';
