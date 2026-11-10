# MCP gameplay discovery verification

Verified 2026-11-10, offline. No deployment or registry publication.

## Regression checks

`kb/test/gameplay-discovery.test.ts` reproduces both original misses and verifies:

- Linen Cloth resolves to item gameId 2589; recordId reads the same hit with get_entity and fetch, and gameId chains into item_page.
- An agreed NPC name resolves to gameId 3840 and chains into npc_page.
- Elwynn Forest resolves to UiMap gameId 1429; its string form chains into world_map_near.zone.
- Lore remains labelled lore, without a gameId. Original eight synthetic-id ranges remain fixed.
- One or two reporters, conflicting agreed names, refreshed/unavailable storage and held-back zones do not leak metadata.
- Quest and object metadata expose only agreed names and allowlisted identity/provenance, never description or tooltip text.

The first run on the original handlers failed the item and zone cases. All eight regression tests now pass.
The web mount's real readers also resolve the item and zone cases in its integration test.

## Question bank

Generated the 2,786-question files-only bank using `npm run kb -- question-bank --files-only`.
Ran `question-eval` before and after against the same local approved `2026-10-24-everloot-public.sqlite` release,
with no corpus connection, the committed game-data files, and the default evidence limit of 8.

| Measure | Before | After |
|---|---:|---:|
| Questions | 2786 | 2786 |
| Exact resolution | 1885 | 1885 |
| Search resolution | 23 | 23 |
| Unresolved | 838 | 838 |
| With evidence | 2776 | 2776 |
| With observed evidence | 0 | 0 |
| With file evidence | 2556 | 2556 |
| With a page | 2752 | 2752 |
| Answer keys found | 1527 | 1527 |

This evaluator calls release search directly, not the generic MCP handlers. Its unchanged totals are a
regression baseline, not a measure of the new gameplay discovery path or of live answerability.
The ID-chain tests above measure this fix. No current production corpus or live transport result is claimed.

## Validation

- All five requested packages installed with `npm ci`.
- KB full suite: 1,988 passed, one skipped, across 168 files; eight discovery regressions also passed after the final test additions.
- Web mount, catalog and MCP docs: 18 passed across three files.
- Protocol: 98 passed across eight files; dist and MCP JSON schemas regenerated with `npm run build`.
- `npx tsc --noEmit` in KB and web; web lint passes with five existing warnings; production `npx next build` passes.
- PR title format, whitespace and eleventh Added changelog bullet checked.

Protocol 2.1.0 adds optional fields only. All existing tool names remain unchanged; existing id ranges are preserved.
