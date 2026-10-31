# Combat log tracking: opt-in, instances first, no typing `/combatlog`

**Date:** 2026-10-30
**Status:** design only. Nothing here is built. Phase 1 waits on the launch-day probes (section 9 of the
[live client checklist](../../2026-10-28-live-client-capability-checklist.md)), and anything that leaves the
player's machine waits on a data-policy line Carlos approves.
**Builds on:** the gap register's LOG-L01 to LOG-L03 and COMBAT-D01 to COMBAT-D03
([register](../../2026-10-28-platform-gap-register.md)), the player pages design
([spec](2026-10-20-player-pages-design.md)), the addon's per-module switches (`addon/core.lua`, `options.lua`).

## Why

Carlos, 2026-10-29: let players choose what Everloot tracks, one kind at a time (the auction house, the combat
log, ...). Start the combat log with instances only, and don't make players type `/combatlog` every time. Open
world can come later, if players ask for it. Get the major things right, don't collect more than needed, and don't
scare players.

## What Everloot already has without the combat log

The combat log should only be added for what it alone can give. Reading the addon on 2026-10-30:

- **Kills and wipes per boss.** `openworld.lua` (on by default) writes an anonymous row on every `ENCOUNTER_END`
  inside a dungeon or raid: encounter, instance, difficulty, group size, and kill or wipe. No names.
- **Guild kills.** `players.lua` (off until `/everloot players on`) writes the guild, encounter and time for a
  kill. Never a character name.
- **Durations: missing, and cheap.** Nothing listens to `ENCOUNTER_START`, so a fight's length is not recorded.
  Adding a start time to the existing encounter row gives "how long does this boss take" with no combat log at
  all.

So **phase 0** is: add `ENCOUNTER_START` to `openworld.lua` and put the fight's length (whole seconds, capped) on
the encounter row it already writes. This needs no new switch, no new data kind and no combat log. It needs a
policy check: duration is a new field on an existing anonymous row. It can ship in the first addon release after
launch, once P-ENC-1 confirms the encounter events fire in Forever.

## What only the combat log gives

Damage, healing, casts, deaths, interrupts, and who did each. Every line names the characters involved: the
player, the group, and anyone else in range. That is why the log is a different kind of data from everything
Everloot reads today, and why the steps below keep it on the player's machine until there is a policy for more.

Note: `COMBAT_LOG_EVENT_UNFILTERED` is restricted in this client branch, and Everloot must not register it
(checklist section 9). The design reads the **file** the game writes, not the event.

## Hard limits

- **Off until the player turns it on.** A new switch, `combatlog`, off by default (`defaults.toggles` in
  `addon/core.lua`, a row in the options panel, `/everloot combatlog on|off`). Turning it off stops logging at once
  and restores the game's own logging state.
- **Instances only.** Logging runs inside a dungeon or raid (`IsInInstance()`, type `party` or `raid`). Open world,
  battlegrounds and arenas are left alone. Open world is a later, separate switch, built only if players ask.
- **The raw file never leaves the machine through Everloot.** Not uploaded, not read by the companion's network
  code, not attached to `/ask`, not in support bundles. Players may still use it with other tools themselves.
- **No other player's name is stored or sent by Everloot.** Local summaries are about the player's own character
  and the fight as a whole (boss, length, result). Group members are counted, not named.
- **The player's own logging is respected.** If the player already logs combat (with `/combatlog` or another
  addon), Everloot does not turn it off on leaving an instance. It only undoes what it did itself.
- **Plain words in game.** One line when the switch turns on, saying what it does and where the file goes. No
  prompt in a fight. No nagging: one hint, once, in the options panel, never a popup.

## Phase 1: the addon turns logging on in instances (LOG-L03)

`addon/modules/combatlog.lua`, a small module:

1. On `PLAYER_ENTERING_WORLD` and `ZONE_CHANGED_NEW_AREA`, read `IsInInstance()`.
2. Entering a dungeon or raid with the switch on: if `LoggingCombat()` is false, call `LoggingCombat(true)` and
   remember that Everloot turned it on (`EverlootDB.combatlogOwned = true`).
3. Leaving: if Everloot turned it on, call `LoggingCombat(false)` and clear the flag. If the player had it on
   before, leave it on.
4. `/everloot combatlog` prints the state: off, on and waiting for an instance, or logging now.
5. A `/reload` or relog inside an instance keeps the state (the flag is in SavedVariables).

**To probe on launch day before building** (adds to checklist section 9):

- P-LOG-7: does `LoggingCombat(true)` called from addon code work outside combat in Forever, or is it protected?
  Expected: it works (other addons use it on classic clients). If it is protected, phase 1 becomes a one-line
  reminder on entering an instance ("type /combatlog to log this run"), and that is all.
- P-LOG-8: does logging survive a loading screen into and out of an instance, and does the file append or start a
  new one (P-LOG-5 covers reload and relog)?
- P-LOG-9: is `IsInInstance()` true in the instance before the first fight (needed for step 2)?

The module calls only `LoggingCombat`, `IsInInstance`, `GetInstanceInfo` (the instance type) and the frame event
API. The contract test lists those calls and fails on any other, like `players.lua`'s.

## Phase 2: local summaries in the Desktop App (LOG-L01, LOG-L02)

The Desktop App already finds the game folder (`desktop/src/main/game-folder.ts`). The game writes the log under
the product folder's `Logs` (P-LOG-2 and P-LOG-3 confirm the folder and file name pattern).

1. **Reader (LOG-L01).** Reads the newest log file in bounded chunks from a saved offset. It handles appends,
   rotation to a new file, truncation, a partial last line and partial UTF-8, and a line over a size cap (skipped
   and counted). It is tested on synthetic files only. Real logs are never committed.
2. **Parser (LOG-L02).** Only after P-LOG-4 and P-LOG-6 give the real line shape. It reads `ENCOUNTER_START` and
   `ENCOUNTER_END` lines and the player's own damage, healing and deaths between them. Event names it doesn't know
   are counted, not guessed. A missing END closes the fight as "unknown result".
3. **Summary (local).** Per fight: instance, boss, difficulty, result, length, group size, and the player's own
   damage, healing and deaths. It is stored in the app's own data folder, the last 200 fights, with a "delete all"
   button.
4. **View.** A "Recent fights" list in the Desktop App. Nothing about it is sent anywhere.

Names of other characters exist only in memory while a chunk is parsed. The summary keeps counts.

## Phase 3: sharing, only with a new policy line (COMBAT-D01 to COMBAT-D03)

Anything leaving the machine is a new data kind: a fight summary without names (boss, difficulty, length, result,
group size, perhaps the player's own class and output). It would give "how long does this boss take, how often do
groups wipe" with more detail than phase 0. Before any of it:

- a data-policy line Carlos approves (draft below);
- its own switch, separate from `combatlog`: logging locally and sharing are two decisions;
- bounded payloads, idempotency and deletion (COMBAT-D02);
- no rankings or comparisons until event coverage is proven and cohort and sample rules are written (COMBAT-D03).

**Draft policy line (not approved, for Carlos):**

> **Combat logs.** With the combat-log switch on, the addon turns the game's own combat logging on inside dungeons
> and raids and off again when you leave. The file stays on your computer. Everloot's Desktop App may read it to show
> you your own recent fights; it keeps your character's numbers and the fight's boss, length and result, never
> another player's name, and sends none of it. Sharing fight summaries is a separate switch, described here before
> it exists.

## Order and dates

| Step | What | Waits on | Size |
|---|---|---|---|
| 0 | Fight length on the existing encounter row | P-ENC-1 on launch day; policy check of one new field | S |
| 1 | `combatlog` switch + instance auto-logging | P-LOG-7 to P-LOG-9; policy line approved | S |
| 2a | Desktop log reader on synthetic files | nothing (can start now) | M |
| 2b | Parser, summaries, Recent fights | P-LOG-4, P-LOG-6 (real line shape) | M |
| 3 | Sharing summaries | a second policy line, COMBAT-D01 decision | L |

Step 2a is the only part that can be built before launch without guessing.

## Not doing

- Registering `COMBAT_LOG_EVENT_UNFILTERED` or any restricted event.
- Uploading raw logs, now or as a default later.
- Open-world logging in this round.
- Rankings, parses or comparisons between players.
