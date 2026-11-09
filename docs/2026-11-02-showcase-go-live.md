# Public character pages: go-live checklist

Date: 2026-11-02. Turns on character links and public character pages (showcase slices S2 and S3) in production.
Run it once the owner has answered the [decision sheet](2026-11-02-showcase-decisions.md). "Owner" steps touch
production and only the owner runs them; agents write the PR and the smoke checks.

What the two switches do:

| `EVERLOOT_CHARACTER_LINKS` | `EVERLOOT_SHOWCASE` | Players get |
|---|---|---|
| off | off | Today. The link and page routes answer 404; /account has no Linked characters section. |
| on | on | /account lists linked characters with Make a link code, Unlink and Public page on/off. `/characters/...` shows a character whose owner turned its page on, with two share images. `/showcase/character` shows the sample page (noindex, with its sample banner). |
| off | on | The link routes answer 404, so no new link can be made. Pages and cards of characters **already linked** with their page on **still show**: `/characters/...` checks only `EVERLOOT_SHOWCASE`. |
| on | off | Links can be made and managed on /account; every public page and card answers 404. |

Only a strict `1` turns a switch on. Before the first link exists the order of the two lines does not matter. After
that, **turning off `EVERLOOT_SHOWCASE` is what takes the public pages down**; turning off links alone does not.

## Before

| # | Who | Step | Pass |
|---|---|---|---|
| 1 | Owner | Answer the decision sheet. | Answers written in the go-live PR. |
| 2 | Owner | Run the readback below in the Supabase SQL editor. It only reads. | Every row `t`. Any `f`: stop, apply `supabase/migrations/20261021190000_character_links.sql` (safe to run twice; it needs `20261021150000_saved_builds.sql` and `20261021130000_players.sql`, both already applied), run the readback again. |
| 3 | Owner | From `web/`: `npx wrangler secret list`. | `EVERLOOT_CHARACTER_KEY` is listed (set 10/28). Without it every link answers 503. |
| 4 | Agent | Open the go-live PR (below). | Checks green; owner reviews. |

```sql
-- readback: 20261021190000_character_links.sql
select check_name, ok from (values
  ('the three link tables exist',
    to_regclass('public.link_codes') is not null and to_regclass('public.character_links') is not null
      and to_regclass('public.character_visibility') is not null),
  ('row level security is on for all three',
    coalesce((select count(*) = 3 and bool_and(relrowsecurity) from pg_class where oid in
      (to_regclass('public.link_codes'), to_regclass('public.character_links'), to_regclass('public.character_visibility'))), false)),
  ('anon and authenticated cannot read or write them',
    coalesce((select bool_and(not has_table_privilege(r, t, 'SELECT,INSERT,UPDATE,DELETE'))
      from unnest(array['anon', 'authenticated']) r,
      unnest(array[to_regclass('public.link_codes'), to_regclass('public.character_links'), to_regclass('public.character_visibility')]) t
      where t is not null), false)),
  ('the hide list the links check exists', to_regclass('public.character_suppressions') is not null),
  -- 9 switches; 13 once 20261106120000_private_sync.sql has added the four section switches.
  ('every visibility switch starts off',
    (select count(*) in (9, 13) and bool_and(column_default = 'false') from information_schema.columns
      where table_schema = 'public' and table_name = 'character_visibility' and data_type = 'boolean')),
  ('the server can call the six site functions',
    coalesce((select count(*) = 6 and bool_and(has_function_privilege('service_role', f, 'EXECUTE')) from unnest(array[
      to_regprocedure('public.create_link_code(uuid, text)'),
      to_regprocedure('public.redeem_link(uuid, text, text, text, text, text, text, text, text, integer, text, boolean)'),
      to_regprocedure('public.unlink_character(uuid, uuid)'),
      to_regprocedure('public.set_visibility(uuid, uuid, jsonb)'),
      to_regprocedure('public.public_character(text, text, text)'),
      to_regprocedure('public.link_account_for_key(text)')]) f where f is not null), false)),
  ('anon and authenticated cannot call them',
    coalesce((select bool_and(not has_function_privilege(r, f, 'EXECUTE'))
      from unnest(array['anon', 'authenticated']) r, unnest(array[
      to_regprocedure('public.create_link_code(uuid, text)'),
      to_regprocedure('public.redeem_link(uuid, text, text, text, text, text, text, text, text, integer, text, boolean)'),
      to_regprocedure('public.unlink_character(uuid, uuid)'),
      to_regprocedure('public.set_visibility(uuid, uuid, jsonb)'),
      to_regprocedure('public.public_character(text, text, text)'),
      to_regprocedure('public.link_account_for_key(text)'),
      to_regprocedure('public.take_link_code(uuid)')]) f where f is not null), false)),
  ('the server can read the link and visibility tables directly',
    coalesce((select bool_and(has_table_privilege('service_role', t, 'SELECT')) from unnest(array[
      to_regclass('public.character_links'), to_regclass('public.character_visibility')]) t), false)),
  ('API keys may carry link:own',
    coalesce((select pg_get_constraintdef(oid) like '%link:own%' from pg_constraint
      where conrelid = to_regclass('public.api_keys') and conname = 'api_keys_scopes_check'), false))
) as checks(check_name, ok);
```

Tested on a disposable Postgres 17: all `t` with every migration applied, all `f` on an empty database, and `f` on
the two access rows after a stray grant to `anon` or `authenticated`. The row "the server can read the link and
visibility tables directly" was added after review. It must turn `f` after
`revoke select on public.character_links from service_role;` (and the same for `character_visibility`), since the
owner list and the visibility controls read those tables directly, not only through the functions. Run on
2026-11-02 against a disposable `supabase/postgres:17.6.1.106` with all 23 migrations in `supabase/migrations/`
applied: every row `t`; after that revoke, this row alone turned `f`; after granting it back, every row `t` again.

## The go-live PR

One PR, so the words and the feature reach players in the same deploy:

- `web/wrangler.jsonc`, under `vars`, after `"EVERLOOT_CHAT_WORKSPACE": "1",`:

  ```jsonc
      "EVERLOOT_CHARACTER_LINKS": "1",
      "EVERLOOT_SHOWCASE": "1",
  ```

- `docs/DATA_POLICY.md`: the policy draft's section, after "Profiles", with the D8 answer in place of the
  placeholder. Mark the draft file accepted.
- `web/src/app/privacy/page.tsx`: the [proposed text](2026-11-02-showcase-privacy-text.md), with the D8 answer.
- `web/src/components/LinkedCharacters.tsx`: `FROZEN_TEXT` names the D8 contact and reply time.
- `CHANGELOG.md` under Unreleased.

Merging deploys it: the deploy-worker workflow runs after the Release checks pass on `main`, about ten minutes.
The footer's Source link names the live commit.

## Smoke checks (after the deploy)

Signed out, from any shell:

```sh
# The link list asks for sign-in instead of 404: links are on.
curl -s -o /dev/null -w "%{http_code}\n" https://everloot.app/api/me/characters/links          # 401
# A character nobody made public is a 404, and so is its card.
curl -s -o /dev/null -w "%{http_code}\n" https://everloot.app/characters/forever/no-realm/nobody  # 404
curl -s -o /dev/null -w "%{http_code}\n" https://everloot.app/characters/forever/no-realm/nobody/card.png  # 404
# The sample page is up and noindex.
curl -s https://everloot.app/showcase/character | grep -o '<meta name="robots"[^>]*>'          # noindex
```

Signed in as the owner, with addon 0.3.15 or later and the Desktop App 0.1.12 or later:

1. /account shows **Linked characters**. Make a link code, type `/everloot link <code>` on a character, `/reload`,
   let the Desktop App send it, press Check again. It shows Linked and Public page: off.
2. Open the character's address (`/characters/forever/<realm>/<name>`): 404 while the page is off.
3. Make it public. The page shows the name, "Level N Race Class · Realm", "From the player's own addon upload, ...",
   the "Not checked against Blizzard" footer and the hide link. View source has `noindex`. `card.png` is
   1200x630; Download card gives the square one.
4. `curl -sI` the page and `card.png`: `cache-control` must not say `public` or `s-maxage`. The card says
   `no-store` and `x-robots-tag: noindex`.
5. Make it private and reload: the page and both cards are 404 at once.

If 3 to 5 fail, roll back.

## Rollback

- **Before the go-live deploy (owner):** from `web/`, `npx wrangler deployments list` and write down the current
  Worker **version ID** in the go-live PR. That is the version to go back to.
- **At once (owner):** from `web/`, `npx wrangler rollback <that version ID>`. A bare `npx wrangler rollback` goes
  to the version just before the current one, which still has both switches on if anything was deployed after
  go-live. ([Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/).) Then check
  that a public page, its `card.png` and `/api/me/characters/link-codes` all answer 404, and revert the go-live PR,
  so the next merge does not turn it back on.
- **What it leaves:** links and their page switches stay in the database, unread. Pages, cards and link routes
  answer 404 and /account hides the section. Turning the switches on again brings every page back as its owner
  left it. Nothing needs deleting.
- **One page, without a rollback (owner):** `update public.character_visibility set page_public = false where
  link_id = '<id>';` in the SQL editor. The page is a 404 on the next request. Find the id with
  `select id, ruleset, realm, name, status from public.character_links where name_key = lower('<name>');`.
- **A frozen character:** settle it as the comment at the end of the migration says.

## The first day

Read-only, in the SQL editor, a few times over the day:

```sql
select status, count(*) from public.character_links group by status;
select count(*) filter (where page_public) as public_pages, count(*) filter (where indexable) as indexable
  from public.character_visibility;
select ruleset, realm, name, user_id, linked_at from public.character_links
  where status = 'frozen' order by realm_key, name_key, linked_at;
```

- `indexable` above 0 is a bug (the API refuses it): roll back.
- Any frozen character is a dispute. Answer anyone who writes within the D8 time.
- The `hello@everloot.app` inbox: anyone saying a page shows their character without their consent. Point them to
  the hide form, which takes the page down without an account, or turn the page off yourself (above).
- Worker logs (Cloudflare dashboard; requests are sampled at 10%): 5xx on `/api/me/characters/` or `/characters/`.
  A steady 503 on the link routes means the database or `EVERLOOT_CHARACTER_KEY`.
- A 429 on `/api/me/characters/link-codes` ("You made 10 codes in the last day") is the daily limit working, not a
  fault.
