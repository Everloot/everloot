-- Player screenshots on entity pages: a signed-in player with a profile handle uploads a screenshot for an item, quest,
-- NPC, spell, zone or instance page; nothing shows until a comment moderator approves it; the uploader deletes their
-- own. Additive: one new table and nine functions. Needs 20261125130000_entity_comments.sql first (the moderators are
-- the rows of comment_moderators, and the limits use its take_comment_count). Apply before setting
-- EVERLOOT_SCREENSHOTS=1; until then the site never calls anything here. Safe to apply twice.
--
-- The rows hold no picture. The site re-encodes each upload to WebP (at most 1920 px a side and 2,000,000 bytes, with no
-- metadata) and keeps the file in its own R2 bucket, under screenshots/pending/ until approved and screenshots/public/
-- after. The site serves a file only while its row here says so (entity_screenshot_access), so a file whose row is
-- rejected, deleted or gone with its account is never shown, even if the bucket still holds it.
--
-- Screenshots are site-only (docs/DATA_POLICY.md, "Screenshots"): nothing here is read by the open data, the API, the
-- MCP server, chat answers, exports or sitemaps. The table has row security on and grants nothing to the browser roles
-- or the service role: the server reads and writes only through the functions below, which hold the owner, the
-- statuses and the limits: 5 uploads an account a day, 10 waiting for review an account at once, 300 a day site-wide.
--
-- A screenshot is pending (uploaded, seen by its uploader and the moderators only), approved (on its page), rejected (by
-- a moderator, before or after approval) or deleted (by its uploader; nothing brings it back). The gallery names the
-- uploader by the handle on their profile now, never the BattleTag, the account name or the email.

do $$
begin
  if to_regclass('public.user_profiles') is null then
    raise exception 'Apply 20261021170000_account_profiles.sql first';
  end if;
  if to_regclass('public.comment_moderators') is null or to_regprocedure('public.take_comment_count(text,integer)') is null then
    raise exception 'Apply 20261125130000_entity_comments.sql first';
  end if;
end $$;

create table if not exists public.entity_screenshots (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('item', 'quest', 'npc', 'spell', 'zone', 'instance')),
  entity_id integer not null check (entity_id > 0),
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'deleted')),
  -- The stored WebP's size, as the server re-encoded it.
  width integer not null check (width between 1 and 1920),
  height integer not null check (height between 1 and 1920),
  bytes integer not null check (bytes between 1 and 2000000),
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references public.users(id) on delete set null,
  deleted_at timestamptz,
  check ((status = 'deleted') = (deleted_at is not null)),
  check (status not in ('approved', 'rejected') or moderated_at is not null)
);
create index if not exists entity_screenshots_entity_idx on public.entity_screenshots (entity_type, entity_id, moderated_at desc) where status = 'approved';
create index if not exists entity_screenshots_user_idx on public.entity_screenshots (user_id, created_at desc);
create index if not exists entity_screenshots_pending_idx on public.entity_screenshots (created_at) where status = 'pending';
alter table public.entity_screenshots enable row level security;
revoke all on public.entity_screenshots from public, anon, authenticated, service_role;

-- The nightly backup reads every ordinary table through its own role (20261110180000_backup_exporter_role.sql).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'backup_exporter') then
    grant select on public.entity_screenshots to backup_exporter;
    drop policy if exists backup_exporter_select on public.entity_screenshots;
    create policy backup_exporter_select on public.entity_screenshots for select to backup_exporter using (true);
  end if;
end $$;

-- 1. A deleted screenshot stays deleted, and every screenshot keeps its page, uploader, time and size.
create or replace function public.entity_screenshot_stays_deleted()
returns trigger
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if old.status = 'deleted' then
    raise exception 'A deleted screenshot stays deleted';
  end if;
  if (new.id, new.entity_type, new.entity_id, new.user_id, new.created_at, new.width, new.height, new.bytes)
    is distinct from (old.id, old.entity_type, old.entity_id, old.user_id, old.created_at, old.width, old.height, old.bytes) then
    raise exception 'A screenshot keeps its page, uploader, time and size';
  end if;
  return new;
end;
$$;
revoke all on function public.entity_screenshot_stays_deleted() from public, anon, authenticated, service_role;
drop trigger if exists entity_screenshots_stay_deleted on public.entity_screenshots;
create trigger entity_screenshots_stay_deleted
  before update on public.entity_screenshots
  for each row execute function public.entity_screenshot_stays_deleted();

-- 2. Record an upload the server has re-encoded, before it writes the file. Returns {screenshot_ref, refusal}. Refusals
-- (nothing written): needs_handle, too_many_pending (10 waiting for review), daily_limit (5 a day), site_limit (300 a
-- day across the site). Input outside the server's caps raises 'Invalid screenshot'.
create or replace function public.submit_entity_screenshot(p_user_id uuid, p_entity_type text, p_entity_id integer,
  p_width integer, p_height integer, p_bytes integer)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or p_entity_type is null or p_entity_type not in ('item', 'quest', 'npc', 'spell', 'zone', 'instance')
    or p_entity_id is null or p_entity_id < 1 or p_width is null or p_width not between 1 and 1920
    or p_height is null or p_height not between 1 and 1920 or p_bytes is null or p_bytes not between 1 and 2000000 then
    raise exception 'Invalid screenshot';
  end if;
  -- The account's row is locked so two uploads cannot both pass the counts.
  perform 1 from public.users where id = p_user_id for update;
  if not found then raise exception 'Unknown user'; end if;
  if not exists (select 1 from public.user_profiles p where p.user_id = p_user_id and p.handle is not null) then
    return jsonb_build_object('screenshot_ref', null, 'refusal', 'needs_handle');
  end if;
  if (select count(*) from public.entity_screenshots s where s.user_id = p_user_id and s.status = 'pending') >= 10 then
    return jsonb_build_object('screenshot_ref', null, 'refusal', 'too_many_pending');
  end if;
  -- The account's count first, so an account over its own limit cannot spend the site's.
  if not public.take_comment_count('screenshot_uploads:' || p_user_id::text, 5) then
    return jsonb_build_object('screenshot_ref', null, 'refusal', 'daily_limit');
  end if;
  if not public.take_comment_count('screenshot_uploads:site', 300) then
    return jsonb_build_object('screenshot_ref', null, 'refusal', 'site_limit');
  end if;
  insert into public.entity_screenshots (entity_type, entity_id, user_id, width, height, bytes)
    values (p_entity_type, p_entity_id, p_user_id, p_width, p_height, p_bytes)
    returning id into v_id;
  return jsonb_build_object('screenshot_ref', v_id, 'refusal', null);
end;
$$;
revoke all on function public.submit_entity_screenshot(uuid, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.submit_entity_screenshot(uuid, text, integer, integer, integer, integer) to service_role;

-- 3. Why an upload would be refused now, without counting anything: the server asks before it spends a re-encode on
-- the file. Null when submit_entity_screenshot would take it; else one of its refusals.
create or replace function public.screenshot_upload_refusal(p_user_id uuid)
returns text
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select case
    when not exists (select 1 from public.user_profiles p where p.user_id = p_user_id and p.handle is not null) then 'needs_handle'
    when (select count(*) from public.entity_screenshots s where s.user_id = p_user_id and s.status = 'pending') >= 10 then 'too_many_pending'
    when exists (select 1 from public.intake_quota_buckets b where b.bucket = 'screenshot_uploads:' || p_user_id::text
      and b.count >= 5 and b.reset_at > clock_timestamp()) then 'daily_limit'
    when exists (select 1 from public.intake_quota_buckets b where b.bucket = 'screenshot_uploads:site'
      and b.count >= 300 and b.reset_at > clock_timestamp()) then 'site_limit'
  end;
$$;
revoke all on function public.screenshot_upload_refusal(uuid) from public, anon, authenticated;
grant execute on function public.screenshot_upload_refusal(uuid) to service_role;

-- 4. Delete the uploader's own screenshot, whatever its status. Returns {screenshot_ref, was, refusal}: `was` is the
-- status it had, so the server knows which file to remove. Refusal: not_found (none of theirs, or already deleted).
create or replace function public.delete_entity_screenshot(p_user_id uuid, p_screenshot_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_was text;
begin
  if p_user_id is null or p_screenshot_id is null then raise exception 'Invalid screenshot'; end if;
  select s.status into v_was from public.entity_screenshots s
    where s.id = p_screenshot_id and s.user_id = p_user_id and s.status <> 'deleted' for update;
  if not found then return jsonb_build_object('screenshot_ref', null, 'was', null, 'refusal', 'not_found'); end if;
  update public.entity_screenshots set status = 'deleted', deleted_at = now() where id = p_screenshot_id;
  return jsonb_build_object('screenshot_ref', p_screenshot_id, 'was', v_was, 'refusal', null);
end;
$$;
revoke all on function public.delete_entity_screenshot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_entity_screenshot(uuid, uuid) to service_role;

-- 5. A moderator's action: approve (pending to approved) or reject (pending or approved to rejected). Returns
-- {screenshot_ref, status, refusal}. Refusals: not_moderator, not_found, wrong_status. Another action raises
-- 'Invalid moderation'.
create or replace function public.moderate_entity_screenshot(p_moderator_id uuid, p_screenshot_id uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_status text;
  v_next text;
begin
  if p_moderator_id is null or p_screenshot_id is null or p_action is null or p_action not in ('approve', 'reject') then
    raise exception 'Invalid moderation';
  end if;
  if not public.is_comment_moderator(p_moderator_id) then
    return jsonb_build_object('screenshot_ref', null, 'status', null, 'refusal', 'not_moderator');
  end if;
  select s.status into v_status from public.entity_screenshots s where s.id = p_screenshot_id for update;
  if not found then return jsonb_build_object('screenshot_ref', null, 'status', null, 'refusal', 'not_found'); end if;
  v_next := case
    when p_action = 'approve' and v_status = 'pending' then 'approved'
    when p_action = 'reject' and v_status in ('pending', 'approved') then 'rejected'
  end;
  if v_next is null then return jsonb_build_object('screenshot_ref', null, 'status', v_status, 'refusal', 'wrong_status'); end if;
  update public.entity_screenshots set status = v_next, moderated_at = now(), moderated_by = p_moderator_id where id = p_screenshot_id;
  return jsonb_build_object('screenshot_ref', p_screenshot_id, 'status', v_next, 'refusal', null);
end;
$$;
revoke all on function public.moderate_entity_screenshot(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.moderate_entity_screenshot(uuid, uuid, text) to service_role;

-- 6. One page's gallery: approved screenshots only, newest approval first, at most 60, with the uploader's handle. It
-- takes no viewer and returns no account, so the answer is the same for everyone and can be cached.
create or replace function public.entity_screenshots_for(p_entity_type text, p_entity_id integer)
returns table (id uuid, author text, width integer, height integer, approved_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select s.id, p.handle, s.width, s.height, s.moderated_at
  from public.entity_screenshots s
  left join public.user_profiles p on p.user_id = s.user_id
  where s.entity_type = p_entity_type and s.entity_id = p_entity_id and s.status = 'approved'
  order by s.moderated_at desc, s.id
  limit 60;
$$;
revoke all on function public.entity_screenshots_for(text, integer) from public, anon, authenticated;
grant execute on function public.entity_screenshots_for(text, integer) to service_role;

-- 7. The uploader's own screenshots on one page, any status but deleted, newest first.
create or replace function public.my_entity_screenshots(p_user_id uuid, p_entity_type text, p_entity_id integer)
returns table (id uuid, status text, width integer, height integer, created_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select s.id, s.status, s.width, s.height, s.created_at
  from public.entity_screenshots s
  where p_user_id is not null and s.user_id = p_user_id and s.entity_type = p_entity_type and s.entity_id = p_entity_id
    and s.status <> 'deleted'
  order by s.created_at desc, s.id
  limit 50;
$$;
revoke all on function public.my_entity_screenshots(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.my_entity_screenshots(uuid, text, integer) to service_role;

-- 8. Which file the site may serve for a screenshot: 'public' (approved, to anyone, from screenshots/public/), 'review'
-- (pending, to its uploader or a moderator only, from screenshots/pending/), or null (nothing to anyone).
create or replace function public.entity_screenshot_access(p_screenshot_id uuid, p_viewer uuid)
returns text
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select case
    when s.status = 'approved' then 'public'
    when s.status = 'pending' and p_viewer is not null and (s.user_id = p_viewer or public.is_comment_moderator(p_viewer)) then 'review'
  end
  from public.entity_screenshots s
  where s.id = p_screenshot_id;
$$;
revoke all on function public.entity_screenshot_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.entity_screenshot_access(uuid, uuid) to service_role;

-- 9. The moderators' queue: screenshots waiting for review, oldest first, then the ones approved in the last 30 days
-- (to take down). Raises 'Not a moderator' for anyone else.
create or replace function public.screenshot_moderation_queue(p_moderator_id uuid)
returns table (id uuid, entity_type text, entity_id integer, author text, status text, width integer, height integer,
  bytes integer, created_at timestamptz, moderated_at timestamptz)
language plpgsql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if not public.is_comment_moderator(p_moderator_id) then raise exception 'Not a moderator'; end if;
  return query
    select s.id, s.entity_type, s.entity_id, p.handle, s.status, s.width, s.height, s.bytes, s.created_at, s.moderated_at
    from public.entity_screenshots s
    left join public.user_profiles p on p.user_id = s.user_id
    where s.status = 'pending' or (s.status = 'approved' and s.moderated_at >= now() - interval '30 days')
    order by (s.status = 'pending') desc,
      case when s.status = 'pending' then s.created_at end asc,
      s.moderated_at desc
    limit 200;
end;
$$;
revoke all on function public.screenshot_moderation_queue(uuid) from public, anon, authenticated;
grant execute on function public.screenshot_moderation_queue(uuid) to service_role;
notify pgrst, 'reload schema';

-- Moderators are the rows of comment_moderators (docs/2026-11-25-comments-activation.md).
-- Rollback (run by hand; this deletes every screenshot row; the files stay in the bucket until removed there):
--   drop function if exists public.screenshot_moderation_queue(uuid);
--   drop function if exists public.entity_screenshot_access(uuid, uuid);
--   drop function if exists public.my_entity_screenshots(uuid, text, integer);
--   drop function if exists public.entity_screenshots_for(text, integer);
--   drop function if exists public.moderate_entity_screenshot(uuid, uuid, text);
--   drop function if exists public.delete_entity_screenshot(uuid, uuid);
--   drop function if exists public.screenshot_upload_refusal(uuid);
--   drop function if exists public.submit_entity_screenshot(uuid, text, integer, integer, integer, integer);
--   drop table if exists public.entity_screenshots;
--   drop function if exists public.entity_screenshot_stays_deleted();
--   delete from public.intake_quota_buckets where bucket like 'screenshot\_uploads:%';
--   notify pgrst, 'reload schema';
