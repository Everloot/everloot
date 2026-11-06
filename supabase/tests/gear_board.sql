-- Run after every migration up to 20261107120000_gear_board.sql on a disposable local PostgreSQL database that has the
-- roles anon, authenticated and service_role. Everything is rolled back at the end.
begin;

do $$
declare role_name text;
-- 20261107130000_profile_pipeline.sql replaces the board with one that takes optional arguments; check whichever is there.
declare fn text := coalesce(to_regprocedure('public.ranked_gear_board(timestamptz, uuid[])'), to_regprocedure('public.ranked_gear_board()'))::oid::regprocedure::text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_function_privilege(role_name, fn, 'EXECUTE') then raise exception '% can read the board', role_name; end if;
  end loop;
  if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'server cannot read the board'; end if;
end $$;

insert into public.users (id, bnet_id, battletag) values
  ('00000000-0000-4000-8000-0000000000a3', 'gear-a', 'Alpha#3'),
  ('00000000-0000-4000-8000-0000000000b3', 'gear-b', 'Bravo#4');

-- 1 ranked; 2 page private; 3 not ranked; 4 gear sync revoked; 5 old capture; 6 hidden; 7 frozen by 8 (B's claim).
insert into public.character_links (id, user_id, link_key, ruleset, realm_key, name_key, realm, name, race, class, faction, level, completion_ref, status) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', repeat('1', 64), 'forever', 'forever pioneer', 'ranky', 'Forever Pioneer', 'Ranky', 'Orc', 'SHAMAN', 'Horde', 60, repeat('c', 64), 'linked'),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a3', repeat('2', 64), 'forever', 'forever pioneer', 'shy', 'Forever Pioneer', 'Shy', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('40000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a3', repeat('3', 64), 'forever', 'forever pioneer', 'unranked', 'Forever Pioneer', 'Unranked', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('40000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a3', repeat('4', 64), 'forever', 'forever pioneer', 'revoked', 'Forever Pioneer', 'Revoked', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('40000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a3', repeat('5', 64), 'forever', 'forever pioneer', 'stale', 'Forever Pioneer', 'Stale', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('40000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000a3', repeat('6', 64), 'forever', 'forever pioneer', 'hidden', 'Forever Pioneer', 'Hidden', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('40000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000a3', repeat('7', 64), 'forever', 'forever pioneer', 'claimed', 'Forever Pioneer', 'Claimed', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'linked'),
  ('40000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000b3', repeat('7', 64), 'forever', 'forever pioneer', 'claimed', 'Forever Pioneer', 'Claimed', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64), 'frozen');
insert into public.character_visibility (link_id, page_public, ranked_gear)
  select id, id <> '40000000-0000-4000-8000-000000000002', id <> '40000000-0000-4000-8000-000000000003'
  from public.character_links where id::text like '40000000-%' and id <> '40000000-0000-4000-8000-000000000008';
insert into public.character_sync_consent (link_id, category, revoked_at)
  select id, 'gear', case when id = '40000000-0000-4000-8000-000000000004' then now() end
  from public.character_links where id::text like '40000000-%' and id <> '40000000-0000-4000-8000-000000000008';
insert into public.character_facts (link_id, category, captured_at, data, data_hash, source_ref)
  select id, 'gear', case when id = '40000000-0000-4000-8000-000000000005' then now() - interval '31 days' else now() - interval '1 day' end,
    '{"equipped": [{"slot": "HeadSlot", "itemId": 1, "itemLevel": 60}]}', repeat('d', 64), repeat('e', 64)
  from public.character_links where id::text like '40000000-%' and id <> '40000000-0000-4000-8000-000000000008';
insert into public.character_suppressions (realm, character) values ('forever pioneer', 'hidden');

do $$
declare got text;
begin
  select string_agg(name, ',' order by name) into got from public.ranked_gear_board();
  if got is distinct from 'Ranky' then raise exception 'board lists %, expected Ranky only', got; end if;
  -- The owner turns ranking off: gone on the next read.
  update public.character_visibility set ranked_gear = false where link_id = '40000000-0000-4000-8000-000000000001';
  if exists (select 1 from public.ranked_gear_board()) then raise exception 'ranking off still listed'; end if;
end $$;

rollback;
