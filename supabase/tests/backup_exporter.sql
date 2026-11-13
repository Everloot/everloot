-- Run after every migration, including 20261110180000_backup_exporter_role.sql,
-- on a disposable local PostgreSQL database that has the roles anon,
-- authenticated and service_role. Everything is rolled back at the end.
begin;

do $$
declare
  r record;
  closed constant text[] := array[
    'character_facts', 'character_sync_consent', 'character_track',
    'armory_characters', 'armory_guilds', 'armory_hides', 'armory_members', 'armory_queue'
  ];
  -- Blizzard auction prices: backups outlive the 30 days Blizzard's terms allow (20261113120000_blizzard_auctions.sql).
  excluded constant text[] := array['players', 'link_codes', 'settled_fact_voters', 'blizzard_auction_houses', 'blizzard_auction_prices'];
  tbl text;
  role_name text;
begin
  if not exists (select 1 from pg_roles where rolname = 'backup_exporter') then
    raise exception 'backup_exporter role is missing';
  end if;
  if exists (select 1 from pg_roles where rolname = 'backup_exporter' and rolcanlogin) then
    raise exception 'backup_exporter must be NOLOGIN in the migration';
  end if;
  if exists (select 1 from pg_roles where rolname = 'backup_exporter' and rolbypassrls) then
    raise exception 'backup_exporter must be NOBYPASSRLS';
  end if;

  if exists (select 1 from pg_roles where rolname = 'backup_exporter'
      and (rolsuper or rolcreatedb or rolcreaterole or rolreplication)) then
    raise exception 'backup_exporter has administrative privileges';
  end if;
  if exists (select 1 from pg_auth_members
      where member = 'backup_exporter'::regrole or roleid = 'backup_exporter'::regrole) then
    raise exception 'backup_exporter must be isolated from application and owner roles';
  end if;
  if has_schema_privilege('backup_exporter', 'public', 'CREATE')
      or has_database_privilege('backup_exporter', current_database(), 'CREATE') then
    raise exception 'backup_exporter can create persistent objects';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and has_function_privilege('backup_exporter', p.oid, 'EXECUTE')) then
    raise exception 'backup_exporter can execute a public SECURITY DEFINER function';
  end if;

  foreach tbl in array closed loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if has_table_privilege(role_name, 'public.' || tbl, 'SELECT,INSERT,UPDATE,DELETE') then
        raise exception '% can touch %', role_name, tbl;
      end if;
    end loop;
    if not has_table_privilege('backup_exporter', 'public.' || tbl, 'SELECT') then
      raise exception 'backup_exporter cannot select %', tbl;
    end if;
    if has_table_privilege('backup_exporter', 'public.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'backup_exporter can write %', tbl;
    end if;
  end loop;

  foreach tbl in array excluded loop
    if to_regclass('public.' || tbl) is null then continue; end if;
    if has_table_privilege('backup_exporter', 'public.' || tbl, 'SELECT') then
      raise exception 'backup_exporter should not be able to select excluded table %', tbl;
    end if;
  end loop;

  -- Ordinary exported tables also get SELECT-only (so a later all-Postgres
  -- dump path does not need a second grant wave). Skip views.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname <> all (closed) and c.relname <> all (excluded)
  loop
    if not has_table_privilege('backup_exporter', 'public.' || r.relname, 'SELECT') then
      raise exception 'backup_exporter cannot select ordinary table %', r.relname;
    end if;
    if has_table_privilege('backup_exporter', 'public.' || r.relname, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'backup_exporter can write ordinary table %', r.relname;
    end if;
  end loop;
end $$;

rollback;
