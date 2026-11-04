# Market rollup per realm: one object per realm, an index, and a cross-realm summary

Date: 2026-11-04. Status: draft for Carlos's review. Follows
[the Forever market design](2026-10-16-forever-market-design.md) and the load estimate of 2026-11-03
(Brain, `wiki/projects/everloot/2026-11-03-tsm-parity-and-load-plan.md`).

## 1. Why

The market rollup is one object, `snapshots/market.json`, that holds every realm's open scans and 60
days of closed history. The 10-minute cron parses it whole, folds, and writes it back; every page and
the price route parse it whole too (cached five minutes per isolate). Three things bound it:

- `MARKET_MAX_BYTES` (10 MiB): past it the fold now trims the oldest closed days (#739), so history
  shortens before prices stop. One realm with 5,000 public items needs about 36 bytes × 5,000 × 60
  days = 10.8 MB for its closed history alone. So a single busy realm already cannot keep 60 days, and
  every realm added shortens every other realm's history.
- The Worker's 128 MB isolate: the cron holds the previous state, a clone per fold batch and the
  serialised body at once. The real ceiling is memory and CPU per request, not bytes in R2.
- Reads: the price route and the MCP tool need one realm and parse all of them.

The fixes shipped on 2026-11-04 (#737, #739, #741, #742) make the single file degrade gracefully.
This design removes the ceiling.

## 2. What exists (readers of the whole state, 2026-11-04)

| Reader | Needs | After this design |
|---|---|---|
| `/api/market/prices?realm=` | one realm | its realm object |
| `/api/market/prices` (no realm) | realm names and houses | the index |
| MCP `market_value` (`kb/src/mcp-server.ts`) | one realm, one item | its realm object |
| `/tools/auctions/[realm]`, `/[realm]/[itemId]` | one realm | its realm object |
| `/tools/auctions` (browse-view: ruleset tabs, summaries, movers) | every realm's public rows | the summary |
| `/tools/auctions/item/[itemId]`, item page `MarketBox` | one item on every realm and house | the summary |
| `auctions-sitemap.ts` | every realm's public item ids | the summary |
| `web/src/lib/auction-house.ts` `realmBoards` | a `MarketState`; memoised per state object | unchanged for one realm; the summary replaces it for all realms |

`kb/src/market.ts` (fold, trim, derivation, caps) stays as it is: a realm object holds a
`MarketState` with one realm in `realms` and that realm's houses in `houses`, so every function keeps
working on it unchanged.

## 3. Objects

- `snapshots/market.json`, version 4, the **index**: `generatedAt`, the fold watermark
  (`lastReceivedAt`, `lastIds`, from #741), and `realms: { [key]: { name, houses, generatedAt, bytes } }`.
  Small: one line per realm.
- `snapshots/market/<key>.json`, one per realm: `{ version: 4, generatedAt, state: MarketState }` with
  that realm only. Each has its own `MARKET_MAX_BYTES` and its own trim, so one realm's history never
  costs another's. Written with `If-Match`, as today.
- `snapshots/market/summary.json`, the **cross-realm summary**: for every realm and house, every
  public item's current value as the compact tuple the price route already sends
  (`[itemId, market, min, historical, quantity, day, reporters]`) plus the one-day and seven-day
  moves the browse page shows. No history. About 40 bytes per item and realm: 10 realms × 5,000 items
  is 2 MB; the 40-realm cap × 20,000 items is 32 MB, so it is capped at `MARKET_MAX_BYTES` by keeping,
  per realm, the items with the most units listed, the same rule as the price file. The browse page
  and the cross-realm item page read this; a realm page keeps reading its realm object, so a realm's
  own pages are never cut by the summary cap.

## 4. The cron

One run: read the index; list uploads since the watermark and fold at most a batch (#741); group the
scans by realm key; for each realm touched, read its object, fold, trim, write; write the index. Then,
when any realm changed or once per UTC day, rebuild the summary by reading the realm objects one at a
time and keeping only the tuples, so memory holds one realm plus the summary. Realms with no new scans
are folded with no records (closing and pruning days) once per UTC day, at most ten per run, oldest
first, so the daily pass finishes within the hour.

`?rebuild=1` folds the whole 62-day window from empty into fresh realm objects and a fresh index;
realm objects the new index does not name are unreachable and may be deleted by hand.

## 5. Reads

`uploadStore.loadMarket()` becomes three readers, each cached five minutes per isolate:
`loadMarketIndex()`, `loadMarketRealm(realm)` (by key; `{ state, dataAsOf }` as today, one realm) and
`loadMarketSummary()`. A missing or unreadable object is "unavailable", never an empty market, as today.
`realmBoards` gets a sibling that builds boards from the summary, so `browse-view`, the cross-realm
item page, `MarketBox` and the sitemap change only their loader. The MCP's `market` reader takes a
realm.

## 6. Migration

The first run with the new code finds a version-3 `market.json` (from #741 it carries a watermark). It
reads it once, splits its state by realm into realm objects, writes the index with the same watermark
and the summary, and overwrites `market.json` with the version-4 index. No rebuild, no gap in prices.
A rollback reads a version-4 `market.json` as "unusable; rebuild it", which the previous code already
says, so a rollback needs `?rebuild=1` once. The price file and the companion do not change.

## 7. Order of work

1. Store: realm objects, index, summary, migration, watermark kept; `loadMarketRealm` and
   `loadMarketIndex`. Price route and MCP switch to them. Tests: split, migration, per-realm trim,
   summary cap, rebuild.
2. Web: boards from the summary; browse-view, cross-realm item page, `MarketBox`, sitemap switch.
   Realm pages switch to the realm object.
3. Delete `loadMarket()`.

One pull request per step; step 1 alone already takes the price route and the MCP off the whole-state
read. Nothing merges without Carlos.

## 8. Not in this design

- Per-item cross-realm history (a chart of one item on every realm): the summary holds values, not
  days. A realm page still has the 60-day history.
- A `has_scans` flag on the upload index (noted in #741); the watermark makes it an optimisation.
- Static `prices/<realm>.json` objects served without the route: #742's edge cache covers the repeat
  polls; revisit if the Worker's request count, not its CPU, becomes the cost.

## 9. For Carlos

- Approve the three objects and the summary cap rule (items with the most units per realm), or say
  what the cross-realm page should show when a realm has more public items than the cap.
- Say whether realm objects the index no longer names should be deleted by the cron (one R2 delete
  per run) or left for a hand clean-up.
