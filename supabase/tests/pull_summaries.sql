-- Run after 20261007070647_verified_publication.sql, 20261021130000_players.sql, 20261021190000_character_links.sql,
-- 20261022160000_players_realm_key.sql and 20261102130000_pull_summaries.sql on a disposable local PostgreSQL
-- database that has the roles anon, authenticated and service_role.
begin;

-- Only the server's role may call anything here; the tables are closed to every API role.
do $$
declare role_name text; fn text; tbl text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach tbl in array array['public.pull_summaries', 'public.pull_members'] loop
      if has_table_privilege(role_name, tbl, 'SELECT,INSERT,UPDATE,DELETE') then raise exception '% can touch %', role_name, tbl; end if;
    end loop;
    foreach fn in array array['public.insert_pull_summaries(jsonb)', 'public.forget_pull_member(text, text)', 'public.prune_pull_summaries()'] loop
      if has_function_privilege(role_name, fn, 'EXECUTE') then raise exception '% can execute %', role_name, fn; end if;
    end loop;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.pull_members'::regclass) then raise exception 'RLS disabled on pull_members'; end if;
  if not has_function_privilege('service_role', 'public.insert_pull_summaries(jsonb)', 'EXECUTE') then raise exception 'server cannot write'; end if;
end $$;

-- A character hidden before the upload is never written.
select public.suppress_player('Forever Pioneer', 'Hidden');

select public.insert_pull_summaries('[
  {"installId":"install-1234","eventId":"epoch:1","capturedAt":"2026-11-02T12:01:15Z",
   "summary":{"kind":"pull_summary","encounterId":1144,"name":"Rhahk''zor","instanceMapId":36,"success":true,"realm":"Forever Pioneer"},
   "members":[{"name":"Myself","realm":"Forever Pioneer","class":"HUNTER","self":true,"damageDone":30000},
              {"name":"Thrallina","realm":"forever  pioneer","class":"SHAMAN","healingDone":25000},
              {"name":"Hidden","realm":"Forever Pioneer","class":"MAGE","damageDone":1000}]},
  {"installId":"install-1234","eventId":"epoch:2","capturedAt":"2026-11-02T12:05:00Z",
   "summary":{"kind":"pull_summary","encounterId":1145,"name":"Sneed","instanceMapId":36,"success":false,"realm":"Forever Pioneer"},
   "members":[{"name":"Hidden","realm":"Forever-Pioneer","class":"MAGE","damageDone":900}]}
]'::jsonb);

do $$
begin
  if (select count(*) from public.pull_summaries) <> 1 then raise exception 'a pull with only hidden members was written'; end if;
  if (select count(*) from public.pull_members) <> 2 then raise exception 'expected two members'; end if;
  if exists (select 1 from public.pull_members where name_key = 'hidden') then raise exception 'a hidden character was written'; end if;
  if (select realm_key from public.pull_members where name_key = 'thrallina') <> 'forever pioneer' then raise exception 'realm not keyed'; end if;
end $$;

-- The same pull sent again changes nothing.
select public.insert_pull_summaries('[{"installId":"install-1234","eventId":"epoch:1","capturedAt":"2026-11-02T12:01:15Z",
  "summary":{"kind":"pull_summary"},"members":[{"name":"Other","realm":"Forever Pioneer","class":"MAGE"}]}]'::jsonb);
do $$
begin
  if (select count(*) from public.pull_members) <> 2 then raise exception 'a resent pull added members'; end if;
end $$;

-- Hiding a character after the upload deletes its member rows, however the realm is spelled; a pull keeps the others.
select public.suppress_player('Forever-Pioneer', 'thrallina');
do $$
begin
  if exists (select 1 from public.pull_members where name_key = 'thrallina') then raise exception 'the hide left pull rows'; end if;
  if (select count(*) from public.pull_members) <> 1 or (select count(*) from public.pull_summaries) <> 1 then raise exception 'the hide removed too much'; end if;
end $$;

-- A verified owner's opt-out (a direct insert) reaches the pulls too, and the last member takes the pull with it.
insert into public.character_suppressions (realm, character) values ('forever pioneer', 'myself');
do $$
begin
  if (select count(*) from public.pull_members) <> 0 or (select count(*) from public.pull_summaries) <> 0 then raise exception 'an opt-out left pull rows'; end if;
end $$;

-- A verified owner's opt-out recorded before the upload keeps the realm only lower-cased ('forever-pioneer'), and the
-- trigger has nothing to delete yet: an upload spelling the realm 'Forever Pioneer' still leaves the character out.
insert into public.character_suppressions (realm, character) values ('forever-pioneer', 'optedout');
select public.insert_pull_summaries('[
  {"installId":"install-1234","eventId":"epoch:9","capturedAt":"2026-11-02T12:10:00Z","summary":{"kind":"pull_summary"},
   "members":[{"name":"OptedOut","realm":"Forever Pioneer","class":"MAGE"},{"name":"Stays","realm":"Forever Pioneer","class":"MAGE"}]},
  {"installId":"install-1234","eventId":"epoch:10","capturedAt":"2026-11-02T12:12:00Z","summary":{"kind":"pull_summary"},
   "members":[{"name":"OptedOut","realm":"Forever Pioneer","class":"MAGE"}]}
]'::jsonb);
do $$
begin
  if exists (select 1 from public.pull_members where name_key = 'optedout') then raise exception 'an opted-out character came back under another realm spelling'; end if;
  if exists (select 1 from public.pull_summaries where event_id = 'epoch:10') then raise exception 'a pull of an opted-out character only was written'; end if;
  if not exists (select 1 from public.pull_members where name_key = 'stays') then raise exception 'the other member was dropped'; end if;
  delete from public.pull_summaries where event_id = 'epoch:9';
end $$;

-- forget_pull_member is safe to repeat.
select public.forget_pull_member('Forever Pioneer', 'Nobody');

-- Retention: a pull received more than a year ago is deleted with its members.
select public.insert_pull_summaries('[
  {"installId":"install-1234","eventId":"epoch:3","capturedAt":"2025-10-01T00:00:00Z","summary":{"kind":"pull_summary"},
   "members":[{"name":"Oldie","realm":"Forever Pioneer","class":"MAGE"}]},
  {"installId":"install-1234","eventId":"epoch:4","capturedAt":"2026-11-01T00:00:00Z","summary":{"kind":"pull_summary"},
   "members":[{"name":"Newbie","realm":"Forever Pioneer","class":"MAGE"}]}
]'::jsonb);
update public.pull_summaries set received_at = now() - interval '366 days' where event_id = 'epoch:3';
select public.prune_pull_summaries();
do $$
begin
  if exists (select 1 from public.pull_members where name_key = 'oldie') then raise exception 'retention kept an old pull'; end if;
  if not exists (select 1 from public.pull_members where name_key = 'newbie') then raise exception 'retention removed a current pull'; end if;
end $$;

-- A batch that is not an array is refused.
do $$
begin
  perform public.insert_pull_summaries('{}'::jsonb);
  raise exception 'a non-array batch was accepted';
exception when raise_exception then
  if sqlerrm <> 'Invalid pull batch' then raise; end if;
end $$;

rollback;
