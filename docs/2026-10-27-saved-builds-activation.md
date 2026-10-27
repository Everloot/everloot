# Saved builds: activation

Saved builds (Save and My builds in the talent calculator, `/me`, short links at `/b/<slug>`, and `my_builds` for a
key that reads its owner's builds) need no migration for this rollout. `supabase/migrations/20261021150000_saved_builds.sql`,
in its #450 version, is already applied in production: it went in ahead of the Chat workspace, whose private builds
live in its tables. Turning the feature on is one switch: `EVERLOOT_SAVED_BUILDS=1`. It works with the
legacy Battle.net sign-in, so `EVERLOOT_AUTH_V2` and the accounts v2 migration stay as they are, and it does not need
profiles: `EVERLOOT_PROFILES` is its own switch (`docs/2026-10-27-profiles-activation.md` has the table of both).
Design: `docs/design/specs/2026-10-20-saved-builds-design.md`.

Never run the saved-builds file again, and never the rollback in its closing comment. Running the file again replaces
`create_api_key` and the `api_key_usage` surface check under a lock, for nothing. The commented rollback deletes every
saved build and character label, including the builds Chat entries point to, and rewrites every key's scopes.

## What the switch turns on

- In the calculator: Save, which files the build under a name, a character label and notes, with the short link on
  by default; Save as new; My builds; and, signed out, a prompt to sign in that comes back to the same plan.
- `/me` and `/me/characters/<id>`, `/b/<slug>`, and the routes under `/api/me/builds` and `/api/me/characters`. With
  the switch off they all answer 404.
- `my_builds` in the MCP tool list and at `/api/tools/my_builds`, only for a key made with "Read my saved builds".
  The keyless list stays the protocol's tools: 31, with guilds on. MCP directories copied that list, and it does not
  change.
- With profiles on, the home, settings and public profiles add builds and character labels. A public profile lists
  its owner's shared builds when they tick builds in settings.
- Builds made in Chat while the switch was off belong to their owners like any other: they show in My builds and on
  `/me`, still private.

A shared build's short link shows its name and notes, its class and split, the game build it was made on, and both
talent sets in the calculator, read-only; a signed-in visitor can save a copy to their own account. The owner's name
shows only when they chose it, and never for a Battle.net account, whose name can hold a BattleTag. The character
label, the BattleTag, the email and every id stay off the page. A build that is not shared, or was deleted, is the
same 404 with `noindex`.

Nothing is created in the database, so Supabase's change to default grants for new tables on 2026-10-30 does not touch
this rollout.

## Test locally

Against a disposable local Postgres only. The script refuses any host but `localhost` or `127.0.0.1` and any
database but `saved_builds_legacy_test`, checks the server's database name, and then drops the `public` schema.

```
docker run -d --name saved-builds-legacy-test -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54406:5432 postgres:17
docker exec saved-builds-legacy-test createdb -U postgres saved_builds_legacy_test
cd web
QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54406/saved_builds_legacy_test node scripts/saved-builds-legacy.integration.mjs
npx vitest run src/components/talents/save-build.test.tsx src/lib/saved-builds.test.ts src/app/api/me/builds/route.test.ts src/app/mcp/public/route.test.ts "src/app/b/[slug]/shared-build.test.tsx"
docker rm -f saved-builds-legacy-test
```

The script builds the schema production has: the legacy users table without accounts v2, players, the #450
saved-builds file once, the Chat workspace, realm keys, guilds and profiles. It runs the schema checks and the
private-builds check below exactly as written here, in a read-only transaction, and shows each schema check catching
the condition it names: accounts v2 columns, a changed column, a lost key or index, row security off or a policy, a
grant to a browser role or a write grant to the service role, a second function of the same name, the four-argument
`create_api_key`, settings reset on a function, a body that is not the file's, `take_build_save` callable, quota
columns out of order, a surface check without `builds`, a lost service-role read. Then, as legacy Battle.net accounts
and through the site's own calls (named arguments, the columns the site reads): save, update, copy, reopen, unshare
and delete; another account refused everywhere; a refused or malformed save writing nothing and costing no save; the
200-build, 30-label and 300-saves-a-day limits; keys with and without `read:own`; Chat's private builds kept private;
what the public read and the profile read leave out; and an account's deletion taking its builds. It also keeps
#450's check that the saved-builds file applies twice on the legacy users table, in a transaction it rolls back.
`scripts/saved-builds.integration.mjs` covers the same functions with every migration applied. The vitest files cover
the calculator's Save, the routes, the MCP list and the short link page.

## Preflight (read-only)

In the Supabase SQL editor, against production, before the switch. Every row must be `t`; anything else (`f`, NULL or
an error) means stop and leave the switch off.

```sql
-- schema checks
select check_name, ok from (values
  ('users is the Battle.net table, without accounts v2 columns',
    (select coalesce(string_agg(attname, ',' order by attname), '') = 'battletag,bnet_id,created_at,id,updated_at'
       from pg_attribute where attrelid = to_regclass('public.users') and attnum > 0 and not attisdropped)),
  ('build_characters has the file''s columns',
    (select coalesce(string_agg(attname || ' ' || format_type(atttypid, atttypmod) || case when attnotnull then ' not null' else '' end,
       ', ' order by attnum), '') = 'id uuid not null, user_id uuid not null, name text not null, class_slug text not null, '
       || 'realm text, note text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null'
       from pg_attribute where attrelid = to_regclass('public.build_characters') and attnum > 0 and not attisdropped)),
  ('saved_builds has the file''s columns',
    (select coalesce(string_agg(attname || ' ' || format_type(atttypid, atttypmod) || case when attnotnull then ' not null' else '' end,
       ', ' order by attnum), '') = 'id uuid not null, user_id uuid not null, character_id uuid, slug text not null, '
       || 'name text not null, notes text, class_slug text not null, code text not null, code2 text, game_build text not null, '
       || 'shared boolean not null, show_name boolean not null, active boolean not null, '
       || 'created_at timestamp with time zone not null, updated_at timestamp with time zone not null'
       from pg_attribute where attrelid = to_regclass('public.saved_builds') and attnum > 0 and not attisdropped)),
  ('rows go with their account, and a build loses only its label when the label goes',
    (select count(*) = 3 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and cardinality(c.conkey) = 1 and (
        (c.conrelid = to_regclass('public.build_characters') and a.attname = 'user_id'
          and c.confrelid = to_regclass('public.users') and c.confdeltype = 'c')
        or (c.conrelid = to_regclass('public.saved_builds') and a.attname = 'user_id'
          and c.confrelid = to_regclass('public.users') and c.confdeltype = 'c')
        or (c.conrelid = to_regclass('public.saved_builds') and a.attname = 'character_id'
          and c.confrelid = to_regclass('public.build_characters') and c.confdeltype = 'n')))),
  ('a slug names one build, and a label has at most one active build',
    exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = to_regclass('public.saved_builds') and i.indisunique and i.indnkeyatts = 1
        and i.indpred is null and a.attname = 'slug')
    and exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = to_regclass('public.saved_builds') and i.indisunique and i.indnkeyatts = 1
        and a.attname = 'character_id' and pg_get_expr(i.indpred, i.indrelid) = 'active')),
  ('row level security is on for both tables, with no policies',
    coalesce((select count(*) = 2 and bool_and(relrowsecurity) from pg_class
      where oid in (to_regclass('public.build_characters'), to_regclass('public.saved_builds'))), false)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('build_characters', 'saved_builds'))),
  ('anon and authenticated have nothing on either table, or on any of its columns',
    (select bool_and(t.rel is not null
       and not has_table_privilege(r.role, t.rel, 'select, insert, update, delete, truncate, references, trigger')
       and not has_any_column_privilege(r.role, t.rel, 'select, insert, update, references'))
       from (values ('anon'), ('authenticated')) as r(role),
         (values (to_regclass('public.build_characters')), (to_regclass('public.saved_builds'))) as t(rel))),
  ('service_role reads both tables and writes them only through the functions',
    (select bool_and(t.rel is not null and has_table_privilege('service_role', t.rel, 'select')
       and not has_table_privilege('service_role', t.rel, 'insert, update, delete, truncate, references, trigger')
       and not has_any_column_privilege('service_role', t.rel, 'insert, update, references'))
       from (values (to_regclass('public.build_characters')), (to_regclass('public.saved_builds'))) as t(rel))),
  ('the seven saved-builds functions, one signature each',
    (select count(*) = 7 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('take_build_save',
      'save_build', 'delete_build', 'save_build_character', 'delete_build_character', 'shared_build', 'own_builds_for_key'))
    and to_regprocedure('public.take_build_save(uuid)') is not null
    and to_regprocedure('public.save_build(uuid, uuid, text, uuid, text, text, text, text, boolean, boolean, boolean)') is not null
    and to_regprocedure('public.delete_build(uuid, uuid)') is not null
    and to_regprocedure('public.save_build_character(uuid, uuid, text, text, text, text)') is not null
    and to_regprocedure('public.delete_build_character(uuid, uuid)') is not null
    and to_regprocedure('public.shared_build(text)') is not null
    and to_regprocedure('public.own_builds_for_key(text, boolean)') is not null),
  ('create_api_key is the saved-builds version, with scopes, and the only one',
    (select count(*) = 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_api_key')
    and to_regprocedure('public.create_api_key(uuid, text, text, text, text[])') is not null),
  ('each takes the named arguments the site sends',
    (select string_agg(proname || '(' || array_to_string(proargnames, ',') || ')', ' ' order by proname) from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('take_build_save', 'save_build', 'delete_build',
        'save_build_character', 'delete_build_character', 'shared_build', 'own_builds_for_key', 'create_api_key'))
      = 'create_api_key(p_user_id,p_token_hash,p_hint,p_label,p_scopes,key_ref,refusal) delete_build(p_user_id,p_id) '
      || 'delete_build_character(p_user_id,p_id) own_builds_for_key(p_token_hash,p_count,refusal,retry_after,characters,builds) '
      || 'save_build(p_user_id,p_id,p_slug,p_character_id,p_name,p_notes,p_code,p_code2,p_shared,p_active,p_show_name,'
      || 'build_ref,build_slug,refusal) save_build_character(p_user_id,p_id,p_name,p_class_slug,p_realm,p_note,character_ref,'
      || 'refusal) shared_build(p_slug,name,notes,class_slug,code,code2,game_build,character_name,character_class,owner_name,'
      || 'updated_at) take_build_save(p_user_id)'),
  ('each runs as its owner with an empty search_path and a 3 s lock wait',
    (select count(*) = 8 and bool_and(prosecdef and coalesce('search_path=""' = any(proconfig), false)
       and coalesce('lock_timeout=3s' = any(proconfig), false)) from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('take_build_save', 'save_build', 'delete_build',
        'save_build_character', 'delete_build_character', 'shared_build', 'own_builds_for_key', 'create_api_key'))),
  ('their bodies are the #450 file''s, word for word',
    (select md5(string_agg(proname || ':' || regexp_replace(prosrc, '\s+', ' ', 'g'), '|' order by proname)) from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('take_build_save', 'save_build', 'delete_build',
        'save_build_character', 'delete_build_character', 'shared_build', 'own_builds_for_key', 'create_api_key'))
      = '42990b7d5081045a91d2ca5f36e240b7'),
  ('shared_build is the #450 version, with no Battle.net owner name',
    coalesce((select prosrc like '%to_jsonb(u) ->> ''bnet_id'' is null%'
      from pg_proc where oid = to_regprocedure('public.shared_build(text)')), false)),
  ('only service_role may call the six site functions and create_api_key',
    (select count(*) = 7 and bool_and(has_function_privilege('service_role', oid, 'execute')
       and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute')
       and not has_function_privilege('public', oid, 'execute'))
       from pg_proc where pronamespace = 'public'::regnamespace and proname in ('save_build', 'delete_build',
         'save_build_character', 'delete_build_character', 'shared_build', 'own_builds_for_key', 'create_api_key'))),
  ('nobody may call take_build_save directly',
    coalesce(not has_function_privilege('service_role', to_regprocedure('public.take_build_save(uuid)'), 'execute')
      and not has_function_privilege('anon', to_regprocedure('public.take_build_save(uuid)'), 'execute')
      and not has_function_privilege('authenticated', to_regprocedure('public.take_build_save(uuid)'), 'execute')
      and not has_function_privilege('public', to_regprocedure('public.take_build_save(uuid)'), 'execute'), false)),
  ('intake_quota_buckets is bucket, count, reset_at in that order, keyed by bucket',
    (select coalesce(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum), '')
       = 'bucket text, count integer, reset_at timestamp with time zone'
       from pg_attribute where attrelid = to_regclass('public.intake_quota_buckets') and attnum > 0 and not attisdropped)
    and exists (select 1 from pg_index where indrelid = to_regclass('public.intake_quota_buckets')
      and indisprimary and indnkeyatts = 1 and indkey[0] = 1)),
  ('key reads of builds are counted under their own surface',
    coalesce((select pg_get_constraintdef(oid) like '%''mcp''::text, ''builds''::text]%' from pg_constraint
      where conrelid = to_regclass('public.api_key_usage') and conname = 'api_key_usage_surface_check'), false)),
  ('anon, authenticated and service_role exist, and service_role uses public',
    (select count(*) = 3 from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
    and has_schema_privilege('service_role', 'public', 'usage')),
  ('service_role reads users, sessions and api_keys',
    coalesce(has_table_privilege('service_role', to_regclass('public.users'), 'select')
      and has_table_privilege('service_role', to_regclass('public.sessions'), 'select')
      and has_table_privilege('service_role', to_regclass('public.api_keys'), 'select'), false))
) as checks(check_name, ok);
```

If only the bodies row is `f`, compare each function with the file in main
(`select prosrc from pg_proc where proname = ...`); do not run the saved-builds file again.

```sql
-- private so far
select check_name, ok from (values
  ('every build saved so far is private, as Chat saves them, so the switch publishes nothing',
    not exists (select 1 from public.saved_builds where shared or show_name))
) as checks(check_name, ok);
```

If that row is `f`, some build is already shared and its short link would go live with the switch. Count them by
account (`select user_id, count(*) from public.saved_builds where shared or show_name group by 1`), not by content,
and find out how they were saved before going on.

Then, from any machine, keep the public MCP tool list as it is now, with the switch still off:

```
curl -s https://everloot.app/mcp/public -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' > tools-before.json
jq '.result.tools | length' tools-before.json                  # 31
jq '[.result.tools[].name] | index("my_builds")' tools-before.json  # null
curl -s -o /dev/null -w '%{http_code}\n' https://everloot.app/api/me/builds   # 404 while the switch is off
```

Note the deployed main commit: the apply redeploys that commit, so the tool list can be compared byte for byte.

## Apply (maintainer only, after review)

Change only `EVERLOOT_SAVED_BUILDS`. Keep `EVERLOOT_AUTH_V2`, `EVERLOOT_PROFILES`, `EVERLOOT_GUILDS`,
`EVERLOOT_CHAT_WORKSPACE` and every other switch as they are. Only once every preflight row reads `t`, set
`EVERLOOT_SAVED_BUILDS=1` in Production and redeploy the main commit noted above. No SQL runs. Unsetting it and
redeploying undoes this step.

## Postflight

Run the schema checks above again: every row must still be `t`, since the switch changes nothing in the database.
Then, without signing in:

- `GET https://everloot.app/api/me/builds` answers 401 `Sign in to save builds.` with
  `cache-control: private, no-store`, where it answered 404 before.
- `POST https://everloot.app/api/me/builds` with `Origin: https://example.com` answers 403 `Invalid origin`, before
  any sign-in check or database call.
- `/b/AAAAAAAA` is a 404 with `noindex, nofollow`, and `/me` redirects to `/sign-in?returnTo=%2Fme`.
- The MCP list has not moved: fetch it again into `tools-after.json` with the same `curl` and
  `cmp tools-before.json tools-after.json` prints nothing. Still 31 tools, still no `my_builds`.

If any of these fails, unset the switch and redeploy (see Rollback).

## Production acceptance (signed in, same origin)

A preview cannot do this part. Saving needs a session on the site's own address: `siteUrl()` is `NEXT_PUBLIC_SITE_URL`
or `https://everloot.app`, Battle.net returns to that site's callback, and every write needs `Origin` to equal
`siteUrl()` (`meAccount` in `web/src/lib/saved-builds-store.ts`). Do not change the site URL, the redirect or the
origin check, copy a session cookie, or make a session to get past this.

On `https://everloot.app`, use a disposable Battle.net test account, never a real player's or the owner's. Name every
build and label so it is plainly a test. Without such an account the signed-in acceptance has not happened: record it
as open, not passed. Do steps 1, 6 and 7 with the window 390 px wide (or on a phone).

1. In a private window, signed out, open `/tools/talents/mage`, spend points in both sets and note the address's
   `#plan=`. Save shows "Sign in to save builds" with the focus on Sign in; Escape closes it and the focus is back on
   Save. Press Save again and sign in with the test account. You land back on the calculator with the same `#plan=`
   (both sets) and the save panel open, the focus in Name.
2. Save it as a test build with Share link on: "Saved as a new build. Short link: https://everloot.app/b/<slug>". The
   address gains `?saved=<id>` and the bar says Editing. With that session, `GET /api/me/builds` answers
   `cache-control: private, no-store` (network tab).
3. Open the short link in another private window: the build shows, read-only, with no "Shared by" line. Its page source
   holds no BattleTag, email or id.
4. Update: change a point and Save. "Saved. Short link: …" with the same slug; the other window shows the change after
   a reload.
5. Copy: press Save, then Save as new in the panel. A second build with its own slug; the first is unchanged.
6. Reopen: open My builds. At 390 px its list opens across the bar under the button, every entry readable; Escape
   closes it with the focus back on My builds. Open the first build: the calculator shows its plan with Editing.
7. Account change: open the save panel and Sign out in the header. The panel closes at once with "The account signed
   in here changed, so nothing was saved. Press Save again.", and My builds and Editing are gone. Press Save and sign
   in again: you come back editing the same build.
8. Unshare: untick Share link on and Save: "Saved. Its short link is off." The short link is a 404 at once in the other
   window.
9. Delete: on `/me`, Delete, then Delete for good, for both test builds, and remove any test label on its page. Their
   short links are 404s, and after a reload the calculator has no My builds.

Run the schema checks again, then check the test account only (counts, no content, no other player's rows). Every
count must be 0:

```sql
select (select count(*) from public.saved_builds where user_id = '<test user id>') as builds,
  (select count(*) from public.build_characters where user_id = '<test user id>') as labels;
```

## Rollback

Unset `EVERLOOT_SAVED_BUILDS` (anything but exactly `1` is off) and redeploy. Save, My builds, `/me`, `/b/<slug>`
and the `/api/me/builds` and `/api/me/characters` routes answer 404 at once, public profiles stop listing builds, and
`my_builds` leaves the MCP list for every key. Stored builds and labels stay, and Chat keeps its private builds. No SQL
is part of the rollback: never run the file's commented rollback (see the top of this document).
