# Search names from one small stored file: implementation plan

**Goal:** `/search/suggest` and `/search` read the names they match from a cron-written file of a few hundred KB instead of parsing the 13.9 MB stored aggregate on every fresh server instance (11/19: cold suggest 2–7 s, isolates recycled under memory pressure, #1354).

**Architecture:** the snapshot cron builds `snapshots/search-names.json` from the same aggregate set it just stored (same name rules as `names.ts`, so nothing a page would not print). A reader keeps it five minutes per instance with ETag revalidation (`kept.ts`, the `aggregate-store.ts` pattern). `loadSearchShown()` serves the search surfaces from the file, merged with the private game-file names as today, and falls back to the aggregate path when there is no file. The aggregate is then only read on the search page when a quest or NPC hit needs its facts.

**Spec facts:** file holds agreed item/NPC/quest/object names, the unanimous NPC names that may map to wiki names (`npcReportedName`), and the item ids with a public drop rate (`showsTip`). Revision `names-1`. Written when the run added uploads, rebuilt, or the file is missing or stale, right after the aggregates, sharing the built set.

## Tasks

1. `web/src/lib/search-names-store.ts`: `SEARCH_NAMES_KEY`, `SEARCH_NAMES_REVISION`, `buildSearchNames(set): SearchNamesFile`, `encodeSearchNames`/`parseSearchNames`, `writeSearchNames(opts, deps)`, `loadStoredSearchNames(deps)` (keep + ETag, null without cloud or file). Test: round trip equals `names.ts` maps and `loadShownNames`'s `dropped`; write rules; reader keep/ETag/null.
2. `web/src/lib/shown-search-names.ts`: `loadSearchShown(): Promise<{ names: Names; showsTip: (id: number) => boolean }>`: file path first, else today's path. `item-icons.ts` `shownItemIcons` accepts `Promise<Pick<ShownNames, "showsTip">>`. Tests: fast path merges private item/quest names and wiki NPC candidates; fallback unchanged.
3. `web/src/app/search/suggest/route.ts` and `web/src/app/search/page.tsx` use `loadSearchShown()`. Tests: suggest never reads item facts when the file is present; search page tests' mocks updated; request-facts test keeps its counts (no cloud → fallback).
4. `web/src/app/api/cron/snapshot/route.ts`: `aggOnce()` shared by `writeAggregates` and `writeSearchNames`; response gains `searchNames`. Test in the cron's test file if one exists; else covered by the store test.
5. CHANGELOG line; full suite, typecheck, lint; reviewer; PR.
