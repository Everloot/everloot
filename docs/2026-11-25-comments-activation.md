# Comments on entity pages: migration and activation

Comments at the bottom of the item, quest, NPC, spell, zone and instance pages, and the moderation page `/ops/comments`,
need one additive migration, `supabase/migrations/20261125130000_entity_comments.sql`, and then `EVERLOOT_COMMENTS=1`.
The switch needs `EVERLOOT_PROFILES=1` as well, since a comment names its author by profile handle. Rules for players:
`docs/DATA_POLICY.md` ("Comments") and `/terms#comments`. Owner decisions of 2026-11-25: any signed-in account posts,
comments show at once, players report, the owner and the moderators hide; site only.

The owner applies the migration. Nothing in this repository applies it.

## Prerequisites

| Prerequisite | Status |
|---|---|
| `EVERLOOT_PROFILES=1` in Production. Check on the day. | OPEN |
| The owner has read the "Comments" sections of `docs/DATA_POLICY.md` and `/terms` and is content to publish them. The guide submissions runbook lists counsel's answer on user posts as open; the owner decides whether it gates comments too. | OPEN |
| At least one moderator account read and added (below), so a report has someone to read it. | OPEN |

## What the switch turns on

- Each of the six pages renders an empty Comments section. The browser fills it from `GET /comments?type=&id=`, which
  answers `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`, so the cached page carries no comment and no
  session. Signed out, the section reads and offers sign-in; signed in without a handle, it links `/settings`.
- `POST /comments` posts, edits, deletes and reports, for the session's account. Writes need this site's `Origin`, and
  the section names its account (`x-everloot-expected-owner`), as saved builds do.
- `/ops/comments` and `POST /comments/moderate`: the queue and the hide, restore and dismiss buttons, for accounts with
  a row in `comment_moderators`. Anyone else gets a 404. Under `/ops`, the middleware already sends `no-store` and
  `noindex`, and the page is a protected page (strict CSP, no ads or analytics). The buttons post to `/comments/moderate`,
  not `/api/ops`, because the middleware answers a browser fetch under `/ops` and `/api/ops` with a page-load notice. If a Cloudflare Access policy covers
  `/ops` (`docs/PRIVATE_OPERATIONS.md`), each moderator must pass it as well.
- With the switch off, the sections render nothing, and `/comments`, `/comments/moderate` and `/ops/comments` are 404s.

## What the migration adds

Three tables and eleven functions; nothing existing is altered.

- `entity_comments` (statuses `visible`, `hidden`, `deleted`; a deleted row keeps no words and never comes back),
  `entity_comment_reports` (one per account per comment) and `comment_moderators` (any number of rows).
- RLS on, no policies for the site's roles, and nothing granted on the tables to `anon`, `authenticated` or even
  `service_role`: the site reads and writes only through `post_entity_comment`, `edit_entity_comment`,
  `delete_entity_comment`, `report_entity_comment`, `moderate_entity_comment`, `entity_comments_for`,
  `comment_moderation_queue` and `is_comment_moderator`, which the service role alone may call. `take_comment_count`,
  `entity_comment_body_ok` and the trigger's `entity_comment_stays_deleted` are for those functions alone.
- `backup_exporter`, where it exists, gets `select` and its read policy on the three tables, as every other table has.
- Limits, in `intake_quota_buckets` (`comment_posts:`, `comment_edits:`, `comment_reports:`): 20 comments, 30 edits and
  30 reports per account a day; edits within 15 minutes of posting.
- Rows belong to `public.users(id)` and go with the account.

Tested on PGlite with the full migration chain: `supabase/tests/entity_comments.sql`.

## Preflight (read-only)

Every row must be `t`.

```sql
-- preflight
select check_name, ok from (values
  ('user_profiles is there, with the handle a comment names its author by',
    (select count(*) = 2 from pg_attribute where attrelid = to_regclass('public.user_profiles') and attnum > 0
      and not attisdropped and attname in ('user_id', 'handle'))),
  ('intake_quota_buckets is bucket, count, reset_at in that order',
    (select coalesce(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum), '')
       = 'bucket text, count integer, reset_at timestamp with time zone'
       from pg_attribute where attrelid = to_regclass('public.intake_quota_buckets') and attnum > 0 and not attisdropped)),
  ('none of the three tables exists yet',
    to_regclass('public.entity_comments') is null and to_regclass('public.entity_comment_reports') is null
    and to_regclass('public.comment_moderators') is null),
  ('no function has any of the eleven names',
    not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('entity_comment_stays_deleted', 'take_comment_count', 'entity_comment_body_ok', 'post_entity_comment', 'edit_entity_comment',
       'delete_entity_comment', 'report_entity_comment', 'is_comment_moderator', 'moderate_entity_comment', 'entity_comments_for',
       'comment_moderation_queue'))),
  ('gen_random_uuid() is there', to_regprocedure('gen_random_uuid()') is not null),
  ('this session may create in public', has_schema_privilege(current_user, 'public', 'create'))
) as checks(check_name, ok);
```

## Apply (owner only)

Take the usual backup first. Paste the migration file unchanged between these lines and run it once. If it stops with
an error, nothing was applied: run `rollback;`, run the preflight again and retry later.

```sql
-- apply
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- paste supabase/migrations/20261125130000_entity_comments.sql here, unchanged
commit;
```

## Postflight (read-only)

Every row must be `t`; anything else means leave the switch off and find out why.

```sql
-- postflight
select check_name, ok from (values
  ('row level security is on for the three',
    (select count(*) = 3 and bool_and(relrowsecurity) from pg_class where oid in
      ('public.entity_comments'::regclass, 'public.entity_comment_reports'::regclass, 'public.comment_moderators'::regclass))),
  ('no site role can read or write the three tables directly',
    (select bool_and(not has_table_privilege(r, t::regclass, 'select, insert, update, delete, truncate'))
       from unnest(array['anon', 'authenticated', 'service_role']) r,
         unnest(array['public.entity_comments', 'public.entity_comment_reports', 'public.comment_moderators']) t)),
  ('only service_role may call the eight site functions',
    (select count(*) = 8 and bool_and(has_function_privilege('service_role', oid, 'execute')
       and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute'))
       from pg_proc where pronamespace = 'public'::regnamespace and proname in
         ('post_entity_comment', 'edit_entity_comment', 'delete_entity_comment', 'report_entity_comment', 'moderate_entity_comment',
          'entity_comments_for', 'comment_moderation_queue', 'is_comment_moderator'))),
  ('nobody may call the three helpers',
    (select count(*) = 3 and bool_and(not has_function_privilege('service_role', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
       and not has_function_privilege('authenticated', oid, 'execute'))
       from pg_proc where pronamespace = 'public'::regnamespace and proname in ('take_comment_count', 'entity_comment_body_ok', 'entity_comment_stays_deleted'))),
  ('each of the eleven runs as its owner with an empty search_path and a lock timeout',
    (select count(*) = 11 and bool_and(prosecdef and coalesce('search_path=""' = any(proconfig) and 'lock_timeout=3s' = any(proconfig), false))
      from pg_proc where pronamespace = 'public'::regnamespace and proname in
        ('entity_comment_stays_deleted', 'take_comment_count', 'entity_comment_body_ok', 'post_entity_comment', 'edit_entity_comment',
         'delete_entity_comment', 'report_entity_comment', 'is_comment_moderator', 'moderate_entity_comment', 'entity_comments_for',
         'comment_moderation_queue'))),
  ('a deleted comment stays deleted: the trigger is on',
    exists (select 1 from pg_trigger where tgrelid = 'public.entity_comments'::regclass
      and tgname = 'entity_comments_stay_deleted' and tgenabled = 'O'))
) as checks(check_name, ok);
```

## Moderators

Read each moderator's account id together with them, and have them confirm it is the account they sign in with. Never
take an id from a comment, a handle, a request or a log. The owner adds their own account first.

```
select u.id, p.handle, u.created_at from public.users u left join public.user_profiles p on p.user_id = u.id where p.handle = '<their handle>';
```

```sql
-- moderator
insert into public.comment_moderators (user_id, note)
  select u.id, '<who, in a few words>' from public.users u where u.id = '<the verified account id>';
select count(*) as moderators from public.comment_moderators;
```

To remove one: `delete from public.comment_moderators where user_id = '<id>';`. Their past actions stay recorded on the
comments (`moderated_by`, which becomes null if their account is deleted).

## Switch on

1. Note the deployed main commit and run the smoke test below with the switch off.
2. Once the prerequisites are closed and the preflight, apply and postflight read `t`, set `EVERLOOT_COMMENTS=1` in
   Production and redeploy that commit. Only a strict `1` turns it on.
3. Run the smoke test again, then the signed-in check.

## Smoke test without an account

Switch off: `GET /comments?type=item&id=19019`, `GET /ops/comments` and `POST /comments/moderate` are 404s, and item
pages have no Comments heading.

Switch on:

- `GET /comments?type=item&id=19019` answers 200 with `cache-control: private, no-store`, `x-robots-tag: noindex` and
  `"viewer":null`. `?type=guild&id=1` is a 400.
- `POST /comments` with `Origin: https://example.com`, and with no `Origin`, answers 403 before any sign-in check.
- `GET /ops/comments` is a 404 signed out.
- An item page's HTML has the empty section (`id="comments"`, "Loading comments") and no comment text, and its
  `cache-control` is what it was before the switch.

```
curl -si 'https://everloot.app/comments?type=item&id=19019'
curl -si -X POST -H 'origin: https://example.com' -H 'content-type: application/json' -d '{}' https://everloot.app/comments
curl -sI https://everloot.app/ops/comments
```

## Signed-in check

With a disposable test account that has a handle, never a real player's: post a comment on an item page, edit it,
report it from a second test account, hide it from `/ops/comments` as a moderator, restore it, then delete it as its
author. The page shows "deleted by its author" in its place. Then remove the test rows:

```
delete from public.entity_comments where user_id in ('<test id 1>', '<test id 2>');
```

## Rollback

Unset `EVERLOOT_COMMENTS` and redeploy: the sections disappear and the routes answer 404 at once; nothing is deleted.
The SQL at the end of the migration file drops the tables and functions and deletes every comment, report, moderator
and counter. Run it only on purpose, after the switch is off and after a backup.
