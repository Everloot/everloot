# Pull timing, dungeon runs and per-player pull totals

**Date:** 2026-11-02
**Status:** built in a draft pull request; the owner decided section 9 on 2026-11-02. Nothing is recorded until an addon
release sets `E.RUN_RECORDS` (section 6), and nothing named is kept until the site's `EVERLOOT_PULL_SUMMARIES` switch is
on. No public page, rollup or API serves these rows.
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
  difficulty within 30 minutes of leaving is the same run. Only time outside counts: a reload or relog after any stay
  inside, however long, is the same run.
- **Ends** when the player has been out for more than 30 minutes (written at the next loading screen), enters another
  instance, the game prints `<instance> has been reset.`, or a boss the run already killed is pulled again (a reset the
  addon could not read). A run with no boss pull writes nothing.

About 450 bytes a row. A player farming 50 dungeon runs a week adds about 22 KB. The file-wide cap (2,000 rows per
kind, then collection pauses) bounds it at about 0.9 MB.

Not covered: the run of a group member who joined late (their run starts when they zone in); two copies of the same
instance within 30 minutes without a reset line or a repeated boss would join into one run; a player who logs out
inside and logs back in there days later, in a new copy, continues the old run until a killed boss is pulled again. The `runId` on each
encounter row lets the site split a run later if needed.

### 3c. `pull_summary` (new, named, on by default)

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
lines by `isLocalPlayer`, then GUID. A line whose GUID is readable but not in the group (a pet, a guardian, a creature,
a stranger) is ignored, so a pet named like a player cannot take the player's totals. The name is used only when the
client hides the line's GUID, and then only for a name one member has and a class (`classFilename`) that agrees. Two
lines that land on one member leave that total out: which one is theirs is unknown.

Size: about 150 bytes a member, so under 1 KB for a 5-player pull and about 6 KB for 40. The module keeps at most 200
rows and 2,000 member entries (about 300 KB), then pauses like every other kind until the file is uploaded and
trimmed. One row stays far below the 600 KB upload batch.

## 4. Privacy and consent

Other group members' names with their numbers are personal data about people who did not install Everloot. The owner
decided on 2026-11-02 to follow Warcraft Logs: whoever uploads sends the whole group, and the protection is per
character, as in its [character hiding](https://www.warcraftlogs.com/help/hiding-characters). This replaces the combat
log design's (2026-10-30) line "no other player's name is stored or sent by Everloot" for pull summaries.

| What | Default | Leaves the computer | Off |
|---|---|---|---|
| `encounter` start and length, `instance_run` | On with `openworld`, like `encounter` and `instance_entrance` today. No names. | Upload page, Desktop App, command-line uploader. | `openworld` switch. |
| `pull_summary` | **On** in every install, new or upgraded (`toggles.pulls` set to true at load in the builds that carry the module), said once in chat per install (`EverlootDB.pullsNotice`). | The everloot.app upload page, after its preview counts the rows and says what they hold, and the Desktop App (`pulls: true` in `desktop/src/main/jobs.ts`). The command-line uploader never sends them: it sends no named kind at all, census and player rows included, and staying consistent with that was simpler than a new flag. | `/everloot pulls off` or the settings switch: stops at once and deletes every row. |

The module reads nothing about another player beyond name, realm, class, group role and the meter's totals: no gear,
talents, guild, position or chat. `addon/tests/pulls_contract.py` lists every game call the module may make and fails
on any other, as `players_contract.py` does.

On the server:

- **Not in the upload object.** Upload objects in R2 are the record of truth and are never rewritten, and the corpus
  snapshot folds them. A hidden character could not be deleted from either. So intake writes `pull_summary` rows to
  their own tables (`supabase/migrations/20261102130000_pull_summaries.sql`): `pull_summaries` (the row without its
  members) and `pull_members` (one row per member, keyed by `link_realm_key(realm)` and the lower-case name, as
  `character_suppressions` and `players` are). `kb/src/corpus.ts` leaves the kind out of the corpus as well.
  `instance_run` has no names and stays in the upload object, private like `talent_snapshot`.
- **Hidden characters.** Anyone can hide a character with the hide form (`/players/opt-out`), without an account. The
  insert function skips every member in `character_suppressions` and does not write a pull left with none. Hiding
  deletes that character's member rows and every pull left empty: the form calls `forget_pull_member`, and a trigger
  on `character_suppressions` does the same for every hide however it is recorded (a verified owner's opt-out, a row
  the owner adds by hand). Both sides compare `link_realm_key` of the realm, never the realm as stored: a verified
  owner's opt-out keeps it only lower-cased (`forever-pioneer`), and a later upload spelling it `Forever Pioneer` must
  still leave the character out. Every member is stored with a realm (the row's when the member has none), and a row
  without one is refused, so a hide always finds it.
- **Retention.** One year after the site received the pull (`prune_pull_summaries`, run by the snapshot cron on every
  run, whether or not the switch below is on, so turning collection off never keeps what was collected). Before the
  migration PostgREST has no such function (PGRST202) and the cron treats that as nothing to prune. A row dated more
  than a year back is refused at intake.
- **Served nowhere.** Not on a page, in the corpus API, the bulk export or the MCP tools. Public display waits on the
  owner's public-character policy (`docs/design/specs/2026-10-28-owned-character-identity.md`) and must leave hidden
  characters out.
- **Switch.** `EVERLOOT_PULL_SUMMARIES=1`, one switch for the whole server side of this design. Off, intake parses
  every upload as it did before (`parseUpload(payload, { runRecords: false })`): `encounter` keeps only its old fields
  (a malformed `startedAt` is dropped unread, not refused), and `instance_run` and `pull_summary` are refused as
  unknown kinds, so an upload gets the same receipt and stores the same rows as on `main` before this change
  (`packages/protocol/test/fixtures/run-records-off.main.json` is that answer, from `main`'s own build). On, every
  intake receipt carries `runRecords: true`.
- **Uploaders hold what the site does not read.** The Desktop App and the command-line uploader keep the site's last
  answer for a batch that carried `instance_run` or `pull_summary` rows in `site-collects.json` beside `sent.json`.
  They send those rows when the site has not answered yet, when it last said `runRecords: true`, or a day after it
  last said nothing; otherwise the rows stay in the file, not marked sent, and the run says how many wait. So a site
  with the switch off is asked at most once a day, and the file is written only once such a row exists. The Desktop
  App's settings describe boss pulls only once the site has said it reads them.

The data policy (`docs/DATA_POLICY.md`, "Boss pulls and runs" and "Group numbers in boss pulls") says this, and the
upload page's preview says what the rows hold, how to stop them, that the site keeps them privately for a year and
that anyone can hide a character.

Proposed `/privacy` paragraph. The live page already describes the addon's records (census, player pages), so this
pull request adds it there as the item `#boss-pulls`, shown only while `EVERLOOT_PULL_SUMMARIES` is on, and the page's
"Last updated" date moves to 2 November 2026 with it:

> **Boss pulls (on for uploaders, private):** after each boss pull in a dungeon or raid, the addon records each member
> of your group by name and realm, with their class, their role (the group role the game shows, or a guess from their
> healing and damage, marked as a guess) and the damage, healing, damage taken and deaths the game's own damage meter
> showed, with the boss, kill or wipe and how long it took. It never reads their gear, guild, position or chat. It is
> on in the addon, which says so once in chat; `/everloot pulls off` stops it and deletes those rows from your file.
> You send them from the upload page, after a preview, or from the Everloot Desktop App. We keep them privately for a
> year after we receive them and show them nowhere; they are not in the public records. The players they name have
> not been asked. Anyone can have a character hidden, without an account, on the hide form: it is deleted from every
> stored pull and left out of later uploads.

## 5. SavedVariables budget

| Kind | Bound | Worst case |
|---|---|---|
| `encounter` (larger rows) | 2,000 rows | +180 KB over today |
| `instance_run` | 2,000 rows | about 0.9 MB, about a year of heavy play |
| `pull_summary` | 200 rows and 2,000 members | about 300 KB |
| run and pull state | `EverlootDB.run`, `EverlootDB.pullStart` | under 1 KB |

## 6. What was built

- **Release gate.** `E.RUN_RECORDS` in `addon/core.lua`, `false` on `main`. While it is false the nightly and any
  tagged build behave as before this design: `openworld.lua` registers neither `ENCOUNTER_START` nor
  `CHAT_MSG_SYSTEM`, writes no run and adds no field to `encounter`, and `pulls.lua` returns before it defines
  anything, so there is no module, settings row, `pulls` switch in the saved file, status line or `/everloot pulls`
  command (it prints the command list, as an unknown command does). `addon/tests/gate_off_snapshot.py` runs one
  session with a boss pull and records the saved file, every printed line, `/everloot status`, the commands around
  pulls, the registered events and the settings rows; `pulls_contract.py` requires this tree's to equal
  `addon/tests/fixtures/gate_off_main.json`, the same session on `main`'s addon. A gate was chosen over moving the Lua
  into a second pull request: the site, protocol and addon stay one reviewed change, the nightly cannot pick the code
  up by accident, and turning it on is one reviewed line in the release pull request (`docs/RELEASING.md`, "Release
  gates").
- `addon/modules/openworld.lua`: `ENCOUNTER_START`, `CHAT_MSG_SYSTEM`; start, length and run on `encounter`;
  `instance_run`; `Everloot.CurrentRunId()`.
- `addon/modules/pulls.lua`, the `pulls` toggle (on), the once-per-install notice, `/everloot pulls [on|off]`, a
  settings row, status lines.
- `addon/tests/pulls_contract.py`: the gate off and on; timing across a reload, corpse runs, long stays inside then a
  reload, a relog and a departure, every end reason; on by default and said once; reads only after combat; hidden
  values left out; pets, creatures and strangers named like a member; the caps; deletion on off; and a schema check
  of every row.
- `packages/protocol`: the three changes above, `PULL_KINDS`, rules, tests; `dist/` and `schema/` regenerated.
- `supabase/migrations/20261102130000_pull_summaries.sql` and `supabase/tests/pull_summaries.sql`: the pull tables,
  insert, forget, the hide trigger and retention.
- `web`: `lib/pull-summaries.ts` (switch, checks) and `lib/pull-store.ts` (Supabase, and a memory store with the same
  rules); with the switch on, intake writes pull rows there and stores timing and runs with the upload, and with it off
  answers as `main` did; the hide form deletes from the pulls; the snapshot cron prunes them, switch or not; the upload
  page preview explains them; `/privacy` has the item above behind the switch. Tests for each, including a hide
  before and after an upload, a verified owner's opt-out under another spelling of the realm, and intake with the
  switch off against `main`'s answers.
- `companion`: the uploader sends `pull_summary` only with `pulls: true`, which the Desktop App sets, and runs and
  pull summaries only to a site that reads them (`site-collects.json`, above); the Desktop App's settings describe
  them once the site does.

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

## 9. Owner decisions (2026-11-02) and what a release needs

Decided:

1. **Named pull summaries** follow Warcraft Logs: on by default for the uploader, the whole group, protection by
   per-character hiding (section 4). The data policy lines are in `docs/DATA_POLICY.md`.
2. **Duration and runs** are on by default under the `openworld` (World) switch.
3. **Desktop App** sends pull summaries, like the upload page. The command-line uploader does not (section 4).
4. **Server retention** is one year. A hidden character's rows are dropped at intake and deleted from storage.
5. **Inferred roles** stay, labelled `inferred`.

Before an addon release carries this, in order:

1. Run the live probes in section 8 (P-ENC-1, P-DM-1 to P-DM-4, P-ROLE-1, P-RESET-1) on the Forever client and write
   the results into the live client checklist.
2. Apply `supabase/migrations/20261102130000_pull_summaries.sql` in the Supabase SQL editor, and check it with
   `supabase/tests/pull_summaries.sql` on a disposable database.
3. Set `EVERLOOT_PULL_SUMMARIES=1` for the Worker (`web/wrangler.jsonc` vars) and deploy. The `/privacy` item, the
   upload page's wording and intake storage switch on together.
4. In the release pull request, set `E.RUN_RECORDS = true` in `addon/core.lua` with the version bump, changelog and
   zip (`docs/RELEASING.md`). Until then no nightly or tagged build records any of this.
