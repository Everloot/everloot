-- Run after every migration up to 20261107130000_profile_pipeline.sql on a disposable local PostgreSQL database that
-- has the roles anon, authenticated and service_role. Everything is rolled back at the end.
begin;

do $$
declare role_name text;
declare fn text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(role_name, 'public.character_track', 'SELECT')
      or has_table_privilege(role_name, 'public.character_track', 'INSERT') then
      raise exception '% can touch character_track directly', role_name;
    end if;
  end loop;
  foreach fn in array array['public.ranked_gear_links()', 'public.ranked_gear_board(timestamptz, uuid[])',
      'public.record_character_track(jsonb)', 'public.character_track_points(uuid)'] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_function_privilege(role_name, fn, 'EXECUTE') then raise exception '% can run %', role_name, fn; end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'server cannot run %', fn; end if;
  end loop;
  if to_regprocedure('public.ranked_gear_board()') is not null then raise exception 'the old board signature is still there'; end if;
end $$;

insert into public.users (id, bnet_id, battletag) values
  ('00000000-0000-4000-8000-0000000000a5', 'track-a', 'Alpha#5'),
  ('00000000-0000-4000-8000-0000000000b5', 'track-b', 'Bravo#6');

-- 1 ranked; 2 page private; 3 not ranked; 4 gear sync revoked; 5 old capture; 6 hidden; 7 frozen by 8 (B's claim);
-- 9 ranked, its gear received long ago (the incremental read skips it unless asked by id).
insert into public.character_links (id, user_id, link_key, ruleset, realm_key, name_key, realm, name, race, class, faction, level, completion_ref, status) values
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a5', repeat('1', 64), 'forever', 'forever pioneer', 'ranky', 'Forever Pioneer', 'Ranky', 'Orc', 'SHAMAN', 'Horde', 60, repeat('c', 64), 'linked'),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a5', repeat('2', 64), 'forever', 'forever pioneer', 'shy', 'Forever Pioneer', 'Shy', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('50000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a5', repeat('3', 64), 'forever', 'forever pioneer', 'unranked', 'Forever Pioneer', 'Unranked', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('50000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a5', repeat('4', 64), 'forever', 'forever pioneer', 'revoked', 'Forever Pioneer', 'Revoked', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('50000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a5', repeat('5', 64), 'forever', 'forever pioneer', 'stale', 'Forever Pioneer', 'Stale', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('50000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000a5', repeat('6', 64), 'forever', 'forever pioneer', 'hidden', 'Forever Pioneer', 'Hidden', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('50000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000a5', repeat('7', 64), 'forever', 'forever pioneer', 'claimed', 'Forever Pioneer', 'Claimed', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('50000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000b5', repeat('7', 64), 'forever', 'forever pioneer', 'claimed', 'Forever Pioneer', 'Claimed', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'frozen'),
  ('50000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-0000000000a5', repeat('9', 64), 'forever', 'forever pioneer', 'steady', 'Forever Pioneer', 'Steady', 'Orc', 'WARRIOR', 'Horde', 58, repeat('c', 64), 'linked');
insert into public.character_visibility (link_id, page_public, ranked_gear)
  select id, id <> '50000000-0000-4000-8000-000000000002', id <> '50000000-0000-4000-8000-000000000003'
  from public.character_links where id::text like '50000000-%' and id <> '50000000-0000-4000-8000-000000000008';
insert into public.character_sync_consent (link_id, category, revoked_at)
  select id, 'gear', case when id = '50000000-0000-4000-8000-000000000004' then now() end
  from public.character_links where id::text like '50000000-%' and id <> '50000000-0000-4000-8000-000000000008';
insert into public.character_facts (link_id, category, captured_at, data, data_hash, source_ref, received_at)
  select id, 'gear', case when id = '50000000-0000-4000-8000-000000000005' then now() - interval '31 days' else now() - interval '1 day' end,
    '{"equipped": [{"slot": "HeadSlot", "itemId": 1, "itemLevel": 60}]}', repeat('d', 64), repeat('e', 64),
    case when id = '50000000-0000-4000-8000-000000000009' then now() - interval '2 days' else now() end
  from public.character_links where id::text like '50000000-%' and id <> '50000000-0000-4000-8000-000000000008';
insert into public.character_suppressions (realm, character) values ('forever pioneer', 'hidden');

do $$
declare
  got text;
  n integer;
  ranky constant uuid := '50000000-0000-4000-8000-000000000001';
  shy constant uuid := '50000000-0000-4000-8000-000000000002';
  steady constant uuid := '50000000-0000-4000-8000-000000000009';
begin
  -- Who may be on the boards, and the board rows, agree: the same rule, read once.
  select string_agg(l.name, ',' order by l.name) into got from public.ranked_gear_links() r join public.character_links l on l.id = r.link_id;
  if got is distinct from 'Ranky,Steady' then raise exception 'eligible lists %, expected Ranky,Steady', got; end if;
  select string_agg(name, ',' order by name) into got from public.ranked_gear_board();
  if got is distinct from 'Ranky,Steady' then raise exception 'board lists %, expected Ranky,Steady', got; end if;
  if (select link_id from public.ranked_gear_board() where name = 'Ranky') is distinct from ranky then raise exception 'board row carries the wrong link'; end if;

  -- Incremental: only gear received since the watermark, plus links asked for by id, and never an ineligible one.
  select string_agg(name, ',' order by name) into got from public.ranked_gear_board(now() - interval '1 hour');
  if got is distinct from 'Ranky' then raise exception 'since read lists %, expected Ranky', got; end if;
  select string_agg(name, ',' order by name) into got from public.ranked_gear_board(now() + interval '1 hour', array[steady, shy]);
  if got is distinct from 'Steady' then raise exception 'by-id read lists %, expected Steady', got; end if;

  -- Points: one per link, day and metric; a later write that day replaces it; an ineligible link is not written.
  n := public.record_character_track(jsonb_build_array(
    jsonb_build_object('link_id', ranky, 'day', '2026-11-05', 'metric', 'item_level', 'value', 50, 'source', 'owner_sync'),
    jsonb_build_object('link_id', ranky, 'day', '2026-11-05', 'metric', 'gear_score', 'value', 48, 'source', 'owner_sync', 'version', 'gs-v1'),
    jsonb_build_object('link_id', shy, 'day', '2026-11-05', 'metric', 'item_level', 'value', 70, 'source', 'owner_sync')));
  if n <> 2 then raise exception 'wrote % points, expected 2', n; end if;
  n := public.record_character_track(jsonb_build_array(
    jsonb_build_object('link_id', ranky, 'day', '2026-11-05', 'metric', 'item_level', 'value', 52, 'source', 'owner_sync'),
    jsonb_build_object('link_id', ranky, 'day', '2026-11-06', 'metric', 'item_level', 'value', 55, 'source', 'owner_sync')));
  if n <> 2 then raise exception 'second write wrote %, expected 2', n; end if;
  select string_agg(day || ':' || metric || '=' || value, ',' order by day, metric) into got from public.character_track_points(ranky);
  if got is distinct from '2026-11-05:gear_score=48,2026-11-05:item_level=52,2026-11-06:item_level=55' then raise exception 'points read %', got; end if;
  if exists (select 1 from public.character_track where link_id = shy) then raise exception 'a private page got a point'; end if;
  if exists (select 1 from public.character_track_points(shy)) then raise exception 'a private page has points to read'; end if;

  -- An unknown metric or source, or a day far ahead, is refused.
  begin
    perform public.record_character_track(jsonb_build_array(jsonb_build_object('link_id', ranky, 'day', '2026-11-06', 'metric', 'mood', 'value', 1, 'source', 'owner_sync')));
    raise exception 'unknown metric accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.record_character_track(jsonb_build_array(jsonb_build_object('link_id', ranky, 'day', (current_date + 5)::text, 'metric', 'level', 'value', 1, 'source', 'owner_sync')));
    raise exception 'a future day was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid points' then raise; end if;
  end;

  -- The owner turns ranking off: off the boards and no points to read on the next request; the history is kept.
  update public.character_visibility set ranked_gear = false where link_id = ranky;
  if exists (select 1 from public.ranked_gear_links() where link_id = ranky) then raise exception 'ranking off still eligible'; end if;
  if exists (select 1 from public.character_track_points(ranky)) then raise exception 'ranking off still has points to read'; end if;
  if (select count(*) from public.character_track where link_id = ranky) <> 3 then raise exception 'ranking off lost the history'; end if;
  -- Unlinking deletes the history.
  delete from public.character_links where id = ranky;
  if exists (select 1 from public.character_track where link_id = ranky) then raise exception 'unlinking kept the history'; end if;
end $$;

rollback;
