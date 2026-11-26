-- Disposable database, all migrations applied, roles anon/authenticated/service_role present. Rolled back at the end.
-- Comments on entity pages (20261125130000_entity_comments.sql): signed-in accounts with a handle post, edit for 15
-- minutes and delete their own; anyone signed in reports; a moderator (any row of comment_moderators) hides, restores
-- or dismisses. Every write goes through the functions, which hold the owner, the status and the daily limits.
begin;

-- Invented accounts: two writers with handles, one without, two moderators.
insert into public.users(id,name,email) values
  ('20000000-0000-4000-8000-000000000001','Ada','ada@users.everloot.invalid'),
  ('20000000-0000-4000-8000-000000000002','Bo','bo@users.everloot.invalid'),
  ('20000000-0000-4000-8000-000000000003','Cy','cy@users.everloot.invalid'),
  ('20000000-0000-4000-8000-000000000004','Mo','mo@users.everloot.invalid'),
  ('20000000-0000-4000-8000-000000000005','Mi','mi@users.everloot.invalid');
insert into public.user_profiles(user_id,handle) values
  ('20000000-0000-4000-8000-000000000001','ada-writes'),
  ('20000000-0000-4000-8000-000000000002','bo-reads');
-- More than one moderator: the table takes any number of rows.
insert into public.comment_moderators(user_id,note) values
  ('20000000-0000-4000-8000-000000000004','first moderator'),
  ('20000000-0000-4000-8000-000000000005','second moderator');

do $$
declare
  ada constant uuid := '20000000-0000-4000-8000-000000000001';
  bo constant uuid := '20000000-0000-4000-8000-000000000002';
  cy constant uuid := '20000000-0000-4000-8000-000000000003';
  mo constant uuid := '20000000-0000-4000-8000-000000000004';
  mi constant uuid := '20000000-0000-4000-8000-000000000005';
  r jsonb;
  c1 uuid;
  c2 uuid;
  f text;
  t text;
  n integer;
  row record;
begin
  -- Locked down: row security on, nothing for the browser roles, the server only through the functions.
  foreach t in array array['entity_comments','entity_comment_reports','comment_moderators'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'rls off on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete')
      or has_table_privilege('authenticated', 'public.' || t, 'select,insert,update,delete')
      or has_table_privilege('service_role', 'public.' || t, 'insert,update,delete') then
      raise exception 'table % is open', t;
    end if;
  end loop;
  foreach f in array array['public.post_entity_comment(uuid,text,integer,text)', 'public.edit_entity_comment(uuid,uuid,text)',
      'public.delete_entity_comment(uuid,uuid)', 'public.report_entity_comment(uuid,uuid,text,text)',
      'public.moderate_entity_comment(uuid,uuid,text)', 'public.entity_comments_for(text,integer,uuid)',
      'public.comment_moderation_queue(uuid)', 'public.is_comment_moderator(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise exception '% is public', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'server cannot call %', f; end if;
    if not (select prosecdef and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid = f::regprocedure) then
      raise exception 'unsafe %', f;
    end if;
  end loop;
  if has_function_privilege('service_role', 'public.take_comment_count(text,integer)', 'execute') then raise exception 'counter is callable'; end if;

  -- Posting needs a handle; the name shown is the handle, never the account name.
  r := public.post_entity_comment(cy, 'item', 19019, 'No handle yet');
  if r ->> 'refusal' is distinct from 'needs_handle' or r ->> 'comment_ref' is not null then raise exception 'no handle %', r; end if;
  r := public.post_entity_comment(ada, 'item', 19019, E'Drops from **Ragnaros**.\nCheck ||the last boss||.');
  if r ->> 'refusal' is not null then raise exception 'post %', r; end if;
  c1 := (r ->> 'comment_ref')::uuid;
  r := public.post_entity_comment(bo, 'item', 19019, 'Second comment');
  c2 := (r ->> 'comment_ref')::uuid;
  select * into row from public.entity_comments_for('item', 19019, null) where id = c1;
  if row.author <> 'ada-writes' or row.status <> 'visible' or row.body not like 'Drops from%' or row.mine then raise exception 'read %', row; end if;
  if (select count(*) from public.entity_comments_for('item', 19019, null)) <> 2 then raise exception 'two comments'; end if;
  if exists (select 1 from public.entity_comments_for('item', 19020, null)) then raise exception 'other entity leaks'; end if;
  if exists (select 1 from public.entity_comments_for('quest', 19019, null)) then raise exception 'other type leaks'; end if;
  if not (select mine and editable from public.entity_comments_for('item', 19019, ada) where id = c1) then raise exception 'own comment not mine'; end if;
  if (select mine from public.entity_comments_for('item', 19019, bo) where id = c1) then raise exception 'other is mine'; end if;

  -- Malformed input raises; the server validates first.
  foreach t in array array['', '   ', repeat('x', 2001), E'bell\x07', 'ok'] loop
    begin
      if t = 'ok' then perform public.post_entity_comment(ada, 'guild', 1, t);
      else perform public.post_entity_comment(ada, 'item', 1, t); end if;
      raise exception 'accepted %', t;
    exception when others then
      if sqlerrm <> 'Invalid comment' then raise; end if;
    end;
  end loop;
  begin
    perform public.post_entity_comment(ada, 'item', 0, 'zero id');
    raise exception 'accepted id 0';
  exception when others then if sqlerrm <> 'Invalid comment' then raise; end if;
  end;

  -- Edit: the author's, visible, within 15 minutes; anyone else's is not_found.
  r := public.edit_entity_comment(bo, c1, 'hijack');
  if r ->> 'refusal' <> 'not_found' then raise exception 'edit other %', r; end if;
  r := public.edit_entity_comment(ada, c1, 'Drops from Ragnaros, edited.');
  if r ->> 'refusal' is not null then raise exception 'edit %', r; end if;
  if (select edited_at is null or body <> 'Drops from Ragnaros, edited.' from public.entity_comments where id = c1) then raise exception 'edit not saved'; end if;
  -- Sixteen minutes pass (the trigger keeps a comment's time, so it steps aside for the fixture).
  alter table public.entity_comments disable trigger entity_comments_stay_deleted;
  update public.entity_comments set created_at = now() - interval '16 minutes' where id = c1;
  alter table public.entity_comments enable trigger entity_comments_stay_deleted;
  begin
    update public.entity_comments set created_at = now() where id = c1;
    raise exception 'time moved';
  exception when others then if sqlerrm <> 'A comment keeps its page, author and time' then raise; end if;
  end;
  r := public.edit_entity_comment(ada, c1, 'too late');
  if r ->> 'refusal' <> 'not_editable' then raise exception 'late edit %', r; end if;
  if (select editable from public.entity_comments_for('item', 19019, ada) where id = c1) then raise exception 'late comment editable'; end if;

  -- Report: not one's own, once per account, reason from the list.
  r := public.report_entity_comment(ada, c1, 'spam', '');
  if r ->> 'refusal' <> 'own_comment' then raise exception 'self report %', r; end if;
  begin
    perform public.report_entity_comment(bo, c1, 'because', '');
    raise exception 'accepted reason';
  exception when others then if sqlerrm <> 'Invalid report' then raise; end if;
  end;
  r := public.report_entity_comment(bo, c1, 'spoiler', 'names the last boss');
  if r ->> 'refusal' is not null then raise exception 'report %', r; end if;
  r := public.report_entity_comment(bo, c1, 'spam', '');
  if r ->> 'refusal' <> 'already_reported' then raise exception 'second report %', r; end if;
  if not (select reported from public.entity_comments_for('item', 19019, bo) where id = c1) then raise exception 'reported flag'; end if;
  r := public.report_entity_comment(cy, c1, 'abuse', '');

  -- Moderation: only a moderator; the queue names reasons and notes, never who reported.
  if public.is_comment_moderator(ada) or not public.is_comment_moderator(mo) or not public.is_comment_moderator(mi) then raise exception 'moderator check'; end if;
  r := public.moderate_entity_comment(ada, c1, 'hide');
  if r ->> 'refusal' <> 'not_moderator' then raise exception 'non-moderator hid %', r; end if;
  begin
    perform public.comment_moderation_queue(ada);
    raise exception 'queue for a non-moderator';
  exception when others then if sqlerrm <> 'Not a moderator' then raise; end if;
  end;
  select * into row from public.comment_moderation_queue(mo) where id = c1;
  if row.open_reports <> 2 or not (row.reasons @> array['spoiler','abuse']) or row.author <> 'ada-writes'
    or not ('names the last boss' = any(row.notes)) then raise exception 'queue row %', row; end if;
  if exists (select 1 from information_schema.routines rt join information_schema.parameters p on p.specific_name = rt.specific_name
      where rt.routine_name = 'comment_moderation_queue' and p.parameter_mode = 'OUT' and p.parameter_name in ('reporter', 'user_id', 'reported_by')) then
    raise exception 'queue names reporters';
  end if;
  r := public.moderate_entity_comment(mi, c1, 'hide');
  if r ->> 'refusal' is not null or r ->> 'status' <> 'hidden' then raise exception 'hide %', r; end if;
  -- Hidden: a tombstone with no words and no name, for everyone, the author too.
  select * into row from public.entity_comments_for('item', 19019, ada) where id = c1;
  if row.status <> 'hidden' or row.body <> '' or row.author is not null or row.editable then raise exception 'hidden row %', row; end if;
  if exists (select 1 from public.comment_moderation_queue(mo) where id = c1 and open_reports > 0) then raise exception 'reports not resolved'; end if;
  r := public.report_entity_comment(cy, c1, 'spam', '');
  if r ->> 'refusal' <> 'not_found' then raise exception 'report hidden %', r; end if;
  r := public.moderate_entity_comment(mo, c1, 'restore');
  if r ->> 'status' <> 'visible' then raise exception 'restore %', r; end if;
  r := public.moderate_entity_comment(mo, c1, 'restore');
  if r ->> 'refusal' <> 'wrong_status' then raise exception 'double restore %', r; end if;
  begin
    perform public.moderate_entity_comment(mo, c1, 'purge');
    raise exception 'accepted action';
  exception when others then if sqlerrm <> 'Invalid moderation' then raise; end if;
  end;
  -- Dismiss: reports closed, the comment stays.
  perform public.report_entity_comment(cy, c2, 'off_topic', '');
  r := public.moderate_entity_comment(mo, c2, 'dismiss');
  if r ->> 'status' <> 'visible' or exists (select 1 from public.entity_comment_reports where comment_id = c2 and resolved_at is null) then raise exception 'dismiss %', r; end if;

  -- Delete: the author's own, words wiped, a tombstone kept; nobody else's.
  r := public.delete_entity_comment(ada, c2);
  if r ->> 'refusal' <> 'not_found' then raise exception 'delete other %', r; end if;
  r := public.delete_entity_comment(bo, c2);
  if r ->> 'refusal' is not null then raise exception 'delete %', r; end if;
  if (select body <> '' or status <> 'deleted' or deleted_at is null from public.entity_comments where id = c2) then raise exception 'not wiped'; end if;
  if (select body from public.entity_comments_for('item', 19019, null) where id = c2) <> '' then raise exception 'tombstone has words'; end if;
  r := public.moderate_entity_comment(mo, c2, 'restore');
  if r ->> 'refusal' <> 'wrong_status' then raise exception 'restored a deleted comment %', r; end if;
  begin
    update public.entity_comments set body = 'back', status = 'visible', deleted_at = null where id = c2;
    raise exception 'deleted comment came back';
  exception when others then if sqlerrm <> 'A deleted comment stays deleted' then raise; end if;
  end;

  -- Daily limits: 20 posts, then daily_limit with nothing written.
  delete from public.intake_quota_buckets where bucket like 'comment\_%';
  for n in 1..20 loop
    r := public.post_entity_comment(bo, 'quest', 100, 'post ' || n);
    if r ->> 'refusal' is not null then raise exception 'post % refused %', n, r; end if;
  end loop;
  r := public.post_entity_comment(bo, 'quest', 100, 'one too many');
  if r ->> 'refusal' <> 'daily_limit' then raise exception 'post limit %', r; end if;
  if (select count(*) from public.entity_comments where entity_type = 'quest' and entity_id = 100) <> 20 then raise exception 'over the limit'; end if;
  -- 30 reports a day.
  for n in 1..30 loop
    insert into public.entity_comments(entity_type, entity_id, user_id, body) values ('npc', 7, ada, 'r' || n) returning id into c1;
    r := public.report_entity_comment(bo, c1, 'spam', '');
    if r ->> 'refusal' is not null then raise exception 'report % refused %', n, r; end if;
  end loop;
  insert into public.entity_comments(entity_type, entity_id, user_id, body) values ('npc', 7, ada, 'last') returning id into c1;
  r := public.report_entity_comment(bo, c1, 'spam', '');
  if r ->> 'refusal' <> 'daily_limit' then raise exception 'report limit %', r; end if;

  -- An account's deletion takes its comments and reports with it.
  delete from public.users where id = bo;
  if exists (select 1 from public.entity_comments where user_id = bo) or exists (select 1 from public.entity_comment_reports where user_id = bo) then
    raise exception 'account deletion left rows';
  end if;
end $$;

rollback;
