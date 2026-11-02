# Pull timing, dungeon runs and per-player pull totals

**Date:** 2026-11-02
**Status:** built in a draft pull request; nothing ships until the owner decides the points in section 9 and an addon
release carries it. No public page, rollup or API serves these rows.
**Builds on:** the [combat log tracking design](2026-10-30-combat-log-tracking-design.md) (its phase 0 is section 3a
here), the [player pages design](2026-10-20-player-pages-design.md) (the consent model for named rows) and the
[live client checklist](../../2026-10-28-live-client-capability-checklist.md) (sections 7 and 9).

## 1. Goal

The owner wants the kind of data Raider.io, WoWProgress and Warcraft Logs build on, from launch: how long each boss
pull and each dungeon or raid run took, kills and wipes, and each player's role and output per pull. That is enough
later for timed dungeon scores, encounter breakdowns and per-player history. Today the addon writes one `encounter`
row per `ENCOUNTER_END`: no start, no length, no run, no per-player numbers.

This design adds the smallest set of records that gives those numbers, keeps the file bounded, and follows the
addon's consent model. It builds no page, score or ranking.

## 2. What the Forever client gives an addon

From the Blizzard UI source for Forever (`Gethe/wow-ui-source`, branch `forever`, head `aff0d8cd53` "1.60.1 (70707)",
read 2026-11-02). Documented is not proven: every line below is the source gate only, and section 8 lists the live
probes.

| Need | What the client has | Notes |
|---|---|---|
| Pull start | `ENCOUNTER_START` (encounterID, encounterName, difficultyID, groupSize) | `EncounterInfoDocumentation.lua`. Everloot did not listen to it before. |
| Pull end | `ENCOUNTER_END` (… success, encounterUnitStatus) | Already used by `openworld.lua` and `players.lua`. |
| Instance | `GetInstanceInfo()`, `PLAYER_ENTERING_WORLD` | Already used for `instance_entrance`. |
| Reset | `CHAT_MSG_SYSTEM` with the game's `INSTANCE_RESET_SUCCESS` line | A system line, not player chat. |
| Raw combat events | `COMBAT_LOG_EVENT_UNFILTERED` | **Restricted** in this client branch (`C_CombatLog.IsCombatLogRestricted`). Everloot must not register it (checklist section 9). Details!-style live parsing is not possible. |
| Per-player totals | `C_DamageMeter` (`DamageMeterDocumentation.lua`) | Blizzard's own damage meter, loaded for the Forever game type (`Blizzard_DamageMeter.toc`: `AllowLoadGameType: standard, camelot`). Per source: `totalAmount`, `amountPerSecond`, `isLocalPlayer`, `sourceGUID`, `name`, `classFilename`, `deathTimeSeconds`. Types include damage done, healing done, damage taken and deaths. `GetCombatSessionFromType` is `SecretWhenInCombat`; `sourceGUID` and `name` are `ConditionalSecret`. |
| Role | `UnitGroupRolesAssigned(unit)` | `UnitDocumentation.lua`; `SecretWhenUnitIdentityRestricted`. Returns `NONE` when the group has no roles set, which is likely common outside the dungeon finder. |
| Active time | nothing | The meter gives a session length and a per-second rate, not each player's active time. Not recorded: it would be a guess. |
| Gear and talents per pull (`COMBATANT_INFO`) | combat log file only | Out of scope for the addon (section 7). |

So the addon reads the meter's totals once per pull, after combat, when the client no longer hides them. It never
sees a single combat event. A value the client still hides is read as missing (`E.Readable`), and a missing total is
left out of the row, never written as zero.

## 3. Records

Three changes to the record protocol (1.12.0, package 1.23.0). All three are written by the addon, validated by
`parseRecords`, and stored by intake in the private upload object. None is on the public corpus allowlist except
`encounter`, which already was.

### 3a. `encounter` gains start, length and run (anonymous, on by default)

| Field | Meaning |
|---|---|
| `startedAt` | When `ENCOUNTER_START` fired. |
| `durationSeconds` | Whole seconds to `ENCOUNTER_END`, 0 to 86,400. Comes only with `startedAt`. |
| `runId` | The `instance_run` it belongs to (16 hex). |

The start is kept in the saved file (`EverlootDB.pullStart`), so a `/reload` mid-fight keeps it. An END without its
START, or for another boss, has no start and no length. This is phase 0 of the combat log design. About 90 bytes more
per encounter row.

### 3b. `instance_run` (new, anonymous, on by default with `openworld`)

One row per dungeon or raid run that had at least one boss pull.

| Field | Meaning |
|---|---|
| `runId` | Random, made when the run starts. |
| `instanceMapId`, `name`, `instanceType`, `difficulty` | From `GetInstanceInfo`. |
| `enteredAt`, `leftAt` | Zoned in (or logged in inside); last seen inside or zoned out for good. |
| `firstPullAt`, `lastKillAt` | First boss pull's start; last boss kill. Clear time is `lastKillAt − firstPullAt`. |
| `pulls`, `kills`, `wipes` | Boss pulls; kills plus wipes equal pulls. |
| `size` | Largest group size an encounter reported. |
| `killedEncounterIds` | The encounters killed, in order, at most 40. |
| `endReason` | `left`, `new_instance` or `reset`. |

Run boundaries:

- **Starts** on `PLAYER_ENTERING_WORLD` into a dungeon or raid when no run is open, or the open one is for another
  instance or difficulty.
- **Continues** through a `/reload`, a relog inside, a corpse run or a trip out: zoning back into the same instance and
  difficulty within 30 minutes of leaving is the same run.
- **Ends** when the player has been out for more than 30 minutes (written at the next loading screen), enters another
  instance, the game prints `<instance> has been reset.`, or a boss the run already killed is pulled again (a reset the
  addon could not read). A run with no boss pull writes nothing.

About 450 bytes a row. A player farming 50 dungeon runs a week adds about 22 KB. The file-wide cap (2,000 rows per
kind, then collection pauses) bounds it at about 0.9 MB.

Not covered: the run of a group member who joined late (their run starts when they zone in); two copies of the same
instance within 30 minutes without a reset line or a repeated boss would join into one run. The `runId` on each
encounter row lets the site split a run later if needed.

### 3c. `pull_summary` (new, named, off by default)

One row per boss pull, written by the new `pulls` module (`addon/modules/pulls.lua`).

| Field | Meaning |
|---|---|
| `encounterId`, `name`, `instanceMapId`, `difficulty`, `size`, `success` | As on `encounter`. |
| `startedAt`, `durationSeconds`, `runId` | As on `encounter`. |
| `realm` | The realm the addon runs on. |
| `meterSeconds` | The meter's own length for the fight it totalled. Far from `durationSeconds` means the totals cover more or less than the pull. |
| `members[]` | 1 to 40, one per group member at `ENCOUNTER_END`. |

Each member:

| Field | Meaning |
|---|---|
| `name`, `class`, `realm` | `UnitName` and `UnitClass` token; `realm` only when not the row's. |
| `self` | `true` on the uploader's own character. |
| `role`, `roleSource` | `tank`, `healer` or `damage`. `assigned` when `UnitGroupRolesAssigned` gave one; otherwise `inferred`: healer when healing done was larger than damage done, else damage. A tank is never inferred. Absent when there is nothing to go on. |
| `damageDone`, `healingDone`, `damageTaken`, `deaths` | The meter's totals for that member. Absent when the meter had no readable line. |

When it reads: at `ENCOUNTER_END` if the player is out of combat, else at the next `PLAYER_REGEN_ENABLED`. A new
`ENCOUNTER_START` before that drops the pending pull, because its totals would be mixed. Members are matched to meter
lines by `isLocalPlayer`, then GUID, then name (a name two members share matches by GUID only). Creatures and players
outside the group are ignored.

Size: about 150 bytes a member, so under 1 KB for a 5-player pull and about 6 KB for 40. The module keeps at most 200
rows and 2,000 member entries (about 300 KB), then pauses like every other kind until the file is uploaded and
trimmed. One row stays far below the 600 KB upload batch.

## 4. Privacy and consent

Other group members' names with their numbers are personal data about people who did not install Everloot. The new
rows follow the existing consent model:

| What | Default | Leaves the computer | Off |
|---|---|---|---|
| `encounter` start and length, `instance_run` | On with `openworld`, like `encounter` and `instance_entrance` today. No names. | Upload page, Desktop App, command-line uploader. | `openworld` switch. |
| `pull_summary` | **Off** in every install, new or upgraded (`defaults.toggles.pulls = false`). | **Only** from the everloot.app upload page, which counts the rows and says what they hold before sending. The Desktop App and the command-line uploader never send them, whatever the player allowed there (`companion/src/uploader.ts`). | `/everloot pulls off` or the settings switch: stops at once and deletes every row. |

Turning it on prints what it records and where it goes. The module reads nothing about another player beyond name,
realm, class, group role and the meter's totals: no gear, talents, guild, position or chat.
`addon/tests/pulls_contract.py` lists every game call the module may make and fails on any other, as
`players_contract.py` does.

On the server, `pull_summary` and `instance_run` are stored with the upload and served nowhere: they are not on the
public corpus allowlist, so the corpus API, the bulk export and the MCP tools never return them. Public display waits
on the owner's public-character policy (`docs/design/specs/2026-10-28-owned-character-identity.md`); any later rollup
must at least apply the player pages' hide list before showing a name.

The combat log design (2026-10-30) said "no other player's name is stored or sent by Everloot". That line was written
for the combat log feature. `pull_summary` is a deliberate exception behind its own opt-in switch, and the owner has to
accept it (section 9).

Draft data-policy lines, for the owner, not yet in `docs/DATA_POLICY.md`:

> **Boss pulls and runs.** Inside dungeons and raids the addon records how long each boss pull took, kill or wipe,
> and each run: when you entered and left, the first pull, the last kill and how many bosses died. No names.
>
> **Group numbers.** Off until you turn on `/everloot pulls on`. After each boss pull it records each member of your
> group by name, with their class, role and the damage, healing, damage taken and deaths the game's own damage meter
> showed. It is sent only from the upload page, after its preview, and Everloot does not show it anywhere until a
> policy for showing players is published. `/everloot pulls off` deletes it from your file.

## 5. SavedVariables budget

| Kind | Bound | Worst case |
|---|---|---|
| `encounter` (larger rows) | 2,000 rows | +180 KB over today |
| `instance_run` | 2,000 rows | about 0.9 MB, about a year of heavy play |
| `pull_summary` | 200 rows and 2,000 members | about 300 KB |
| run and pull state | `EverlootDB.run`, `EverlootDB.pullStart` | under 1 KB |

## 6. What was built

- `addon/modules/openworld.lua`: `ENCOUNTER_START`, `CHAT_MSG_SYSTEM`; start, length and run on `encounter`;
  `instance_run`; `Everloot.CurrentRunId()`.
- `addon/modules/pulls.lua`, the `pulls` toggle (off), `/everloot pulls [on|off]`, a settings row, status lines.
- `addon/tests/pulls_contract.py`: timing across a reload, corpse runs, every end reason, the off-by-default
  behaviour, reads only after combat, hidden values left out, the caps, deletion on off, and a schema check of every
  row.
- `packages/protocol`: the three changes above, `PULL_KINDS`, rules, tests; `dist/` and `schema/` regenerated.
- `web`: intake stores the new kinds (tests); the upload page preview explains pull summaries; the public corpus test
  names both kinds as private.
- `companion`: the uploader never sends `pull_summary`.

No addon version bump, no zip, no release.

## 7. Later phase (not built)

### 7a. Desktop App reads `WoWCombatLog.txt`

The combat log file is the only source of a Warcraft Logs-style breakdown: every damage and heal event, per spell and
target, deaths with the hits before them, buffs, casts, and `COMBATANT_INFO` (gear, talents, stats) at each pull. What
it would take, following the combat log design's phases 1 and 2:

1. **Logging on in instances.** A `combatlog` switch (off) that calls `LoggingCombat(true)` on entering a dungeon or
   raid and undoes only what it did itself. Waits on P-LOG-7 to P-LOG-9 (is `LoggingCombat` callable from an addon,
   does logging survive loading screens).
2. **Reader.** The Desktop App tails the newest file under the game's `Logs` folder from a saved offset: appends,
   rotation, truncation, partial lines and partial UTF-8, a line-size cap. Built and tested on synthetic files first.
3. **Parser.** Only once P-LOG-4 and P-LOG-6 give the real line format for this client (the header, the timestamp, the
   advanced-logging fields). `ENCOUNTER_START` and `ENCOUNTER_END` lines bound each pull; damage, heal, absorb and
   death events are summed per source GUID and spell; pets are folded into owners with `SPELL_SUMMON`; unknown event
   names are counted, not guessed.
4. **Join.** A parsed pull matches the addon's `pull_summary` by encounter id and start time (within a few seconds),
   so the file adds per-spell detail to a pull the addon already recorded.
5. **Storage and sharing.** The raw file never leaves the machine. Summaries stay local (last 200 fights) with a
   "Recent fights" view. Sharing per-spell summaries is a separate switch and a separate policy line; payloads stay
   bounded (per pull: top spells per member, not every event).

Cost: medium for the reader and parser, plus a live session to capture a real log. It also needs a decision on whether
gear and talents from `COMBATANT_INFO` (other players' gear) may be shared at all.

### 7b. PvP

What the client may have (checklist section 8; all unverified): a camelot PvP rank panel with renown, an arena season
and season end; `UnitHonor`, `UnitHonorLevel`; possibly battlegrounds. Options, smallest first:

1. **Your own rank and honor** (no other players): a `pvp_snapshot` like `gold_snapshot`, your character only, at
   login and on `HONOR_XP_UPDATE`. Needs P-PVP-1 to P-PVP-3.
2. **Battleground results** (anonymous): on `PVP_MATCH_COMPLETE`, the map, length, winner faction and your team's
   size, no names. Needs P-PVP-4 and P-PVP-5 to show battlegrounds exist and which events fire.
3. **Battleground scoreboards** (named): `GetBattlefieldScore` per player (kills, deaths, honorable kills, damage and
   healing columns). Named data about up to 80 players a match; it would need its own opt-in switch like `pulls`, an
   upload-page-only path, and a policy line. The damage meter also has `Arena` session types, so the same
   `C_DamageMeter` read may work for a match once probed.

PvP waits until the probes show what Forever has; zeros for systems that do not exist would be wrong data.

## 8. Live probes before a release

Add to the live client checklist, section 7:

| Probe | Steps | Expected |
|---|---|---|
| P-ENC-1 (exists) | `/eventtrace`, pull and kill a dungeon boss | `ENCOUNTER_START` at the pull, `ENCOUNTER_END` with success 1. |
| P-DM-1 | `/dump C_DamageMeter and C_DamageMeter.IsDamageMeterAvailable()` with Blizzard's damage meter window shown and hidden | `true`. Record whether the meter tracks with its window hidden or its setting off. |
| P-DM-2 | After a boss kill, out of combat: `/dump C_DamageMeter.GetCombatSessionFromType(1, 0)` | A session with one source per group member, readable totals, `durationSeconds` close to the pull. Record whether `name` or `sourceGUID` is secret. |
| P-DM-3 | Same with types 2, 7 and 9 | Healing, damage taken and deaths. Record what `totalAmount` means for deaths. |
| P-DM-4 | Kill trash right after a boss without leaving combat, then read | Whether the current session holds only the boss or both (compare `meterSeconds`). |
| P-ROLE-1 | In a group with and without roles set, `/dump UnitGroupRolesAssigned("party1")` | `TANK`/`HEALER`/`DAMAGER` when set, `NONE` otherwise, and not secret. |
| P-RESET-1 | Reset a dungeon from the party frame | The system line matches `INSTANCE_RESET_SUCCESS` with the instance name. |

If P-DM-1 or P-DM-2 fails, `pull_summary` rows hold the group and assigned roles only, and `/everloot status` says the
meter is missing. The timing and run rows do not depend on the meter.

## 9. Owner decisions before an addon release carries this

1. **Accept named pull summaries as an opt-in exception** to the combat log design's "no other player's name" line,
   and approve the draft data-policy lines in section 4 (or reword them) for `docs/DATA_POLICY.md`.
2. **Duration and runs on by default.** They are anonymous like `encounter` and `instance_entrance`; confirm they stay
   under the `openworld` switch rather than a new one.
3. **Desktop App path for pull summaries.** This build sends them only from the upload page. Allowing the Desktop App
   later (like the player pages switch) is a separate choice.
4. **Server retention.** Pull summaries are stored privately with each upload and never served. Decide how long they
   are kept before a public-character policy exists, and whether a hidden character's rows are dropped at intake.
5. **Inferred roles.** Healer when healing is larger than damage, else damage, labelled `inferred`. Confirm the label
   is enough, or ask for no inference at all.
