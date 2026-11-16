# The TSM market loop next to ours — mechanics in our own words, nothing copied

**Date:** 2026-10-18 · **Author:** overnight desktop lane (Carlos asked: "check those folders and
see the logic, how they communicate") · **Status:** research note, clean-room. Both addons below are
**All Rights Reserved** (TradeSkillMaster LLC; Auctionator by plusmouse and borjamacare). Their
files were read on Carlos's own machine only to understand the mechanism. No code, data, strings
or layouts are reused. The decision of 2026-10-17 stands: Everloot's market is built from our own
scans, clean room, not TSM.

## What is on this machine

| Thing | Where | What it tells us |
|---|---|---|
| TradeSkillMaster addon + `TradeSkillMaster_AppHelper` | `_classic_/Interface/AddOns` | The split: a big addon, and a tiny five-file helper addon whose only job is to carry data the desktop app writes |
| `AppHelper/AppData.lua` | same | One Lua file: a loader call per data block, each block a key, a scope (`Global` or a realm or region) and a serialized payload. On this machine it holds only app info and news (620 bytes), no realm prices, because the app was never pointed at a realm |
| TSM desktop application | `%APPDATA%\TradeSkillMaster\TSMApplication` (only logs here; the program itself is not installed under Program Files or LocalAppData any more) | The app logs in, downloads the realms the user picked, rewrites `AppData.lua` on a schedule, and backs up the addon's SavedVariables |
| Auctionator | `_classic_era_`, `_anniversary_`, `_retail_` | A scanning and selling UI with its own price database in SavedVariables. No desktop app, no server, no cross-player data |

## How the TSM loop works (described, not copied)

1. **Scan.** The addon scans the auction house in game. On modern clients it uses the game's
   replicate API (one full dump of the house, read in pieces). It keeps its own recent data in
   SavedVariables.
2. **Upload.** The desktop app reads the addon's SavedVariables from disk after the game writes
   them and sends the scans to TSM's servers. Blizzard's addon rules make this a file hand-off,
   exactly like ours: no network from Lua.
3. **Aggregate.** TSM's servers combine scans from many players into per-realm and per-region
   statistics (their "market value", "min buyout", "historical", "sale rate", "sold per day",
   region averages), with their own smoothing. The formulas are theirs; we do not use them.
4. **Download.** The app fetches the realms the user picked and rewrites the helper addon's one
   data file. The game reads it on load or `/reload`.
5. **Consume.** The addon reads the blocks, exposes them in tooltips and in "price strings" other
   features (and other addons) can evaluate, and drives posting and shopping decisions from them.

The product around it: a subscription gates the download cadence and some data; the free tier
gets less frequent data. The realm pick on the website is what Carlos called "pick the servers".

## Auctionator, briefly

Auctionator scans only what the player searches (and a full scan on clients that allow it), keeps
the result in that player's SavedVariables, and shows it in tooltips and its shopping and selling
tabs. Nothing leaves the machine and nothing comes from other players. It is the "no account, no
server" end of the spectrum.

## Everloot today, step by step

| Step | Ours | Where |
|---|---|---|
| Scan | The `Everloot scan` button or `/everloot scan`: a full replicate-API scan read in 1,000-row chunks per frame, a 15-minute cooldown, the newest 3 scans per realm kept. Older clients: the 50 rows of the opened list | `addon/modules/auctions.lua` |
| Upload | Companion CLI or Everloot Desktop reads `Everloot.lua` after the game writes it and sends unconfirmed events to `/api/intake` | `companion/`, `desktop/` |
| Aggregate | Per realm and item, per day: `market` (weighted), `min`, `historical` (median of the last 60 days), outlier trimming, and a day is published only when 3 reporters (distinct upload addresses) scanned the item | `kb/src/market.ts` |
| Download | Desktop or CLI fetches `/api/market/prices?realm=` for the player's scanned realms plus followed realms (the realm picks), writes `EverlootPrices`, one Lua-escaped string per realm with an Adler-32 sum | `desktop/src/main/market.ts`, `companion/src/prices.ts` |
| Consume | The addon shows market, min and historical in item tooltips after `/reload`; the player's own last scan shows without the companion | `addon/modules/prices.lua` |
| Anywhere | The same values are public on `/tools/auctions`, on `/api/market/prices` and through the MCP tools, CC BY-SA 4.0 | `web/`, `kb/src/mcp-server.ts` |

So the loop Carlos described is already built end to end. The "hotspot" is the site plus the
desktop app, and the realm picks landed in the desktop app on 2026-10-18.

## What TSM has that we do not (candidates, our own design)

1. **Region values.** TSM shows a region-wide average beside the realm value. We publish per
   realm only. A region roll-up is a server-side change in `market.ts` (group realms by region;
   Forever's realm list and regions are known from the client tables) and one more column in the
   price file.
2. **Sale rate and sold per day.** TSM estimates how fast an item sells. We keep 3 scans per
   realm per reporter; comparing consecutive scans from the same reporter (listings that vanished
   before their expiry and were not cancelled) gives a sales estimate. Needs a design: what counts
   as a sale, how many reporters make it public, how to label it as an estimate.
3. **A price API for other addons.** TSM exposes its values to other addons. Our prices file is
   already loaded in game; a small, documented `Everloot.GetMarketValue(itemId)` in the addon lets
   other Forever addons read the community value. Display only, no acting.
4. **Scan on open.** TSM can scan without a button press. Ours needs the button, by design (the
   player starts every scan). Worth keeping; a "scan reminder" in the desktop app when the last scan
   on a realm is older than a day is a softer version.
5. **Backups.** The TSM app backs up SavedVariables. Cheap to add to Everloot Desktop: copy
   `Everloot.lua` into the data folder after each upload, keep the last 10.
6. **A paid bracket for faster data.** Carlos's "down the road" idea. Everything in it is a
   product and money decision (platform spec part 7 owns the money model; the 2026-10-07 decision
   keeps hosting on free services). Technically it is a cadence and a key: the data guard already
   counts keyed requests per key.

## What we deliberately do not do

- Read or import any TSM or Auctionator data, formulas, strings or file formats. Our price file
  format, checksum and loader are ours and were built before this note.
- Scan without the player starting it, post, bid or buy. The addon never acts.
- Install more third-party software to study. Nothing further is needed: the mechanism is clear
  and ours already mirrors it with our own parts.

## For Carlos

- The TSM app on this machine never synced a realm, so there is no realm payload to look at even
  if we wanted one. We do not need one.
- Of the six candidates, the two with the most player value per hour of work are a sale-rate
  estimate (needs a short design and a server change) and the in-addon price API (addon change,
  gated by the beta checklist). Say which you want first; the desktop lane can take the backups
  and the scan reminder tonight without a decision.
