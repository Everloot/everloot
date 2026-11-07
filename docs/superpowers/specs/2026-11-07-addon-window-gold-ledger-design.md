# The Everloot window: cut the stubs, build the Gold ledger, Collection and an account Home (2026-11-07)

Status: design, awaiting the owner's approval. Addon at `5cf8b845` (0.3.21). Companion note in the Brain:
`wiki/projects/everloot/ops/2026-11-07-addon-window-focus.md`.

## Intent

Launch-week players asked what the addon is good for. The in-game window answers that question badly: one real
view (Home), two hand-offs to older panels (Gold, Build plan), four "Coming soon" lines (Professions, Collection,
Auctions, Ask). The owner's direction, 11/07: simplify the platform, no "soon" in the product, and give players
value inside the game. He named the shape: a Home with the overall picture, a Gold tab in the TradeSkillMaster
(TSM) style with a real gold tracker, a Collection tab in the ALL THE THINGS style, and no Ask or Build plan.

Competition is heavy and shipping on Forever today: TSM 4.15, Accountant Classic, Journalator, Kerzo Gold
Tracker, ForeverGold for gold; ALL THE THINGS for collections; Altoholic for alts. "We need to be extra fine": the
bar is the full TSM-style ledger, not a category tally.

## Goals

1. The sidebar shows only things a player can use today: Home, Gold, Collection, Professions, Settings.
2. Gold is a complete ledger: every character's gold, income and spending by category per day, each auction sale
   by item with its price, gold over time, and the farming session timer, with the account's own alt-to-alt
   transfers netted out of the totals.
3. Home shows the account at a glance, not only the logged-in character.
4. Collection shows owned versus missing for this character from the completion module.
5. Every number in the window matches the web gold-ledger page and the Desktop App for the same file: one set of
   category and direction rules, ported, with a test that holds them equal.

## Non-goals

- Posting, buying, cancelling or any action at the auction house. `addon/tests/market_contract.py` traps them.
- Crafting cost, shopping lists, operations, price strings. TSM's long tail is not the bar (11/03 parity plan).
- Shipping a Blizzard API price anywhere in the addon. Terms bar it; community prices stay the Desktop App file.
- A cross-alt bag or bank inventory. Altoholic's job; not this change.
- Rebuilding `/ask` or the planner. They keep their slash commands and panels, off the sidebar.

## Anti-goals

- A ledger that silently misses money. Every unattributed change is shown as "unrecorded", never guessed.
- Reading another player's name into an uploaded record. Today's gold module reads none; that holds.
- A SavedVariables file that grows without bound (TSM's 43 MB complaint). The ledger keeps a bounded window.
- A tab that says "turn on X to see this" without saying what X reads. The Collection offer names its calls.

## Constraints

- WoW: Forever client 1.60.1, interface 16001, mainline UI and API (Brain note
  `wiki/projects/everloot/2026-11-05-forever-ui-api-from-cdn.md`; repo checklist
  `docs/2026-10-28-live-client-capability-checklist.md`).
  Every new client call is listed in the module header, checked against the CDN API docs by file name, and
  carries a live-client probe for the owner. Nothing in this design was run in a game client.
- Secret values: every unit, name and tooltip read goes through `E.Readable` (`addon/core.lua`).
- Records (`EverlootDB.records.<kind>`) are capped at `E.MAX_ROWS_PER_KIND = 2000` and pause at the cap; the
  upload path reads them. The ledger therefore keeps its own store outside `records` (below).
- Gold rows are private by default: the uploader holds `gold_snapshot` and `money_event` unless the player shares
  them on the upload page. The ledger store is local only and never uploaded.
- The window registers no events and recording never runs through it (`ui_window_contract.py`); an error closes
  the window and leaves capture alone. Capture changes go in `gold.lua`, display in `window.lua` and new view files.
- Addon tests are Python contracts over `lupa` (`addon/tests/*_contract.py`, run by `run_all.py` in CI). Each new
  behaviour gets a failing contract first.
- No AI attribution in commits or PRs; DCO sign-off on every commit (`git commit -s`).
- Owner decisions already taken: Ask and Build plan leave the sidebar; "Actions" in the owner's note means the
  Auctions tab; TSM full style.

## Approaches considered

**A. Ledger from what is already recorded.** Render the web page's ledger in game from `money_event` and
`gold_snapshot`. Days of work, no client risk, no per-item sales. Rejected: it is what Accountant Classic already
does and does not meet "extra fine".

**B. Full TSM-style ledger in two slices (chosen).** Slice one: A plus per-item auction sales from the mailbox
invoice the gold module already calls, the ledger store, the Gold tab, the account Home, Collection, and the
sidebar cut. Slice two: the "sold, gold pending" row from the chat notice, repairs and vendor purchases, trades,
alt-to-alt mail netting. Chosen because slice one reuses capture that exists, ships the one thing competitors
lack (named sales plus a server-side archive later), and leaves the riskier client events for an in-game check.

**C. Record in game, show on the website.** Rejected: it sends the player out of the game, the exact complaint.

## What was decided

### 1. Sidebar

`U.NAV` in `addon/modules/window.lua` becomes: Home, Gold, Collection, Professions, Settings (bottom). Removed:
Auctions, Ask, Build plan. `/ask`, `/everloot plan`, `/everloot gph` and the planner panel keep working; the
options page keeps its Ask box (`options.lua:113-120`; plan and gph have no switch today and get none). Gold, Collection and Professions become views inside the window (`view`
functions), not hand-offs. The gph panel stays as a draggable mini window for farming; the Gold tab shows the
same session and the same buttons.

### 2. Home: the account at a glance

Top: the logged-in character as today (portrait, level, race, class, realm, gold on hand, peak, professions with
skill bars). Below, replacing "Recorded:" and "What you've added": a roster table of every character this install
has seen, grouped by realm: name (class-coloured), level, gold, professions (icon and rank), raid lockouts this
week (count of saved raids), last seen. A realm footer with the realm's total gold; an account footer with every
realm's total. "What you've added" moves to the Settings page.

The roster comes from a new local store `EverlootDB.roster[characterKey] = { name, realm, class, level, faction,
professions = { { name, icon, rank, maxRank }... }, lastSeen, copper, peakCopper }`, keyed by the completion
module's opaque `characterKey` (`C.Identity`, `completion.lua:119`) so owned rows, ledger rows and the roster join
on one key. It is written by a new `roster` module (`addon/modules/roster.lua`), on by default, with its own
options switch and `/everloot status` line, reading only the player's own `UnitGUID`, `UnitClass`, `UnitLevel`,
`UnitFactionGroup`, `GetMoney`, `GetProfessions` and `GetProfessionInfo` at login and when they change. (Owner
decision 11/07: professions are the player's own data and may be read outside the completion switch; raid
lockouts stay under completion and show a dash with "turn on the completion tracker" until then. With "Your gold"
off the roster still shows names, levels and professions, and gold is a dash; the ledger store itself is written
only while the gold module runs.) Local only: the uploaders read `EverlootDB.records` only, so a top-level `roster` or
`ledger` table never reaches an upload; the roster contract asserts that against the file parser directly (the
`LOCAL_ONLY_KINDS` list in `upload-batches.ts` is for record kinds and is not the guarantee).
A character the player deletes stays until "Forget this character" in Settings (slice two) removes its roster,
ledger and owned rows.

### 3. Gold: the ledger

One view with four sections, chosen by a row of small tabs under the heading, and a period selector (Today, 7
days, 30 days, All) that applies to Ledger and Sales.

**Overview.** Gold per character (same roster rows, gold only), realm and account totals, and a gold-over-time
chart for the selected character or the account: 30 daily closing balances drawn as bars with the window's own
textures (no graphics library). Daily closes come from `EverlootDB.ledger.daily[characterKey][YYYY-MM-DD] =
copper`, written on every gold change, so the chart never depends on the capped `gold_snapshot` records.

**Ledger.** In and out by category for the period, one row per category with the event count, then a day list
(date, in, out, net) and the receipts for the selected day (time, category, amount, and for a sale the item).
Categories and directions are the web's `kb/src/gold-ledger.ts` lists, ported verbatim to a Lua table in a new
`addon/modules/ledger.lua`, plus the slice-two categories below. Income: loot, quest, vendor, auction. Spending:
flight, postage, barber, respec, auction_spend (barber and respec are in the contract but nothing in the addon
writes them yet; the port carries them so the lists stay equal). Slice two adds repair, vendor_spend, trade_in, trade_out,
mail_in, mail_out. An "Unrecorded" line shows the period's gold change not explained by events, so the player
sees what the ledger could not attribute instead of a wrong total.

**Sales.** One row per auction sale: item (name, with the item link and icon when the client can resolve it),
count, unit price, total after the house cut, deposit returned, when, and status (paid; slice two adds pending).
Grouped by item on request (count sold, average unit price, total). Source: on `TakeInboxMoney` /
`AutoLootMailItem` of a letter whose `GetInboxInvoiceInfo` type is `seller`, which `gold.lua:93-103` already reads
for the `auction` money event, and written only when the money delta confirms the letter, as that event is. The
sale row adds `itemName`, `count`, `bid`/`buyout`, `deposit`, `consignmentFee` and the `commerceAuction` flag from
the same call (field names as the 0.3.2 checklist recorded them, `docs/2026-10-18-addon-0.3.2-beta-checklist.md:27`;
confirm in the live probe). Buyer name: not read in slice one (the gold module never reads
other players' names; `GetInboxInvoiceInfo` returns it, and the call must discard it). Owner decides for slice
two whether an opt-in "show buyers" switch exists; until then no row carries a name.

**Session.** The gold-per-hour tracker as it is: Start/Pause/Stop, elapsed, gold per hour, items valued with their
source, top five, zone. `gph.lua` stays the engine; the Gold tab only shows it.

**The ledger store.** `EverlootDB.ledger = { events = {...}, sales = {...}, daily = {...} }`, local only, never
uploaded. Events carry `{ at, characterKey, category, copper, itemName?, count? }`. Bounded window: 90 days or
5,000 events and 2,000 sales per install, oldest dropped first; daily closes keep 400 days. `money_event` records
keep being written exactly as today for the upload path, so the web ledger loses nothing; the in-game ledger reads
the local store first and falls back to records for days before the store existed.

**Slice two capture (not in the first PR):**
- Pending sales from the system message `ERR_AUCTION_SOLD_S` (item name only) shown as "sold, gold pending" until
  the matching invoice arrives, then merged; a pending row older than 48 hours is marked unmatched.
- `repair`: a money drop while a merchant with `CanMerchantRepair()` is open and `RepairAllItems` or the per-item
  repair was hooked. `vendor_spend`: a money drop at a merchant that is not a repair.
- `trade_in`/`trade_out`: money moved when `TRADE_CLOSED` follows an accepted trade (`GetPlayerTradeMoney`,
  `GetTargetTradeMoney`); partner name read only to test membership in the local roster, never stored.
- `mail_in`/`mail_out`: money sent (`GetSendMailMoney` on `MAIL_SEND_SUCCESS`) and money taken from a non-invoice
  letter; sender read only to test roster membership, never stored. Transfers whose other side is in the roster
  are netted out of account totals and shown as "Moved between your characters".

### 4. Collection

Needs `/everloot completion on`. When it is off, the tab shows what the module reads (the calls listed in
`completion.lua`'s header, in plain words) and one "Turn on" button that flips the switch; nothing is read until
then. When on: four sections for this character, from the owned and catalog rows the module already writes.
Achievements: points, done of total, by category, with the ten newest earned. Reputation: each faction with its
standing bar and the next standing. Titles: known of total, with the missing ones listed. Raids: this week's
lockouts, bosses killed of total, reset time. A "Missing" filter on each section. "Where to get it" is not in this
change: it needs the community source file, which is thin until more installs loot; the design leaves the column
out rather than empty.

### 5. Professions

This character's professions with skill bars (exists on Home, kept there too), known recipes per profession with
the count by difficulty colour from `recipe_observed` rows, when the profession window was last read, and a line
that the full planner is on everloot.app/tools/profession-planner. No new capture.

### 6. Settings page

Gains "What you've added" (row counts) from Home, and the per-module switches it already has.

## Verification

- Contract tests first for each behaviour: `ledger_contract.py` (category rules equal to the TypeScript lists,
  bounded window, daily closes, unrecorded line, sale row from a simulated seller invoice, buyer name never
  stored), `ui_window_contract.py` extended for the new sidebar and views (no events registered, dashes for
  unreadable values), `gold_contract.py` extended for the sale capture, `owned_contract.py` for the roster store
  being local only. A parity test runs the same event list through the Lua ledger and the TypeScript
  `money-ledger.ts` and compares totals.
- `addon/tests/run_all.py` green; the market trap suite unchanged and green.
- Live-client checklist entries for the owner (a new section in `docs/2026-10-28-live-client-capability-checklist.md`):
  open the window on each tab; sell one auction, collect the letter, see the Sales row with item and price; the
  Overview chart after two days; Collection "Turn on" then reload. Slice two adds the sold notice, a repair, a trade
  and an alt mail.
- Ships in the nightly first; the owner's in-game check gates the tag, as for 0.3.22.

## Left to the builder

- Layout inside the window's fixed `W`/`H`, the tab strip, the bar chart drawing, scroll frames for long lists.
- Resolving an item name to an id and icon for the Sales row (`GetItemInfo` with the cached name; show the name
  alone when the client does not know it).
- Exact bounded-window eviction and the migration for files that predate the ledger store.
- Which `ledger_contract.py` fixtures to borrow from `money-ledger.test.ts` so the parity test shares data.
- Whether Professions and Collection share one list widget.
