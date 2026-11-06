# Private sync and published sections: switch-on steps

Date: 2026-11-06. Turns on private sync of linked characters and the owner's section switches (showcase plan S5 and
S6) in production. "Owner" steps touch production and only the owner runs them; agents write the PRs and the smoke
checks.

What the switch does:

| `EVERLOOT_PRIVATE_SYNC` | Players get |
|---|---|
| off (today) | `POST /api/me/characters/sync`, `/api/me/characters/links/<id>/sync` and `/me/characters/links/<id>` answer 404. The key form has no "Sync my linked characters". The visibility route refuses every `show_*` switch. Nothing reads or writes `character_sync_consent` or `character_facts`. Character pages are as before. |
| on | A `sync:own` key can be made on /account. The Desktop App can send linked characters' rows with it; each category is kept only when its sync is on. The owner sees everything synced on `/me/characters/links/<id>`. A section shows on the public page only with the page on, that section's switch on, and its sync on. |

Only a strict `1` turns it on, and it also needs `EVERLOOT_CHARACTER_LINKS=1`. The public sections also need
`EVERLOOT_SHOWCASE=1`. Turning `EVERLOOT_PRIVATE_SYNC` off takes every published section off every page on the next
request; the stored facts stay until their link is unlinked or their sync is turned off.

## Before

| # | Who | Step | Pass |
|---|---|---|---|
| 1 | Owner | Character links and public pages are live: the [go-live checklist](2026-11-02-showcase-go-live.md) is done. | `EVERLOOT_CHARACTER_LINKS=1` and `EVERLOOT_SHOWCASE=1` in `web/wrangler.jsonc`, and its readback passes. |
| 2 | Owner | Approve the "Private sync and owner-published sections" section of [DATA_POLICY](DATA_POLICY.md) (a draft), and add a matching /privacy item in the same PR that sets the switch. | Text merged. |
| 3 | Agent | The pieces that make it usable are merged: account-page controls for sync and the section switches, and the Desktop App's sync sender. Without them the switch works but nobody can use it. | PRs merged. |
| 4 | Owner | `20261021190000_character_links.sql` and `20261022120000_api_key_expiry.sql` are applied (the migration checks and stops otherwise). Apply `supabase/migrations/20261106120000_private_sync.sql` in the Supabase SQL editor. It is safe to run twice. | No error. |
| 5 | Owner | Run the readback below. It only reads. | Every row `t`. |

```sql
-- readback: 20261106120000_private_sync.sql
select 'consent table' as check, to_regclass('public.character_sync_consent') is not null as ok
union all select 'facts table', to_regclass('public.character_facts') is not null
union all select 'switches', (select count(*) = 4 from information_schema.columns where table_schema = 'public'
    and table_name = 'character_visibility' and column_name in ('show_talents', 'show_professions', 'show_reputations', 'show_raids'))
union all select 'scope', pg_get_constraintdef((select oid from pg_constraint where conname = 'api_keys_scopes_check')) like '%sync:own%'
union all select 'key', has_function_privilege('service_role', 'public.sync_account_for_key(text)', 'EXECUTE')
union all select 'consent', has_function_privilege('service_role', 'public.set_sync_consent(uuid, uuid, text, boolean)', 'EXECUTE')
union all select 'sync', has_function_privilege('service_role', 'public.sync_character_facts(uuid, text, text, text, text, text, jsonb)', 'EXECUTE')
union all select 'own', has_function_privilege('service_role', 'public.own_character_facts(uuid, uuid)', 'EXECUTE')
union all select 'public', has_function_privilege('service_role', 'public.public_character_facts(text, text, text)', 'EXECUTE')
union all select 'closed', not has_function_privilege('anon', 'public.public_character_facts(text, text, text)', 'EXECUTE')
  and not has_table_privilege('service_role', 'public.character_facts', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', 'public.character_sync_consent', 'SELECT,INSERT,UPDATE,DELETE');
```

SQL checks on a disposable database: `supabase/tests/private_sync.sql`, after every migration up to this one.

## Switch

| # | Who | Step | Pass |
|---|---|---|---|
| 6 | Agent | PR: `"EVERLOOT_PRIVATE_SYNC": "1"` in `web/wrangler.jsonc` vars, with the /privacy item from step 2. | Checks green. |
| 7 | Owner | Merge and deploy. | Deploy green. |

## Smoke (after deploy)

| # | Check | Pass |
|---|---|---|
| 8 | `curl -i -X POST https://everloot.app/api/me/characters/sync` with no key | 401, `Cache-Control: private, no-store`. |
| 9 | The same with a key that has only `read:public` | 403. With a revoked key: 401. |
| 10 | On /account, make a key with "Sync my linked characters"; turn gear sync on for one linked character; send that character's `gear_snapshot` with the key | Receipt `synced` with `gear: stored`; sending it again says `duplicate`. |
| 11 | Open `/me/characters/links/<id>` signed in | The gear section shows; the settings list says sync on, public off. Signed out, or as another account: sign-in redirect or 404. |
| 12 | Turn the page and `show_gear` on; open the public page signed out | The Gear section shows, with "From the player's own addon upload" and no account, handle or key in the HTML. |
| 13 | Turn `show_gear` off; reload | The Gear section is gone. |
| 14 | Turn gear sync off; check `/me/characters/links/<id>` | "Nothing synced for this yet." The fact is deleted. |

## Rollback

Unset `EVERLOOT_PRIVATE_SYNC` and deploy: every route above answers 404 again and pages stop reading facts. To remove
the data as well, run the rollback block at the end of the migration by hand.
