# Launch acceptance: Desktop 0.1.14 and addon 0.3.15

Record observations here or in a dated private test receipt. Do not include account names, API keys,
character names, raw save files or combat logs in a public report. Leave unrun cases pending.

## Before the game is playable

1. Download [Desktop 0.1.14](https://github.com/Everloot/everloot/releases/tag/desktop-v0.1.14) and its
   `SHA256SUMS`. Compare the chosen file's SHA-256 (`Get-FileHash <file> -Algorithm SHA256` on Windows).
   The checksum proves matching bytes; publisher identity/signing remains a separate readiness question.
2. Preserve existing settings, queued uploads and game files. For a separate portable test, set
   `EVERLOOT_DATA_DIR` to a new scratch directory in the launching terminal, as described in
   [the Desktop README](../desktop/README.md). Do not point it at an existing profile.
3. Open the portable app and record the displayed version, setup screen, tray, closing/reopening the
   window and quitting. A successfully spawned process is not a pass until these are observed.
4. For the installed app, record an upgrade from the previous version and whether settings and queued
   work remain. Back up first. Uninstall/reinstall and failure-recovery cases belong in the
   [native readiness matrix](2026-10-28-readiness-handoff.md); preserve data rather than deleting it to reset a test.
5. Select the game root and record which `_<product>_` folder the app detects. If the launch client is
   absent, mark this pending. A fixture or another game folder does not establish launch-client support.

## When the client is playable

Record date/time, full game build, realm, addon version and Desktop version. Use addon 0.3.15 or later.
These versions are the released baseline checked on November 2. Record any newer release used; passing this
card on another build does not establish acceptance on the launch build.

| Check | Action | Expected observation | Actual result |
|---|---|---|---|
| Addon startup | `/reload`, `/everloot status`, `/everloot selftest` | Addon loads; record ready/disabled modules and any Lua error | Pending |
| Website upload | Log out, preserve the save file, upload through `/upload` | Record accepted and invalid row counts; no invented success from a preview | Pending |
| Desktop upload | Run Desktop, make a new game observation and log out | Watcher sends the saved update; record status/counts/time | Pending |
| Basic `/ask` | `/ask which bosses are in Deadmines`, then log out and wait for Desktop to answer; log in or reload | Answer reaches the game and names the relevant bosses | Pending |
| Follow-up | `/ask where is Edwin VanCleef`, then `/ask what does he drop` | Follow-up keeps the same subject | Pending |
| Local context | `/ask where is the flight master here` | Answer uses the asking zone or clearly states missing evidence | Pending |
| Price | `/ask price 2589` | Uses the asking realm and recorded data, or says data is absent | Pending |
| Spanish question | `/ask dónde queda Deadmines` | Correct subject; English game names remain intact | Pending |
| Retry recovery | During an actual temporary answer failure, retain the question and restore the failed service; let Desktop retry, then reload | Failure shown once, question retained, later answer delivered once | Pending |

Do not disconnect an active game session or change production credentials merely to force the retry case.
If no safe failure occurs, leave it pending; the automated retry contracts remain separate evidence.
For upload acceptance, compare the resulting snapshot time after its next refresh. Empty/unchanged files
may legitimately have no new rows; keep the original file and the actual receipt.

## Market and ledger assumptions

The scan, price and ledger code was written against the beta client and against what addon authors
reported about Forever's auction house (retail-style `C_AuctionHouse`, one full scan per 15 minutes).
None of it is confirmed by Blizzard. Each row records what the launch client actually does; a row that
fails names a code assumption to change, not a player error. Record the same versions as above.

| Check | Action | Expected observation | Actual result |
|---|---|---|---|
| Save file read back | Play a session with one scan and one ledger event, log out, log in, `/everloot status` | The scan and the ledger rows from before the restart are still listed (a beta build wrote the save file but did not read it back) | Pending |
| Scan completes | At the auction house, Everloot tab, "Scan this house" | Finishes within 30 seconds with an item count; `/everloot status` names the realm and the house | Pending |
| Scan cooldown | Scan again at once, then again after 15 minutes | The second scan is refused and says when the next one is allowed; the third runs. Record the throttle the client itself enforces (`E.SCAN_COOLDOWN` assumes 900 seconds; a shorter real limit means the addon waits too long, a longer one means a scan returns nothing) | Pending |
| Commodities and gear | Scan a house that lists a trade good (Linen Cloth) and a piece of gear | Both appear with a unit price; record whether the trade good came back as one commodity row per unit price (retail style) or as stack listings | Pending |
| Sale captured | Sell one item on the auction house, collect the mail with the invoice | `/everloot status` shows the sale with its bid, cut and deposit; record whether the chat notice named the item and whether the invoice carried the commerce flag | Pending |
| Community price in game | After the Desktop App fetches prices, hover an item with a public value and one without | The first shows market, minimum, reporters and age; the second says there is no public value, never zero | Pending |
| Three installs agree (Agent) | After three different installs have uploaded a scan of one realm, read `/api/market/prices?realm=<realm>` and the cron's response | Items appear with `reporters` 3 within one cron run; the cron's `market` result shows `dropped` 0 and `trimmedDays` 0 | Pending |

## Six weapon readings

Hover the plain item in the current client and record its item level, quality, speed and exact damage
line. Avoid enchants, random suffixes and temporary buffs. The older comparison card is a hypothesis,
not evidence that its numbers or table classification are correct on the launch build.

| Item ID | Item | Item level / quality | Speed | Exact damage line | Game build |
|---|---|---|---|---|---|
| 851 | Cutlass | Pending | Pending | Pending | Pending |
| 852 | Mace | Pending | Pending | Pending | Pending |
| 853 | Hatchet | Pending | Pending | Pending | Pending |
| 864 | Knightly Longsword | Pending | Pending | Pending | Pending |
| 1820 | Wooden Maul | Pending | Pending | Pending | Pending |
| 2131 | Shortsword | Pending | Pending | Pending | Pending |

Missing items stay pending; do not buy items just to complete this card. The site keeps `[?]` damage
until current-build observations validate the table, formula and rounding. Only then update
`CHECKED_WEAPONS`, with its own review and tests.
