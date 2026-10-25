# Chat workspace: migration and activation

The private Chat workspace (projects, account chats, saved entries) needs one additive migration,
`supabase/migrations/20261025191223_chat_workspace.sql`, and then `EVERLOOT_CHAT_WORKSPACE=1`. Until the switch
is on, every `/api/me/chat/**` route answers 404 and the site calls nothing in the migration. The switch is
independent of `EVERLOOT_SAVED_BUILDS`. Design: `docs/superpowers/specs/2026-10-25-chat-projects-design.md`.

## What the migration adds

Five tables (`chat_projects`, `chat_conversations`, `chat_entries`, `chat_imports`, `chat_daily_saves`) and
twenty functions. Every table has RLS on, no policies, and nothing for `anon` or `authenticated`; the service
role may only `select` (for the nightly backup) and writes through the `security definer` functions. Each row
belongs to `public.users(id)` and goes when that user is deleted. Nothing existing is altered.

Prerequisites: `public.users` only. Saved-build entries also need `public.saved_builds`
(`20261021150000_saved_builds.sql`). Without it the migration still applies and a build entry is refused as
`build_not_found` (404). Production had no `saved_builds` at the 2026-10-25 preflight, so apply that migration first
if build entries should work on day one.

## Limits

| Bound | Value |
|---|---|
| Projects / conversations / entries per account | 100 / 500 / 1000 |
| Stored content per account | 10 MiB (names, titles, messages JSON, entry text, links, sources) |
| Per conversation | 200 messages, 1 MiB |
| Message or note text | 20,000 characters |
| Title / project name | 100 characters (an entry title may be empty) |
| Project description | 1000 characters |
| Page link | same-site path, 2048 characters |
| Entry sources | 20, each 1 to 512 characters |
| Message tool trail | 100 sources, 100 pages (2048 characters each), 100 steps |
| Page size | 50 |
| Saves per account per day | 300 (creates, updates, first imports; deletes and repeated imports are free) |
| Request body | 1.5 MiB |

The database holds these under a lock on the user row, so concurrent saves cannot pass them. Nothing saved is
pruned to make room: an excess save is refused (413 `quota_exceeded` or `size_exceeded`, 429 `daily_limit`).

## Test locally

Against a disposable local Postgres only (the script drops the `public` schema and refuses any other host or
database name):

```
docker run -d --name chat-ws-test -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54389:5432 postgres:17
docker exec chat-ws-test psql -U postgres -c "create database intake_quota_test"
cd web
QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54389/intake_quota_test node scripts/chat-workspace.integration.mjs
npx vitest run src/lib/chat/workspace.test.ts src/app/api/me/chat
```

The integration script applies the migration on `users` alone first, then every migration in order, plus this one twice.
It checks role isolation, two-account CRUD and references, revisions, project unfiling, pages, concurrent
quotas, idempotent concurrent import, export, workspace clear and account deletion.

## Apply (root only, after review)

1. Back up as usual. Apply `20261025191223_chat_workspace.sql` once in the SQL editor, after
   `20261021150000_saved_builds.sql` if build entries are wanted. The file ends with `notify pgrst, 'reload schema'`.
2. Read-only checks, expected `t` for each:

```sql
select to_regclass('public.chat_projects') is not null, to_regclass('public.chat_conversations') is not null,
  to_regclass('public.chat_entries') is not null, to_regclass('public.chat_imports') is not null,
  to_regclass('public.chat_daily_saves') is not null;
select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.chat_projects'::regclass,
  'public.chat_conversations'::regclass, 'public.chat_entries'::regclass, 'public.chat_imports'::regclass, 'public.chat_daily_saves'::regclass);
select not has_table_privilege('anon', 'public.chat_conversations', 'select'),
  not has_table_privilege('authenticated', 'public.chat_conversations', 'select'),
  not has_table_privilege('service_role', 'public.chat_conversations', 'insert'),
  has_function_privilege('service_role', 'public.chat_save_conversation(uuid, uuid, integer, text, uuid, boolean, jsonb)', 'execute'),
  not has_function_privilege('anon', 'public.chat_export(uuid)', 'execute'),
  not has_function_privilege('service_role', 'public.chat_take_mutation(uuid)', 'execute');
```

3. Set `EVERLOOT_CHAT_WORKSPACE=1` for a preview first. Signed in with two test accounts, from the site only:
   - A makes a project, a chat in it and a note; B lists nothing and gets 404 reading A's chat id.
   - A saves the chat from two tabs with the same revision: the second gets 409 `revision_conflict`.
   - A imports one browser chat twice: one conversation, `created` true then false.
   - A removes the project: the chat and note show as Unfiled.
   - A downloads `/api/me/chat/export` and clears the workspace with `DELETE /api/me/chat/workspace`.
4. Confirm the test rows are gone (counts only, no content):

```sql
select (select count(*) from public.chat_projects where user_id = '<test user id>')
  + (select count(*) from public.chat_conversations where user_id = '<test user id>')
  + (select count(*) from public.chat_entries where user_id = '<test user id>')
  + (select count(*) from public.chat_imports where user_id = '<test user id>');
```

5. Then enable in production and repeat step 3 with one test account.

## Rollback

Unset `EVERLOOT_CHAT_WORKSPACE` first: every route returns to 404 at once. The SQL rollback at the end of the
migration drops the workspace and every account's workspace content; run it only on purpose.
