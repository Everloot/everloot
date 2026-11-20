# Object pages

Drop-rate rule updated 2026-11-19: rates, measured zeros and unanimous drop source names now show from one install, labelled reported, verified at two, confirmed at three or more. This supersedes the drop publication thresholds described below; other thresholds stay unchanged. See [DATA_POLICY.md](../../DATA_POLICY.md).

**Date:** 2026-10-18
**Status:** step 4 of 5 from the [database taxonomy research](../../2026-10-18-database-taxonomy-research.md).
**Depends on:** item taxonomy (step 3).

## Why

Herbs, ore and chests are what gatherers search for. The addon already records which object a loot
window came from (`sourceObjectId`, the entry id in the object's GUID), and the drop table counts
it, but there is no object kind and no page.

## What gets built

- `object` joins `Kind` (`kb/src/entities.ts`) and the search filter.
- `kb/src/object-page.ts`: per object, its public drops (frequency over observed loot windows,
  public after 3 install reports, the same rule as NPCs), agreed item names, a measured zero when
  three installs opened it and found nothing, and whether observations are queued below the rule.
  `objectList` lists the objects with public observations, most-looted first.
- Pages: `/database/objects` (list and id lookup) and `/database/objects/[id]`. An object page is
  indexed only when it has public observations. Item pages now link each drop source to its NPC or
  object page; relation links to objects go there too.
- MCP `object_page`, after `npc_page`. The same data is in `/api/rollups/drops` (rows with
  `sourceObjectId`) and `/api/edges?to_kind=object`.

## What the client's `GameObjects` table gives

Nothing for these pages, in build 1.60.1.70450. Of its 1,526 rows, 1,521 are type 5 (map labels
such as "Old Coast Road"), 2 are type 38 and 3 type 48. There is no type 3 (chests, herbs and ore
are all type 3), and its ids are the client's own placement records, not the entry ids in a GUID.
So no `sourceObjectId` can match a row. Object names and positions would also need a decision:
the 2026-10-18 decision covers item categories and item relations, not object data.

## Known gaps

- No names: uploads carry the object's id only. A name would need the addon to send the object's
  name with the loot window, agreed by 3 installs like item names.
- No positions: no upload gives an object a position, so objects are not on `/map`.
