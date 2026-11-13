-- Read-only backup role for the nightly logical dump.
--
-- Why this exists: from 2026-11-07 the dump went INCOMPLETE because
-- character_facts, character_sync_consent and character_track (and, from
-- 2026-11-10, the five armory_* tables) are closed to service_role on purpose.
-- PostgREST still lists them, the backup key is service_role, and the count
-- request returns HTTP 403 / 42501. Granting SELECT to service_role would
-- satisfy the error hint and would also fail the closed-role tests in
-- 20261106120000_private_sync.sql, 20261107150000_profile_pipeline.sql and
-- 20261109120000_armory.sql, and would widen the application's secret key.
--
-- This migration does not open service_role. It adds a dedicated role,
-- backup_exporter, with SELECT only. service_role stays revoked. Apply this
-- in production only after Carlos approves; this file is safe to run twice
-- and does not create a password or a LOGIN.
--
-- NOLOGIN / BYPASSRLS:
--   * The role is NOLOGIN here so a credential is never in the repo. Carlos
--     later enables LOGIN (or creates a separate login role that inherits
--     this one) and stores the URL in a private credential file outside git.
--     See the ops steps in the PR body.
--   * The role is NOBYPASSRLS. BYPASSRLS would let a later accidental GRANT
--     on any RLS-protected table become a full read. Instead each table this
--     role may read gets an explicit policy: FOR SELECT TO backup_exporter
--     USING (true). A new table stays closed until a follow-up migration
--     adds GRANT SELECT and that policy.
--
-- Privacy exclusions, never granted here (the dump already skips them):
--   players, link_codes, settled_fact_voters.
-- Retention exclusions, never granted either: blizzard_auction_houses and blizzard_auction_prices (Blizzard's
-- terms allow nothing older than 30 days; a backup lives longer).
--
-- Needs the public tables to already exist. Safe to apply twice.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'backup_exporter') then
    create role backup_exporter;
  end if;
end $$;

alter role backup_exporter nocreatedb nocreaterole noreplication;
alter role backup_exporter nologin;
alter role backup_exporter nobypassrls;

do $$
begin
  execute format('revoke all on database %I from backup_exporter', current_database());
  execute format('grant connect on database %I to backup_exporter', current_database());
end $$;
grant usage on schema public to backup_exporter;

-- SELECT + a read-all policy on every ordinary public table except the
-- intentional privacy exclusions. Closed tables are included. Default
-- privileges are left unset so a new table is closed until we say otherwise.
do $$
declare
  r record;
  -- The Blizzard auction tables may hold nothing past 30 days, which a backup would outlive (20261113120000).
  excluded constant text[] := array['players', 'link_codes', 'settled_fact_voters', 'blizzard_auction_houses', 'blizzard_auction_prices'];
  backup_policy_name constant text := 'backup_exporter_select';
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname <> all (excluded)
    order by 1, 2
  loop
    execute format('grant select on %I.%I to backup_exporter', r.nspname, r.relname);
    execute format('revoke insert, update, delete, truncate, references, trigger on %I.%I from backup_exporter', r.nspname, r.relname);
    if not exists (
      select 1 from pg_policy p
      where p.polrelid = format('%I.%I', r.nspname, r.relname)::regclass
        and p.polname = backup_policy_name
    ) then
      execute format(
        'create policy %I on %I.%I for select to backup_exporter using (true)',
        backup_policy_name, r.nspname, r.relname
      );
    end if;
  end loop;
end $$;

-- Re-assert the closed invariant the earlier migrations already set.
revoke all on public.character_facts from public, anon, authenticated, service_role;
revoke all on public.character_sync_consent from public, anon, authenticated, service_role;
revoke all on public.character_track from public, anon, authenticated, service_role;
revoke all on public.armory_characters from public, anon, authenticated, service_role;
revoke all on public.armory_guilds from public, anon, authenticated, service_role;
revoke all on public.armory_hides from public, anon, authenticated, service_role;
revoke all on public.armory_members from public, anon, authenticated, service_role;
revoke all on public.armory_queue from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- Readback (every row t), after apply. Do not run against a role other than
-- the owner / a superuser.
--   select 'role exists' as check, exists (select 1 from pg_roles where rolname = 'backup_exporter') as ok
--   union all select 'nologin', not exists (select 1 from pg_roles where rolname = 'backup_exporter' and rolcanlogin)
--   union all select 'nobypassrls', not exists (select 1 from pg_roles where rolname = 'backup_exporter' and rolbypassrls)
--   union all select 'facts service_role closed',
--     not has_table_privilege('service_role', 'public.character_facts', 'SELECT,INSERT,UPDATE,DELETE')
--   union all select 'facts backup select only',
--     has_table_privilege('backup_exporter', 'public.character_facts', 'SELECT')
--     and not has_table_privilege('backup_exporter', 'public.character_facts', 'INSERT,UPDATE,DELETE')
--   union all select 'consent service_role closed',
--     not has_table_privilege('service_role', 'public.character_sync_consent', 'SELECT,INSERT,UPDATE,DELETE')
--   union all select 'track service_role closed',
--     not has_table_privilege('service_role', 'public.character_track', 'SELECT,INSERT,UPDATE,DELETE')
--   union all select 'armory hides service_role closed',
--     not has_table_privilege('service_role', 'public.armory_hides', 'SELECT,INSERT,UPDATE,DELETE')
--   union all select 'players still excluded',
--     not has_table_privilege('backup_exporter', 'public.players', 'SELECT');
-- Rollback (run by hand; does not drop any table):
--   do $$
--   declare r record;
--   begin
--     for r in select n.nspname, c.relname from pg_class c
--       join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'r' loop
--       if exists (select 1 from pg_policy p where p.polrelid = format('%I.%I', r.nspname, r.relname)::regclass
--                  and p.polname = 'backup_exporter_select') then
--         execute format('drop policy backup_exporter_select on %I.%I', r.nspname, r.relname);
--       end if;
--       execute format('revoke all on %I.%I from backup_exporter', r.nspname, r.relname);
--     end loop;
--   end $$;
--   revoke all on schema public from backup_exporter;
--   revoke connect on database postgres from backup_exporter;
--   drop role if exists backup_exporter;
--   notify pgrst, 'reload schema';
