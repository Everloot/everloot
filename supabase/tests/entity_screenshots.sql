-- Disposable database, all migrations applied, roles anon/authenticated/service_role present. Rolled back at the end.
-- Player screenshots on entity pages (20261125140000_entity_screenshots.sql): signed-in accounts with a handle upload;
-- nothing shows until a comment moderator approves it; the uploader deletes their own. Every write goes through the
-- functions, which hold the owner, the status and the limits.
begin;

-- Invented accounts: two uploaders with handles, one without, one moderator.
insert into public.users(id,name,email) values
  ('30000000-0000-4000-8000-000000000001','Ada','ada@users.everloot.invalid'),
  ('30000000-0000-4000-8000-000000000002','Bo','bo@users.everloot.invalid'),
  ('30000000-0000-4000-8000-000000000003','Cy','cy@users.everloot.invalid'),
  ('30000000-0000-4000-8000-000000000004','Mo','mo@users.everloot.invalid');
insert into public.user_profiles(user_id,handle) values
  ('30000000-0000-4000-8000-000000000001','ada-shoots'),
  ('30000000-0000-4000-8000-000000000002','bo-shoots');
insert into public.comment_moderators(user_id,note) values ('30000000-0000-4000-8000-000000000004','moderator');

do $$
declare
  ada constant uuid := '30000000-0000-4000-8000-000000000001';
  bo constant uuid := '30000000-0000-4000-8000-000000000002';
  cy constant uuid := '30000000-0000-4000-8000-000000000003';
  mo constant uuid := '30000000-0000-4000-8000-000000000004';
  r jsonb;
  s1 uuid;
  s2 uuid;
  f text;
  n integer;
  row record;
begin
  -- Locked down: row security on, nothing for the browser roles, the server only through the functions.
  if not (select relrowsecurity from pg_class where oid = 'public.entity_screenshots'::regclass) then raise exception 'rls off'; end if;
  if has_table_privilege('anon', 'public.entity_screenshots', 'select,insert,update,delete')
    or has_table_privilege('authenticated', 'public.entity_screenshots', 'select,insert,update,delete')
    or has_table_privilege('service_role', 'public.entity_screenshots', 'select,insert,update,delete') then
    raise exception 'table is open';
  end if;
  foreach f in array array['public.submit_entity_screenshot(uuid,text,integer,integer,integer,integer)',
      'public.delete_entity_screenshot(uuid,uuid)', 'public.moderate_entity_screenshot(uuid,uuid,text)',
      'public.entity_screenshots_for(text,integer)', 'public.my_entity_screenshots(uuid,text,integer)',
      'public.entity_screenshot_access(uuid,uuid)', 'public.screenshot_moderation_queue(uuid)', 'public.screenshot_upload_refusal(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise exception '% is public', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'server cannot call %', f; end if;
    if not (select prosecdef and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid = f::regprocedure) then
      raise exception 'unsafe %', f;
    end if;
  end loop;

  -- Uploading needs a handle.
  if public.screenshot_upload_refusal(cy) is distinct from 'needs_handle' or public.screenshot_upload_refusal(ada) is not null then raise exception 'peek'; end if;
  r := public.submit_entity_screenshot(cy, 'item', 19019, 1920, 1080, 250000);
  if r ->> 'refusal' is distinct from 'needs_handle' or r ->> 'screenshot_ref' is not null then raise exception 'no handle %', r; end if;
  -- Malformed input raises; the server validates first. Sizes past the caps the server re-encodes to are refused too.
  begin
    perform public.submit_entity_screenshot(ada, 'guild', 1, 100, 100, 1000);
    raise exception 'accepted type';
  exception when others then if sqlerrm <> 'Invalid screenshot' then raise; end if;
  end;
  begin
    perform public.submit_entity_screenshot(ada, 'item', 1, 1921, 100, 1000);
    raise exception 'accepted width';
  exception when others then if sqlerrm <> 'Invalid screenshot' then raise; end if;
  end;
  begin
    perform public.submit_entity_screenshot(ada, 'item', 1, 100, 100, 2000001);
    raise exception 'accepted bytes';
  exception when others then if sqlerrm <> 'Invalid screenshot' then raise; end if;
  end;

  -- Pending: nobody sees it on the page, the uploader sees it as theirs.
  r := public.submit_entity_screenshot(ada, 'item', 19019, 1920, 1080, 250000);
  if r ->> 'refusal' is not null then raise exception 'submit %', r; end if;
  s1 := (r ->> 'screenshot_ref')::uuid;
  if (select status from public.entity_screenshots where id = s1) <> 'pending' then raise exception 'not pending'; end if;
  if exists (select 1 from public.entity_screenshots_for('item', 19019)) then raise exception 'pending shows'; end if;
  if (select count(*) from public.my_entity_screenshots(ada, 'item', 19019) where id = s1 and status = 'pending') <> 1 then raise exception 'mine'; end if;
  if exists (select 1 from public.my_entity_screenshots(bo, 'item', 19019)) then raise exception 'other sees mine'; end if;
  -- The file: nobody publicly; the uploader and the moderators for review; anyone else nothing.
  if public.entity_screenshot_access(s1, null) is not null then raise exception 'pending public'; end if;
  if public.entity_screenshot_access(s1, ada) is distinct from 'review' then raise exception 'owner review'; end if;
  if public.entity_screenshot_access(s1, mo) is distinct from 'review' then raise exception 'moderator review'; end if;
  if public.entity_screenshot_access(s1, bo) is not null then raise exception 'stranger review'; end if;

  -- Moderation: only a moderator; approve shows it, with the uploader's handle.
  r := public.moderate_entity_screenshot(ada, s1, 'approve');
  if r ->> 'refusal' <> 'not_moderator' then raise exception 'self approve %', r; end if;
  begin
    perform public.screenshot_moderation_queue(ada);
    raise exception 'queue for a non-moderator';
  exception when others then if sqlerrm <> 'Not a moderator' then raise; end if;
  end;
  select * into row from public.screenshot_moderation_queue(mo) where id = s1;
  if row.status <> 'pending' or row.author <> 'ada-shoots' or row.entity_id <> 19019 then raise exception 'queue row %', row; end if;
  begin
    perform public.moderate_entity_screenshot(mo, s1, 'publish');
    raise exception 'accepted action';
  exception when others then if sqlerrm <> 'Invalid moderation' then raise; end if;
  end;
  r := public.moderate_entity_screenshot(mo, s1, 'approve');
  if r ->> 'refusal' is not null or r ->> 'status' <> 'approved' then raise exception 'approve %', r; end if;
  r := public.moderate_entity_screenshot(mo, s1, 'approve');
  if r ->> 'refusal' <> 'wrong_status' then raise exception 'double approve %', r; end if;
  select * into row from public.entity_screenshots_for('item', 19019);
  if row.id <> s1 or row.author <> 'ada-shoots' or row.width <> 1920 or row.height <> 1080 then raise exception 'gallery %', row; end if;
  if exists (select 1 from public.entity_screenshots_for('item', 19020)) or exists (select 1 from public.entity_screenshots_for('quest', 19019)) then
    raise exception 'other page leaks';
  end if;
  if public.entity_screenshot_access(s1, null) is distinct from 'public' then raise exception 'approved not public'; end if;
  -- The gallery reads no account: it has no viewer argument and returns no account id.
  if exists (select 1 from information_schema.routines rt join information_schema.parameters p on p.specific_name = rt.specific_name
      where rt.routine_name = 'entity_screenshots_for' and p.parameter_name in ('user_id', 'p_viewer', 'email')) then
    raise exception 'gallery reads accounts';
  end if;

  -- A moderator can take an approved one down again (reject), and it leaves the page.
  r := public.submit_entity_screenshot(bo, 'item', 19019, 800, 600, 90000);
  s2 := (r ->> 'screenshot_ref')::uuid;
  perform public.moderate_entity_screenshot(mo, s2, 'approve');
  r := public.moderate_entity_screenshot(mo, s2, 'reject');
  if r ->> 'status' <> 'rejected' then raise exception 'take down %', r; end if;
  if exists (select 1 from public.entity_screenshots_for('item', 19019) where id = s2) then raise exception 'rejected shows'; end if;
  if public.entity_screenshot_access(s2, bo) is not null or public.entity_screenshot_access(s2, null) is not null then raise exception 'rejected file'; end if;
  if (select status from public.my_entity_screenshots(bo, 'item', 19019) where id = s2) <> 'rejected' then raise exception 'owner sees rejection'; end if;
  r := public.moderate_entity_screenshot(mo, s2, 'approve');
  if r ->> 'refusal' <> 'wrong_status' then raise exception 'approved a rejected one %', r; end if;

  -- Delete: the uploader's own, any status but deleted; nobody else's; never back.
  r := public.delete_entity_screenshot(bo, s1);
  if r ->> 'refusal' <> 'not_found' then raise exception 'delete other %', r; end if;
  r := public.delete_entity_screenshot(ada, s1);
  if r ->> 'refusal' is not null or r ->> 'was' <> 'approved' then raise exception 'delete %', r; end if;
  if exists (select 1 from public.entity_screenshots_for('item', 19019)) or public.entity_screenshot_access(s1, null) is not null
    or public.entity_screenshot_access(s1, mo) is not null then raise exception 'deleted shows'; end if;
  if exists (select 1 from public.my_entity_screenshots(ada, 'item', 19019) where id = s1) then raise exception 'deleted listed'; end if;
  r := public.delete_entity_screenshot(ada, s1);
  if r ->> 'refusal' <> 'not_found' then raise exception 'double delete %', r; end if;
  r := public.moderate_entity_screenshot(mo, s1, 'approve');
  if r ->> 'refusal' <> 'wrong_status' then raise exception 'moderated a deleted one %', r; end if;
  begin
    update public.entity_screenshots set status = 'approved', deleted_at = null where id = s1;
    raise exception 'deleted screenshot came back';
  exception when others then if sqlerrm <> 'A deleted screenshot stays deleted' then raise; end if;
  end;
  begin
    update public.entity_screenshots set user_id = ada where id = s2;
    raise exception 'owner moved';
  exception when others then if sqlerrm <> 'A screenshot keeps its page, uploader, time and size' then raise; end if;
  end;

  -- Limits: 5 uploads an account a day, then daily_limit with nothing written.
  delete from public.intake_quota_buckets where bucket like 'screenshot\_%';
  for n in 1..5 loop
    r := public.submit_entity_screenshot(bo, 'npc', 100 + n, 640, 480, 50000);
    if r ->> 'refusal' is not null then raise exception 'upload % refused %', n, r; end if;
  end loop;
  r := public.submit_entity_screenshot(bo, 'npc', 200, 640, 480, 50000);
  if r ->> 'refusal' <> 'daily_limit' then raise exception 'daily limit %', r; end if;
  if public.screenshot_upload_refusal(bo) is distinct from 'daily_limit' then raise exception 'peek daily'; end if;
  if (select count(*) from public.entity_screenshots where user_id = bo and entity_type = 'npc') <> 5 then raise exception 'over the limit'; end if;
  -- At most 10 waiting for review an account, whatever the day.
  delete from public.intake_quota_buckets where bucket like 'screenshot\_%';
  for n in 1..5 loop perform public.submit_entity_screenshot(bo, 'npc', 300 + n, 640, 480, 50000); end loop;
  delete from public.intake_quota_buckets where bucket like 'screenshot\_%';
  r := public.submit_entity_screenshot(bo, 'npc', 400, 640, 480, 50000);
  if r ->> 'refusal' <> 'too_many_pending' then raise exception 'pending cap %', r; end if;
  if public.screenshot_upload_refusal(bo) is distinct from 'too_many_pending' then raise exception 'peek pending'; end if;
  -- And 300 a day across the site.
  delete from public.intake_quota_buckets where bucket like 'screenshot\_%';
  insert into public.intake_quota_buckets values ('screenshot_uploads:site', 300, now() + interval '1 day');
  r := public.submit_entity_screenshot(ada, 'npc', 500, 640, 480, 50000);
  if r ->> 'refusal' <> 'site_limit' then raise exception 'site limit %', r; end if;
  if public.screenshot_upload_refusal(ada) is distinct from 'site_limit' then raise exception 'peek site'; end if;
  -- Peeking counts nothing.
  if (select count from public.intake_quota_buckets where bucket = 'screenshot_uploads:site') <> 300 then raise exception 'peek counted'; end if;

  -- An account's deletion takes its rows with it (the files are then never served: access needs the row).
  delete from public.users where id = bo;
  if exists (select 1 from public.entity_screenshots where user_id = bo) then raise exception 'account deletion left rows'; end if;
  if public.entity_screenshot_access(s2, mo) is not null then raise exception 'orphan served'; end if;
end $$;

rollback;
