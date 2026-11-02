-- Run after every migration up to 20261102120000_build_label_links.sql on a disposable local PostgreSQL database
-- that has the roles anon, authenticated and service_role. Everything is rolled back at the end.
begin;

-- Only the server's role may call the two functions.
do $$
declare role_name text; fn text;
begin
  foreach fn in array array['public.attach_build_label(uuid, uuid, uuid)', 'public.public_character_builds(text, text, text)'] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_function_privilege(role_name, fn, 'EXECUTE') then raise exception '% can execute %', role_name, fn; end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'server cannot execute %', fn; end if;
  end loop;
  if has_table_privilege('service_role', 'public.build_characters', 'UPDATE') then raise exception 'labels writable outside the functions'; end if;
end $$;

insert into public.users (id, bnet_id, battletag) values
  ('00000000-0000-4000-8000-0000000000a1', 'label-a', 'Alpha#1'),
  ('00000000-0000-4000-8000-0000000000b1', 'label-b', 'Bravo#2');

-- A's public Orc Shaman, a second shaman of A's, and B's mage.
insert into public.character_links (id, user_id, link_key, ruleset, realm_key, name_key, realm, name, race, class, faction, level, completion_ref) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', repeat('1', 64), 'forever', 'forever pioneer', 'thrallina', 'Forever Pioneer', 'Thrallina', 'Orc', 'SHAMAN', 'Horde', 24, repeat('c', 64)),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', repeat('2', 64), 'forever', 'forever pioneer', 'rokhan', 'Forever Pioneer', 'Rokhan', 'Troll', 'SHAMAN', 'Horde', 20, repeat('c', 64)),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b1', repeat('3', 64), 'forever', 'forever pioneer', 'jainy', 'Forever Pioneer', 'Jainy', 'Human', 'MAGE', 'Alliance', 30, repeat('c', 64));
insert into public.character_visibility (link_id, page_public) values
  ('10000000-0000-4000-8000-000000000001', true),
  ('10000000-0000-4000-8000-000000000002', true),
  ('10000000-0000-4000-8000-000000000003', true);

-- Labels: A's "Thrallina" (same name as the link, never attached by that), A's second shaman label, A's mage label,
-- and B's shaman label.
insert into public.build_characters (id, user_id, name, class_slug) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'Thrallina', 'shaman'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'Alt plans', 'shaman'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1', 'Frosty', 'mage'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000b1', 'Borrowed', 'shaman');

insert into public.saved_builds (user_id, character_id, slug, name, notes, class_slug, code, game_build, shared, active, updated_at) values
  ('00000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001', 'Shared01', 'Raid resto', 'private note', 'shaman', 'EL1-shaman-0-1.60.1.70450-MTE6NQ', '1.60.1.70450', true, false, now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001', 'Shared02', 'Levelling enh', null, 'shaman', 'EL1-shaman-0-1.60.1.70450-MTE6NQ', '1.60.1.70450', true, true, now() - interval '3 days'),
  ('00000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001', 'Unshare1', 'Secret build', null, 'shaman', 'EL1-shaman-0-1.60.1.70450-MTE6NQ', '1.60.1.70450', false, false, now()),
  -- A build of another class under the label, as a class change after its builds were moved could leave one.
  ('00000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001', 'Wrongcl1', 'Mage build', null, 'mage', 'EL1-mage-0-1.60.1.70450-MTE6NQ', '1.60.1.70450', true, false, now()),
  ('00000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000002', 'AltShar1', 'Alt build', null, 'shaman', 'EL1-shaman-0-1.60.1.70450-MTE6NQ', '1.60.1.70450', true, false, now());

create function pg_temp.attach(p_user text, p_link text, p_label text) returns text language sql as $$
  select coalesce(public.attach_build_label(p_user::uuid, p_link::uuid, p_label::uuid), 'ok');
$$;
create function pg_temp.planned(p_name text default 'thrallina') returns text language sql as $$
  select coalesce(string_agg(slug, ',' order by ord), '') from (
    select slug, row_number() over () as ord from public.public_character_builds('forever', 'forever-pioneer', p_name)) x;
$$;
create function pg_temp.label_of(p_link text) returns uuid language sql as $$
  select id from public.build_characters where link_id = p_link::uuid;
$$;

-- Nothing is attached by matching names, and nothing shows before the owner attaches a label.
do $$
begin
  if exists (select 1 from public.build_characters where link_id is not null) then raise exception 'a label was attached by itself'; end if;
  if pg_temp.planned() <> '' then raise exception 'builds shown without an attached label'; end if;
end $$;

-- Refusals write nothing: another account's link or label, a label of another class.
do $$
declare
  a constant text := '00000000-0000-4000-8000-0000000000a1';
  b constant text := '00000000-0000-4000-8000-0000000000b1';
  thrallina constant text := '10000000-0000-4000-8000-000000000001';
begin
  if pg_temp.attach(b, thrallina, '20000000-0000-4000-8000-000000000004') <> 'not_found' then raise exception 'attached to another account''s link'; end if;
  if pg_temp.attach(a, thrallina, '20000000-0000-4000-8000-000000000004') <> 'not_found' then raise exception 'attached another account''s label'; end if;
  if pg_temp.attach(a, thrallina, '20000000-0000-4000-8000-000000000003') <> 'class_mismatch' then raise exception 'mage label on a shaman'; end if;
  if pg_temp.attach(a, '10000000-0000-4000-8000-0000000000ff', null) <> 'not_found' then raise exception 'unknown link answered'; end if;
  if exists (select 1 from public.build_characters where link_id is not null) then raise exception 'a refusal wrote'; end if;
end $$;

-- Attached: the label's shared builds of the character's class, the active one first, and nothing else about them.
do $$
declare
  a constant text := '00000000-0000-4000-8000-0000000000a1';
  thrallina constant text := '10000000-0000-4000-8000-000000000001';
  r record;
begin
  if pg_temp.attach(a, thrallina, '20000000-0000-4000-8000-000000000001') <> 'ok' then raise exception 'attach refused'; end if;
  if pg_temp.planned() <> 'Shared02,Shared01' then raise exception 'planned builds wrong: %', pg_temp.planned(); end if;
  -- The realm and name as any page address spells them.
  if (select count(*) from public.public_character_builds('forever', 'Forever-Pioneer', 'THRALLINA')) <> 2 then raise exception 'address spelling'; end if;
  select * into r from public.public_character_builds('forever', 'forever-pioneer', 'thrallina') limit 1;
  if to_jsonb(r) - array['name', 'slug', 'updated_at'] <> '{}'::jsonb then raise exception 'extra columns: %', to_jsonb(r); end if;
  -- Attaching again is a no-op.
  if pg_temp.attach(a, thrallina, '20000000-0000-4000-8000-000000000001') <> 'ok' or pg_temp.planned() <> 'Shared02,Shared01' then raise exception 'reattach changed it'; end if;
end $$;

-- A page that is a 404 has no builds: page off, hidden by a hide request, frozen by a second claim.
do $$
declare
  thrallina constant uuid := '10000000-0000-4000-8000-000000000001';
begin
  update public.character_visibility set page_public = false where link_id = thrallina;
  if pg_temp.planned() <> '' then raise exception 'builds on a private page'; end if;
  update public.character_visibility set page_public = true where link_id = thrallina;

  insert into public.character_suppressions (realm, character) values ('forever pioneer', 'thrallina');
  if pg_temp.planned() <> '' then raise exception 'builds on a hidden character'; end if;
  delete from public.character_suppressions where realm = 'forever pioneer' and character = 'thrallina';

  insert into public.character_links (id, user_id, link_key, ruleset, realm_key, name_key, realm, name, race, class, faction, level, completion_ref, status)
    values ('10000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-0000000000b1', repeat('9', 64), 'forever', 'forever pioneer', 'thrallina',
      'Forever Pioneer', 'Thrallina', 'Orc', 'SHAMAN', 'Horde', 24, repeat('c', 64), 'frozen');
  if pg_temp.planned() <> '' then raise exception 'builds on a character another account claims'; end if;
  delete from public.character_links where id = '10000000-0000-4000-8000-000000000009';

  update public.character_links set status = 'frozen' where id = thrallina;
  if pg_temp.planned() <> '' then raise exception 'builds on a frozen link'; end if;
  if pg_temp.attach('00000000-0000-4000-8000-0000000000a1', thrallina::text, null) <> 'frozen' then raise exception 'frozen link changed'; end if;
  update public.character_links set status = 'linked' where id = thrallina;

  if pg_temp.planned() <> 'Shared02,Shared01' then raise exception 'builds did not come back'; end if;
end $$;

-- One label per link and one link per label: a new label replaces the old, a label moves between links, null takes it off.
do $$
declare
  a constant text := '00000000-0000-4000-8000-0000000000a1';
  thrallina constant text := '10000000-0000-4000-8000-000000000001';
  rokhan constant text := '10000000-0000-4000-8000-000000000002';
begin
  if pg_temp.attach(a, thrallina, '20000000-0000-4000-8000-000000000002') <> 'ok' then raise exception 'replace refused'; end if;
  if pg_temp.label_of(thrallina) <> '20000000-0000-4000-8000-000000000002' or pg_temp.planned() <> 'AltShar1' then raise exception 'not replaced'; end if;
  if (select count(*) from public.build_characters where link_id is not null) <> 1 then raise exception 'old label still attached'; end if;

  if pg_temp.attach(a, rokhan, '20000000-0000-4000-8000-000000000002') <> 'ok' then raise exception 'move refused'; end if;
  if pg_temp.label_of(thrallina) is not null or pg_temp.planned() <> '' then raise exception 'label left on the old link'; end if;
  if pg_temp.planned('rokhan') <> 'AltShar1' then raise exception 'label did not move'; end if;

  if pg_temp.attach(a, rokhan, null) <> 'ok' or pg_temp.label_of(rokhan) is not null then raise exception 'not taken off'; end if;
end $$;

-- Unlinking keeps the label and its builds; deleting the label keeps the link.
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000000a1';
  label constant uuid := '20000000-0000-4000-8000-000000000001';
begin
  perform pg_temp.attach(a::text, '10000000-0000-4000-8000-000000000001', label::text);
  if not public.unlink_character(a, '10000000-0000-4000-8000-000000000001') then raise exception 'unlink failed'; end if;
  if (select link_id from public.build_characters where id = label) is not null then raise exception 'label still points at the link'; end if;
  if (select count(*) from public.saved_builds where character_id = label) <> 4 then raise exception 'builds lost on unlink'; end if;

  perform pg_temp.attach(a::text, '10000000-0000-4000-8000-000000000002', label::text);
  if not public.delete_build_character(a, label) then raise exception 'label delete failed'; end if;
  if not exists (select 1 from public.character_links where id = '10000000-0000-4000-8000-000000000002') then raise exception 'link lost with the label'; end if;
  if pg_temp.planned('rokhan') <> '' then raise exception 'deleted label still shows'; end if;
end $$;

rollback;
