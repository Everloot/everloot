# The addon value loop: what the player gets back for recording

Drop-rate rule updated 2026-11-19: rates, measured zeros and unanimous drop source names now show from one install, labelled reported, verified at two, confirmed at three or more. This supersedes the drop publication thresholds described below; other thresholds stay unchanged. See [DATA_POLICY.md](../../DATA_POLICY.md).

**Date:** 2026-10-21
**Status:** module 1 (price and drop tooltips) built in this pull request; modules 2 to 5 are design only.
**Launch:** 2026-11-04.
**Builds on:** the market design ([2026-10-16-forever-market-design.md](2026-10-16-forever-market-design.md)),
the Desktop App ([2026-10-18-desktop-app-design.md](2026-10-18-desktop-app-design.md)), the census
([2026-10-18-census-design.md](2026-10-18-census-design.md)), the character view
([2026-10-19-character-view-design.md](2026-10-19-character-view-design.md)) and the build changes read set
([2026-10-18-build-changes-read-set-design.md](2026-10-18-build-changes-read-set-design.md)).

## Why

Recording is a one-way street today. The addon collects, the player uploads, the site stores, and the player
sees almost nothing in return in the game. A tool that only takes is not a reason to install. Each module below
gives something back, in the game or on the site, and says what it costs.

## Rules every module keeps

1. **No ads in the game.** The addon's text points to everloot.app for detail and nothing else
   (`addon/tests/no_ads_contract.py`).
2. **A number carries its denominator, its date and its method.** A drop rate is "42 of 340 loot windows" from
   uploads as of a date, never a bare percentage. A price says it is a market value, how many units and
   reporters, and the day. A number without these is a bug.
3. **Nothing is invented.** A value the file does not hold is said to be missing, in words. A fact is shown when
   three installs agree, as on the site.
4. **The addon reads nothing new.** Everything the player gets back reaches the game through a slot addon the
   Desktop App or companion writes (`EverlootPrices`, `EverlootAnswers`, `EverlootBuilds`), or is shown on the
   site. No module widens what the addon records or what the disclosure on the upload page lists.
5. **SavedVariables stay as they are unless a module says otherwise,** with its size. The game rewrites the whole
   file at every logout; every byte is paid on every logout and every upload.

## What exists today

| Piece | Where | State |
|---|---|---|
| Community prices in item tooltips and `/everloot price` | `addon/modules/prices.lua` | Built (0.3.x). Market, min, historical, units, reporters, day, freshness, stale flag. |
| The player's own last scan in tooltips | `addon/modules/prices.lua` `E:OwnScan` | Built. |
| The `EverlootPrices` slot addon: one checksummed string per realm | `companion/src/prices.ts`, written by `desktop/src/main/market.ts` | Built. Up to 20 realms, 2,000 rows each; refreshed after each upload and every hour. |
| Public drop rates | `GET /api/rollups/drops` | Built on the site; never reached the game. |
| Gold per hour from community prices | `addon/modules/gph.lua` | Built. |
| Census counts | `/census`, `loadCensus` | Built on the site; not in the game. |
| Owned versus missing for a collection | `kb/src/collection-gap.ts`, MCP `collection_gap` | Built for the agent; not in the game. |
| The player's own ledger (gold, gear, progress) | Desktop App character view, `desktop/src/main/characters.ts` | Built, local to the app. |
| Build digests for the client tables | `kb/src/build-watch/client-digests.ts` | Built; nothing reads the per-item changes yet. |

## Module 1: price and drop tooltips (built here)

**What the player sees.** Hovering an item with the Desktop App's file in the game:

```
Everloot market 2s 5c · min 2s 0c · historical 1s 90c
  40 up · 3 reporters · 2026-10-20
  prices fetched 2026-10-20
Your scan: min 1s 0c · value 1s 10c · 100 up · 3 h ago
Everloot drop: NPC 116 · 12.4% (42 of 340 loot windows) · 5 installs
Everloot drop: NPC 94 · 6.0% (12 of 200 loot windows) · 3 installs
Everloot drop: NPC 474 · 4.2% (5 of 120 loot windows) · 4 installs
  drop rates from uploads as of 2026-10-20 · 1 more source
```

The first four lines are what 0.3.10 already shows; the drop lines are new. When something is missing, one grey
line says what:

- a price and no drop source: `Everloot: no drop source reported by 3 installs`
- a drop source and no price: `Everloot: no price on Forever yet`
- neither: `Everloot: no price on Forever yet · no drop source reported by 3 installs`
- a file from an app that does not write drops: `Everloot: drop sources not in the price file yet`
- a block that fails its checksum: `Everloot: drop sources failed their checksum` (prices still show)

Without the file in the game a tooltip carries no Everloot line it has no value for, as before: a player who never
installed the Desktop App is not nagged on every item. `/everloot price <item>` prints the same lines in chat.

Sources show by id ("NPC 116", "object 1731"). The game has no call that names a creature from its id, and the
drop rollup carries no names. Names three installs agree on are a follow-up (see Open).

**What is new.**

- `EverlootPricesDB.drops = { data, sum, dataAsOf, fetchedAt }` beside `realms`, written by
  `renderPricesAddon(realms, drops)`. `data` is `itemId,kind,sourceId,drops,windows,installs;...` with `kind`
  `n` (NPC) or `o` (object), grouped by item and each item's sources best rate first, so the addon reads one run
  per item. `sum` is the same Adler-32 the prices use. `data` comes first in the table so the Desktop App's realm
  reader never takes the block for a realm. Without drops the file is the same as before.
- `desktop/src/main/market.ts` `fetchDropSources`: reads `/api/rollups/drops`, follows `next` on the same site for
  at most 10 pages, keeps rates with one source, at least one loot window and three installs (the site sends no
  others; the check is repeated). Measured zeros name no item and are not carried. At most 5,000 rows; past that the
  sources with the most loot windows stay.
- Drop rates are fetched at most once a day. The hourly price refresh carries the last good block over, and a failed
  or unreachable drop fetch keeps it, so a drop outage never stops prices.
- `addon/modules/drops.lua`: `E:DropSources(itemId)` and `E:DropLines(itemId)`. It verifies the checksum a slice per
  frame like the prices, shows up to three sources, counts the rest, ignores any row under three installs whatever
  the file says, and writes nothing.

**Cost.**

| | Size | How measured |
|---|---|---|
| SavedVariables | +0 bytes | `drops_contract.py` serialises `EverlootDB` before and after tooltips and `/everloot price`; byte for byte equal. |
| Slot file on disk, 5,000 rows | 108,892 bytes | The contract test's 5,000-row block (ids up to six digits). |
| Lua memory | about 107 KB for the addon's `;`-delimited copy, on top of the string the file itself loads (same size) | `collectgarbage("count")` around loading and checking that block. |
| Checksum time | 6 frames of 20,000 characters for 5,000 rows | `VERIFY_SLICE` in `prices.lua`. |
| Site requests | 1 to 10 GETs a day per app | Pages of 500 rates with `EVERLOOT_DATA_GUARD=1` (off today: one page). |

## Module 2: a per-character progression page (opt-in)

**What the player sees.** On everloot.app, signed in, a page per character they chose to link: level over time,
gold, gear level, reputation and achievement progress from their own uploads, each with the day it was recorded.
Not public; nothing on it is listed or indexed.

**What is there.** The addon already records gold, gear and progress (`gold.lua`, `gear.lua`, `completion.lua`,
completion off until enabled). The Desktop App shows the same ledger locally. Character labels exist on the site
(`POST /api/me/characters`), and named records need a verified sharing grant.

**What is new.** A page that joins an account's labels to its own uploads through the sharing grant, and a switch
the player turns on per character. Off by default.

**Cost.** SavedVariables: +0 bytes; the page reads what uploads already carry. Site storage: the rows already
stored for a granted character. The addon changes nothing.

## Module 3: realm statistics

**What the player sees.** `/everloot realm` in chat: characters counted, faction split, top classes, each with its
count, the counting rule (10 characters, 3 installs, 3 addresses) and the date. The same numbers as `/census`.

**What is there.** The census rollup on the site, and the `population` answer.

**What is new.** The Desktop App adds a `census` block to `EverlootPricesDB` (same checksum pattern) for the realms
it already fetches prices for; the addon reads it on command, not in tooltips.

**Cost.** SavedVariables: +0 bytes. Slot file: under 2 KB a realm (about 30 counts), estimated, not measured.

## Module 4: "still missing here"

**What the player sees.** In a zone, `/everloot missing`: the collection entries three installs found in this zone
that this player's own file does not show as owned, with the source and how many installs reported it.

**What is there.** `kb/src/collection-gap.ts` computes owned versus missing for one install; the completion
module records owned collections (off until enabled).

**What is new.** The Desktop App computes the gap locally, from the player's own file and the public list, so no
install id leaves the machine, and writes a per-zone list into a slot block. The addon reads the block by the
current map id.

**Cost.** SavedVariables: +0 bytes. Slot file: [?] until the public collection list's size at launch is known;
capped at 2,000 rows.

## Module 5: "this patch changed your items"

**What the player sees.** After a new client build, one chat line at login: "Build 1.60.2: 3 items you carry
changed", and `/everloot changed` lists them with what changed and the build.

**What is there.** Client digests per table (`client-digests.json`) and the changes feed the Desktop App reads.
Neither names the items that changed: the digests are per table.

**What is new.** A per-item diff in the build watch (kb), published with the build entry; the Desktop App
intersects it with the gear in the player's own file and writes the matching ids into a slot block.

**Cost.** SavedVariables: +0 bytes, or about 40 bytes if the addon keeps the last build it announced so it says it
once. Slot file: under 1 KB.

## Order

1. Price and drop tooltips (this pull request).
2. Realm statistics: the census already exists; only the block and the command are new.
3. "Still missing here": needs the completion module on and a public collection list worth showing.
4. "This patch changed your items": needs the per-item diff in the build watch first.
5. The progression page: site work behind a switch, after the sharing grant review.

## Open

- **Source names in the game.** The rollup carries ids. Names three installs agree on exist on the site (NPC and
  object pages); a bulk names endpoint, or names in the drop rollup, would let the file carry them. Site work,
  outside this lane.
- **Measured zeros.** "Looted 400 times, never dropped" is honest and useful, but the zeros name a source, not an
  item. Showing them on an item needs the site to say which items a zero covers.
- **The page cap.** With the data guard on, 10 pages of 500 is 5,000 rates. If the public rates outgrow that, the
  app needs a key or a compact endpoint.
