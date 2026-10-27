-- Community guides, private until review: a signed-in player's own guide drafts, each revision they submit kept exactly
-- as it was sent, and who may review them. Additive: three new tables and six functions. Needs
-- 20261021170000_account_profiles.sql first (a guide names its author by profile handle). Apply before setting
-- EVERLOOT_GUIDE_SUBMISSIONS=1; until then the site never calls anything here. Safe to apply twice.
--
-- Nothing here is public. Each table has row security on and grants nothing to the browser roles: the server reads with
-- the service role, always for the signed-in account, and writes only through the functions below, which hold the owner
-- and the limits: 20 guides an account, 100 revisions a guide, 300 draft saves and 10 submissions a day.
--
-- A revision is a draft while its owner edits it. Submitting freezes it: from then on its words never change, it never
-- goes back to draft and it is deleted only with its guide or its account; only its status moves. Its status is its
-- place in review (draft, submitted, changes_requested, approved, published, withdrawn, rejected, removed, archived).
-- How current a published guide still is, readers work out from the data, as for the guides in kb/guides, so it is not
-- a status. This file reaches draft, submitted and withdrawn; the rest are for review and publication, which come later
-- and publish nothing from here on their own.
--
-- Only what the owner typed is stored, and at submission the handle the guide names its author by, as the owner saw it
-- before sending. Never the BattleTag, the Battle.net id or the email, and submitting changes nothing on the profile.

do $$
begin
  if to_regclass('public.user_profiles') is null then
    raise exception 'Apply 20261021170000_account_profiles.sql first';
  end if;
end $$;

-- One community guide and its owner. Its words are in its revisions.
create table if not exists public.guide_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists guide_submissions_user_idx on public.guide_submissions (user_id);
alter table public.guide_submissions enable row level security;
revoke all on public.guide_submissions from public, anon, authenticated, service_role;
grant select on public.guide_submissions to service_role;

-- Each revision of a guide: the fields of the guides' contract (docs/GUIDES.md) as the owner typed them, the text, and
-- where the revision is in review. A revision belongs to its guide's owner (the two-column key).
create table if not exists public.guide_submission_revisions (
  guide_id uuid not null,
  revision integer not null check (revision between 1 and 100),
  user_id uuid not null,
  status text not null default 'draft' check (status in
    ('draft', 'submitted', 'changes_requested', 'approved', 'published', 'withdrawn', 'rejected', 'removed', 'archived')),
  title text not null check (char_length(title) between 1 and 90),
  summary text not null default '' check (char_length(summary) <= 300),
  class_slug text check (class_slug is null
    or class_slug in ('warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid')),
  activity text check (activity is null or activity in ('leveling', 'dungeons', 'raids')),
  roles text[] not null default '{}' check (roles <@ array['tank', 'healer', 'damage'] and cardinality(roles) <= 3),
  level_from integer check (level_from between 1 and 100),
  level_to integer check (level_to between 1 and 100),
  code text check (code is null or (char_length(code) <= 400 and code ~ '^EL1-[a-z]+-[0-9]+-[0-9.]+-[A-Za-z0-9_-]+$')),
  point_order text check (point_order is null or (code is not null and point_order ~ '^O1[pg]-[A-Za-z0-9_-]{1,64}$')),
  code2 text check (code2 is null or (char_length(code2) <= 400 and code2 ~ '^EL1-[a-z]+-[0-9]+-[0-9.]+-[A-Za-z0-9_-]+$')),
  point_order2 text check (point_order2 is null or (code2 is not null and point_order2 ~ '^O1[pg]-[A-Za-z0-9_-]{1,64}$')),
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 20),
  body text not null default '' check (char_length(body) <= 20000),
  author_handle text check (author_handle is null or author_handle ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  withdrawn_at timestamptz,
  primary key (guide_id, revision),
  foreign key (guide_id, user_id) references public.guide_submissions (id, user_id) on delete cascade,
  check ((level_from is null) = (level_to is null)),
  -- A revision that left draft was submitted, under the handle its owner saw.
  check (status = 'draft' or (author_handle is not null and submitted_at is not null)),
  check (status <> 'withdrawn' or withdrawn_at is not null)
);
-- One draft a guide, and one revision waiting for review.
create unique index if not exists guide_submission_revisions_one_draft on public.guide_submission_revisions (guide_id) where status = 'draft';
create unique index if not exists guide_submission_revisions_one_waiting on public.guide_submission_revisions (guide_id) where status = 'submitted';
create index if not exists guide_submission_revisions_user_idx on public.guide_submission_revisions (user_id, updated_at desc);
alter table public.guide_submission_revisions enable row level security;
revoke all on public.guide_submission_revisions from public, anon, authenticated, service_role;
grant select on public.guide_submission_revisions to service_role;

-- Who may review community guides, for the review that comes later to read; nothing here or in a request names one.
-- Carlos alone until he names others: the operator adds his account by hand (below), and the table holds one account
-- until a later file lifts that. Empty, nobody can review anything.
create table if not exists public.guide_moderators (
  user_id uuid primary key references public.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text check (note is null or char_length(note) between 1 and 200)
);
create unique index if not exists guide_moderators_one on public.guide_moderators ((true));
alter table public.guide_moderators enable row level security;
revoke all on public.guide_moderators from public, anon, authenticated, service_role;
grant select on public.guide_moderators to service_role;

-- 1. A submitted revision is kept as it was sent. Once it leaves draft only its status (and when it last changed or was
-- withdrawn) may move, and never back to draft; a draft keeps its guide, number and owner. It is deleted only through its
-- guide's or its account's deletion, which reaches it from another table's cascade, a trigger deep.
create or replace function public.guide_revision_is_kept()
returns trigger
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and pg_trigger_depth() < 2 then
      raise exception 'A submitted guide revision is kept as it was sent';
    end if;
    return old;
  end if;
  if (new.guide_id, new.revision, new.user_id) is distinct from (old.guide_id, old.revision, old.user_id)
    or (old.status <> 'draft' and (new.status = 'draft'
      or to_jsonb(new) - array['status', 'updated_at', 'withdrawn_at'] is distinct from to_jsonb(old) - array['status', 'updated_at', 'withdrawn_at'])) then
    raise exception 'A submitted guide revision is kept as it was sent';
  end if;
  return new;
end;
$$;
revoke all on function public.guide_revision_is_kept() from public, anon, authenticated, service_role;
drop trigger if exists guide_submission_revisions_kept on public.guide_submission_revisions;
create trigger guide_submission_revisions_kept
  before update or delete on public.guide_submission_revisions
  for each row execute function public.guide_revision_is_kept();

-- 2. One count against an account's day: 'guide_saves:<id>' for draft saves, 'guide_submits:<id>' for submissions.
-- Called only by the functions below; nobody else may execute it.
create or replace function public.take_guide_count(p_bucket text, p_limit integer)
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
revoke all on function public.take_guide_count(text, integer) from public, anon, authenticated, service_role;

-- 3. A draft as the server checked it (GuideDraft in web/src/lib/guide-submissions.ts), as a revision's fields: exactly
-- title, summary, classSlug, activity, roles, levels {from, to}, code, order, code2, order2, sources [{title, url,
-- checkedOn}] and body, each of its type and within its limits. Any other shape raises, an owner, status, review or
-- moderator field included: the server sends none. Whether the guide would pass review is the server's guide check; a
-- draft may still be unfinished. Called only by the functions below.
create or replace function public.guide_draft_row(p_payload jsonb)
returns public.guide_submission_revisions
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  code_shape constant text := '^EL1-[a-z]+-[0-9]+-[0-9.]+-[A-Za-z0-9_-]+$';
  order_shape constant text := '^O1[pg]-[A-Za-z0-9_-]{1,64}$';
  v public.guide_submission_revisions;
  v_levels jsonb;
  v_source jsonb;
begin
  -- Each step reads only what the step before it has shown to be of its type: SQL does not promise to read an "or" from
  -- the left, so no key is read from a value that might not be an object and nothing is cast before it is shaped right.
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid guide'; end if;
  if not p_payload ?& array['title', 'summary', 'classSlug', 'activity', 'roles', 'levels', 'code', 'order', 'code2', 'order2', 'sources', 'body']
    or (select count(*) from jsonb_object_keys(p_payload)) <> 12
    or exists (select 1 from jsonb_each(p_payload) f where jsonb_typeof(f.value) <> all (case f.key
      when 'title' then array['string'] when 'summary' then array['string'] when 'body' then array['string']
      when 'roles' then array['array'] when 'sources' then array['array'] when 'levels' then array['object', 'null']
      else array['string', 'null'] end)) then
    raise exception 'Invalid guide';
  end if;
  v.title := p_payload ->> 'title';
  v.summary := p_payload ->> 'summary';
  v.class_slug := p_payload ->> 'classSlug';
  v.activity := p_payload ->> 'activity';
  v.code := p_payload ->> 'code';
  v.point_order := p_payload ->> 'order';
  v.code2 := p_payload ->> 'code2';
  v.point_order2 := p_payload ->> 'order2';
  v.body := p_payload ->> 'body';
  if btrim(v.title) = '' or char_length(v.title) > 90 or v.title ~ '[\x01-\x1f\x7f]'
    or char_length(v.summary) > 300 or v.summary ~ '[\x01-\x1f\x7f]'
    or char_length(v.body) > 20000 or v.body ~ '[\x01-\x09\x0b-\x1f\x7f]'
    or (v.class_slug is not null and v.class_slug not in ('warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'))
    or (v.activity is not null and v.activity not in ('leveling', 'dungeons', 'raids'))
    or (v.code is not null and (char_length(v.code) > 400 or v.code !~ code_shape))
    or (v.code2 is not null and (char_length(v.code2) > 400 or v.code2 !~ code_shape))
    or (v.point_order is not null and (v.code is null or v.point_order !~ order_shape))
    or (v.point_order2 is not null and (v.code2 is null or v.point_order2 !~ order_shape))
    or jsonb_array_length(p_payload -> 'roles') > 3 or jsonb_array_length(p_payload -> 'sources') > 20
    or exists (select 1 from jsonb_array_elements(p_payload -> 'roles') r where jsonb_typeof(r) <> 'string') then
    raise exception 'Invalid guide';
  end if;
  v.roles := array(select jsonb_array_elements_text(p_payload -> 'roles'));
  if not v.roles <@ array['tank', 'healer', 'damage'] or (select count(distinct r) from unnest(v.roles) r) <> cardinality(v.roles) then
    raise exception 'Invalid guide';
  end if;

  v_levels := p_payload -> 'levels';
  if jsonb_typeof(v_levels) = 'object' then
    if not v_levels ?& array['from', 'to'] or (select count(*) from jsonb_object_keys(v_levels)) <> 2
      or jsonb_typeof(v_levels -> 'from') <> 'number' or jsonb_typeof(v_levels -> 'to') <> 'number' then
      raise exception 'Invalid guide';
    end if;
    if (v_levels ->> 'from') !~ '^[0-9]{1,3}$' or (v_levels ->> 'to') !~ '^[0-9]{1,3}$' then raise exception 'Invalid guide'; end if;
    v.level_from := (v_levels ->> 'from')::integer;
    v.level_to := (v_levels ->> 'to')::integer;
    if v.level_from not between 1 and 100 or v.level_to not between 1 and 100 then raise exception 'Invalid guide'; end if;
  end if;

  -- Each source: a title, an https address with no user name or port, and a real day, nothing else.
  for v_source in select s from jsonb_array_elements(p_payload -> 'sources') s loop
    if jsonb_typeof(v_source) <> 'object' then raise exception 'Invalid guide'; end if;
    if not v_source ?& array['title', 'url', 'checkedOn'] or (select count(*) from jsonb_object_keys(v_source)) <> 3
      or jsonb_typeof(v_source -> 'title') <> 'string' or jsonb_typeof(v_source -> 'url') <> 'string' or jsonb_typeof(v_source -> 'checkedOn') <> 'string' then
      raise exception 'Invalid guide';
    end if;
    if btrim(v_source ->> 'title') = '' or char_length(v_source ->> 'title') > 200 or (v_source ->> 'title') ~ '[\x01-\x1f\x7f]'
      or char_length(v_source ->> 'url') > 500 or (v_source ->> 'url') !~ '^https://[^\s/?#@:\\]+(/[^\s]*)?$'
      or (v_source ->> 'checkedOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Invalid guide';
    end if;
    begin
      if to_char((v_source ->> 'checkedOn')::date, 'YYYY-MM-DD') <> v_source ->> 'checkedOn' then raise exception 'Invalid guide'; end if;
    exception when others then
      raise exception 'Invalid guide';
    end;
  end loop;
  v.sources := p_payload -> 'sources';
  return v;
end;
$$;
revoke all on function public.guide_draft_row(jsonb) from public, anon, authenticated, service_role;

-- 4. Save the owner's draft: a new guide (p_guide_id null) with its first draft, or the guide's draft, edited in place.
-- A guide with no draft (its last revision submitted or withdrawn) gets the next revision as its draft: what was
-- submitted stays as it was. Returns {guide_ref, revision, created, refusal}. Refusals (nothing written, nothing counted):
-- not_found (not a guide of the owner's), guide_limit (20), revision_limit (100), daily_limit (300 saves). Malformed input
-- raises: the server validates first.
create or replace function public.save_guide_draft(p_user_id uuid, p_guide_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_draft public.guide_submission_revisions := public.guide_draft_row(p_payload);
  v_guide uuid := p_guide_id;
  v_revision integer;
  v_editing boolean := false;
begin
  if p_user_id is null then raise exception 'Invalid guide'; end if;
  -- The account's row is locked so two saves cannot both pass the counts.
  perform 1 from public.users where id = p_user_id for update;
  if not found then raise exception 'Unknown user'; end if;

  if v_guide is null then
    if (select count(*) from public.guide_submissions g where g.user_id = p_user_id) >= 20 then
      return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'guide_limit');
    end if;
    v_revision := 1;
  else
    perform 1 from public.guide_submissions g where g.id = v_guide and g.user_id = p_user_id for update;
    if not found then return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'not_found'); end if;
    select r.revision into v_revision from public.guide_submission_revisions r where r.guide_id = v_guide and r.status = 'draft';
    v_editing := found;
    if not v_editing then
      select coalesce(max(r.revision), 0) + 1 into v_revision from public.guide_submission_revisions r where r.guide_id = v_guide;
      if v_revision > 100 then return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'revision_limit'); end if;
    end if;
  end if;
  if not public.take_guide_count('guide_saves:' || p_user_id::text, 300) then
    return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'daily_limit');
  end if;

  if v_guide is null then
    insert into public.guide_submissions (user_id) values (p_user_id) returning id into v_guide;
  else
    update public.guide_submissions set updated_at = now() where id = v_guide;
  end if;
  if v_editing then
    update public.guide_submission_revisions r set title = v_draft.title, summary = v_draft.summary, class_slug = v_draft.class_slug,
        activity = v_draft.activity, roles = v_draft.roles, level_from = v_draft.level_from, level_to = v_draft.level_to,
        code = v_draft.code, point_order = v_draft.point_order, code2 = v_draft.code2, point_order2 = v_draft.point_order2,
        sources = v_draft.sources, body = v_draft.body, updated_at = now()
      where r.guide_id = v_guide and r.revision = v_revision and r.status = 'draft';
  else
    insert into public.guide_submission_revisions (guide_id, revision, user_id, title, summary, class_slug, activity, roles,
        level_from, level_to, code, point_order, code2, point_order2, sources, body)
      values (v_guide, v_revision, p_user_id, v_draft.title, v_draft.summary, v_draft.class_slug, v_draft.activity, v_draft.roles,
        v_draft.level_from, v_draft.level_to, v_draft.code, v_draft.point_order, v_draft.code2, v_draft.point_order2, v_draft.sources, v_draft.body);
  end if;
  return jsonb_build_object('guide_ref', v_guide, 'revision', v_revision, 'created', p_guide_id is null, 'refusal', null);
end;
$$;
revoke all on function public.save_guide_draft(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_guide_draft(uuid, uuid, jsonb) to service_role;

-- 5. Submit the owner's guide for review: the payload, which the server has just checked as a guide it would publish, is
-- written as the guide's draft (or its next revision) and frozen in the same transaction, under the handle the owner saw
-- (p_alias), so what was checked is what is kept. The account's row is locked first, the lock a handle change takes too,
-- so the handle cannot change between the comparison and the write. Under the server's check, this holds the floor
-- itself: a summary, a class, an activity, a role, levels, a code of that class, any order planned (O1p) and every source
-- on Blizzard's own sites. Returns {guide_ref, revision, refusal}. Refusals (nothing written, nothing counted): not_found,
-- needs_handle, alias_changed, already_submitted (another revision waits for review), incomplete, revision_limit,
-- submit_limit (10 a day). Malformed input raises.
create or replace function public.submit_guide(p_user_id uuid, p_guide_id uuid, p_payload jsonb, p_alias text)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_draft public.guide_submission_revisions := public.guide_draft_row(p_payload);
  v_handle text;
  v_revision integer;
  v_editing boolean;
begin
  if p_user_id is null or p_guide_id is null or p_alias is null then raise exception 'Invalid guide'; end if;
  perform 1 from public.users where id = p_user_id for update;
  if not found then raise exception 'Unknown user'; end if;
  perform 1 from public.guide_submissions g where g.id = p_guide_id and g.user_id = p_user_id for update;
  if not found then return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'not_found'); end if;
  select p.handle into v_handle from public.user_profiles p where p.user_id = p_user_id;
  if v_handle is null then return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'needs_handle'); end if;
  if v_handle is distinct from p_alias then return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'alias_changed'); end if;
  if exists (select 1 from public.guide_submission_revisions r where r.guide_id = p_guide_id and r.status = 'submitted') then
    return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'already_submitted');
  end if;
  if v_draft.summary !~ '[^[:space:]]' or v_draft.body !~ '[^[:space:]]' or v_draft.class_slug is null or v_draft.activity is null
    or cardinality(v_draft.roles) = 0 or v_draft.level_from is null or v_draft.code is null
    or split_part(v_draft.code, '-', 2) <> v_draft.class_slug
    or (v_draft.code2 is not null and split_part(v_draft.code2, '-', 2) <> v_draft.class_slug)
    or coalesce(v_draft.point_order !~ '^O1p-', false) or coalesce(v_draft.point_order2 !~ '^O1p-', false)
    or exists (select 1 from jsonb_array_elements(v_draft.sources) s
      where (s ->> 'url') !~ '^https://(worldofwarcraft\.blizzard\.com|news\.blizzard\.com|(us|eu)\.forums\.blizzard\.com)(/|$)') then
    return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'incomplete');
  end if;
  select r.revision into v_revision from public.guide_submission_revisions r where r.guide_id = p_guide_id and r.status = 'draft';
  v_editing := found;
  if not v_editing then
    select coalesce(max(r.revision), 0) + 1 into v_revision from public.guide_submission_revisions r where r.guide_id = p_guide_id;
    if v_revision > 100 then return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'revision_limit'); end if;
  end if;
  if not public.take_guide_count('guide_submits:' || p_user_id::text, 10) then
    return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'submit_limit');
  end if;

  if v_editing then
    update public.guide_submission_revisions r set title = v_draft.title, summary = v_draft.summary, class_slug = v_draft.class_slug,
        activity = v_draft.activity, roles = v_draft.roles, level_from = v_draft.level_from, level_to = v_draft.level_to,
        code = v_draft.code, point_order = v_draft.point_order, code2 = v_draft.code2, point_order2 = v_draft.point_order2,
        sources = v_draft.sources, body = v_draft.body, status = 'submitted', author_handle = v_handle, submitted_at = now(), updated_at = now()
      where r.guide_id = p_guide_id and r.revision = v_revision and r.status = 'draft';
  else
    insert into public.guide_submission_revisions (guide_id, revision, user_id, status, title, summary, class_slug, activity, roles,
        level_from, level_to, code, point_order, code2, point_order2, sources, body, author_handle, submitted_at)
      values (p_guide_id, v_revision, p_user_id, 'submitted', v_draft.title, v_draft.summary, v_draft.class_slug, v_draft.activity,
        v_draft.roles, v_draft.level_from, v_draft.level_to, v_draft.code, v_draft.point_order, v_draft.code2, v_draft.point_order2,
        v_draft.sources, v_draft.body, v_handle, now());
  end if;
  update public.guide_submissions set updated_at = now() where id = p_guide_id;
  return jsonb_build_object('guide_ref', p_guide_id, 'revision', v_revision, 'refusal', null);
end;
$$;
revoke all on function public.submit_guide(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_guide(uuid, uuid, jsonb, text) to service_role;

-- 6. Withdraw the owner's revision from review: submitted becomes withdrawn, with its words as they were. Returns
-- {guide_ref, revision, refusal}. Refusals: not_found, not_submitted (that revision is not waiting for review).
create or replace function public.withdraw_guide(p_user_id uuid, p_guide_id uuid, p_revision integer)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if p_user_id is null or p_guide_id is null or p_revision is null then raise exception 'Invalid guide'; end if;
  perform 1 from public.guide_submissions g where g.id = p_guide_id and g.user_id = p_user_id for update;
  if not found then return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'not_found'); end if;
  update public.guide_submission_revisions r set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    where r.guide_id = p_guide_id and r.revision = p_revision and r.status = 'submitted';
  if not found then return jsonb_build_object('guide_ref', null, 'revision', null, 'refusal', 'not_submitted'); end if;
  update public.guide_submissions set updated_at = now() where id = p_guide_id;
  return jsonb_build_object('guide_ref', p_guide_id, 'revision', p_revision, 'refusal', null);
end;
$$;
revoke all on function public.withdraw_guide(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.withdraw_guide(uuid, uuid, integer) to service_role;
notify pgrst, 'reload schema';

-- One account's guides: select guide_id, revision, status, title, author_handle, updated_at
--   from public.guide_submission_revisions where user_id = '<id>' order by guide_id, revision;
-- Carlos as the one reviewer, once his account id is read from public.users:
--   insert into public.guide_moderators (user_id, note) values ('<his id>', 'Carlos, the owner');
-- Rollback (run by hand; this deletes every community guide draft and every submitted revision):
--   drop function if exists public.withdraw_guide(uuid, uuid, integer);
--   drop function if exists public.submit_guide(uuid, uuid, jsonb, text);
--   drop function if exists public.save_guide_draft(uuid, uuid, jsonb);
--   drop function if exists public.guide_draft_row(jsonb);
--   drop function if exists public.take_guide_count(text, integer);
--   drop table if exists public.guide_moderators;
--   drop table if exists public.guide_submission_revisions;
--   drop function if exists public.guide_revision_is_kept();
--   drop table if exists public.guide_submissions;
--   delete from public.intake_quota_buckets where bucket like 'guide\_saves:%' or bucket like 'guide\_submits:%';
--   notify pgrst, 'reload schema';
