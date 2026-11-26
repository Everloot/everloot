# Player screenshots on entity pages: migration, bucket and activation

Screenshots on the item, quest, NPC, spell, zone and instance pages, and the moderation page `/ops/screenshots`, need
one additive migration, `supabase/migrations/20261125140000_entity_screenshots.sql`, an R2 bucket and the Cloudflare
Images binding on the site's Worker, and then `EVERLOOT_SCREENSHOTS=1`. The switch needs `EVERLOOT_PROFILES=1` as well,
since the gallery credits an uploader by profile handle. Rules for players: `docs/DATA_POLICY.md` ("Screenshots") and
`/terms#screenshots`. Owner decisions of 2026-11-25: signed-in accounts upload; nothing shows until a moderator
approves it; 5 a day and 8 MB per file; site only; uploaders delete their own.

The owner applies the migration, creates the bucket and adds the bindings. Nothing in this repository does any of it.

## Prerequisites

| Prerequisite | Status |
|---|---|
| `20261125130000_entity_comments.sql` is applied (PR #1512). The moderators are its `comment_moderators` rows, and the limits use its `take_comment_count`. | OPEN |
| `EVERLOOT_PROFILES=1` in Production. Check on the day. | OPEN |
| The owner has read the "Screenshots" sections of `docs/DATA_POLICY.md`, `docs/ASSETS.md` and `/terms` and is content to publish them. Counsel's open question on user posts (guide submissions runbook) applies here too; the owner decides whether it gates screenshots. | OPEN |
| At least one row in `comment_moderators`, so an upload has someone to review it. | OPEN |
| Cloudflare Images transformations are available on the account (the Images binding is billed per unique transformation; one upload costs one). | OPEN |

## Steps, in order

1. **Preflight**, read-only, below. Every row `t`.
2. **Apply** the migration, below. Then the **postflight**; every row `t`.
3. **Create the bucket** (private, no public access, no custom domain, no `r2.dev` URL):
   ```
   cd web
   npx wrangler r2 bucket create everloot-screenshots
   ```
   The site never makes it public: it serves approved files itself, after checking the row.
4. **Bind it and Cloudflare Images to the site's Worker** in `web/wrangler.jsonc` (not the cron Worker), in a PR of its
   own that the owner merges after step 3, because a deploy fails while a bound bucket does not exist:
   ```jsonc
   "r2_buckets": [
     { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "everloot-next-cache" },
     // Player screenshots (docs/2026-11-25-screenshots-activation.md): private; the site serves approved files itself.
     { "binding": "SCREENSHOTS", "bucket_name": "everloot-screenshots" }
   ],
   // Re-encodes player screenshots to WebP on upload (web/src/lib/screenshots.ts).
   "images": { "binding": "IMAGES" },
   ```
   Deploy it with the switch still off. Nothing changes for visitors.
5. **Turn it on**: add `"EVERLOOT_SCREENSHOTS": "1"` to `vars` in `web/wrangler.jsonc` (same PR as step 4, or the next one)
   and deploy.
6. **Check on the site**, signed in as a moderator, below.

With the switch off, or either binding missing, the sections render nothing (switch off) or say screenshots are
unavailable (bindings missing), and `/screenshots...` and `/ops/screenshots` are 404s or 503s. Nothing is stored.

## What the switch turns on

- Each of the six pages renders an empty Screenshots section above its comments. When it nears the screen, the browser
  asks `GET /screenshots?type=&id=` without cookies: approved screenshots only, the same answer for everyone, cached
  five minutes (`Cache-Control: public, max-age=300`, `CDN-Cache-Control: max-age=300`), `X-Robots-Tag: noindex`. It
  also asks `GET /screenshots/mine?type=&id=` (`private, no-store`) for the viewer and their own uploads.
- `POST /screenshots` (multipart: `type`, `id`, `file`, `confirm=yes`) uploads, for the session's account, with this
  site's `Origin` and the expected-owner header. Refused before anything is read: no `Content-Length` (411), over 8 MB
  (413), first bytes not PNG, JPEG or WebP (415), the licence box unticked (400). Refused before any re-encode: no handle
  (409), 10 waiting (429), 5 today (429), 300 site-wide today (429). Then Cloudflare Images must read it as the type its
  bytes say, at most 40 megapixels; it returns a still WebP at most 1920 px a side; `cleanWebp` keeps only its pixel
  chunks; the copy must be at most 2,000,000 bytes. The row is written, then the file to `screenshots/pending/<id>.webp`;
  if the file write fails, the row is deleted again.
- `/ops/screenshots` and `POST /screenshots/moderate`: the queue with Approve, Reject and Take down, for accounts with a
  row in `comment_moderators`. Anyone else gets a 404. Approve copies the file to `screenshots/public/<id>.webp`, marks
  the row approved and removes the pending copy. Reject marks the row and removes both copies. The page is under `/ops`
  (no-store, noindex, strict CSP); the buttons post outside it because the middleware answers browser fetches under
  `/ops` and `/api/ops` with a page-load notice. If Cloudflare Access covers `/ops`, each moderator must pass it.
- `GET /screenshots/file/<id>`: an approved file, to anyone, cached an hour by browsers and the edge (the edge drops
  cookies on this path). `GET /screenshots/review/<id>`: a waiting file, to its uploader and the moderators only, never
  cached. Both answer only what `entity_screenshot_access` allows, always as `image/webp` with `nosniff`.
- `POST /screenshots/mine {action: "delete", screenshotId}`: the uploader deletes their own; both copies go.

## What the migration adds

One table and nine functions; nothing existing is altered.

- `entity_screenshots`: page, uploader, status (`pending`, `approved`, `rejected`, `deleted`), the stored copy's width,
  height and bytes, and when it was uploaded, moderated (and by whom) or deleted. A trigger keeps a row's page, uploader,
  time and size, and a deleted row deleted. No picture is stored in the database.
- RLS on, no policies for the site's roles, nothing granted on the table to `anon`, `authenticated` or `service_role`:
  the site reads and writes only through `submit_entity_screenshot`, `screenshot_upload_refusal`,
  `delete_entity_screenshot`, `moderate_entity_screenshot`, `entity_screenshots_for`, `my_entity_screenshots`,
  `entity_screenshot_access` and `screenshot_moderation_queue`, which the service role alone may call. The trigger's
  `entity_screenshot_stays_deleted` is callable by nobody.
- Moderators are `comment_moderators` rows (`is_comment_moderator`).
- `backup_exporter`, where it exists, gets `select` and its read policy on the table.
- Limits in `intake_quota_buckets` (`screenshot_uploads:<account>`, `screenshot_uploads:site`): 5 per account a day,
  300 a day site-wide; 10 waiting per account at once.
- Rows belong to `public.users(id)` and go with the account.

Tested on PGlite with the full migration chain: `supabase/tests/entity_screenshots.sql`.

## Preflight (read-only)

Every row must be `t`.

```sql
-- preflight
select check_name, ok from (values
  ('comments are applied: comment_moderators and take_comment_count are there',
    to_regclass('public.comment_moderators') is not null and to_regprocedure('public.take_comment_count(text,integer)') is not null
    and to_regprocedure('public.is_comment_moderator(uuid)') is not null),
  ('user_profiles is there, with the handle the gallery credits',
    (select count(*) = 2 from pg_attribute where attrelid = to_regclass('public.user_profiles') and attnum > 0
      and not attisdropped and attname in ('user_id', 'handle'))),
  ('intake_quota_buckets is bucket, count, reset_at in that order',
    (select coalesce(string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum), '')
       = 'bucket text, count integer, reset_at timestamp with time zone'
       from pg_attribute where attrelid = to_regclass('public.intake_quota_buckets') and attnum > 0 and not attisdropped)),
  ('the table does not exist yet', to_regclass('public.entity_screenshots') is null),
  ('no function has any of the nine names',
    not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('entity_screenshot_stays_deleted', 'submit_entity_screenshot', 'screenshot_upload_refusal', 'delete_entity_screenshot',
       'moderate_entity_screenshot', 'entity_screenshots_for', 'my_entity_screenshots', 'entity_screenshot_access',
       'screenshot_moderation_queue'))),
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
-- paste supabase/migrations/20261125140000_entity_screenshots.sql here, unchanged
commit;
```

## Postflight (read-only)

Every row must be `t`; anything else means leave the switch off and find out why.

```sql
-- postflight
select check_name, ok from (values
  ('row level security is on', (select relrowsecurity from pg_class where oid = 'public.entity_screenshots'::regclass)),
  ('no site role can read or write the table directly',
    (select bool_and(not has_table_privilege(r, 'public.entity_screenshots', 'select, insert, update, delete, truncate'))
       from unnest(array['anon', 'authenticated', 'service_role']) r)),
  ('only service_role may call the eight site functions',
    (select count(*) = 8 and bool_and(has_function_privilege('service_role', oid, 'execute')
       and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute'))
       from pg_proc where pronamespace = 'public'::regnamespace and proname in
         ('submit_entity_screenshot', 'screenshot_upload_refusal', 'delete_entity_screenshot', 'moderate_entity_screenshot',
          'entity_screenshots_for', 'my_entity_screenshots', 'entity_screenshot_access', 'screenshot_moderation_queue'))),
  ('nobody may call the trigger function',
    (select not has_function_privilege('service_role', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
       and not has_function_privilege('authenticated', oid, 'execute')
       from pg_proc where pronamespace = 'public'::regnamespace and proname = 'entity_screenshot_stays_deleted')),
  ('each of the nine runs as its owner with an empty search_path and a lock timeout',
    (select count(*) = 9 and bool_and(prosecdef and coalesce('search_path=""' = any(proconfig) and 'lock_timeout=3s' = any(proconfig), false))
      from pg_proc where pronamespace = 'public'::regnamespace and proname in
        ('entity_screenshot_stays_deleted', 'submit_entity_screenshot', 'screenshot_upload_refusal', 'delete_entity_screenshot',
         'moderate_entity_screenshot', 'entity_screenshots_for', 'my_entity_screenshots', 'entity_screenshot_access',
         'screenshot_moderation_queue'))),
  ('the trigger is on the table',
    exists (select 1 from pg_trigger where tgrelid = 'public.entity_screenshots'::regclass and tgname = 'entity_screenshots_stay_deleted')),
  ('the table is empty', not exists (select 1 from public.entity_screenshots))
) as checks(check_name, ok);
```

## Moderators

The same accounts as for comments. To add one, read their id from `public.users` and:

```sql
insert into public.comment_moderators (user_id, note) values ('<their id>', '<who>');
```

## Check on the site

1. Signed out, open an item page: a Screenshots section above the comments, "No screenshots yet.", "Sign in to add a
   screenshot." The page's HTML (view source) holds no picture and no handle.
2. Signed in with a handle, upload a PNG game screenshot. "Thanks. A moderator will look at it", and "Your screenshots on
   this page" shows it as "Waiting for review". Signed out in another browser, the gallery still shows nothing.
3. Upload a text file renamed `.png`: "That file is not a PNG, JPEG or WebP picture." Nothing is counted.
4. As a moderator, open `/ops/screenshots`, check the picture and approve it. Within five minutes it shows on the item
   page for everyone. Download it and check it has no EXIF (`exiftool <file>` shows only file and RIFF fields).
5. Take it down from `/ops/screenshots`. It leaves the gallery within five minutes and `/screenshots/file/<id>` is a 404
   once the edge's hour is up (a cached copy may answer until then).
6. In the R2 dashboard, `everloot-screenshots` holds only `screenshots/pending/` and `screenshots/public/` objects.

## Account deletion and orphaned files

Deleting an account deletes its rows; its files stay in the bucket but are never served, since every file route checks
the row first. A file delete that failed leaves the same kind of orphan. Remove them by hand now and then: list the ids
in the bucket, and delete every object whose id has no row, or whose row is `rejected` or `deleted`:

```sql
-- ids whose files should be in the bucket; any other object can go
select id, status from public.entity_screenshots where status in ('pending', 'approved');
```

## Rollback

Set `EVERLOOT_SCREENSHOTS` off (remove the var) and deploy: the sections disappear and the routes answer 404. To remove
the data as well, run the rollback at the end of the migration file, then empty and delete the bucket and remove the two
bindings. This deletes every screenshot.

## Known limits

- No bot check (the repo has no Turnstile); the daily limits and the review queue are the defence.
- A moderator sees a waiting picture in their browser before it is published. It has already been decoded and
  re-encoded by Cloudflare Images, and the stored file is pixel chunks only, so a crafted file never reaches a browser as
  it was sent.
- A taken-down or deleted picture can stay in browser and edge caches for up to an hour.
- No thumbnails: the gallery loads the stored copy (at most 1920 px, usually a few hundred KB) lazily.
- Approval is per picture; there is no ban tool beyond removing an account's moderator row or SQL.
