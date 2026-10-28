# PROBE-01: live client capability checklist

Date: 2026-10-28. Status: prepared, not run. No Forever server was reachable while it was written, so every
capability below is `UNVERIFIED` until an operator runs it in the client.

This is the evidence kit for PROBE-01 in the [gap register](2026-10-28-platform-gap-register.md), Task 5 of the
[implementation plan](superpowers/plans/2026-10-28-platform-readiness.md). It settles what the Forever client
can do. It does not change the addon, Desktop, the site, flags, databases or any server. Follow-up collectors
and dashboards stay with the gap IDs named in each section, after their own design gates.

Scope boundaries for the session:

- Character links and private progress are not part of this run. The identity policy
  ([owned-character identity](design/specs/2026-10-28-owned-character-identity.md), HUB-P01) is still open: do not
  redeem a link code, sign the Desktop App in for builds, or tick the collection choice on the upload page.
- No new commands are typed into the game other than the ones listed here. Each is either an Everloot command
  handled in [`addon/core.lua`](../addon/core.lua) or a Blizzard slash command from the Forever UI source below.
  `/dump` only reads and prints a value; nothing in this list calls a function that changes the game.
- The addon does not register combat log events, and this checklist adds no code that does. Combat logging is
  probed only through Blizzard's own `/combatlog` command and by looking at files on disk.
- The Cloudflare migration terminal owns web/kb runtime, config, resources, secrets and deploy. Nothing here
  touches them.

## Three gates

Record which gate a result comes from. A higher gate never inherits a lower one's result.

| Gate | What it shows | What it cannot show |
|---|---|---|
| Source | The repository's code and tests, and Blizzard's published UI source for Forever | That the running client has the call, returns data for a Forever character, or fires the event |
| Native/package | The installed addon zip and Desktop App build on this machine: versions, files written, watcher, backups | What the game server sends |
| Live | The running Forever client on a live realm | Anything about other builds, realms or characters than the one recorded |

Source references used below, read 2026-10-28:

- This repository at `119ad0a6` (addon 0.3.12, `## Interface: 16001`; Desktop package 0.1.7; protocol package 1.21.0).
- Blizzard UI source, [`Gethe/wow-ui-source`](https://github.com/Gethe/wow-ui-source) branch `forever`, head
  `ca8368f2f2` "1.60.1 (70532)". Paths below are under `Interface/AddOns/`. A call present in the generated
  documentation can still return nothing for a Forever character; a documented event can still never fire.

## Evidence status and record

Each probe ends with one record. The plan's interface names the same states in lower case; `AVAILABLE` is its
`supported`.

| Status | Means |
|---|---|
| `UNVERIFIED` | Not run yet, or run without a usable result. The default. |
| `AVAILABLE` | Observed working in the live client on the recorded build. |
| `UNAVAILABLE` | Observed absent: the call or namespace is nil, the event never fired during the scenario, or the game has no such feature. Never shown as zero. |
| `ERROR` | The call exists but raised a Lua error, returned an unexpected shape, or the client misbehaved. |

Record fields, one per probe:

```
probe:          e.g. P-REP-1
gap ids:        e.g. PROBE-01, COL-C02
gate:           live | native/package | source
status:         UNVERIFIED | AVAILABLE | UNAVAILABLE | ERROR
client build:   GetBuildInfo version.build, e.g. 1.60.1.xxxxx (also on the login screen)
interface:      from /dump select(4, GetBuildInfo())
addon version:  /everloot version
desktop:        version shown on the Desktop App's Addon or Settings page, or "not running"
date (UTC):     2026-11-..
method:         the exact command or the window opened
expected:       from this checklist
observed:       sanitized summary only (shape, field names, counts, yes/no)
evidence:       path under <private-evidence-root>, never a repository path
recovery:       what was done if it failed
```

## Private evidence handling

Keep every raw artifact in a private folder outside every Git checkout and outside the game folder, called
`<private-evidence-root>` here (for example a dated folder in your user profile). Never inside this repository,
a worktree, `docs/fixtures/` or `addon/tests/fixtures/`.

- Raw screenshots, `/dump` output, `/eventtrace` captures, SavedVariables copies and combat log files stay there.
- In a PR, issue, status note or this file: field names, types, counts, yes/no and redacted shapes only.
  Replace character and player names, realm-bound names, GUIDs, the install id, the account folder name under
  `WTF/Account/`, Battle.net tags, guild names and chat text with placeholders such as `<char-1>`.
- `/everloot status` prints the install id on its first line. Crop or redact it.
- Desktop backup file names start with the account folder name ([`desktop/src/main/backups.ts`](../desktop/src/main/backups.ts)).
  Treat those names as private.
- `/eventtrace` and combat log files show other players' names and GUIDs. Never paste them; summarize event
  names and argument positions/types only.
- Never add a captured file, or anything derived from one, to a public test fixture or the public corpus. A
  future sanitized parser fixture (LOG-L02) needs its own review and consent from everyone it names.

## 0. Baseline and safety (before logging in)

Gap IDs: REL-01, REL-04, REL-05, PROBE-01.

1. **Close the game.** Do every file step in this section with the client fully closed: the game rewrites
   SavedVariables on logout and `/reload`, and would overwrite a restore.
2. **Back up, outside the game folder.** Copy the whole `WTF/Account/` tree (every account's
   `SavedVariables/Everloot.lua` and the other addons' files) and the existing `Interface/AddOns/Everloot*`
   folders to `<private-evidence-root>/baseline/`. Keep the Desktop App's own `backups/` folder as it is; it is
   a second copy, not a replacement. Record each `Everloot.lua` size and modification time.
3. **Stop uploads for the probe session.** Pause the Desktop App from the tray (or do not start it) and do not
   use the website upload page. Probe sessions produce real observations, but whether to send them is decided
   afterwards. Nothing synthetic is ever uploaded.
4. **Record versions.** Addon version from the `.toc` (`## Version`) and later `/everloot version`; the Desktop
   App version from its Addon or Settings page; the protocol package the Desktop build carries if its release
   notes say. Expected for this source: addon 0.3.12, interface 16001.
5. **Data folder isolation (native/package).** Write down the Desktop data folder in use (`%APPDATA%\Everloot`,
   `~/Library/Application Support/Everloot` or `~/.config/everloot`, per [`desktop/README.md`](../desktop/README.md)).
   A source run of the app must set `EVERLOOT_DATA_DIR` to a scratch folder so it never touches the real
   `sent.json` and settings. Do not run a source build against the real data folder during this probe.
6. **Toggles.** Note, do not change, the current toggles from `/everloot status` once in game. Leave `players`
   off: it reads other players' names. Changing `census` or `completion` to off deletes their rows
   ([`addon/core.lua`](../addon/core.lua)); do not run an `off` command on the real file during this probe.

Recovery: if anything in the session corrupts or loses a file, close the game, copy the baseline file back over
the live one, and keep the damaged copy in `<private-evidence-root>/damaged/` for the REL follow-up. From the
Desktop App, restore only while logged out; it backs up the replaced file first.

## 1. Client, addon and slot addons

Gap IDs: REL-05, PROBE-01; "slot overwrite parity" in the register's outside-wave list.

| Probe | Steps | Expected | If not |
|---|---|---|---|
| P-BUILD-1 | Log in. `/dump GetBuildInfo()` and `/dump select(4, GetBuildInfo())`. Compare with the login screen. | Version `1.60.1`, a build number, interface `16001` | A different interface can mark Everloot and its slots out of date in the AddOns list: record what the list says for REL-05; do not edit the `.toc` in the session |
| P-BUILD-2 | `/everloot version`, then `/everloot status` | `Everloot 0.3.12`; one line per module, `ready` or a reason | A `disabled: …` line is the evidence: copy the reason (redact the first line's install id) |
| P-SLOT-1 | In the game's AddOns list, check `EverlootPrices`, `EverlootAnswers`, `EverlootBuilds` | Present only if the Desktop App or companion has written them; each loadable, not out of date | Record which are missing, disabled or out of date |
| P-SLOT-2 | First discovery: with the game running, let the Desktop App write a slot that did not exist before (tray: Refresh prices now, which sends only a GET; leave uploads paused, and skip this probe if the pause blocks the refresh). `/reload`, check the AddOns list. Then restart the client and check again | Record whether a new slot folder appears after `/reload` or only after a client restart | Either answer is evidence; the Desktop text may need to say "restart the game" |
| P-SLOT-3 | Disable `EverlootPrices` in the AddOns list, `/reload`, hover an item, `/everloot price <item id>` | Everloot loads (the slot is an `OptionalDeps`); tooltip price lines absent, no Lua error | A Lua error is `ERROR`: copy the first line only |

Re-enable the slot after P-SLOT-3.

## 2. Account files, reload and logout

Gap IDs: REL-04, COL-C03, HUB-P04 (input only), PROBE-01.

Use two game accounts on the same Battle.net login if you have them, one character each. Desktop and the
command-line uploader read every `WTF/Account/<account>/SavedVariables/Everloot.lua`
([`companion/src/savedvariables.ts`](../companion/src/savedvariables.ts)).

| Probe | Steps | Expected | If not |
|---|---|---|---|
| P-ACCT-1 | Log in on account A, `/reload`. Note `Everloot.lua` modification time under A only | Only A's file changes | Another account's file changing is `ERROR` |
| P-ACCT-2 | Log out to character select. Note the time again | A's file is rewritten at logout | Record whether a write needs full logout or exit |
| P-ACCT-3 | Repeat on account B | B gets its own file; A unchanged | |
| P-ACCT-4 | With the Desktop App open but paused, check the Upload page lists both files with addon version and client build | Two separate rows | Missing row: copy the page text (redact account folder names) |
| P-ACCT-5 | Two characters on one account, `/everloot status` on each | Same install id (one file per account); completion keys differ per character once completion is on | |

Do not merge or rename account folders to test reconciliation. COL-C03's mapping design needs these
observations, not changed files.

## 3. Completion and reputation

Gap IDs: COL-C02, COL-C04 (catalog side), HIST-02 (input), PROBE-01. Calls and their source evidence are in the
[0.3.3 completion checklist](2026-10-19-addon-0.3.3-beta-checklist.md) and
[`addon/modules/completion.lua`](../addon/modules/completion.lua).

If completion is already on in the file, use it as is. If it is off: `/everloot completion on`, then `/reload`.
This keeps rows local; they leave the computer only from the upload page with the collection choice, which stays
unticked here.

| Probe | Steps | Expected | If not |
|---|---|---|---|
| P-REP-1 | `/everloot completion`, wait for it to finish, `/everloot status` | `completion` notes say which parts read; `reputation_catalog` and `reputation_owned` counts above 0 | A part reported missing is `UNAVAILABLE` for that part |
| P-REP-2 | Open the reputation window. Collapse one header, `/everloot completion`, `/everloot status`; expand it, read again | Status names the collapsed header count; expanded factions appear only after expanding | Factions read while collapsed would contradict the module note |
| P-REP-3 | Character frame: open the PvP rank side panel, if the client shows one (Forever's `Blizzard_UIPanels_Game/Camelot/PVPRankFrame.lua`, which reads a renown faction) | Record whether that faction also appears in the reputation list and whether `/everloot status` counts it | Feeds COL-C02: renown needs explicit support, not a zero |
| P-REP-4 | Gain reputation once (a quest turn-in). Log out and inspect the private copy of the file | The changed `reputation_owned` row replaced its earlier one; no history kept | That is the known HIST-02 gap, recorded as observed |
| P-REP-5 | Opposite-faction or unknown factions in the list | Record whether the list shows factions the character cannot raise | Feeds eligibility rules; never infer them from names |

## 4. Professions and learned recipes

Gap IDs: COL-C04, PROBE-01. The addon records the colour the profession window shows
(`recipe_observed`, `relativeDifficulty`), not a learned list ([`addon/modules/professions.lua`](../addon/modules/professions.lua)).
Forever's `TradeSkillUITypesDocumentation.lua` documents a `learned` field and `TradeSkillUIDocumentation.lua`
documents `NEW_RECIPE_LEARNED`.

| Probe | Steps | Expected | If not |
|---|---|---|---|
| P-RCP-1 | Open a profession window. `/dump C_TradeSkillUI.GetFilteredRecipeIDs()` | A list of recipe ids | nil or an empty list with recipes visible: `UNAVAILABLE` or `ERROR` |
| P-RCP-2 | Pick one recipe the character knows and one shown but unknown (filters may hide unknown ones). `/dump C_TradeSkillUI.GetRecipeInfo(<id>)` for each | A table with `learned = true` and `learned = false` | Field absent: `UNAVAILABLE`; same value for both: `ERROR` |
| P-RCP-3 | With `/eventtrace` open, learn one recipe from a trainer | `NEW_RECIPE_LEARNED` fires with a recipe id | Not firing: record which events did |
| P-RCP-4 | Close the window, `/dump C_TradeSkillUI.GetFilteredRecipeIDs()` again | Record whether the list needs the window open | |

An anonymous `recipe_observed` row never becomes a character's learned recipe; COL-C04 waits for COL-C00.

## 5. Inventory scope

Gap IDs: ITEM-I01, PROBE-01. [`addon/modules/gear.lua`](../addon/modules/gear.lua) reads equipped items only.
Forever's `ContainerDocumentation.lua` documents `C_Container`.

| Probe | Steps | Expected | If not |
|---|---|---|---|
| P-INV-1 | `/dump C_Container and C_Container.GetContainerNumSlots(0)` | A number (backpack slots) | nil: `UNAVAILABLE` |
| P-INV-2 | `/dump C_Container.GetContainerItemInfo(0, 1)` with an item in the first slot | A table with an item id and a link | Shape differs: record field names |
| P-INV-3 | At a banker, with `/eventtrace` open, open and close the bank window | `BANKFRAME_OPENED` fires (the addon already listens for it). Record the bank-related events seen | No bank read is probed by command: Forever's bank bag ids are not established in this repository |

Record that equipped gear is not the bag or bank list; nothing here implies alt or account-wide inventory.

## 6. Auction house scan

Gap IDs: ECON-E02, ECON-E01 (wording), PROBE-01. Code: [`addon/modules/auctions.lua`](../addon/modules/auctions.lua)
uses `C_AuctionHouse.ReplicateItems`, `REPLICATE_ITEM_LIST_UPDATE` and `GetReplicateItemInfo`'s `hasAllInfo`. Its
15-minute cooldown (`E.SCAN_COOLDOWN = 900`) is Retail's figure: the Forever `AuctionHouseDocumentation.lua` states
no cooldown for `ReplicateItems`. Design: [forever market design](design/specs/2026-10-16-forever-market-design.md).

| Probe | Steps | Expected | If not |
|---|---|---|---|
| P-AH-1 | At the auction house, `/dump C_AuctionHouse and C_AuctionHouse.ReplicateItems` and `/dump GetNumAuctionItems` | A function for the first; nil for the second | Legacy API present: record it |
| P-AH-2 | Open the Everloot tab and click **Scan this house** (or `/everloot scan`). Keep the house open until it reports | A chat line `scanned N items on <realm> (S rows skipped, I not loaded)`. Record N, S, I and the wall time read from your clock | `the auction house sent no data` after 30 s: record it, the addon gives the cooldown back |
| P-AH-3 | Close the auction house mid-scan on a second visit after the cooldown | `scan stopped: the auction house closed.` | A Lua error is `ERROR` |
| P-AH-4 | Click Scan again right after a scan | The addon refuses with `next full scan in N min`. This is the addon's own timer, not evidence of the server's | The server's real throttle stays `UNVERIFIED`; probing it needs a code change and a separate decision |
| P-AH-5 | Note the house kind the tab shows at a faction house and at a neutral house, if reachable | `faction` / `house` fields in the private copy of the file | |
| P-AH-6 | Observe responsiveness during the chunked read; write down visible stalls only | A description, no numbers presented as measurements | Do not publish timings |

Asking prices are not completed sales. ECON-E03 transaction categories are not probed here; the gold checks in the
[0.2.7 beta checklist](2026-10-08-beta-client-checklist.md) step 6 still apply.

## 7. Own encounters: start, end, kill, wipe

Gap IDs: PVE-E01, LOG-L02, PROBE-01. Forever's `EncounterInfoDocumentation.lua` documents `ENCOUNTER_START`
(encounterID, encounterName, difficultyID, groupSize) and `ENCOUNTER_END` (the same plus success and
`encounterUnitStatus`). The addon registers only `ENCOUNTER_END` ([`addon/modules/openworld.lua`](../addon/modules/openworld.lua),
[`addon/modules/players.lua`](../addon/modules/players.lua)). Steps 14 and 15 of the
[0.3.10 launch checklist](2026-10-21-addon-0.3.10-launch-checklist.md) cover the existing `encounter` row; run them in
the same session.

| Probe | Steps | Expected | If not |
|---|---|---|---|
| P-ENC-1 | In a dungeon, `/eventtrace`, pull the first boss and kill it | `ENCOUNTER_START` at the pull, `ENCOUNTER_END` with success 1 at the kill. Record argument count and types; whether a 6th argument arrives | Either event missing: `UNAVAILABLE` for that event |
| P-ENC-2 | Wipe on a boss, if the group agrees | `ENCOUNTER_END` with success 0 | |
| P-ENC-3 | `/reload` during a boss fight, then finish it | Record whether `ENCOUNTER_START` is seen again after the reload; this is the "missing START" case | |
| P-ENC-4 | Leave the instance mid-fight or release | Record whether `ENCOUNTER_END` fires at all | An unmatched START is unknown, never a guessed result |

Existing anonymous `encounter` rows are not attributed to a character, now or retroactively.

## 8. PvP: honor, battlegrounds, rank and season

Gap IDs: PVP-V01, PROBE-01. Forever's UI source loads a camelot PvP rank side panel
(`Blizzard_UIPanels_Game/Camelot/PVPRankFrame.lua`) that reads a renown faction, `GetCurrentArenaSeason` and
`C_SeasonInfo.GetTimeUntilCurrentPVPSeasonEnd`; it does not load the Classic or Cata `HonorFrame`. The generated
`PvpInfoDocumentation.lua` still lists arena and rated events shared with other game types. Documented is not
supported: decide support from the live client only.

| Probe | Steps | Expected | If not |
|---|---|---|---|
| P-PVP-1 | Open the character frame's PvP rank panel. Note which fields it shows (rank, progress, season end, weekly cap) | Screenshot to the private folder; record field labels only | No panel: `UNAVAILABLE` |
| P-PVP-2 | `/dump GetCurrentArenaSeason()` and `/dump C_SeasonInfo and C_SeasonInfo.GetTimeUntilCurrentPVPSeasonEnd()` | Values the panel uses | nil: record which |
| P-PVP-3 | `/dump UnitHonor("player")` and `/dump UnitHonorLevel("player")` (documented in `UnitDocumentation.lua`) | Numbers, or nil | A 0 here is only "zero honor" if the panel agrees; otherwise `UNAVAILABLE` |
| P-PVP-4 | Check whether the game offers a battleground queue at all | Yes/no and where | No: battlegrounds `UNAVAILABLE`; do not show BG zeros |
| P-PVP-5 | If a battleground exists: `/eventtrace`, queue, play to the end | Record which of `UPDATE_BATTLEFIELD_STATUS`, `PLAYER_JOINED_PVP_MATCH`, `UPDATE_BATTLEFIELD_SCORE`, `PVP_MATCH_COMPLETE`, `HONOR_XP_UPDATE` fire | Absent events are evidence |
| P-PVP-6 | Arenas and ratings | Record whether the game shows any arena or rated UI | None: `UNAVAILABLE`, not zero rating |

Scoreboards name other players. Keep them in the private folder and record counts and column names only.

## 9. Combat log file

Gap IDs: LOG-L02, LOG-L03, COMBAT-D01, PROBE-01. `/combatlog` is Blizzard's slash command
(`Blizzard_ChatFrameBase/Shared/SlashCommands.lua`, `COMBATLOG`): it toggles `LoggingCombat` and prints the enabled or
disabled message. The same branch documents `C_CombatLog.IsCombatLogRestricted` and marks `COMBAT_LOG_EVENT` and
`COMBAT_LOG_EVENT_UNFILTERED` as restricted. Everloot does not register them and must not.

Only if the client accepts the command:

| Probe | Steps | Expected | If not |
|---|---|---|---|
| P-LOG-1 | `/dump C_CombatLog and C_CombatLog.IsCombatLogRestricted()` outdoors and inside an instance | `false` or `true`; record both | nil: record it |
| P-LOG-2 | Note files in the game's product folder (beside `WTF`) and any `Logs` folder in it. `/combatlog` once | The chat message says logging is enabled | Unknown command or no message: `UNAVAILABLE`, stop here |
| P-LOG-3 | Fight one creature. `/combatlog` again to disable | A new or growing file. Record folder, file name pattern (not the full name if it contains a character name), size and that it is text | No file: `UNAVAILABLE` even though the command answered |
| P-LOG-4 | Copy the file to the private folder. Read the first lines privately: record whether there is a header with a version or build, the timestamp format, the field separator, and which event names appear | Shape only in the record | Unreadable or binary: `ERROR` |
| P-LOG-5 | Enable, `/reload`, fight, disable; then enable, log out and back in, fight, disable | Record whether logging survives a reload or relog, and whether it appends to one file or starts a new one | |
| P-LOG-6 | A boss kill with logging on (combine with P-ENC-1) | Record whether the file contains encounter start/end lines and their names | |

Disable logging at the end of the session and confirm the disabled message. Combat log files name every
participant in range: never upload, commit or paste them. Rotation, truncation and growth limits are LOG-L01 tests
on synthetic files, not live measurements.

## 10. Restore and wrap-up

1. Log out, close the game, then compare each `Everloot.lua` with its baseline copy. Probe rows are real local
   observations; keep the file unless something went wrong.
2. If a restore is needed: game closed, copy the baseline back, keep the replaced file in
   `<private-evidence-root>/damaged/`. Never copy one account's file into another account's folder.
3. Unpause the Desktop App only after deciding whether this session's file is sent. A probe session is not a
   reason to upload, and a synthetic file never is.
4. If `completion` was turned on only for this probe, leave it on until the file is kept or restored; turning it
   off deletes its rows.

## Results

Fill one record per probe; keep raw evidence private.

| Probe | Gap IDs | Gate | Status | Build | Date (UTC) |
|---|---|---|---|---|---|
| P-BUILD-1..2 | REL-05 | live | UNVERIFIED | | |
| P-SLOT-1..3 | REL-05 | native/package + live | UNVERIFIED | | |
| P-ACCT-1..5 | REL-04, COL-C03 | native/package + live | UNVERIFIED | | |
| P-REP-1..5 | COL-C02, HIST-02 | live | UNVERIFIED | | |
| P-RCP-1..4 | COL-C04 | live | UNVERIFIED | | |
| P-INV-1..3 | ITEM-I01 | live | UNVERIFIED | | |
| P-AH-1..6 | ECON-E02 | live | UNVERIFIED | | |
| P-ENC-1..4 | PVE-E01, LOG-L02 | live | UNVERIFIED | | |
| P-PVP-1..6 | PVP-V01 | live | UNVERIFIED | | |
| P-LOG-1..6 | LOG-L02, LOG-L03, COMBAT-D01 | live | UNVERIFIED | | |

## Open unknowns this checklist cannot settle

- The server's real `ReplicateItems` throttle: the addon enforces its own 15 minutes and never asks sooner.
- Whether a slot addon created while the game runs needs a client restart (P-SLOT-2 answers it for one build).
- Whether the PvP rank renown faction belongs in reputation completion or a PvP view.
- Combat log format stability across builds, and whether logging is allowed on every realm type.
- Everything that depends on the identity ADR: which character a probe result belongs to beyond this file.
