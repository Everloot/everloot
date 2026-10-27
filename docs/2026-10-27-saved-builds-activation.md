# Saved builds: activation

Saved builds (Save and My builds in the talent calculator, `/me`, short links at `/b/<slug>`, and `my_builds` for a
key that reads its owner's builds) need no migration for this rollout. `supabase/migrations/20261021150000_saved_builds.sql`,
in its #450 version, is already applied in production: it went in ahead of the Chat workspace, whose private builds
live in its tables. Turning the feature on is one switch: `EVERLOOT_SAVED_BUILDS=1`. It works with the
legacy Battle.net sign-in, so `EVERLOOT_AUTH_V2` and the accounts v2 migration stay as they are, and it does not need
profiles: `EVERLOOT_PROFILES` is its own switch (`docs/2026-10-27-profiles-activation.md` has the table of both).
Design: `docs/design/specs/2026-10-20-saved-builds-design.md`.

Saving each talent set's spend order with its build is one more, additive migration,
`supabase/migrations/20261027120000_saved_build_point_order.sql`. It has its own preflight, apply, postflight and
rollback under [Spend orders](#spend-orders). It can go in before or after the code that uses it, which keeps orders
only once it is in, and it goes in before the switch. The schema checks below hold before it and after it.

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
- On `/tools/builds`, signed in: "Plans saved here while signed out", which saves the plans a browser keeps signed
  out to the account, when the player asks. See [Plans kept on a device](#plans-kept-on-a-device).

Save shows one account's builds: the one this tab last confirmed through `/api/auth/me`, asked again whenever the tab
comes back. Each save sends that account's id in `x-everloot-expected-owner`, and the site answers a private 409
`account_mismatch`, before anything is read or written, when another account is signed in now. So a save pressed
just after another tab switched accounts is refused instead of landing in the new account. The list of builds is
asked for with the same header, so another account's builds never show under this one; on a 409 Save asks who is
signed in again before it shows any list. When a check of the
account fails, Save shows no builds and stays off, with the reason beside it, until a check works again.

A shared build's short link shows its name and notes, its class and split, the game build it was made on, and both
talent sets in the calculator, read-only; a signed-in visitor can save a copy to their own account. The owner's name
shows only when they chose it, and never for a Battle.net account, whose name can hold a BattleTag. The character
label, the BattleTag, the email and every id stay off the page. A build that is not shared, or was deleted, is the
same 404 with `noindex`.

The switch creates nothing in the database, so Supabase's change to default grants for new tables on 2026-10-30 does
not touch this rollout. The spend-order migration creates no table, and it grants and revokes its two functions
itself, so it works the same before and after that date.

## Test locally

Against a disposable local Postgres only. The script refuses any host but `localhost` or `127.0.0.1` and any
database but `saved_builds_legacy_test`, checks the server's database name, and then drops the `public` schema.

```
docker run -d --name saved-builds-legacy-test -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54406:5432 postgres:17
docker exec saved-builds-legacy-test createdb -U postgres saved_builds_legacy_test
cd web
QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54406/saved_builds_legacy_test node scripts/saved-builds-legacy.integration.mjs
npx vitest run src/components/talents/save-build.test.tsx src/lib/saved-builds.test.ts src/app/api/me/builds/route.test.ts src/app/api/me/characters/route.test.ts src/app/mcp/public/route.test.ts "src/app/b/[slug]/shared-build.test.tsx" src/components/workspace/device-plans.test.tsx
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
the calculator's Save, including a save pressed while another tab has just switched accounts and a failed check of
the account; the routes, including the owner check; the MCP list; the short link page; and Plans on this device,
which keeps its own rule for a failed check.

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
    -- Once 20261027120000_saved_build_point_order.sql is applied they are followed by point_order, point_order2 and transfer_key.
    (select regexp_replace(coalesce(string_agg(attname || ' ' || format_type(atttypid, atttypmod) || case when attnotnull then ' not null' else '' end,
       ', ' order by attnum), ''), ', point_order text, point_order2 text, transfer_key text$', '') = 'id uuid not null, user_id uuid not null, character_id uuid, slug text not null, '
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

These checks run without an account. They show that the switch is on, the routes answer and the MCP list did not
move, and nothing more: they prove none of the signed-in operations. Saving, updating, copying, reopening,
unsharing and deleting, the owner check on every save, and the guards for an account change or a failed check are
proven only by the signed-in acceptance below. Until it passes, record the rollout as on but not accepted.

## Production acceptance (signed in, same origin)

A preview cannot do this part. Saving needs a session on the site's own address: `siteUrl()` is `NEXT_PUBLIC_SITE_URL`
or `https://everloot.app`, Battle.net returns to that site's callback, and every write needs `Origin` to equal
`siteUrl()` (`meAccount` in `web/src/lib/saved-builds-store.ts`). Do not change the site URL, the redirect or the
origin check, copy a session cookie, or make a session to get past this.

On `https://everloot.app`, use a disposable Battle.net test account, never a real player's or the owner's. Name every
build and label so it is plainly a test. Without such an account the signed-in acceptance has not happened: record it
as open, not passed. Do steps 1, 6, 7 and 8 with the window 390 px wide (or on a phone).

1. In a private window, signed out, open `/tools/talents/mage`, spend points in both sets and note the address's
   `#plan=`. Save shows "Sign in to save builds" with the focus on Sign in; Escape closes it and the focus is back on
   Save. Press Save again and sign in with the test account. You land back on the calculator with the same `#plan=`
   (both sets) and the save panel open, the focus in Name.
2. Save it with Share link on, under a test name of the full 60 characters (step 6 needs one that long): "Saved as a
   new build. Short link: https://everloot.app/b/<slug>". The address gains `?saved=<id>` and the bar says Editing.
   With that session, `GET /api/me/builds` answers `cache-control: private, no-store` (network tab).
3. Open the short link in another private window: the build shows, read-only, with no "Shared by" line. Its page source
   holds no BattleTag, email or id.
4. Update: change a point and Save. "Saved. Short link: …" with the same slug; the other window shows the change after
   a reload.
5. Copy: press Save, then Save as new in the panel. A second build with its own slug; the first is unchanged.
6. Reopen: open My builds. At 390 px its list opens across the bar under the button and stays inside the card: the
   60-character name ends in an ellipsis, as does the Editing line, and the page does not scroll sideways. Escape
   closes it with the focus back on My builds. Open the first build: the calculator shows its plan with Editing.
7. Sign-out in this tab: open the save panel and Sign out in the header. The panel closes at once with "The account
   signed in here changed, so nothing was saved. Press Save again.", and My builds and Editing are gone. Press Save and
   sign in again: you come back editing the same build.
8. A failed check: in DevTools, block requests to `/api/auth/me` (Network, request blocking), then click into another
   window and back. My builds and Editing go, and Save is off with "Your account could not be checked, so Save is off
   for now. Reload the page to try again." beside it. Unblock, click away and back: the builds return and Save is on.
9. The site's owner check, with this one account: in this tab's DevTools console run

   ```js
   fetch("/api/me/builds", { method: "POST", body: "{}", headers: { "content-type": "application/json",
     "x-everloot-expected-owner": "00000000-0000-4000-8000-000000000000" } }).then((r) => r.status)
   ```

   It answers 409, and the network tab shows `cache-control: private, no-store` and `"code":"account_mismatch"`. With
   the test account's own id (from `/api/auth/me`) in the header, the same call answers 400: the empty body is refused
   only after the account check passes. Neither call writes anything.
10. Another tab switches accounts. This needs a second disposable test account; without one, record this step as not
    done (step 9 still shows the site refusing a save meant for another account). With the save panel open and a note
    typed, sign out and sign in as the second account in another tab, then come back. The panel closes with "You are
    signed in to a different account now, so nothing was saved. Press Save again to save the build to this one.",
    Editing goes, and nothing of the first account's builds shows. Sign the first account back in from the other tab
    and come back: Save opens with the note you typed.
11. Unshare: untick Share link on and Save: "Saved. Its short link is off." The short link is a 404 at once in the
    other window.
12. Delete: on `/me`, Delete, then Delete for good, for both test builds, and remove any test label on its page. Their
    short links are 404s, and after a reload the calculator has no My builds.

Run the schema checks again, then check the test accounts only (counts, no content, no other player's rows): the
first, and the second if step 10 ran. Every count must be 0:

```sql
select (select count(*) from public.saved_builds where user_id = '<test user id>') as builds,
  (select count(*) from public.build_characters where user_id = '<test user id>') as labels;
```

## Plans kept on a device

The switch also shows, on `/tools/builds` signed in, "Plans saved here while signed out": the plans a browser keeps
signed out, which the player can save to the account signed in now. The account is asked nothing until the panel is
opened, and nothing is sent until Save. Each plan goes through `POST /api/me/builds` with `x-everloot-expected-owner`,
both spend orders, the sharing the player chose, and a `transferKey` the browser stores before sending (`transfer_key`
under [Spend orders](#spend-orders)). Sent again after a lost answer, a reload or from another tab, the same save is
answered 200 with the build it made, not a 201 with a second one; the panel reads that 200 as the build it sent before.
Until the spend-order migration is in, the route refuses such a save with the code `orders_unavailable`, and the panel
says so and keeps every plan on the device as it was.

Add these to the signed-in acceptance, with the same disposable test account and the window 390 px wide:

1. Signed out, save two test plans on `/tools/builds`. Sign in: the panel offers them, and the network tab shows no
   request to `/api/me/builds` until "Choose plans to save to your account". Open it: it names the test account. Choose
   one plan, private, and Save: "Saved 1 plan to your account." It is on `/me`, private, with its spend order, and on
   `/tools/builds` it shows under the account, not signed out.
2. A failure: with the spend-order migration not in yet, save a plan from the panel: "Saving spend orders isn't
   available yet, so no plans were saved to your account. They stay on this device as they were, spend orders
   included." The plan is still offered, unchanged, and `/me` has nothing new.
3. An account switch: open the panel and choose a plan, then sign in as a second disposable account in another tab,
   come back and press Save: "The account signed in here changed, so nothing was sent." Neither account gains a build.
   Without a second account, record this step as not done.

Delete the test builds on `/me` afterwards, as in step 12 above.

## Rollback

Unset `EVERLOOT_SAVED_BUILDS` (anything but exactly `1` is off) and redeploy. Save, My builds, `/me`, `/b/<slug>`
and the `/api/me/builds` and `/api/me/characters` routes answer 404 at once, public profiles stop listing builds, and
`my_builds` leaves the MCP list for every key. Stored builds and labels stay, and Chat keeps its private builds. No SQL
is part of the rollback: never run the file's commented rollback (see the top of this document). The panel on
`/tools/builds` goes with the switch; plans it moved stay with their account on the device.

## Spend orders

A build is saved with each talent set's spend order, the token a plan link carries after `&order=` and `&order2=`
(`docs/2026-10-17-talent-share-code.md`, "Spend order"). Save in the calculator, Save a copy and Duplicate send the
orders with the codes. Chat's save takes them too; its form pastes codes only, and an edit from Chat keeps a build's
orders while its codes stay the same. My builds, `/me`, Chat and a short link's Open in the calculator bring them
back. The token says who made the order: `O1p-` the player, `O1g-` a generated, provisional one. One additive
migration holds them, `supabase/migrations/20261027120000_saved_build_point_order.sql`:

- `point_order` and `point_order2` on `saved_builds`, nullable text after the existing columns. Each is checked to the
  token's shape, and a second order needs a second set. Null is an unknown order; builds saved before have none.
- `save_build_plan(p_user_id uuid, p_payload jsonb) returns jsonb`, the one call the site then makes to save a build.
  It files the build through `save_build`, with its limits, ownership checks and refusals unchanged, and writes the
  orders in the same transaction, so a failure anywhere saves nothing and costs no save. A new build must say `shared`
  and `showName`, and Chat sends false for both. An order left out of a save stays only while its code stays the same.
  The server reads every token against its own set's code before calling it.
- `transfer_key` on `saved_builds`, nullable text after the orders, checked to `^[A-Za-z0-9_-]{16,64}$`, with the
  unique index `saved_builds_transfer_key` on `(user_id, transfer_key)` where a key is set. A client that may send the
  same new build twice, such as the device transfer, gives it a key (`transferKey`). The first save with a key that
  succeeds makes the build, and the key answers with that build from then on. If the account already has a build with
  that key, `save_build_plan` answers with it as its create did, plus `"replayed": true`: nothing is written and no save
  is counted, and the rest of the save, its name, codes and orders included, is ignored. The route answers 200 rather
  than 201, in the body a create has, with the build as it is now. A change to the build after its create is an update
  by `id`, not another save with the key. Two saves racing with one key make one build. One that finds no build with
  its key looks again once it holds the account's row, the lock `save_build` takes first, which a save with the same
  key still under way holds until it commits: the second finds the first one's build and is answered as its replay, at
  the day's last save and the account's last build too, never refused for the place the first one took. The index
  stays the backstop for any other writer: a save it refuses the key is answered as the replay of the build that has
  it, with all it did undone. Another account's same key is a key of its own. A key is for a new build only; an update
  that sends one is refused.
- The trigger `saved_builds_order_follows_code`, with its function `saved_build_order_follows_code()`: an update that
  changes a code drops that set's order. That keeps the orders right for every caller of `save_build`, the site from
  before this migration included.

Nothing else changes. The eight functions of the saved-builds file keep their bodies, settings and grants, so the
schema checks above still read `t`; the table keeps its grants and row security. The public read (`shared_build`), the
key read (`own_builds_for_key`) and the MCP tool list stay as they are: a key's read has no orders, and a short link's
page reads the orders beside `shared_build`, only for the build it returned and only while that build is shared.

The code and the migration can go out in either order, but orders are kept only once the migration is in. Until then
the site reads builds without orders, and Chat, which is on in production whatever the switch says, lists and saves
as it did: a save that names no order goes through `save_build`. A save that names an order, an unknown one too, or a
transfer key, is refused before anything is written: a 409 with "Saving spend orders isn't available yet, so this
build was not saved." and the code `orders_unavailable` on both build routes. The
calculator's Save always names both sets' orders, so with saved builds on it saves nothing until the migration is
in: apply it before `EVERLOOT_SAVED_BUILDS` goes on. Only PostgREST's own answer, word for word, counts as missing:
a 400 with 42703 and "column saved_builds.point_order does not exist" (or `point_order2`), or a 404 with PGRST202
naming `public.save_build_plan(p_payload, p_user_id)`, or with 42883 naming
`public.save_build_plan(p_user_id => uuid, p_payload => jsonb)` when its schema cache is stale. Anything else is a
failure: another status, a 5xx, a name that merely contains these, or a function `save_build_plan` itself needs. It is
never tried again through `save_build` and never remembered as the migration missing. A server that did find the
migration missing asks again a minute later, so orders are kept from about a minute after the apply. If PostgREST ever
words these answers differently, saving fails safe with a 503 instead of falling back.

### Test locally

Against a disposable local Postgres only. The script refuses any host but `localhost` or `127.0.0.1` and any
database but `saved_build_point_order_test`, checks the server's database name, and then drops the `public` schema.

```
docker run -d --name saved-build-point-order-test -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54407:5432 postgres:17
docker exec saved-build-point-order-test createdb -U postgres saved_build_point_order_test
cd web
QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54407/saved_build_point_order_test node scripts/saved-build-point-order.integration.mjs
npx vitest run src/lib/saved-builds.test.ts src/components/talents/save-build.test.tsx src/app/b/point-order.test.tsx src/app/api/me/builds/route.test.ts src/app/api/me/chat/builds/route.test.ts src/components/builds/copy-orders.test.tsx "src/app/b/[slug]/shared-build.test.tsx"
docker rm -f saved-build-point-order-test
```

The script builds the schema production has, as `scripts/saved-builds-legacy.integration.mjs` does, and runs the
schema checks above with the preflight, apply, postflight and rollback below exactly as written here: once with
Supabase's old default grants and once with none. It shows the preflight and the postflight catching what they name,
and a held lock making the apply fail with nothing changed. A connection that ran `save_build` before the apply goes on
saving after it. Then, through the site's own calls: a save whose order write fails leaves nothing, a new build or an
update alike; an older save that changes a code drops its order, and one that keeps the code keeps it; a new build
without `shared` and `showName` is refused; malformed payloads write nothing; unshared, private and unknown builds stay
off the public read, orders and all; the browser roles reach neither the columns nor the function; the calculator's
and Chat's saves and reopens keep both orders and their makers; another account changes nothing; the limits hold; a
key's read is unchanged. A new build's transfer key: the same save again is answered with the build it made, as its
create was plus `replayed`, with nothing written and no save counted, even at the day's limit; another account's same
key makes its own build; two saves racing with one key make one build, when one waits for the other's account, at the
day's last save and the account's last build too, and when they are sent together; a key another session gives a build
while a save is under way answers that save with that build, its own row and count undone; a key of another shape or on
an update is refused. Applying twice keeps every order and key, the rollback keeps the columns, the orders and keys,
the index and the trigger, and applying again brings the function back, with every other function, grant and table as
it was throughout.

`src/lib/saved-build-point-order.rest.test.ts` runs the site's own saved-builds code, the Chat and calculator routes
with a made-up session, through a real PostgREST on the same legacy schema: first without the migration, then in the
same process after applying it, then after the rollback below. It is skipped unless its three fixtures are given:

```
docker network create saved-build-point-order-rest
docker run -d --name saved-build-point-order-rest-db --network saved-build-point-order-rest -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54411:5432 postgres:17
docker exec saved-build-point-order-rest-db createdb -U postgres saved_build_point_order_rest_test
docker run -d --name saved-build-point-order-rest-api --network saved-build-point-order-rest -p 127.0.0.1:54412:3000 -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=<a local secret of 32 characters or more> -e PGRST_DB_URI=postgres://postgres@saved-build-point-order-rest-db:5432/saved_build_point_order_rest_test postgrest/postgrest:v12.2.12
cd web
QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54411/saved_build_point_order_rest_test LOCAL_REST_URL=http://127.0.0.1:54412 LOCAL_REST_JWT_SECRET=<the same secret> npx vitest run src/lib/saved-build-point-order.rest.test.ts
docker rm -f saved-build-point-order-rest-api saved-build-point-order-rest-db
docker network rm saved-build-point-order-rest
```

Before the migration PostgREST answers a read of the order columns with 400 and 42703, and a call to
`save_build_plan` with 404 and PGRST202; PostgREST 12.2, 13.0 and Supabase's 14.4, 14.8 and 16.4 answer the same. The
test checks those answers. Then it checks that Chat lists and saves, that a save with an order or a transfer key is
refused with nothing written, and that the explicit sharing and the owner checks hold on the older path. After the
apply, the process goes on without the migration for the rest of its minute, then saves orders through
`save_build_plan`. Through the calculator's route, a new build with a transfer key is a 201, the same save again a 200
with the same body and nothing written, and once the build is updated by `id`, a 200 with the build as it is now;
another account's same key is its own build, two sent together one build, and two that both wait for the account at
the day's last save a 201 and a 200 with that build, not a 429. A fault made on purpose, `save_build_plan` calling a
helper the database does not have, gets a 503 with nothing written, and once the file is applied again the very next
save with orders goes through `save_build_plan`. A drop that PostgREST is not told about counts as the function
missing, through 42883 from its stale cache. After the rollback the orders stay, and a save without one goes through
`save_build` again.

### Preflight (read-only)

In the Supabase SQL editor, against production. First the schema checks and the private-builds check above, then
this block. Every row must be `t`; anything else (`f`, NULL or an error) means stop.

```sql
-- point order preflight
select check_name, ok from (values
  ('saved_builds has none of the columns the file adds yet',
    not exists (select 1 from pg_attribute where attrelid = to_regclass('public.saved_builds')
      and attname in ('point_order', 'point_order2', 'transfer_key') and not attisdropped)),
  ('no constraint has a name the file adds',
    not exists (select 1 from pg_constraint where conname in ('saved_builds_point_order_check', 'saved_builds_point_order2_check',
      'saved_builds_transfer_key_check'))),
  ('no index or table has the name of the file''s index',
    to_regclass('public.saved_builds_transfer_key') is null),
  ('no trigger has the name the file adds',
    not exists (select 1 from pg_trigger where tgname = 'saved_builds_order_follows_code')),
  ('no function has either name the file adds',
    not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('save_build_plan', 'saved_build_order_follows_code'))),
  ('this session owns saved_builds and may call save_build, as the new function will',
    coalesce((select pg_has_role(current_user, relowner, 'usage') from pg_class where oid = to_regclass('public.saved_builds')), false)
    and coalesce(has_function_privilege(current_user,
      to_regprocedure('public.save_build(uuid, uuid, text, uuid, text, text, text, text, boolean, boolean, boolean)'), 'execute'), false)),
  ('this session may create in public', has_schema_privilege(current_user, 'public', 'create'))
) as checks(check_name, ok);
```

### Apply (maintainer only, after review)

Back up as usual. In the SQL editor, paste the migration file unchanged between these lines and run it once. The
bounded lock wait matters: adding the columns, the index and the trigger needs `saved_builds` to itself for a moment,
and a save in progress holds it. If it stops with an error, nothing was applied: run `rollback;`, run the preflight again and
retry later.

```sql
-- point order apply
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- paste supabase/migrations/20261027120000_saved_build_point_order.sql here, unchanged
commit;
```

### Postflight (read-only)

Every row must be `t`, and so must every row of the schema checks above, run again. Anything else (`f`, NULL or an
error) means stop: do not deploy the code that reads the orders, and find out why. The rollback below removes the new
function.

```sql
-- point order postflight
select check_name, ok from (values
  ('saved_builds ends with point_order, point_order2 and transfer_key, nullable text',
    (select string_agg(attname || ' ' || format_type(atttypid, atttypmod) || case when attnotnull then ' not null' else '' end,
       ', ' order by attnum) from (select attname, atttypid, atttypmod, attnotnull, attnum from pg_attribute
         where attrelid = to_regclass('public.saved_builds') and attnum > 0 and not attisdropped order by attnum desc limit 4) last)
      = 'updated_at timestamp with time zone not null, point_order text, point_order2 text, transfer_key text'),
  ('each order has the token''s shape, a second order needs a second set, and a transfer key has its own shape',
    (select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint
      where conrelid = to_regclass('public.saved_builds')
        and conname in ('saved_builds_point_order_check', 'saved_builds_point_order2_check', 'saved_builds_transfer_key_check'))
      = 'saved_builds_point_order2_check CHECK (((point_order2 IS NULL) OR ((code2 IS NOT NULL) AND '
      || '(point_order2 ~ ''^O1[pg]-[A-Za-z0-9_-]{1,64}$''::text)))) | saved_builds_point_order_check CHECK (((point_order IS NULL) '
      || 'OR (point_order ~ ''^O1[pg]-[A-Za-z0-9_-]{1,64}$''::text))) | saved_builds_transfer_key_check CHECK (((transfer_key IS NULL) '
      || 'OR (transfer_key ~ ''^[A-Za-z0-9_-]{16,64}$''::text)))'),
  ('a transfer key names one build of its owner: a unique index on user_id and transfer_key, where one is set',
    exists (select 1 from pg_index i where i.indexrelid = to_regclass('public.saved_builds_transfer_key')
      and i.indrelid = to_regclass('public.saved_builds') and i.indisunique and i.indisvalid and i.indnkeyatts = 2
      and (select array_agg(a.attname::text order by k.n) from unnest(i.indkey::int2[]) with ordinality as k(attnum, n)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = array['user_id', 'transfer_key']
      and pg_get_expr(i.indpred, i.indrelid) = '(transfer_key IS NOT NULL)')),
  ('a save that changes a code drops its order: the trigger runs before each update of code or code2, and is on',
    exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.saved_builds') and t.tgname = 'saved_builds_order_follows_code'
      and t.tgfoid = to_regprocedure('public.saved_build_order_follows_code()') and t.tgtype = 19 and t.tgenabled = 'O'
      and (select array_agg(attname::text order by attname) from pg_attribute a where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr))
        = array['code', 'code2'])),
  ('save_build_plan is the one function of its name, taking a user and a payload and answering in JSON',
    (select count(*) = 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_build_plan')
    and coalesce((select array_to_string(proargnames, ',') = 'p_user_id,p_payload' and prorettype = 'jsonb'::regtype
      from pg_proc where oid = to_regprocedure('public.save_build_plan(uuid, jsonb)')), false)),
  ('both run as their owner with an empty search_path and a 3 s lock wait',
    (select count(*) = 2 and bool_and(prosecdef and coalesce('search_path=""' = any(proconfig), false)
       and coalesce('lock_timeout=3s' = any(proconfig), false)) from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('save_build_plan', 'saved_build_order_follows_code'))),
  ('their bodies are the file''s, word for word',
    (select md5(string_agg(proname || ':' || regexp_replace(prosrc, '\s+', ' ', 'g'), '|' order by proname)) from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('save_build_plan', 'saved_build_order_follows_code'))
      = '37561800ec163ecfbef6f352479bc2f9'),
  ('only service_role may call save_build_plan',
    coalesce(has_function_privilege('service_role', to_regprocedure('public.save_build_plan(uuid, jsonb)'), 'execute')
      and not has_function_privilege('anon', to_regprocedure('public.save_build_plan(uuid, jsonb)'), 'execute')
      and not has_function_privilege('authenticated', to_regprocedure('public.save_build_plan(uuid, jsonb)'), 'execute')
      and not has_function_privilege('public', to_regprocedure('public.save_build_plan(uuid, jsonb)'), 'execute'), false)),
  ('nobody may call the trigger''s function directly',
    coalesce(not has_function_privilege('service_role', to_regprocedure('public.saved_build_order_follows_code()'), 'execute')
      and not has_function_privilege('anon', to_regprocedure('public.saved_build_order_follows_code()'), 'execute')
      and not has_function_privilege('authenticated', to_regprocedure('public.saved_build_order_follows_code()'), 'execute')
      and not has_function_privilege('public', to_regprocedure('public.saved_build_order_follows_code()'), 'execute'), false)),
  ('save_build_plan''s owner may run save_build and write saved_builds',
    coalesce((select has_function_privilege(proowner,
        to_regprocedure('public.save_build(uuid, uuid, text, uuid, text, text, text, text, boolean, boolean, boolean)'), 'execute')
      and has_table_privilege(proowner, 'public.saved_builds', 'insert, update')
      from pg_proc where oid = to_regprocedure('public.save_build_plan(uuid, jsonb)')), false))
) as checks(check_name, ok);
```

If the code that reads the orders is already deployed, it starts keeping them within a minute of the apply; if not,
it can be deployed now. From outside, without an account, `GET /api/me/chat/builds` still answers 401 and, with the
switch off, `GET /api/me/builds` a 404. These show the deploy answers, nothing more.
Saving with orders is proven only by a signed-in check on `https://everloot.app` with a disposable test account,
never a real player's: in Chat, a new private build saves and an edit keeps it private; with saved builds on, a plan
from a link with `&order=` saved from the calculator comes back from My builds with the same `&order=` in the
address. Until that check passes, record the orders as deployed, not accepted. Then, for the test account only:

```sql
select count(*) as builds, count(point_order) as with_order from public.saved_builds where user_id = '<test user id>';
```

### Rollback

The code needs no rollback for the database's sake: it works with the migration, without it and with the function
alone gone. Redeploying the commit from before it is a rollback of its own, with no SQL; that code never reads or
writes orders, and while it runs the trigger drops the order of any build whose code it changes. If the function
itself must go, run the block below. From its next save the site saves a build that names no order and no transfer
key through `save_build` again and refuses one that names either, with nothing written.

```sql
-- point order rollback
begin;
set local lock_timeout = '5s';
drop function if exists public.save_build_plan(uuid, jsonb);
notify pgrst, 'reload schema';
commit;
```

The columns, every order and transfer key in them, the key's unique index and the trigger stay, and the schema checks
above still read `t`. Never drop the columns, which deletes every saved order and key, or the trigger, without which
an older save could leave an order beside a code it was not made for. Applying the file again brings the function
back, and a build's key finds it again.
