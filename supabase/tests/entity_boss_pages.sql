-- Disposable database, all migrations applied, roles anon/authenticated/service_role present. Rolled back at the end.
-- Boss pages take comments and screenshots (20261126100000_directory_login_boss_pages.sql): 'boss' joins the six page
-- types in both tables' checks and in post_entity_comment and submit_entity_screenshot; nothing else changes.
begin;

-- An invented account with a handle.
insert into public.users(id,name,email) values ('40000000-0000-4000-8000-000000000001','Ada','ada@users.everloot.invalid');
insert into public.user_profiles(user_id,handle) values ('40000000-0000-4000-8000-000000000001','ada-bosses');

do $$
declare
  ada constant uuid := '40000000-0000-4000-8000-000000000001';
  r jsonb;
  t text;
begin
  -- A boss page takes a comment and a screenshot through the server's functions.
  r := public.post_entity_comment(ada, 'boss', 1084, 'Watch the second phase.');
  if r ->> 'refusal' is not null or r ->> 'comment_ref' is null then raise exception 'boss comment refused %', r; end if;
  if (select count(*) from public.entity_comments_for('boss', 1084, null)) <> 1 then raise exception 'boss comment not read back'; end if;
  r := public.submit_entity_screenshot(ada, 'boss', 1084, 800, 600, 12000);
  if r ->> 'refusal' is not null or r ->> 'screenshot_ref' is null then raise exception 'boss screenshot refused %', r; end if;
  if (select count(*) from public.entity_screenshots where entity_type = 'boss' and entity_id = 1084) <> 1 then raise exception 'boss screenshot not stored'; end if;

  -- The six earlier types still pass; any other type is still refused, by the functions and by the tables.
  foreach t in array array['item', 'quest', 'npc', 'spell', 'zone', 'instance'] loop
    if public.post_entity_comment(ada, t, 1, 'Still here.') ->> 'refusal' is not null then raise exception 'type % lost', t; end if;
  end loop;
  begin
    perform public.post_entity_comment(ada, 'guild', 1, 'Not a page type.');
    raise exception 'guild comment posted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid comment' then raise; end if;
  end;
  begin
    perform public.submit_entity_screenshot(ada, 'guild', 1, 800, 600, 12000);
    raise exception 'guild screenshot stored';
  exception when raise_exception then
    if sqlerrm <> 'Invalid screenshot' then raise; end if;
  end;
  begin
    insert into public.entity_comments (entity_type, entity_id, user_id, body) values ('guild', 1, ada, 'x');
    raise exception 'comment table took guild';
  exception when check_violation then null;
  end;
  begin
    insert into public.entity_screenshots (entity_type, entity_id, user_id, width, height, bytes) values ('guild', 1, ada, 1, 1, 1);
    raise exception 'screenshot table took guild';
  exception when check_violation then null;
  end;

  -- The functions are still the server's alone and still run as their owner with an empty search_path.
  foreach t in array array['public.post_entity_comment(uuid,text,integer,text)', 'public.submit_entity_screenshot(uuid,text,integer,integer,integer,integer)'] loop
    if has_function_privilege('anon', t, 'execute') or has_function_privilege('authenticated', t, 'execute')
      or not has_function_privilege('service_role', t, 'execute') then raise exception 'grants on %', t; end if;
    if not (select prosecdef and proconfig @> array['search_path=""', 'lock_timeout=3s'] from pg_proc where oid = t::regprocedure) then raise exception 'unsafe %', t; end if;
  end loop;
end $$;

rollback;
