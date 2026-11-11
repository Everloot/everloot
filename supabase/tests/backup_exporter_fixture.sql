-- Minimal disposable schema for the backup migration, never a production setup.
create role anon;
create role authenticated;
create role service_role bypassrls;
revoke create on schema public from public;
do $$
declare t text;
begin
  foreach t in array array[
    'character_facts', 'character_sync_consent', 'character_track',
    'armory_characters', 'armory_guilds', 'armory_hides', 'armory_members',
    'armory_queue', 'players', 'link_codes', 'settled_fact_voters', 'backup_fixture'
  ] loop
    execute format('create table public.%I (id integer primary key)', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('insert into public.%I values (1)', t);
  end loop;
end $$;
