begin;
set local role backup_exporter;
do $$
declare t text; n integer;
begin
  foreach t in array array[
    'character_facts', 'character_sync_consent', 'character_track',
    'armory_characters', 'armory_guilds', 'armory_hides', 'armory_members',
    'armory_queue', 'backup_fixture'
  ] loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 1 then raise exception 'RLS hid backup rows in %', t; end if;
    begin
      execute format('insert into public.%I values (2)', t);
      raise exception 'backup role inserted into %', t;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('truncate public.%I', t);
      raise exception 'backup role truncated %', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    create table public.backup_ddl_probe (id integer);
    raise exception 'backup role created a persistent table';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
