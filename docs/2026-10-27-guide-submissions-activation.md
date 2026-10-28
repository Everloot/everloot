# Community guide drafts: migration and activation

Community guide drafts (at `/guides/write`, a signed-in player writes a guide in the guides' own format, keeps it as a
private draft, previews it, and submits a revision for review or withdraws it) need one additive migration,
`supabase/migrations/20261027140000_guide_submissions.sql`, and then `EVERLOOT_GUIDE_SUBMISSIONS=1`. The switch needs
`EVERLOOT_PROFILES=1` as well, since a guide names its author by profile handle. Both work with the legacy Battle.net
sign-in: `EVERLOOT_AUTH_V2` and the accounts v2 migration stay as they are. Contract: `docs/GUIDES.md`.

Nothing here publishes a guide. Review is not built yet, so a submitted revision waits with no one to review it, and
the public guides are still the reviewed files in `kb/guides`.

**Activation is blocked.** Until every prerequisite below is closed, do not apply the migration in production and do
not set the switch. The preflight is read-only and may run at any time.

## Prerequisites

| Prerequisite | Status |
|---|---|
| `EVERLOOT_PROFILES=1` in Production. It was on when this was written; check again on the day. | OPEN |
| Counsel's answer to section C of the counsel packet: the terms for user posts and the licence a writer grants, copyright notices and a repeat-infringer policy, notice and takedown, the EU and UK rules for user content, the minimum age, and the lawful basis for showing a handle. | OPEN |
| A copyright agent designated with the US Copyright Office and published on the site. Any filing fee needs the owner's own exception to the free-services rule first; this runbook authorizes no filing and no payment. | OPEN |
| The data policy, privacy and terms text for community guides: what is stored, who sees it, the licence, removal and how long it is kept. `docs/DATA_POLICY.md` has no section on them yet. | OPEN |

## What the switch turns on

- `/guides/write`: the player's own guides, the editor, and a preview of the saved draft drawn by the guides' own
  renderer, with what must change before it can be submitted. Signed out, it sends the player to sign in and back. It
  is one of the protected pages (`web/src/data/protected-paths.json`): the strict Content-Security-Policy, no ads,
  analytics or consent banner, and a reload of the document on any move between it and a public page.
- `GET /api/me/guides` lists the player's guides and revisions, titles and statuses only. `POST /api/me/guides` saves
  a draft, submits a revision or withdraws one. Writes need this site's `Origin`, and the editor names the page's
  account (`x-everloot-expected-owner`), so a write meant for one account is refused with 409 when another is signed in.
- With the switch off, both answer 404 and nothing reads the tables.

No public page, list, sitemap, search, feed, card, MCP tool or API reads the tables. A submitted revision is kept
exactly as it was sent, under the handle the player saw before sending. The author is that handle, never the BattleTag,
and submitting changes nothing on the profile: a private profile stays private.

## What the migration adds

Three tables and six functions; nothing existing is altered.

- `guide_submissions`, one row per guide and its owner, and `guide_submission_revisions`, each revision's fields, text,
  status and, once sent, the handle it was sent under. A revision that leaves draft keeps its words: a trigger refuses
  any change to them, any way back to draft, and any delete but its guide's or its account's.
- `guide_moderators`, who may review: empty, and one account at most until a later migration lifts that. Carlos is
  the only reviewer until he names others.
- RLS is on with no policies, and nothing is granted to `anon` or `authenticated`. The service role may `select` the
  three tables and execute `save_guide_draft`, `submit_guide` and `withdraw_guide`; every write goes through them.
  `take_guide_count`, `guide_draft_row` and the trigger's `guide_revision_is_kept` are for those functions alone.
- The limits are the database's: 20 guides an account, 100 revisions a guide, 300 draft saves and 10 submissions a day,
  counted in `intake_quota_buckets` (`guide_saves:` and `guide_submits:`).
- A row belongs to `public.users(id)` and goes when that user is deleted, so the email-and-SQL account deletion needs no
  extra step.

It needs `public.users` (the legacy table is enough), `public.user_profiles` from
`20261021170000_account_profiles.sql`, and `public.intake_quota_buckets` with its columns in the order
`bucket, count, reset_at`, since `take_guide_count` inserts into it by position. The preflight checks all three.

Supabase stops granting new tables to `anon`, `authenticated` and `service_role` by default on 2026-10-30. The migration
revokes and grants exactly what the site uses, so it works the same before and after that date.

## Test locally

Against disposable local fixtures only. The script refuses any host but `localhost` or `127.0.0.1` and any database but
`guide_submissions_test`, checks the server's database name, and then drops the `public` schema.

```
docker run -d --name guide-submissions-test -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54421:5432 postgres:17
docker exec guide-submissions-test createdb -h 127.0.0.1 -U postgres guide_submissions_test
cd web
QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54421/guide_submissions_test node scripts/guide-submissions.integration.mjs
npx vitest run src/app/api/me/guides/route.test.ts src/components/guides/guide-editor.test.tsx src/app/guides/write/write.test.tsx
```

The script builds the schema production has (the legacy users table without accounts v2, the production chain and the
profiles file), then runs the preflight, apply, postflight, reviewer, backup and rollback below exactly as written here:
once with Supabase's old default grants and once with none. It checks that the preflight catches a missing
`user_profiles`, quota columns out of order, leftover counters, an existing table, a function name collision and a
missing grant; that a held lock makes the apply fail with nothing changed; that the postflight catches a function left
without its settings, a grant to `anon`, a callable helper, the trigger off, the one-reviewer index gone and row
security off; ownership, refused owner, status and review fields, revisions kept as sent, the limits, and that apply
and rollback leave every other function, grant and table as it was. `src/lib/guide-submissions.rest.test.ts` runs the
site's route through a real PostgREST, with the commands in its header.

## Preflight (read-only)

In the Supabase SQL editor. Every row must be `t`; anything else (`f`, NULL or an error) means stop.

```sql
-- preflight
select check_name, ok from (values
  ('users.id is the uuid primary key',
    exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = to_regclass('public.users') and i.indisprimary and i.indnkeyatts = 1
        and a.attname = 'id' and a.atttypid = 'uuid'::regtype)),
  ('user_profiles is there, with the handle a guide names its author by',
    (select count(*) = 3 from pg_attribute where attrelid = to_regclass('public.user_profiles') and attnum > 0
      and not attisdropped and attname in ('user_id', 'handle', 'public_profile'))),
  ('intake_quota_buckets is bucket, count, reset_at in that order, keyed by bucket',
    (select coalesce(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum), '')
       = 'bucket text, count integer, reset_at timestamp with time zone'
       from pg_attribute where attrelid = to_regclass('public.intake_quota_buckets') and attnum > 0 and not attisdropped)
    and exists (select 1 from pg_index where indrelid = to_regclass('public.intake_quota_buckets')
      and indisprimary and indnkeyatts = 1 and indkey[0] = 1)),
  ('no guide counters from an earlier attempt',
    not exists (select 1 from public.intake_quota_buckets where bucket like 'guide\_saves:%' or bucket like 'guide\_submits:%')),
  ('none of the three tables exists yet',
    to_regclass('public.guide_submissions') is null and to_regtype('public.guide_submissions') is null
    and to_regclass('public.guide_submission_revisions') is null and to_regtype('public.guide_submission_revisions') is null
    and to_regclass('public.guide_moderators') is null and to_regtype('public.guide_moderators') is null),
  ('no function has any of the six names',
    not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('guide_revision_is_kept', 'take_guide_count', 'guide_draft_row', 'save_guide_draft', 'submit_guide', 'withdraw_guide'))),
  ('gen_random_uuid() is there for the new ids', to_regprocedure('gen_random_uuid()') is not null),
  ('anon, authenticated and service_role exist, and service_role uses public',
    (select count(*) = 3 from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
    and has_schema_privilege('service_role', 'public', 'usage')),
  ('service_role reads users, sessions and user_profiles',
    coalesce(has_table_privilege('service_role', to_regclass('public.users'), 'select')
      and has_table_privilege('service_role', to_regclass('public.sessions'), 'select')
      and has_table_privilege('service_role', to_regclass('public.user_profiles'), 'select'), false)),
  ('this session may create in public', has_schema_privilege(current_user, 'public', 'create'))
) as checks(check_name, ok);
```

If `user_profiles` is missing, apply the profiles file first with its own runbook (`docs/2026-10-27-profiles-activation.md`).

## Backup

Before the apply, take the usual backup and confirm it finished; if none can be taken, stop. The apply only adds three
empty tables and six functions and changes no existing row, grant or function, but it is not applied without one. The
nightly mirror captures rows, not the schema (`docs/DATA_PLACEMENT.md`, gap 2), so a restore rebuilds the schema from
`supabase/migrations`.

The rollback is the step that destroys. Before it, export what is to be kept with the read below. Its rows are players'
unpublished words and their account ids: keep the file private, off the repository and out of any shared place, and
delete it once it is no longer needed.

```sql
-- backup
select jsonb_build_object(
  'guides', (select coalesce(jsonb_agg(to_jsonb(g) order by g.created_at, g.id), '[]'::jsonb) from public.guide_submissions g),
  'revisions', (select coalesce(jsonb_agg(to_jsonb(r) order by r.guide_id, r.revision), '[]'::jsonb) from public.guide_submission_revisions r),
  'moderators', (select coalesce(jsonb_agg(to_jsonb(m) order by m.granted_at), '[]'::jsonb) from public.guide_moderators m)
) as backup;
```

## Apply (maintainer only, after review, once every prerequisite is closed)

In the SQL editor, paste the migration file unchanged between these lines and run it once. The bounded lock wait
matters: the new tables' foreign keys briefly lock `users` against writes, and a sign-in in progress holds a conflicting
lock. If it stops with an error, nothing was applied: run `rollback;`, run the preflight again and retry later.

```sql
-- apply
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- paste supabase/migrations/20261027140000_guide_submissions.sql here, unchanged
commit;
```

## Postflight (read-only)

Every row must be `t`. Anything else (`f`, NULL or an error) means stop: leave `EVERLOOT_GUIDE_SUBMISSIONS` off and find
out why; the rollback below removes the migration.

```sql
-- postflight
select check_name, ok from (values
  ('guide_submissions has the migration''s columns',
    (select string_agg(attname, ',' order by attnum) = 'id,user_id,created_at,updated_at'
       from pg_attribute where attrelid = 'public.guide_submissions'::regclass and attnum > 0 and not attisdropped)),
  ('guide_submission_revisions has the migration''s columns',
    (select string_agg(attname, ',' order by attnum) = 'guide_id,revision,user_id,status,title,summary,class_slug,activity,'
       || 'roles,level_from,level_to,code,point_order,code2,point_order2,sources,body,author_handle,created_at,updated_at,'
       || 'submitted_at,withdrawn_at'
       from pg_attribute where attrelid = 'public.guide_submission_revisions'::regclass and attnum > 0 and not attisdropped)),
  ('guide_moderators has the migration''s columns',
    (select string_agg(attname, ',' order by attnum) = 'user_id,granted_at,note'
       from pg_attribute where attrelid = 'public.guide_moderators'::regclass and attnum > 0 and not attisdropped)),
  ('row level security is on for the three, with no policies',
    (select count(*) = 3 and bool_and(relrowsecurity) from pg_class where oid in
      ('public.guide_submissions'::regclass, 'public.guide_submission_revisions'::regclass, 'public.guide_moderators'::regclass))
    and not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename in ('guide_submissions', 'guide_submission_revisions', 'guide_moderators'))),
  ('anon and authenticated have nothing on the three',
    (select bool_and(not has_table_privilege(r, t::regclass, 'select, insert, update, delete, truncate, references, trigger'))
       from unnest(array['anon', 'authenticated']) r,
         unnest(array['public.guide_submissions', 'public.guide_submission_revisions', 'public.guide_moderators']) t)),
  ('service_role reads the three and writes none of them',
    (select bool_and(has_table_privilege('service_role', t::regclass, 'select')
       and not has_table_privilege('service_role', t::regclass, 'insert, update, delete, truncate, references, trigger'))
       from unnest(array['public.guide_submissions', 'public.guide_submission_revisions', 'public.guide_moderators']) t)),
  ('the six functions, one signature each',
    (select count(*) = 6 from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('guide_revision_is_kept', 'take_guide_count', 'guide_draft_row', 'save_guide_draft', 'submit_guide', 'withdraw_guide'))
    and to_regprocedure('public.guide_revision_is_kept()') is not null
    and to_regprocedure('public.take_guide_count(text, integer)') is not null
    and to_regprocedure('public.guide_draft_row(jsonb)') is not null
    and to_regprocedure('public.save_guide_draft(uuid, uuid, jsonb)') is not null
    and to_regprocedure('public.submit_guide(uuid, uuid, jsonb, text)') is not null
    and to_regprocedure('public.withdraw_guide(uuid, uuid, integer)') is not null),
  ('each runs as its owner with an empty search_path and a lock timeout',
    (select count(*) = 6 and bool_and(prosecdef
       and coalesce('search_path=""' = any(proconfig) and 'lock_timeout=3s' = any(proconfig), false))
      from pg_proc where pronamespace = 'public'::regnamespace and proname in
        ('guide_revision_is_kept', 'take_guide_count', 'guide_draft_row', 'save_guide_draft', 'submit_guide', 'withdraw_guide'))),
  ('only service_role may call the three site functions',
    (select bool_and(has_function_privilege('service_role', oid, 'execute')
       and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute')
       and not has_function_privilege('public', oid, 'execute'))
       from pg_proc where pronamespace = 'public'::regnamespace and proname in ('save_guide_draft', 'submit_guide', 'withdraw_guide'))),
  ('nobody may call the other three directly',
    (select bool_and(not has_function_privilege('service_role', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
       and not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('public', oid, 'execute'))
       from pg_proc where pronamespace = 'public'::regnamespace and proname in ('guide_revision_is_kept', 'take_guide_count', 'guide_draft_row'))),
  ('a sent revision is kept as it was: the trigger is on, before update or delete',
    exists (select 1 from pg_trigger where tgrelid = 'public.guide_submission_revisions'::regclass
      and tgname = 'guide_submission_revisions_kept' and tgenabled = 'O' and (tgtype::integer & 27) = 27
      and tgfoid = 'public.guide_revision_is_kept()'::regprocedure)),
  ('guide_moderators holds one account at most',
    (select count(*) <= 1 from public.guide_moderators)
    and exists (select 1 from pg_index where indrelid = 'public.guide_moderators'::regclass
      and indexrelid = to_regclass('public.guide_moderators_one') and indisunique))
) as checks(check_name, ok);
```

## The reviewer, only once review is built

Not part of this activation. `guide_moderators` is read by the review step, which is not built yet; until it is, a row
here does nothing, so leave the table empty. When review ships, Carlos is the one reviewer until he names others.

Read the id of the account Carlos signs in with, together with him, and have him confirm the BattleTag and the day the
account was made. The BattleTag only finds the account here; it is never shown as anyone's name. Never take the id from
a guide, a handle, a request or a log.

```
select id, battletag, created_at from public.users where battletag = '<his BattleTag>';
```

Then put that id in both places below and run it. Unedited, it stops at the placeholder; an id that is no account adds
nobody and reads `f`; a second account is refused while the one-reviewer index stands.

```sql
-- moderator
begin;
set local lock_timeout = '5s';
insert into public.guide_moderators (user_id, note)
  select u.id, 'Carlos, the owner' from public.users u where u.id = '<the verified account id>';
select count(*) = 1 as one_moderator, bool_and(user_id = '<the verified account id>') as that_account from public.guide_moderators;
commit;
```

Both columns must read `t`. Run the postflight again afterwards.

## Switch on

Change only `EVERLOOT_GUIDE_SUBMISSIONS`. Keep `EVERLOOT_PROFILES`, `EVERLOOT_SAVED_BUILDS`, `EVERLOOT_AUTH_V2` and every
other switch as they are.

1. Note the deployed main commit, and run the smoke test below with the switch still off.
2. Only once every prerequisite is closed and the preflight, the apply and the postflight are done with every row `t`,
   set `EVERLOOT_GUIDE_SUBMISSIONS=1` in Production and redeploy the main commit noted above. Only a strict `1` turns it
   on. Unsetting it and redeploying undoes this step.
3. Run the smoke test again with the switch on.

## Smoke test without an account

With no cookies. With the switch off:

- `GET /guides/write` is a 404, and `GET /api/me/guides` answers 404 `{"error":"Not found"}`.

With the switch on:

- `GET /guides/write` answers 307 to `/sign-in?returnTo=%2Fguides%2Fwrite`. Its `content-security-policy` is the protected
  pages' policy: `script-src 'self' 'unsafe-inline'` and `frame-src 'none'`, with no ad or analytics host.
- `GET /api/me/guides` answers 401 with `cache-control: private, no-store` and
  `{"error":"Sign in to write guides.","signIn":"/sign-in?returnTo=%2Fguides%2Fwrite"}`.
- `POST /api/me/guides` with `Origin: https://example.com`, and again with no `Origin`, answers 403
  `{"error":"Invalid origin"}` before any sign-in check or database call.
- `/guides` keeps the public pages' policy, and `/sitemap.xml` does not list `/guides/write`.

```
curl -sI https://everloot.app/guides/write
curl -si https://everloot.app/api/me/guides
curl -si -X POST -H 'origin: https://example.com' -H 'content-type: application/json' -d '{}' https://everloot.app/api/me/guides
```

## Signed-in acceptance

This needs a disposable Battle.net test account, never a real player's or the owner's. Without one, the signed-in
acceptance has not happened: record it as open, not passed.

- With a test handle on a private profile, save a draft titled plainly as a test. It lists under Your guides, and the
  preview reads "By @" and the handle. Submit it: revision 1 is waiting for review, and the profile is still private.
  Withdraw it: it reads withdrawn.
- In a second disposable account, `/guides/write` lists none of it, and `?guide=<the first account's guide id>` is a 404.
- In the browser's network panel, `/guides/write` loads nothing from an ad or analytics host.
- Then delete the test account's guides, and only those. Deleting a guide removes its revisions with it:

```
delete from public.guide_submissions where user_id = '<test user id>';
```

## Rollback

Unset `EVERLOOT_GUIDE_SUBMISSIONS` and redeploy: `/guides/write` and `/api/me/guides` answer 404 at once, and nothing is
deleted. The SQL below deletes every draft, every submitted and withdrawn revision of every player, the reviewer row and
the day's counters, and cannot be undone. Run it only on purpose, after the switch is off and after the export under
[Backup](#backup).

```sql
-- rollback
begin;
set local lock_timeout = '5s';
drop function if exists public.withdraw_guide(uuid, uuid, integer);
drop function if exists public.submit_guide(uuid, uuid, jsonb, text);
drop function if exists public.save_guide_draft(uuid, uuid, jsonb);
drop function if exists public.guide_draft_row(jsonb);
drop function if exists public.take_guide_count(text, integer);
drop table if exists public.guide_moderators;
drop table if exists public.guide_submission_revisions;
drop function if exists public.guide_revision_is_kept();
drop table if exists public.guide_submissions;
delete from public.intake_quota_buckets where bucket like 'guide\_saves:%' or bucket like 'guide\_submits:%';
notify pgrst, 'reload schema';
commit;
```

Profiles, saved builds and every other table stay as they were.
