# ECON-E01 economy terminology audit

Date: 2026-10-28. Read-only audit for [ECON-E01](2026-10-28-platform-gap-register.md). Source baseline
`3608a4a9`. No code, schema, rollup, version or migration changed. Nothing here was run against a service,
the game or production; every claim below is read from the repository.

## Follow-up delivery, 2026-10-28

F4, F6 and F7 are corrected locally: shared chat answers distinguish asking prices from sales, addon prices
state their per-unit basis, Desktop and the realm page name the all-house blend, and own-scan status names
its actual realm scope. The sells-for regression failed before the change; afterwards web market/chat 145,
Desktop agent 29 and companion bridge 29 tests passed. Updated market and auction-tab Lua contracts pass.
These are source/fixture checks, not live-game or packaged-release acceptance.

F1, F2, F3 and F5 remain open. They touch shared KB/protocol paths while the Cloudflare lane converts the
knowledge read layer. Coordinate file ownership before changing those sources; generated protocol output
and changelog must stay consistent when protocol descriptions change. No market calculation changed here.

## What the data is

- **Market rows are asking prices.** A full scan reads each listing's buyout and divides it by the stack size
  (`addon/modules/auctions.lua:8`, `:105-110`). A scan's value for an item is the unit-weighted mean of the cheapest
  quarter of the listed units (`auctions.lua:52-67`). `min` is the lowest per-unit buyout and `quantity` is units
  listed (`kb/src/market.ts:61`, `:141`). Nothing records a completed sale, so no market figure is a sale price
  or a sales volume.
- **Scope.** Without a house, the realm view blends every auction house (`market.ts:25-28`). `market_value` and the
  companion price file read only that blend (`market.ts:440`, `:412-418`).
- **Freshness.** `min`, `quantity` and `reporters` come from the newest trusted public day, which can be up to 60 days
  old. `market` is null when no solid public day falls in the last 14 days (`market.ts:310-342`).
- **Legacy `auction_history`** reads only `auction_scan` rows (`kb/src/auction-history.ts:97-110`). Those rows come from
  the older client's browse list: at most 50 rows the player opened, each a per-unit buyout
  (`auctions.lua:24-50`). The value per install and day is the last sighting, not the cheapest
  (`auction-history.ts:61`).
- **The gold ledger's `auction` category** is `bid - cut` from a seller invoice. It is recorded only when the player
  takes the money from the mailbox, and the returned deposit is left out (`addon/modules/gold.lua:3-5`, `:83`,
  `:98-102`). `auction_spend` is recorded only for a bid at the buyout price or a confirmed commodity purchase.
  Lower bids that win are not recorded (`gold.lua:117-140`).

## Findings

Ordered by reach. Each fix is a wording change only.

### F1: the market rule never says asking price, per unit or all houses

- **Where:** `kb/src/market.ts:432-434` (`MARKET_RULE`). The constant is shown under "How are market values made?"
  on three web pages (`web/src/app/tools/auctions/browse-view.tsx:269`, `.../[realm]/[itemId]/page.tsx:154`,
  `.../item/[itemId]/page.tsx:113`). It is also the `rule` field of `/api/market/prices` (`route.ts:41`) and the
  second line of every `market_value` MCP answer (`market.ts:441`).
- **Actual text:** "A day is public when 3 reporters scanned this item on this realm with a full scan … Market value
  weights the last 14 public days toward today, skips thin days … Historical is the median of the last 60."
- **Why it is wrong:** this is the only explanation of how the values are made. It never says they are buyout asking
  prices of listed units or that they are per unit, so "market value" can be read as a sale price. It also never says
  the realm view blends every house.
- **Smallest correction:** begin the rule with: "Values are per-unit buyout asking prices from listings players
  scanned, not completed sales: a scan's value is the mean of the cheapest quarter of the units listed. Without a
  house, every auction house on the realm is blended."
- **Regression:** in the kb market test, assert that `MARKET_RULE` contains "per-unit" and "not completed sales".
  Run the `/api/market/prices` route test, because the string is echoed there. This is a text change, not a
  schema change.

### F2: the `market_value` tool hides the scope and unit

- **Where:** the description at `packages/protocol/src/mcp.ts:892`. The text answer at `kb/src/market.ts:441`
  starts with `` `${realm} item ${id}` ``.
- **Actual text:** the description reads "Market value, minimum buyout, historical value and units listed for one item
  on one WoW: Forever realm …". The answer header reads "Forever item 2589".
- **Why it is wrong:** the handler reads only the blend of all houses (`market.ts:440`, with no house). Website
  Chat adds "all houses" itself (`web/src/lib/chat/market-question.ts:198`), but a direct MCP client gets neither
  the scope nor the unit, and the word "listings" never appears.
- **Smallest correction:** change the header to `` `${realm} item ${id}, all houses` `` (F1 brings the rule line with
  it). In the description, after "uploaded", add: "Per-unit buyout asking prices of listed units, not completed
  sales; all houses on the realm blended."
- **Owner note:** editing `mcp.ts` changes the protocol package (dist and changelog). That is the protocol owner's
  release step and is not part of this audit.
- **Regression:** check the `market_value` text in the existing kb MCP test for ", all houses".

### F3: `auction_history` calls browse sightings "scans"

- **Where:** `packages/protocol/src/mcp.ts:881` (description), `mcp.ts:187` (`copper` schema text) and
  `kb/src/auction-history.ts:79`, `:82`.
- **Actual text:** "Price history from auction scans players uploaded on purpose … Copper is the median." The schema
  says "The median of the last scan from each install that day." The answer says "The copper is the median of the
  last scan from each install."
- **Why it is wrong:** the source is single browse-list listings (see "What the data is"), not full scans or a
  scan summary. Each install contributes its latest sighting, which is neither its lowest nor a sale. The website
  already labels the same output "Single listings seen while browsing" (`.../[realm]/[itemId]/page.tsx:157`).
- **Smallest correction:**
  - Description: "Per-unit buyout asking prices of single listings players saw while browsing (older auction API),
    not full scans or completed sales. A day is public after 3 installs saw the item on that realm; copper is the
    median of each install's last sighting that day. Full-scan values are in market_value."
  - Line 79: "The copper is the median of each install's last listing seen that day: a per-unit buyout asked, not
    a sale."
  - Schema text: "Median of each install's last per-unit buyout seen that day."
- **Regression:** add a `formatAuctionHistory` assertion for "not a sale". The protocol owner note from F2 applies.

### F4: price answers to "sells for" questions never say asking price

- **Where:** `web/src/lib/chat/market-question.ts:204` and `:221`. This answer is shared by website Chat, Desktop
  Chat and the in-game `/ask`.
- **Actual text:** "A recorded community blend, not a live auction quote." and "Unrecorded is not zero, and this is not
  a live auction quote."
- **Why it is wrong:** the parser accepts "sells for", "goes for" and "selling for" (`market-question.ts:57`). So "how
  much does Linen Cloth sell for on Forever" is answered with listing values, and nothing tells the player they are
  not sale prices.
- **Smallest correction:**
  - `:204`: "Recorded asking prices, not completed sales or a live quote."
  - `:221`: "Unrecorded is not zero; these are asking prices, not sales or a live quote."
  - Both fit within `MARKET_ANSWER_BUDGET`.
- **Regression:** update `FIXTURE_ANSWER` (`web/src/lib/chat/market-fixture.ts:30`). The parity tests in web, Desktop
  and the companion pick it up. Add one `market-question.test.ts` case where a "sells for" question's answer
  contains "not completed sales".

### F5: the gold ledger's auction labels overstate what was recorded

- **Where:** `kb/src/gold-ledger.ts:129` ("Auction sales") and `:137` ("Auction purchases"), and the `gold_ledger`
  description at `packages/protocol/src/mcp.ts:903`.
- **Actual text:** the ledger lines read "Auction sales: …" and "Auction purchases: …". The description says "Loot,
  quests, vendors, and auction sales stay on the money line."
- **Why it is wrong:** the auction line holds mailbox proceeds net of the house cut, taken when the letter's money
  was collected. It is not gross sale value, and it leaves out sales still in the mail. The spending line is buyouts
  only; won bids are unrecorded. The web page states this correctly (`web/src/app/tools/gold-ledger/page.tsx:76-77`),
  but the MCP text and the text answer stand alone.
- **Smallest correction:**
  - Labels: "Auction sales collected from mail (after the cut)" and "Auction buyouts".
  - In the description, replace "auction sales" with "auction sales collected from the mailbox (after the house cut)".
  - Own sales are not market volume, which already holds: nothing feeds the ledger into the market.
- **Regression:** add a kb gold-ledger assertion on the two labels.

### F6 (low): unit and scope missing beside numbers in game and in Desktop

- **Tooltip:** `addon/modules/prices.lua:140-141` reads "Everloot market %s · min %s · historical %s · all houses". On
  a stack's tooltip a per-unit figure is easy to read as the stack's price. The fix is "Everloot market %s each · min
  %s · historical %s · all houses". The "Your scan" line at `:165` needs "each" too.
- **Desktop Market lookup:** `desktop/src/renderer/app.ts:798` reads "… min is the lowest buyout." These rows are the
  companion's blend of all houses. The fix is "… min is the lowest buyout per unit. All houses on each realm are
  blended."
- **Web realm item page lede:** `web/src/app/tools/auctions/[realm]/[itemId]/page.tsx:88` reads "Auction House price on
  ${realm} in WoW: Forever." The facts below it are the blend, and per-house prices sit in the Houses tab. The fix
  appends ", all houses blended" to the lede.
- **Regression:** if an addon test pins the tooltip line, update that string. Otherwise there is none.

### F7 (low): the Everloot tab calls a realm scan "this house"

- **Where:** `addon/modules/auctiontab.lua:30` ("No scan of this house yet.") and `:36` ("Last scan: %d items, …").
- **Why it is wrong:** `OwnScan` is keyed by realm only (`prices.lua:9-10`, `auctions.lua:153-154`). At Blackwater,
  the tab shows the last Horde-house scan as if it belonged to the house in front of the player.
- **Smallest correction:** "No scan on this realm yet." and "Last scan on this realm: %d items, …".
- **Regression:** none needed.

## Already correct (leave as is)

- `/api/market/prices` documentation (`packages/protocol/src/api.ts:87`, `:511`): copper per unit, blend versus
  `house`, and three reporters.
- The web item, browse and cross-realm tables:
  - "Min buyout" and "Units listed" are dated "On {day}". Thin days are marked "(thin)" or "Thin: left out of the
    market value".
  - "Weighted over 14 days" and "60-day median" sit under the values.
  - `money()` prints "unrecorded", never 0, and "Market values are unavailable right now. They are unrecorded, not
    zero." covers a missing rollup.
  - The house tabs, the MarketBox "All" house and the cross-realm "Units listed / Newest day on each realm" are a
    count of listed units, not volume.
- The disclosure "Single listings seen while browsing" on the realm item page.
- Addon tooltip:
  - "all houses" is shown.
  - The newest public day ("STALE") is kept apart from the file build date ("OLD FILE").
  - A null market prints "unrecorded (thin)".
  - The 2,000-row cap and checksum notes say why a price is missing.
- `market-question.ts`: "all houses", "each", the stale note, the thin note and "missing data, not a price of zero"
  (only the closing sentence needs F4).
- `addon/README.md:33-35`: "recorded asking-price estimates, not live listings or guaranteed sale prices". This is the
  wording F1 and F4 should match.
- Desktop Ask page (`desktop/src/renderer/app.ts:812`): "Item prices come from recorded scans, not live listings."
- The gold-ledger web page explanation and the `formatGoldLedger` lines "Gameplay is unrecorded." and "The difference
  is unrecorded."; the local ledger's raw category names next to that explanation.

## Not filed here

Unknowns about scan cooldown, API throttling, unloaded rows and partial houses belong to ECON-E02. Attributing
transactions (bids, deposits, repairs) belongs to ECON-E03. Neither is a copy bug.
