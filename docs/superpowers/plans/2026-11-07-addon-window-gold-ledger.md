# Everloot window: sidebar cut, Gold ledger, account Home, Collection, Professions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the window's "Coming soon" sidebar with four working views (Home across alts, a TSM-style Gold ledger with per-item auction sales, Collection, Professions) backed by a local, bounded ledger store, without changing what uploads carry.

**Architecture:** Capture stays in `gold.lua` (events, hooks) and a new `roster.lua`; a new `ledger.lua` owns the local store `EverlootDB.ledger` and every ledger query; `window.lua` keeps the frame and sidebar and delegates each non-Home view to a `modules/view_*.lua` file that registers `E.Window.Views[key] = { build = fn(f, parent), refresh = fn(f) }`. Views read `EverlootDB` and module query functions; they register no events and store nothing (the window contract enforces it per file).

**Tech Stack:** WoW Lua 5.1 (Forever client 1.60.1, interface 16001), Python contract tests over `lupa` (`uv run --with lupa --with jsonschema python addon/tests/<name>.py`), vitest in `web/` for the parity fixture.

**Spec:** `docs/superpowers/specs/2026-11-07-addon-window-gold-ledger-design.md`

## Global Constraints

- Every client call a view or module makes goes through `E.Readable` (secret values) and `pcall`; a value that cannot be read draws `-`.
- The window and every `view_*.lua` file contain none of: `RegisterEvent`, `HookScript`, `hooksecurefunc`, `E:Store`, `EverlootDB.records[`, `SendAddonMessage` (outside comments). `ui_window_contract.py` checks each file.
- `EverlootDB.ledger` and `EverlootDB.roster` are top-level keys, never under `records`; no uploader reads them (`web/src/lib/sv-parse.ts:214` reads `records` only).
- Ledger bounds: events 5,000 rows or 90 days (oldest dropped first); sales 2,000 rows; daily closes 400 days per character.
- No other player's name is stored anywhere: `GetInboxInvoiceInfo`'s `playerName`, trade partner and mail sender are read only to test roster membership (slice two) and discarded.
- Category lists are exactly `kb/src/gold-ledger.ts`: income `loot, quest, vendor, auction`; spending `flight, postage, barber, respec, auction_spend`; slice two adds spending `repair, vendor_spend, trade_out, mail_out` and income `trade_in, mail_in`. Days are UTC (`date("!%Y-%m-%d", ts)`).
- Money is drawn with `U.Money` (coin icons); copper amounts are integers ≥ 1.
- Copy: plain sentences, no "Coming soon" anywhere in the window after Task 1.
- Commits: `git commit -s` (DCO), no AI attribution lines, message style `feat(addon): …` / `test(addon): …`.
- Run the full suite before every commit: `uv run --with lupa --with jsonschema python addon/tests/run_all.py` → `Addon contract tests: N PASS`.

## Review Focus

1. A file from before this change (no `EverlootDB.ledger`, no `roster`) must open every tab without error and show dashes or "nothing recorded yet" — Task 3 (store init on a nil table) and Task 5 (empty view).
2. A letter whose invoice is `seller` but whose money delta does not match (another addon took the money first) must produce no sale row and no `auction` event, as today — Task 4.
3. Two characters with the same name on different realms must not merge in the roster or the ledger — Task 2 (key from install id + GUID) and Task 3 (`keys` filter).
4. The ledger period "Today" at 23:59 UTC then 00:01 UTC must move the day boundary with the clock, never show tomorrow's empty day — Task 3 (`Summary` uses `time()` at call).
5. A sale invoice with `count` nil or 0 (older client, or a non-commodity letter) must still record the sale with `count = 1` and the name — Task 4.

---

### Task 1: Sidebar cut and the view registry

**Files:**
- Modify: `addon/modules/window.lua:22-35` (`U.NAV`), `:505-525` (`U.Select`), `:406-412` (build: note frame)
- Modify: `addon/tests/ui_window_contract.py:205-212` and the file-level checks at `:136-139`
- Modify: `addon/Everloot.toc` (no new files yet; order unchanged)

**Interfaces:**
- Produces: `U.Views = {}` on `E.Window`; a view is `{ build = function(f, parent) end, refresh = function(f) end }` keyed by nav key. `U.Select(key)`: Home as today; a key in `U.Views` builds its frame once (`f.views[key]`, parented to `f`, at `TOPLEFT MAIN, -48`, size `W - MAIN - 12, H - 60`), shows it, hides the others, calls `refresh`; a key with `open` hands off as today. `U.Views` may be filled by files loaded after `window.lua`.
- Produces: `U.NAV` = home, gold, collection, professions, settings(bottom). `gold`, `collection`, `professions` have no `view` string and no `open`; they are looked up in `U.Views` at select time. An unregistered key shows the line "This part of Everloot did not load. /everloot status says why." in `f.note`.

- [ ] **Step 1: Write the failing test.** In `ui_window_contract.py`, replace the "Other sidebar items" block with:

```lua
assert(f.nav.ask == nil and f.nav.plan == nil and f.nav.auctions == nil, 'Ask, Build plan and Auctions left the sidebar')
assert(f.nav.gold and f.nav.collection and f.nav.professions and f.nav.settings, 'Home, Gold, Collection, Professions, Settings')
Everloot.Window.Views.collection = { build = function(f, parent) parent.built = true end, refresh = function(f) f.views.collection.refreshed = (f.views.collection.refreshed or 0) + 1 end }
f.nav.collection.scripts.OnClick(f.nav.collection)
assert(f.home.shown == false and f.views.collection.shown and f.views.collection.built and f.views.collection.refreshed == 1 and f.subtitle.text == 'Collection')
f.nav.gold.scripts.OnClick(f.nav.gold)
assert(f.views.collection.shown == false and f.note.shown and f.note.text:find('did not load'), 'an unregistered view says so')
assert(not f.note.text:find('oon'), 'no coming soon')
```
Keep the Settings and Home assertions that follow. Add to the file-level checks: `assert "Coming soon" not in source`.

- [ ] **Step 2: Run it.** `uv run --with lupa python addon/tests/ui_window_contract.py` → FAIL on `f.nav.ask == nil`.
- [ ] **Step 3: Implement.** `U.NAV` per Interfaces; `U.Views = {}`; in `build()` add `f.views = {}`; `U.Select` per Interfaces (build view inside `pcall`, failure → `U.Fail`). Remove `E.Planner.Open` and `E.GphCommand("show")` hand-offs from NAV only (the modules stay).
- [ ] **Step 4: Run the window contract and the full suite.** Both PASS (`38 PASS`).
- [ ] **Step 5: Commit** `feat(addon): sidebar shows Home, Gold, Collection, Professions, Settings; views register by key`.

### Task 2: Character key in core, roster module

**Files:**
- Modify: `addon/core.lua` (add `E.CharacterKey()` next to `E.Adler32`), `addon/modules/completion.lua:119-128` (`C.Identity` calls it)
- Create: `addon/modules/roster.lua`
- Modify: `addon/Everloot.toc` (`modules\roster.lua` after `modules\gold.lua`), `addon/modules/options.lua:13-44` (row after "Your gold")
- Create: `addon/tests/roster_contract.py`; add to `addon/tests/run_all.py`

**Interfaces:**
- Produces: `E.CharacterKey() -> key(8 hex) | nil, classToken, level` with the same formula as `completion.lua:119-128` (`hex8(E.Adler32(installId .. ":" .. UnitGUID("player")))`), secrets → nil.
- Produces: `E.Roster.Current() -> key | nil`; `E.Roster.Rows() -> array` sorted realm then name of `{ key, name, realm, class, level, faction, professions = { { name, icon, rank, maxRank } }, lastSeen, copper, peakCopper }` (copper fields nil when the gold module is off); `E.Roster.Update()` writes `EverlootDB.roster[key]` for the current character; `E.Roster.Forget(key)` removes it. Store shape exactly the row above, minus `key`.
- Module name `roster`, toggle default on (`defaults.toggles.roster = true`), options row label "Your characters", text "Name, realm, class, level, faction, gold and professions of each character you log in with, for the window's Home. Stays in this file; never uploaded."
- Events: `PLAYER_ENTERING_WORLD`, `PLAYER_LEVEL_UP`, `SKILL_LINES_CHANGED`, `PLAYER_MONEY` (money only when `E:IsEnabled("gold")`).

- [ ] **Step 1: Write `roster_contract.py`** (fixture style of `gold_contract.py`; load `core.lua`, `modules/gold.lua`, `modules/roster.lua`, `modules/options.lua`). Assertions: after `PLAYER_ENTERING_WORLD` one row with name `Thrall`, realm `Test Realm`, class `SHAMAN`, level, faction, professions from the stubbed `GetProfessions`; `PLAYER_MONEY` updates `copper`; `GetProfessions = nil` → `professions = {}` and status says `professions: no API`; `toggles.gold = false` → `copper == nil`; `toggles.roster = false` → no `EverlootDB.roster`; a secret `UnitGUID` → no row; `Forget(key)` removes it; the source contains no `E:Store(` and never writes `EverlootDB.records`; `Everloot:Status()` has a `roster:` line; `E.CharacterKey()` equals what `completion.lua`'s `C.Identity` returns for the same stubs.
- [ ] **Step 2: Run** → FAIL (`roster.lua` missing).
- [ ] **Step 3: Implement** `E.CharacterKey` (move the body; `C.Identity` becomes a thin call so `completion_contract.py` stays green), `roster.lua`, TOC line, options row, default toggle.
- [ ] **Step 4: Run `roster_contract.py`, `completion_contract.py`, `options_contract.py`, then `run_all.py`** → PASS.
- [ ] **Step 5: Commit** `feat(addon): roster module keeps each character's own facts for Home`.

### Task 3: Ledger store and queries

**Files:**
- Create: `addon/modules/ledger.lua` (TOC: after `modules\roster.lua`, before `modules\gold.lua`? No: `gold.lua` calls `E.Ledger` at event time, not load time, so load order is roster, ledger, then the rest; put `modules\ledger.lua` right after `modules\roster.lua`)
- Create: `addon/tests/ledger_contract.py`, `addon/tests/fixtures/ledger-parity.json`; add to `run_all.py`
- Create: `web/src/lib/money-ledger.parity.test.ts`

**Interfaces:**
- Produces (all on `E.Ledger`, store at `EverlootDB.ledger = { events = {}, sales = {}, daily = {} }`, created on first use):
  - `INCOME`, `SPENDING` arrays (strings, order as `kb/src/gold-ledger.ts` plus the slice-two names); `LABELS[category] -> string` (same labels as the TypeScript `INCOME_LABEL`/`SPENDING_LABEL`; new: Repairs, Vendor purchases, Trades in, Trades out, Mail in, Mail out); `Direction(category) -> "in"|"out"`.
  - `Record(key, category, copper, extra) -> boolean` appends `{ at = time(), key, category, copper, itemName = extra.itemName, count = extra.count }`; refuses non-whole copper or unknown category; evicts oldest past 5,000 rows or older than 90 days.
  - `RecordSale(key, sale) -> boolean` appends `{ at, key, itemName, count, unit, total, deposit, cut, status = "paid" }` (`unit = floor(total / count)`); 2,000 cap.
  - `Close(key, copper)` sets `daily[key][date("!%Y-%m-%d")] = copper`; keeps the newest 400 dates per key.
  - `Summary(keys, fromTs, toTs) -> { categories = { { category, direction, copper, events } sorted copper desc then name }, days = { { date, inCopper, outCopper, net } oldest first, only days with events }, receipts(dateString) -> rows newest first, totalIn, totalOut, unrecorded }` where `unrecorded = (closing balance at toTs - closing at fromTs) - (totalIn - totalOut)` when both closes exist, else nil. `keys` is an array of character keys (one key = one character; all roster keys = account).
  - `Sales(keys, fromTs, toTs) -> rows newest first`; `SalesByItem(keys, fromTs, toTs) -> { { itemName, count, total, unit = floor(total/count), sales } }` sorted total desc.
  - `Series(keys, days) -> { { date, copper } }` of the last `days` UTC days, summing each key's latest close on or before that date; a day with no close for any key is nil copper.
  - `Period(name) -> fromTs, toTs` for `"today"`, `"7d"`, `"30d"`, `"all"` (from = 0), computed from `time()` at the call.
- Module name `ledger`, registered under the `gold` toggle (`E:RegisterModule("ledger", init, "gold")`); status line "ready (N events, M sales, local only)".

- [ ] **Step 1: Write the parity fixture** `addon/tests/fixtures/ledger-parity.json`: `{ "now": "2026-11-07T12:00:00Z", "events": [ {at, character, realm, category, copper} × 12 covering every slice-one category, two characters, one event 40 days old ], "expected": { "categories": [ {category, direction, copper, events} ], "week": {in, out, net} } }`.
- [ ] **Step 2: Write `money-ledger.parity.test.ts`** (vitest): build `money_event` records from the fixture, `summarizeMoney(records, Date.parse(now))`, assert `categories` and `week` equal `expected`. Run `cd web && npx vitest run src/lib/money-ledger.parity.test.ts` → PASS (it defines the expected values; fix the fixture until it does).
- [ ] **Step 3: Write `ledger_contract.py`.** Load `core.lua`, `modules/ledger.lua` with `time()` stubbed to the fixture's `now`. Assertions: `INCOME`/`SPENDING` equal the TypeScript lists (read `kb/src/gold-ledger.ts` with a regex in the test); feeding the fixture through `Record` gives `Summary(allKeys, 0, now).categories == expected.categories` and the 7-day window totals equal `expected.week`; `Period("today")` boundaries at UTC midnight (set `time()` to 23:59:30Z then 00:00:30Z next day); eviction at 5,001 events and at 91 days; `RecordSale` cap 2,000; `Close` then `Series(keys, 3)`; `unrecorded` arithmetic with two closes; a nil `EverlootDB.ledger` on an old file creates the store; `Record` never writes `EverlootDB.records`; the file has no `RegisterEvent`.
- [ ] **Step 4: Run** → FAIL (`ledger.lua` missing).
- [ ] **Step 5: Implement `ledger.lua`.**
- [ ] **Step 6: Run `ledger_contract.py` and `run_all.py`** → PASS.
- [ ] **Step 7: Commit** `feat(addon): local gold ledger store with the web's category rules and a parity fixture`.

### Task 4: Gold capture writes the ledger and records sales

**Files:**
- Modify: `addon/modules/gold.lua:62-72` (`storeMoney`), `:93-103` (`mailTaken`), `:77-89` (`moneyChanged`), `:168-220` (events)
- Modify: `addon/tests/gold_contract.py`

**Interfaces:**
- Consumes: `E.Ledger.Record`, `RecordSale`, `Close`; `E.CharacterKey`.
- Produces: every `storeMoney(category, copper)` also calls `E.Ledger.Record(key, category, copper, extra)` when `E.Ledger` exists; `PLAYER_MONEY` and `PLAYER_ENTERING_WORLD` call `E.Ledger.Close(key, copper)`. `mailTaken` keeps `{ letter, sale }` and adds `item = { itemName, count, bid, buyout, deposit, cut, commerce }` read from `GetInboxInvoiceInfo` positions (invoiceType, itemName, playerName, bid, buyout, deposit, consignmentFee, moneyDelay, etaDay, etaHour, count, commerceAuction); `playerName` is bound to `_`. When the delta confirms the letter, `storeMoney("auction", sale)` passes `extra = { itemName, count }` and `E.Ledger.RecordSale(key, { itemName, count = count or 1, total = sale, deposit, cut })`.

- [ ] **Step 1: Extend `gold_contract.py`.** Stub `GetInboxInvoiceInfo` to return `('seller', 'Linen Cloth', 'Buyerperson', 4000, 4000, 100, 200, 0, 0, 0, 20, true)`, `GetInboxHeaderInfo` money `3900` (bid − cut + deposit). Simulate `TakeInboxMoney(1)` then `money = money + 3900; fire PLAYER_MONEY`. Assert: one `money_event` `auction 3800`; `EverlootDB.ledger.sales[1]` has `itemName 'Linen Cloth', count 20, total 3800, unit 190, deposit 100, cut 200, status 'paid'`; `EverlootDB.ledger.events` has the auction row with `itemName`; serialising `EverlootDB` (walk all strings) never contains `'Buyerperson'`. A mismatched delta (money + 1) → no sale, no event. `count = nil` → `count 1`. Daily close written on `PLAYER_MONEY`. With `E.Ledger = nil` (file not loaded) gold still records `money_event` as before.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `gold_contract.py`, `conveniences_contract.py`, `run_all.py`** → PASS.
- [ ] **Step 5: Commit** `feat(addon): auction sales by item in the local ledger; buyer names never read`.

### Task 5: Gold view

**Files:**
- Create: `addon/modules/view_gold.lua` (TOC: after `modules\window.lua`, before `modules\minimap.lua`)
- Modify: `addon/tests/ui_window_contract.py` (`BEFORE` adds `modules/roster.lua`, `modules/ledger.lua`; `AFTER` adds the three view files; file-level forbidden-word check loops over `window.lua` and every `view_*.lua`)
- Create: `addon/tests/view_gold_contract.py`; add to `run_all.py`

**Interfaces:**
- Consumes: `E.Window.Views`, `U.Money`, `U.Text/Surface/COLORS`, `E.Ledger.*`, `E.Roster.Rows/Current`, `E.Gph.Summary`, `E.GphCommand`, `EverlootDB.gph.current`.
- Produces: `E.Window.Views.gold = { build, refresh }`. `f.gold = { tab = "overview", period = "30d", scope = "character"|"account", tabs = { overview, ledger, sales, session }, periods = { today, ["7d"], ["30d"], all }, ... }`. Sections:
  - Overview: `f.gold.rows[i]` (name, gold) per roster row grouped by realm with `f.gold.realmTotals[realm]`, `f.gold.accountTotal`; chart `f.gold.bars[1..30]` StatusBars with `SetMinMaxValues(0, max)` and `SetValue(copper)`; `f.gold.chartCaption` "Last 30 days · <scope>".
  - Ledger: `f.gold.categories[i]` (label, amount, count), `f.gold.days[i]` (date, in, out, net), `f.gold.receipts[i]` for the selected day (`f.gold.day`), `f.gold.unrecorded` text "Unrecorded: <money>" or "Unrecorded: -".
  - Sales: `f.gold.sales[i]` (item, count, unit, total, when, status); `f.gold.groupButton` toggles `SalesByItem`.
  - Session: `f.gold.session` lines from `E.Gph.Lines()`, `f.gold.sessionButton` Start/Pause/Resume, `f.gold.stopButton`.
  - Period and scope buttons set state and call `refresh`.
  - Empty states: no roster → "No characters recorded yet."; no events in period → "Nothing recorded in this period."; no sales → "No auction sales recorded yet. Collect an auction letter at the mailbox and it appears here."

- [ ] **Step 1: Write `view_gold_contract.py`** reusing `ui_window_contract.py`'s `WORLD` (import it). Seed `EverlootDB.roster` with two characters (same name, two realms), `EverlootDB.ledger` with events (one each of vendor 41000, quest 67500, flight 55, auction 3800 with itemName) and sales, closes for 3 days. Open the window, click Gold: Overview rows show both characters and `accountTotal == sum`; `bars[30].value` equals the latest close sum; switch to Ledger: `categories[1].label.text == 'Quest rewards'` with `6g 75s`, `days` has 1 row, receipts for that day has 4 rows newest first, unrecorded text present; Sales tab: one row `Linen Cloth × 20`, unit `19s`, total `38s`; group button → one grouped row; Session tab: `sessionButton.text == 'Start'`, click → `EverlootDB.gph.current.runningSince ~= nil`; period `today` with `time()` beyond the events → "Nothing recorded in this period."; a file with no `ledger`/`roster` → every section shows its empty line, no error, `EverlootWindow.shown`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `view_gold.lua`** (layout: tab strip at `-8`, period/scope row at `-36`, content from `-64`; lists as fixed pools of 12 rows with a scroll offset and two arrows, no ScrollFrame template dependence).
- [ ] **Step 4: Run both contracts and `run_all.py`** → PASS.
- [ ] **Step 5: Commit** `feat(addon): Gold tab: overview, ledger, sales and session`.

### Task 6: Home across alts; row counts move to Settings

**Files:**
- Modify: `addon/modules/window.lua:255-342` (`buildHome`), `:90-126` (`HomeData`), `:449-500` (`Refresh`)
- Modify: `addon/modules/options.lua` (a "What you've added" block under the rows, from `U.ADDED` counts; `/everloot status` unchanged)
- Modify: `addon/tests/ui_window_contract.py`, `addon/tests/options_contract.py`

**Interfaces:**
- Consumes: `E.Roster.Rows()`, `E.Roster.Current()`, `E.Ledger.Summary` (this character, 7d, for the "This week: +X / −Y" line that replaces "Recorded:").
- Produces: `f.roster = { rows = { [i] = { name, level, gold, profs, lockouts, seen } }, realmTotals = {}, accountTotal }`; `f.week` text; the "What you've added" box and `f.added` leave `window.lua`; `U.ADDED` moves to `options.lua` as `O.ADDED`; `E.Options.page.added[i]`.

- [ ] **Step 1: Update tests.** Window: seed roster with three characters on two realms (one is the current); assert `f.roster.rows[1].name.text` is class-coloured, rows sorted realm then name, `realmTotals['Forever'].text` and `accountTotal.text` sums, lockouts `-` with `completion` off and `2 raids` when `lockout_owned` rows exist for that key, `f.week.text:find('This week')`; `f.added == nil`. Options: `page.added[i].text == tostring(Everloot:Count(kind))`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Home layout: character card left as today (150 wide), right column: week line box (444 × 56), roster box (444 × 320) with a header row and 10 row pools + arrows.
- [ ] **Step 4: Run `ui_window_contract.py`, `options_contract.py`, `run_all.py`** → PASS.
- [ ] **Step 5: Commit** `feat(addon): Home shows every character on the account; row counts move to Settings`.

### Task 7: Collection view

**Files:**
- Create: `addon/modules/view_collection.lua` (TOC after `view_gold.lua`)
- Create: `addon/tests/view_collection_contract.py`; add to `run_all.py`

**Interfaces:**
- Consumes: `EverlootDB.records.achievement_catalog/achievement_owned/reputation_catalog/reputation_owned/title_catalog/title_owned/lockout_owned` (read through a local helper `rows(kind)` that reads `EverlootDB.records` via `Everloot:Rows(kind)` — add `function E:Rows(kind) return EverlootDB.records[kind] or {} end` to `core.lua` so the view file contains no `EverlootDB.records[` text), `E.CharacterKey()`, `E:IsEnabled("completion")`, `SlashCmdList.EVERLOOT`.
- Produces: `E.Window.Views.collection`. Off state: `f.collection.offText` = the plain-words list of what the tracker reads (achievements, reputation, titles, completed quests, professions, raid lockouts, talent build, character stats, PvP standing) and where rows go (as `options.lua:39`), `f.collection.turnOn` button → `SlashCmdList.EVERLOOT("completion on")` then text "Turned on. /reload to start reading." On state: section buttons `achievements, reputation, titles, raids`; `f.collection.summary` ("Achievements: 12 of 340 · 155 points"); list pool `f.collection.rows[i]` (name, detail, done flag); `f.collection.missingOnly` toggle; newest-earned first for achievements, standing bars (`StatusBar` lo/hi = floor/ceiling) for reputation; titles known/total with missing listed; raids from `lockout_owned` (instance, `bossesKilled of bossesTotal`, reset).

- [ ] **Step 1: Write the contract.** Off: `turnOn` exists, `offText` names "achievements" and "raid lockouts", click → `EverlootDB.toggles.completion == true`. On (seed catalog + owned rows for the current key and a foreign key): summary counts only the current key; missing-only hides done rows; reputation bar `lo == floor, hi == ceiling, value == standing`; titles missing list; raids row; no `EverlootDB.records[` in the source; no events.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run + `run_all.py`** → PASS.
- [ ] **Step 5: Commit** `feat(addon): Collection tab: achievements, reputation, titles and raids for this character`.

### Task 8: Professions view

**Files:**
- Create: `addon/modules/view_professions.lua` (TOC after `view_collection.lua`)
- Create: `addon/tests/view_professions_contract.py`; add to `run_all.py`

**Interfaces:**
- Consumes: `U.Professions()`, `Everloot:Rows("recipe_observed")` (fields `profession`, `difficulty` colour token, `recipeId`), `E.Roster.Current()`.
- Produces: `E.Window.Views.professions`; per profession a block: name, bar, rank text, "N recipes recorded: a orange · b yellow · c green · d grey", "Last read: <date of the newest row>" or "Open the profession window to read its recipes."; footer line "Full planner: everloot.app/tools/profession-planner".

- [ ] **Step 1: Contract:** with the `WORLD` professions and 2 Cooking rows (`difficulty = 'optimal'`, `'medium'`) assert the Cooking block text counts them and names the newest `kindLoggedAt` date; no rows → the "Open the profession window" line; `GetProfessions = nil` → "No profession book in this client."
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(addon): Professions tab from the profession book and recorded recipe colours`.

### Task 9: Docs, checklist, changelog

**Files:**
- Modify: `addon/README.md` (window section: the five tabs, local-only ledger and roster, bounds), `CHANGELOG.md` (Unreleased, addon), `docs/2026-10-28-live-client-capability-checklist.md` (new section "Window and ledger" with probes W-1 open each tab, W-2 sell one auction and collect the letter → Sales row, W-3 Overview chart after two days, W-4 Collection Turn on then reload, W-5 Home roster after logging a second character), `docs/DATA_POLICY.md` (one paragraph: `EverlootDB.ledger` and `EverlootDB.roster` are local, never uploaded, buyer names never read)
- Test: `addon/tests/no_ads_contract.py` and `web` docs tests unaffected; run `run_all.py`.

- [ ] **Step 1: Write the docs.** **Step 2: `run_all.py`** PASS. **Step 3: Commit** `docs(addon): window tabs, local ledger and the live probes`.

### Task 10 (slice two): pending sales from the sold notice

**Files:**
- Modify: `addon/modules/gold.lua` (register `CHAT_MSG_SYSTEM`; match `ERR_AUCTION_SOLD_S` via the global format string turned into a pattern), `addon/modules/ledger.lua` (`RecordPending(key, itemName)`, `MatchPending(key, itemName) -> row|nil`, `ExpirePending(now)` marks rows older than 48 h `status = "unmatched"`)
- Modify: `addon/tests/gold_contract.py`, `addon/tests/ledger_contract.py`, `addon/tests/view_gold_contract.py`

**Interfaces:** sale rows gain `status ∈ { "pending", "paid", "unmatched" }`; `RecordSale` first looks for a pending row with the same `itemName` and `key`, fills it and sets `paid`; the Sales tab shows "sold, gold pending" for pending rows.

- [ ] **Steps:** contract (notice → pending row; invoice → the same row paid, not two rows; 49 h later → unmatched; a notice whose text is secret → nothing) → FAIL → implement → PASS → commit `feat(addon): sold notices show as pending sales until the letter arrives`.

### Task 11 (slice two): repairs, vendor purchases, trades, alt mail

**Files:**
- Modify: `addon/modules/gold.lua`: hooks `RepairAllItems`, `RepairItem` (sets `repairPending` for 5 s like buyout); `MERCHANT` money drop → `repair` when pending else `vendor_spend`; `TRADE_SHOW/TRADE_CLOSED` + `GetPlayerTradeMoney/GetTargetTradeMoney` → `trade_out`/`trade_in` with `extra.ownAlt = roster has UnitName("NPC")`; `MAIL_SEND_SUCCESS` with `GetSendMailMoney() > 0` → `mail_out` with `extra.ownAlt` from the recipient field read via `SendMailNameEditBox:GetText()` tested against roster names (discarded); a non-invoice letter's money → `mail_in` with `ownAlt` from `GetInboxHeaderInfo` sender tested against roster names (discarded).
- Modify: `addon/modules/ledger.lua`: `Record` accepts `extra.ownAlt`; `Summary` gains `moved` (sum of in/out rows with `ownAlt`) and excludes them from `totalIn/totalOut` when `keys` covers both sides; the Ledger section shows "Moved between your characters: <money>".
- Modify: `packages/protocol/schema/records/money_event.json` enum: NOT changed. `storeMoney` writes `money_event` only for the categories the schema knows; the new categories go to the ledger store alone (test asserts `protocol_contract.py` still validates every `money_event`).
- Tests: `gold_contract.py`, `ledger_contract.py`, `view_gold_contract.py`, `protocol_contract.py`.

- [ ] **Steps:** contracts first (repair 1200 → `repair`; purchase 500 → `vendor_spend`; trade with a roster name → `ownAlt = true` and `moved` excludes it; a trade partner name never appears in the file; mail to a non-alt → `mail_out` with `ownAlt = false`; `money_event` never carries a new category) → FAIL → implement → PASS → commit `feat(addon): repairs, vendor purchases, trades and alt mail in the ledger; transfers netted`.

### Task 12: Whole-branch verification

- [ ] `uv run --with lupa --with jsonschema python addon/tests/run_all.py` → all PASS; `python addon/tests/raid_plan_contract.py && python addon/tests/planner_contract.py` PASS; `cd web && npx vitest run src/lib/money-ledger.parity.test.ts` PASS; `python scripts/package-addon.py` builds the zip; `gitleaks detect --source . --log-opts="main..HEAD"` clean.
- [ ] Independent whole-branch review by a fresh reviewer against the spec; fix findings; re-run.
- [ ] Rebase on `origin/main` with `--signoff` if needed; push; open the PR with the `pr` skill's body (Summary visual / Evidence / Merge Danger); no attribution lines.
