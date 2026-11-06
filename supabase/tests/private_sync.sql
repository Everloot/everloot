-- Run after every migration up to 20261106120000_private_sync.sql on a disposable local PostgreSQL database
-- that has the roles anon, authenticated and service_role. Everything is rolled back at the end.
begin;

-- Only the server's role may call the functions; the two tables are closed to every role, the server's included.
do $$
declare role_name text; tbl text; fn text;
begin
  foreach fn in array array[
    'public.sync_account_for_key(text)', 'public.set_sync_consent(uuid, uuid, text, boolean)',
    'public.sync_character_facts(uuid, text, text, text, text, text, jsonb)', 'public.own_character_facts(uuid, uuid)',
    'public.public_character_facts(text, text, text)', 'public.set_visibility(uuid, uuid, jsonb)'
  ] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_function_privilege(role_name, fn, 'EXECUTE') then raise exception '% can execute %', role_name, fn; end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'server cannot execute %', fn; end if;
  end loop;
  foreach tbl in array array['public.character_sync_consent', 'public.character_facts'] loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if has_table_privilege(role_name, tbl, 'SELECT,INSERT,UPDATE,DELETE') then raise exception '% can touch %', role_name, tbl; end if;
    end loop;
    if not (select relrowsecurity from pg_class where oid = tbl::regclass) then raise exception 'RLS disabled on %', tbl; end if;
  end loop;
  -- No column can hold an install id, a character key, a GUID or a raw name.
  if exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name in ('character_sync_consent', 'character_facts')
      and (column_name ilike '%guid%' or column_name ilike '%install%' or column_name in ('character_key', 'name', 'user_id'))) then
    raise exception 'a raw identity column exists';
  end if;
end $$;

insert into public.users (id, bnet_id, battletag) values
  ('00000000-0000-4000-8000-0000000000a2', 'sync-a', 'Alpha#1'),
  ('00000000-0000-4000-8000-0000000000b2', 'sync-b', 'Bravo#2');

-- A's live Orc Shaman, public; A's mage; B's hand-written link to A's shaman by another game id (a forged claim, not
-- yet frozen in this fixture: freezing is tested below); B's own warrior.
insert into public.character_links (id, user_id, link_key, ruleset, realm_key, name_key, realm, name, race, class, faction, level, completion_ref) values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', repeat('1', 64), 'forever', 'forever pioneer', 'thrallina', 'Forever Pioneer', 'Thrallina', 'Orc', 'SHAMAN', 'Horde', 60, repeat('c', 64)),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2', repeat('2', 64), 'forever', 'forever pioneer', 'frosty', 'Forever Pioneer', 'Frosty', 'Human', 'MAGE', 'Alliance', 60, repeat('c', 64)),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000b2', repeat('4', 64), 'forever', 'forever pioneer', 'gromma', 'Forever Pioneer', 'Gromma', 'Orc', 'WARRIOR', 'Horde', 60, repeat('c', 64));
insert into public.character_visibility (link_id, page_public) values
  ('30000000-0000-4000-8000-000000000001', true),
  ('30000000-0000-4000-8000-000000000002', false),
  ('30000000-0000-4000-8000-000000000004', true);

create function pg_temp.sync(p_user text, p_name text, p_facts jsonb, p_class text default null, p_realm text default 'forever-pioneer')
returns table (category text, outcome text) language sql as $$
  select * from public.sync_character_facts(p_user::uuid, 'forever', p_realm, p_name, p_class, repeat('5', 64), p_facts);
$$;
create function pg_temp.fact(p_category text, p_at text, p_data jsonb) returns jsonb language sql as $$
  select jsonb_build_object('category', p_category, 'captured_at', p_at, 'data', p_data);
$$;
create function pg_temp.public_cats(p_name text default 'Thrallina') returns text language sql as $$
  select coalesce(string_agg(category, ',' order by category), '') from public.public_character_facts('forever', 'forever-pioneer', p_name);
$$;

-- Keys: sync:own may be made through issue_api_key, and only it opens sync_account_for_key.
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000000a2';
begin
  delete from public.intake_quota_buckets where bucket = 'keys_made:' || a::text;
  perform public.issue_api_key(a, repeat('d', 64), 'dddd', 'Desktop', 'Sync my characters', array['read:public', 'sync:own'], now() + interval '30 days');
  perform public.issue_api_key(a, repeat('e', 64), 'eeee', 'Links', 'Link my characters', array['read:public', 'link:own'], now() + interval '30 days');
  if (select account from public.sync_account_for_key(repeat('d', 64))) <> a then raise exception 'sync key not resolved'; end if;
  if (select refusal from public.sync_account_for_key(repeat('e', 64))) <> 'no_scope' then raise exception 'link:own key may sync'; end if;
  if (select refusal from public.link_account_for_key(repeat('d', 64))) <> 'no_scope' then raise exception 'sync:own key may link'; end if;
  if (select refusal from public.sync_account_for_key(repeat('f', 64))) <> 'unknown_key' then raise exception 'unknown key accepted'; end if;
  update public.api_keys set revoked_at = now() where token_hash = repeat('d', 64);
  if (select refusal from public.sync_account_for_key(repeat('d', 64))) <> 'unknown_key' then raise exception 'revoked key accepted'; end if;
  begin
    perform public.issue_api_key(a, repeat('9', 64), '9999', 'Bad', 'Bad', array['sync:all'], now() + interval '1 day');
    raise exception 'unknown scope accepted';
  exception when check_violation then null;
  end;
end $$;

-- Consent: nothing is kept without it; only the owner sets it; a frozen link cannot be granted.
do $$
declare
  a constant text := '00000000-0000-4000-8000-0000000000a2';
  b constant text := '00000000-0000-4000-8000-0000000000b2';
  thrall constant uuid := '30000000-0000-4000-8000-000000000001';
begin
  if (select outcome from pg_temp.sync(a, 'Thrallina', jsonb_build_array(pg_temp.fact('gear', '2026-10-05T10:00:00Z', '{"equipped": []}')))) <> 'no_consent' then
    raise exception 'stored without consent';
  end if;
  if exists (select 1 from public.character_facts) then raise exception 'a fact was written without consent'; end if;
  if public.set_sync_consent(b::uuid, thrall, 'gear', true) <> 'not_found' then raise exception 'another account granted consent'; end if;
  if exists (select 1 from public.character_sync_consent) then raise exception 'consent written for another account'; end if;
  if public.set_sync_consent(a::uuid, thrall, 'gear', true) is not null then raise exception 'consent refused'; end if;
  if public.set_sync_consent(a::uuid, thrall, 'gear', true) is not null then raise exception 'second grant refused'; end if;
  begin
    perform public.set_sync_consent(a::uuid, thrall, 'gold', true);
    raise exception 'unknown category accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid consent' then raise; end if;
  end;
end $$;

-- Sync: stored, the same capture again is a no-op, an older one never overwrites, a newer one replaces.
do $$
declare
  a constant text := '00000000-0000-4000-8000-0000000000a2';
  thrall constant uuid := '30000000-0000-4000-8000-000000000001';
  newer constant jsonb := '{"equipped": [{"slot": "HeadSlot", "itemId": 2, "itemLevel": 60}]}';
begin
  if (select outcome from pg_temp.sync(a, 'Thrallina', jsonb_build_array(pg_temp.fact('gear', '2026-10-05T10:00:00Z', '{"equipped": [{"slot": "HeadSlot", "itemId": 1, "itemLevel": 50}]}')))) <> 'stored' then
    raise exception 'not stored';
  end if;
  if (select outcome from pg_temp.sync(a, 'Thrallina', jsonb_build_array(pg_temp.fact('gear', '2026-10-05T10:00:00Z', '{"equipped": [{"slot": "HeadSlot", "itemId": 1, "itemLevel": 50}]}')))) <> 'duplicate' then
    raise exception 'duplicate not recognised';
  end if;
  if (select outcome from pg_temp.sync(a, 'Thrallina', jsonb_build_array(pg_temp.fact('gear', '2026-10-04T10:00:00Z', '{"equipped": [{"slot": "HeadSlot", "itemId": 9, "itemLevel": 1}]}')))) <> 'older' then
    raise exception 'older capture not refused';
  end if;
  -- The same moment with other contents is not newer either.
  if (select outcome from pg_temp.sync(a, 'Thrallina', jsonb_build_array(pg_temp.fact('gear', '2026-10-05T10:00:00Z', '{"equipped": [{"slot": "HeadSlot", "itemId": 9, "itemLevel": 1}]}')))) <> 'older' then
    raise exception 'same-time capture overwrote';
  end if;
  if (select data -> 'equipped' -> 0 ->> 'itemId' from public.character_facts where link_id = thrall and category = 'gear') <> '1' then
    raise exception 'an older capture overwrote the stored one';
  end if;
  -- The realm may be spelled any way, the name in any case; another install's newer capture replaces it.
  if (select outcome from public.sync_character_facts(a::uuid, 'forever', 'Forever Pioneer', 'THRALLINA', 'shaman', repeat('6', 64),
      jsonb_build_array(pg_temp.fact('gear', '2026-10-06T10:00:00Z', newer)))) <> 'stored' then
    raise exception 'newer capture not stored';
  end if;
  if (select data from public.character_facts where link_id = thrall and category = 'gear') <> newer
    or (select source_ref from public.character_facts where link_id = thrall and category = 'gear') <> repeat('6', 64) then
    raise exception 'newer capture did not replace';
  end if;
  if (select count(*) from public.character_facts where link_id = thrall) <> 1 then raise exception 'more than the latest state kept'; end if;
  -- Another class, or a character the account has not linked, writes nothing and tells nothing more.
  if (select outcome from pg_temp.sync(a, 'Thrallina', jsonb_build_array(pg_temp.fact('gear', '2026-10-07T10:00:00Z', newer)), 'MAGE')) <> 'mismatch' then
    raise exception 'class mismatch accepted';
  end if;
  if (select outcome from pg_temp.sync(a, 'Gromma', jsonb_build_array(pg_temp.fact('gear', '2026-10-07T10:00:00Z', newer)))) <> 'not_linked' then
    raise exception 'another account''s character accepted';
  end if;
  if (select outcome from pg_temp.sync(a, 'Nobody', jsonb_build_array(pg_temp.fact('gear', '2026-10-07T10:00:00Z', newer)))) <> 'not_linked' then
    raise exception 'unlinked character accepted';
  end if;
  begin
    perform pg_temp.sync(a, 'Thrallina', jsonb_build_array(pg_temp.fact('gear', (now() + interval '3 days')::text, newer)));
    raise exception 'a capture from the future was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid facts' then raise; end if;
  end;
end $$;

-- The public read: only switched-on, consented categories of a live, public, unhidden link; switching off removes them.
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000000a2';
  thrall constant uuid := '30000000-0000-4000-8000-000000000001';
  frosty constant uuid := '30000000-0000-4000-8000-000000000002';
begin
  perform public.set_sync_consent(a, thrall, 'raids', true);
  perform pg_temp.sync(a::text, 'Thrallina', jsonb_build_array(pg_temp.fact('raids', '2026-10-06T10:00:00Z', '{"lockouts": []}')));
  if pg_temp.public_cats() <> '' then raise exception 'facts public with every switch off'; end if;
  perform public.set_visibility(a, thrall, '{"show_gear": true}');
  if pg_temp.public_cats() <> 'gear' then raise exception 'show_gear did not publish gear only: %', pg_temp.public_cats(); end if;
  perform public.set_visibility(a, thrall, '{"show_raids": true}');
  if pg_temp.public_cats() <> 'gear,raids' then raise exception 'show_raids did not publish raids'; end if;
  perform public.set_visibility(a, thrall, '{"show_gear": false}');
  if pg_temp.public_cats() <> 'raids' then raise exception 'switching gear off did not remove it'; end if;
  perform public.set_visibility(a, thrall, '{"page_public": false}');
  if pg_temp.public_cats() <> '' then raise exception 'facts public with the page off'; end if;
  perform public.set_visibility(a, thrall, '{"page_public": true}');
  -- A page that is off shows nothing, whatever its switches.
  perform public.set_sync_consent(a, frosty, 'gear', true);
  perform pg_temp.sync(a::text, 'Frosty', jsonb_build_array(pg_temp.fact('gear', '2026-10-06T10:00:00Z', '{"equipped": []}')));
  perform public.set_visibility(a, frosty, '{"show_gear": true}');
  if pg_temp.public_cats('Frosty') <> '' then raise exception 'facts public on a private page'; end if;
  -- A hide request takes the sections off with the page.
  insert into public.character_suppressions (realm, character) values ('forever pioneer', 'thrallina');
  if pg_temp.public_cats() <> '' then raise exception 'a hidden character shows facts'; end if;
  delete from public.character_suppressions where character = 'thrallina';
  if pg_temp.public_cats() <> 'raids' then raise exception 'fixture: raids not back after the hide was lifted'; end if;
  begin
    perform public.set_visibility(a, thrall, '{"show_mounts": true}');
    raise exception 'unknown switch accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid visibility' then raise; end if;
  end;
end $$;

-- The owner's own read: every category with its consent; nothing for another account.
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000000a2';
  b constant uuid := '00000000-0000-4000-8000-0000000000b2';
  thrall constant uuid := '30000000-0000-4000-8000-000000000001';
begin
  if (select count(*) from public.own_character_facts(a, thrall)) <> 6 then raise exception 'owner read is not one row per category'; end if;
  if (select count(*) from public.own_character_facts(a, thrall) where data is not null) <> 2 then raise exception 'owner read misses facts'; end if;
  if (select consented from public.own_character_facts(a, thrall) where category = 'talents') then raise exception 'talents consented by default'; end if;
  if exists (select 1 from public.own_character_facts(b, thrall)) then raise exception 'another account reads the facts'; end if;
end $$;

-- Revoking a category deletes its facts, and a later sync of it is refused.
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000000a2';
  thrall constant uuid := '30000000-0000-4000-8000-000000000001';
begin
  if public.set_sync_consent(a, thrall, 'raids', false) is not null then raise exception 'revoke refused'; end if;
  if exists (select 1 from public.character_facts where link_id = thrall and category = 'raids') then raise exception 'revoked facts kept'; end if;
  if not exists (select 1 from public.character_facts where link_id = thrall and category = 'gear') then raise exception 'revoke took another category'; end if;
  if (select outcome from pg_temp.sync(a::text, 'Thrallina', jsonb_build_array(pg_temp.fact('raids', '2026-10-07T10:00:00Z', '{"lockouts": []}')))) <> 'no_consent' then
    raise exception 'revoked category still syncs';
  end if;
  if pg_temp.public_cats() <> '' then raise exception 'a revoked category stays public'; end if;
end $$;

-- Frozen: a second account claiming the character freezes both; the frozen owner syncs and reads nothing, the public
-- read is empty, and a grant is refused. The forger's frozen link takes nothing either.
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000000a2';
  b constant uuid := '00000000-0000-4000-8000-0000000000b2';
  thrall constant uuid := '30000000-0000-4000-8000-000000000001';
  forged constant uuid := '30000000-0000-4000-8000-000000000003';
begin
  perform public.set_visibility(a, thrall, '{"show_gear": true}');
  if pg_temp.public_cats() <> 'gear' then raise exception 'fixture: gear not public'; end if;
  insert into public.character_links (id, user_id, link_key, ruleset, realm_key, name_key, realm, name, race, class, faction, level, completion_ref, status)
    values (forged, b, repeat('3', 64), 'forever', 'forever pioneer', 'thrallina', 'Forever Pioneer', 'Thrallina', 'Orc', 'SHAMAN', 'Horde', 60, repeat('c', 64), 'frozen');
  update public.character_links set status = 'frozen' where id = thrall;
  if pg_temp.public_cats() <> '' then raise exception 'a frozen character shows facts'; end if;
  if exists (select 1 from public.own_character_facts(a, thrall) where data is not null) then raise exception 'a frozen link reads its facts'; end if;
  if (select outcome from pg_temp.sync(a::text, 'Thrallina', jsonb_build_array(pg_temp.fact('gear', '2026-10-08T10:00:00Z', '{"equipped": []}')))) <> 'not_linked' then
    raise exception 'a frozen link took a sync';
  end if;
  if (select outcome from pg_temp.sync(b::text, 'Thrallina', jsonb_build_array(pg_temp.fact('gear', '2026-10-08T10:00:00Z', '{"equipped": []}')))) <> 'not_linked' then
    raise exception 'the forger''s frozen link took a sync';
  end if;
  if public.set_sync_consent(a, thrall, 'talents', true) <> 'frozen' then raise exception 'a frozen link was granted'; end if;
  if public.set_sync_consent(b, forged, 'gear', true) <> 'frozen' then raise exception 'the forger was granted'; end if;
  if exists (select 1 from public.own_character_facts(b, forged) where data is not null) then raise exception 'the forger reads facts'; end if;
  -- Revoking still works on a frozen link.
  if public.set_sync_consent(a, thrall, 'gear', false) is not null then raise exception 'revoke refused on a frozen link'; end if;
  delete from public.character_links where id = forged;
  update public.character_links set status = 'linked' where id = thrall;
end $$;

-- Unlink deletes the link's consent and facts at once, and its public sections with them.
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000000a2';
  thrall constant uuid := '30000000-0000-4000-8000-000000000001';
begin
  perform public.set_sync_consent(a, thrall, 'gear', true);
  perform pg_temp.sync(a::text, 'Thrallina', jsonb_build_array(pg_temp.fact('gear', '2026-10-09T10:00:00Z', '{"equipped": []}')));
  if pg_temp.public_cats() <> 'gear' then raise exception 'fixture: gear not public before unlink'; end if;
  if not public.unlink_character(a, thrall) then raise exception 'unlink failed'; end if;
  if exists (select 1 from public.character_facts where link_id = thrall) then raise exception 'facts kept after unlink'; end if;
  if exists (select 1 from public.character_sync_consent where link_id = thrall) then raise exception 'consent kept after unlink'; end if;
  if pg_temp.public_cats() <> '' then raise exception 'public sections kept after unlink'; end if;
end $$;

rollback;
