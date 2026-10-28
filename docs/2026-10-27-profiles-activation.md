# Profiles: migration and activation

Profiles (a handle, a display name, a status, a main character and an opt-in public page at `/u/<handle>`) need one
additive migration, `supabase/migrations/20261021170000_account_profiles.sql`, and then `EVERLOOT_PROFILES=1`.
They work with the legacy Battle.net sign-in: `EVERLOOT_AUTH_V2` and the accounts v2 migration are not needed and
stay as they are. Profiles do not turn on build saving; `EVERLOOT_SAVED_BUILDS` is a separate switch with its own
rollout, and either can be turned on or off without the other. Design: `docs/design/specs/2026-10-20-account-shell-design.md`.

## The two switches

| `EVERLOOT_PROFILES` | `EVERLOOT_SAVED_BUILDS` | What players get |
|---|---|---|
| off | off | `/` is the landing page for everyone. `/home`, `/settings`, `/u/<handle>` and the profile routes under `/api/me` answer 404. |
| off | on | Saved builds without profiles. The profile pages and routes still answer 404. |
| on | off | A signed-in `/` is the home. `/settings` edits the handle, display name, status, what a public profile shows, and the main character. A public profile shows the ticked characters and status. The home, settings, public profiles and the account menu show no build list, build link or `/me` link, and characters cannot be added, since character labels belong to saved builds. |
| on | on | As above, and the home, settings and public profiles add the builds and character pages. |

Only a strict `1` turns a switch on. With the legacy sign-in, the account switcher shows the current account only.

## What the migration adds

One table, `user_profiles` (one row per account, made on its first save), and six functions: `save_profile`,
`set_status`, `set_main_character`, `set_active_character`, `public_profile`, and `take_handle_change`, which only
`save_profile` calls. RLS is on with no policies and nothing for `anon` or `authenticated`. The service role may
`select` the table and execute the five site functions; every write goes through them. A row belongs to
`public.users(id)` and goes when that user is deleted. Nothing existing is altered.

It needs `public.users` (the legacy table is enough), `public.build_characters` and `public.saved_builds` from
`20261021150000_saved_builds.sql`, and `public.intake_quota_buckets` with its columns in the order
`bucket, count, reset_at`: `take_handle_change` inserts into it by position to count handle changes (5 a day). With
the columns in another order the migration still applies and the first handle change fails, so the preflight
checks the order. The saved-builds file is already applied in production: never run it again.

Supabase stops granting new tables to `anon`, `authenticated` and `service_role` by default on 2026-10-30
(https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically);
tables that already exist keep their grants. The migration grants the service role exactly what the site uses, so
it works the same before and after that date.

## What a public profile shows

Only what its owner ticked: characters (name, class, realm, which one is the main), shared builds (name, class,
date, short link) while saved builds are on, and a status that has not cleared. Never the BattleTag, the email, the
account or character ids, a character's note or a build that is not shared. A private profile and a handle nobody
has are the same 404 with `noindex`, and the page is rendered on every request, so turning a profile off takes it
down at once. Your profile in the avatar menu opens `/u/<handle>` only while the profile is public, and Settings
otherwise. A public profile is indexable with the canonical `/u/<handle>` and is not in the sitemap; this rollout
does not change that.

The signed-in home that `/` becomes is rendered per request with `noindex`, and the middleware adds no caching of
its own. The header checks below, with a made-up cookie on a preview and with a real session in the production
acceptance, confirm that the response is `private, no-store`, so one player's home is not stored and served to
another visitor.

## Test locally

Against a disposable local Postgres only. The script refuses any host but `localhost` or `127.0.0.1` and any
database but `account_profiles_legacy_test`, checks the server's database name, and then drops the `public` schema.

```
docker run -d --name profiles-legacy-test -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54405:5432 postgres:17
docker exec profiles-legacy-test createdb -U postgres account_profiles_legacy_test
cd web
QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54405/account_profiles_legacy_test node scripts/account-profiles-legacy.integration.mjs
npx vitest run src/middleware.test.ts src/app/home/home.test.tsx src/app/settings/settings.test.tsx "src/app/u/[handle]/public-profile.test.tsx" src/components/account-menu.test.tsx
```

The script builds the schema production has (the legacy users table without accounts v2, players, the #450
saved-builds file once, the Chat workspace, realm keys and guilds), then runs the preflight, apply, postflight and
rollback below exactly as written here: once with Supabase's old default grants and once with none. It checks
legacy accounts editing their profile, status and main and active character through the same columns and named
arguments the site sends; private, unknown and malformed handles; each public toggle; that no BattleTag, Battle.net
id, account or character id, note or unshared build reaches the public read; the handle limit and a handle race;
that a held lock makes the apply fail with nothing changed; that the preflight catches accounts v2, a missing
column, the shared_build from before #450, quota columns out of order, leftover handle counters, an existing
`user_profiles`, a function name collision and a missing grant; that the postflight catches a profile function left
without its settings; and that apply and rollback leave every other function, grant and table as it was. `scripts/account-profiles.integration.mjs` covers the same functions with
every migration applied.

## Preflight (read-only)

In the Supabase SQL editor. Every row must be `t`; anything else (`f`, NULL or an error) means stop.

```sql
-- preflight
select check_name, ok from (values
  ('users is the Battle.net table, without accounts v2 columns',
    (select coalesce(string_agg(attname, ',' order by attname), '') = 'battletag,bnet_id,created_at,id,updated_at'
       from pg_attribute where attrelid = to_regclass('public.users') and attnum > 0 and not attisdropped)),
  ('users.id is the uuid primary key',
    exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = to_regclass('public.users') and i.indisprimary and i.indnkeyatts = 1
        and a.attname = 'id' and a.atttypid = 'uuid'::regtype)),
  ('build_characters and saved_builds have the 13 columns profiles read',
    (select count(*) = 13 from pg_attribute where attnum > 0 and not attisdropped and (
      (attrelid = to_regclass('public.build_characters') and attname in ('id', 'user_id', 'name', 'class_slug', 'realm', 'note'))
      or (attrelid = to_regclass('public.saved_builds')
        and attname in ('id', 'user_id', 'slug', 'name', 'class_slug', 'shared', 'updated_at'))))),
  ('shared_build is the #450 version, with no Battle.net owner name',
    coalesce((select prosrc like '%to_jsonb(u) ->> ''bnet_id'' is null%'
      from pg_proc where oid = to_regprocedure('public.shared_build(text)')), false)),
  ('intake_quota_buckets is bucket, count, reset_at in that order, keyed by bucket',
    (select coalesce(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum), '')
       = 'bucket text, count integer, reset_at timestamp with time zone'
       from pg_attribute where attrelid = to_regclass('public.intake_quota_buckets') and attnum > 0 and not attisdropped)
    and exists (select 1 from pg_index where indrelid = to_regclass('public.intake_quota_buckets')
      and indisprimary and indnkeyatts = 1 and indkey[0] = 1)),
  ('no handle counters from an earlier attempt',
    not exists (select 1 from public.intake_quota_buckets where bucket like 'handle:%')),
  ('user_profiles does not exist yet',
    to_regclass('public.user_profiles') is null and to_regtype('public.user_profiles') is null),
  ('no function has any of the six names',
    not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('take_handle_change', 'save_profile', 'set_status', 'set_main_character', 'set_active_character', 'public_profile'))),
  ('anon, authenticated and service_role exist, and service_role uses public',
    (select count(*) = 3 from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
    and has_schema_privilege('service_role', 'public', 'usage')),
  ('service_role reads users, sessions and build_characters',
    coalesce(has_table_privilege('service_role', to_regclass('public.users'), 'select')
      and has_table_privilege('service_role', to_regclass('public.sessions'), 'select')
      and has_table_privilege('service_role', to_regclass('public.build_characters'), 'select'), false)),
  ('this session may create in public', has_schema_privilege(current_user, 'public', 'create'))
) as checks(check_name, ok);
```

If only the `shared_build` row is `f`, compare that function with the file in main; do not run the saved-builds
migration again.

## Apply (maintainer only, after review)

Back up as usual. In the SQL editor, paste the migration file unchanged between these lines and run it once. The
bounded lock wait matters: the new table's foreign key briefly locks `users` against writes, and a sign-in in
progress holds a conflicting lock. If it stops with an error, nothing was applied: run `rollback;`, run the
preflight again and retry later.

```sql
-- apply
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- paste supabase/migrations/20261021170000_account_profiles.sql here, unchanged
commit;
```

## Postflight (read-only)

Every row must be `t`. Anything else (`f`, NULL or an error) means stop: leave `EVERLOOT_PROFILES` off and find out
why; the rollback below removes the migration.

```sql
-- postflight
select check_name, ok from (values
  ('user_profiles has the migration''s columns',
    (select string_agg(attname, ',' order by attnum) = 'user_id,handle,display_name,status_emoji,status_text,'
       || 'status_clears_at,public_profile,show_characters,show_builds,show_status,main_character_id,'
       || 'active_character_id,created_at,updated_at'
       from pg_attribute where attrelid = 'public.user_profiles'::regclass and attnum > 0 and not attisdropped)),
  ('row level security is on, with no policies',
    (select relrowsecurity from pg_class where oid = 'public.user_profiles'::regclass)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles')),
  ('anon and authenticated have nothing on user_profiles',
    not has_table_privilege('anon', 'public.user_profiles', 'select, insert, update, delete, truncate, references, trigger')
    and not has_table_privilege('authenticated', 'public.user_profiles', 'select, insert, update, delete, truncate, references, trigger')),
  ('service_role reads user_profiles and writes it only through the functions',
    has_table_privilege('service_role', 'public.user_profiles', 'select')
    and not has_table_privilege('service_role', 'public.user_profiles', 'insert, update, delete, truncate, references, trigger')),
  ('the six functions, one signature each',
    (select count(*) = 6 from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('take_handle_change', 'save_profile', 'set_status', 'set_main_character', 'set_active_character', 'public_profile'))
    and to_regprocedure('public.take_handle_change(uuid)') is not null
    and to_regprocedure('public.save_profile(uuid, text, text, boolean, boolean, boolean, boolean)') is not null
    and to_regprocedure('public.set_status(uuid, text, text, timestamptz)') is not null
    and to_regprocedure('public.set_main_character(uuid, uuid)') is not null
    and to_regprocedure('public.set_active_character(uuid, uuid)') is not null
    and to_regprocedure('public.public_profile(text)') is not null),
  ('each runs as its owner with an empty search_path',
    (select count(*) = 6 and bool_and(prosecdef and coalesce('search_path=""' = any(proconfig), false)) from pg_proc
      where pronamespace = 'public'::regnamespace and proname in
        ('take_handle_change', 'save_profile', 'set_status', 'set_main_character', 'set_active_character', 'public_profile'))),
  ('only service_role may call the five site functions',
    (select bool_and(has_function_privilege('service_role', oid, 'execute')
       and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute')
       and not has_function_privilege('public', oid, 'execute'))
       from pg_proc where pronamespace = 'public'::regnamespace and proname in
         ('save_profile', 'set_status', 'set_main_character', 'set_active_character', 'public_profile'))),
  ('nobody may call take_handle_change directly',
    not has_function_privilege('service_role', 'public.take_handle_change(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.take_handle_change(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.take_handle_change(uuid)', 'execute')
    and not has_function_privilege('public', 'public.take_handle_change(uuid)', 'execute')),
  ('the public read returns handle, display name, status, characters and builds only',
    (select array_to_string(proargnames, ',') from pg_proc where oid = to_regprocedure('public.public_profile(text)'))
      = 'p_handle,handle,display_name,status_emoji,status_text,characters,builds')
) as checks(check_name, ok);
```

## Preview checks (no sign-in)

A preview deployment cannot sign anyone in at its own address. `siteUrl()` is `NEXT_PUBLIC_SITE_URL` or
`https://everloot.app` (`web/src/lib/supabase/server.ts`); Battle.net returns to that site's callback
(`BNET_REDIRECT_URI` or `<siteUrl>/api/auth/bnet/callback`), which sets the session there; and every profile write
needs `Origin` to equal `siteUrl()` (`profileAccount` in `web/src/lib/account-shell.ts`). Do not change the site URL,
the redirect or the origin check, copy a session cookie, or make a session to get past this. With only
`EVERLOOT_PROFILES=1` on one preview deployment, check what needs no account:

- `/` without cookies is the landing page. With an `everloot_session` cookie of 64 made-up hex characters, which
  matches no session (as a stale cookie would), it is still the landing page, answers
  `cache-control: private, no-cache, no-store, max-age=0, must-revalidate` and never `x-vercel-cache: HIT`; a request
  without cookies afterwards still gets the landing page.
- `/home` without a session redirects to `/`, and `/settings` to `/sign-in?returnTo=%2Fsettings`.
- `/u/<a handle nobody has>` is a 404 with `noindex, nofollow`.
- `GET /api/me/shell` answers 401. `POST /api/me/profile` with the preview's own `Origin` is refused with 403
  `Invalid origin` before any sign-in check or database call.

## Production acceptance (signed in)

Change only `EVERLOOT_PROFILES`. Keep `EVERLOOT_SAVED_BUILDS` and `EVERLOOT_AUTH_V2` as they are, along with every
other switch.

1. Only once the preflight and the postflight read `t` in every row, set `EVERLOOT_PROFILES=1` in Production and
   redeploy main. Unsetting it and redeploying undoes this step.
2. On `https://everloot.app`, sign in with a disposable Battle.net test account, never a real player's or the
   owner's, and do not make anyone else's profile public or pick a handle for them. Without such an account the
   signed-in acceptance has not happened: record it as open, not passed.
   - Signed in, `/` is the home, and with that session it answers
     `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`, never `x-vercel-cache: HIT`. In a
     private window `/` is the landing page.
   - In `/settings`, save a handle that is plainly a test, a display name and a status that clears in 30 minutes.
     Each saves and shows again after a reload. Without saved builds no character can be added, so the main
     character stays none unless the account already has character labels.
   - With the profile private, `/u/<handle>` is a 404 with `noindex, nofollow`, like `/u/<a handle nobody has>`, and
     Your profile in the avatar menu opens Settings.
   - Make it public with only Status ticked: the page shows the display name, `@handle` and the status, with no
     characters or builds. Its source holds no BattleTag, email or account id. Turn it private: 404 at once.
   - Clear the status and save an empty handle, so the test leaves nothing public.
3. Run the postflight again, then check the test account only (counts and flags, no other player's data):

```sql
select handle is null as no_handle, not public_profile as not_public, status_text is null as no_status
from public.user_profiles where user_id = '<test user id>';
```

## Rollback

Unset `EVERLOOT_PROFILES` and redeploy: `/` is the landing page for everyone again, and the profile pages and
routes answer 404 at once. Stored profiles stay. The SQL below deletes every handle, status and profile setting;
run it only on purpose, after the switch is off.

```sql
-- rollback
begin;
set local lock_timeout = '5s';
drop function if exists public.public_profile(text);
drop function if exists public.set_active_character(uuid, uuid);
drop function if exists public.set_main_character(uuid, uuid);
drop function if exists public.set_status(uuid, text, text, timestamptz);
drop function if exists public.save_profile(uuid, text, text, boolean, boolean, boolean, boolean);
drop function if exists public.take_handle_change(uuid);
drop table if exists public.user_profiles;
delete from public.intake_quota_buckets where bucket like 'handle:%';
notify pgrst, 'reload schema';
commit;
```
