# Loot tables: what drops, from where, out of how many windows

Drop-rate rule updated 2026-11-19: rates, measured zeros and unanimous drop source names now show from one install, labelled reported, verified at two, confirmed at three or more. This supersedes the drop publication thresholds described below; other thresholds stay unchanged. See [DATA_POLICY.md](../../DATA_POLICY.md).

**Date:** 2026-10-21
**Status:** design. Section 9 (the dense item-source and NPC loot tables) is built in the same pull request as
this spec; everything else is a proposal for later slices.
**Builds on:** the drop rollup (`kb/src/drop-rollup.ts`), the 3-install rule, Recorder windows counted apart
(`kb/src/pending-loot.ts`, #290 and #291), the fact states and the rate-settling rule in the
[coverage and plateau design](2026-10-21-coverage-plateau-design.md), the
[Classic baseline](2026-10-17-classic-baseline-design.md) (local only).

## Why

An item page is what a player holds up against Wowhead. Where Wowhead has a drop table, ours says nobody has
looted it yet. The data path exists: the addon records loot windows, the server rolls them up, the item and
NPC pages show a rate once three installs looted the source. What was never written down is what a loot table
*is* on Everloot: which windows count, out of what, from when, and what the page says while the windows are
not there yet. This spec does that, then builds the first table from it.

## 1. The number rule

Every number on a loot table states three things beside it. A number without them is a bug.

- **Denominator:** what it is out of. A rate is "windows holding the item ÷ loot windows opened on that
  source". A count is "N loot windows from M installs".
- **Date:** the capture dates of the windows behind it (first and last, UTC days, from `capturedAt`), and the
  corpus time the page was built from (`dataAsOf`). A capture time later than the corpus time is a wrong clock
  and dates nothing.
- **Method:** which windows count. Today: windows the addon recorded with the game's loot API naming the
  source (`sourceEvidence: "loot-api"`), from installs folded into voters as `publicRecords` does.

Terms used below, all from the code as it stands:

| Term | Meaning |
|---|---|
| Loot window | One loot record: one source (creature or object) and the items the window showed from it. Not a kill: a corpse nobody opened is not a window, and the game does not tell the addon about kills it did not loot. |
| Install | A voter: an addon install id, or a folded Recorder voter (`foldRecorderInstalls`). |
| Rate | Windows holding the item ÷ loot windows on the source. Shown only once **3 installs** looted the source (`INDEPENDENT_INSTALLS`). The page calls it *observed frequency*, never *drop chance*. |
| Measured zero | A source 3 installs looted whose windows held no item. "0 items in N windows", never "drops nothing". |
| Pending | Recorder loot windows. The Recorder file does not say whether the loot API named the source, so they are counted (`pendingLootFromRecords`) and never enter a rate. |

None of these rules change in this spec. The 3-install rule stays, the pending windows stay out of the rates,
and no rate is shown that the windows do not give.

## 2. Where the data stands on day one

Read from the site's own public endpoint, `GET https://everloot.app/api/rollups/drops`, at
2026-10-21T20:58:25Z; its corpus time was 2026-10-21T20:50:28Z:

| Number | Value | Out of |
|---|---|---|
| Uploads in the public corpus | 10 | all stored uploads that passed intake |
| Public records | 84 | records in those 10 uploads after `publicRecords` |
| Addon loot windows (`loot-api`) | 0 | the 84 public records |
| Public rates | 0 | sources with windows from 3 installs |
| Measured zeros | 0 | the same sources |

Recorder windows (pending) are not in that endpoint's answer: their count on day one is `[?]`.

So on day one every table this spec describes is honestly empty, and every page says so with the numbers
above in its own terms ("0 loot windows from 0 installs"). The work in this PR is to make the empty and
nearly-empty states say exactly what is missing, so that the first uploads fill in a table whose meaning is
already fixed.

## 3. What the addon records today, and what it does not

From `lootCapture` in `addon/modules/openworld.lua`:

- For each slot, `GetLootSourceInfo` gives the source GUIDs; creature and game-object GUIDs become
  `sourceNpcId` / `sourceObjectId`. One record per source per window, with `{ itemId, count }` per item.
- Objects also carry the player's map position and, from the spell cast just before (`gatherContext`), a
  `gatherKind` (herb, ore, chest, fishing, other) and the object's name.
- The addon keeps a local set of GUIDs already recorded (`EverlootDB.lootSources`) so a corpse opened twice is
  one window. That set is never exported.

Not recorded, each needed by a section below:

| Missing | Why it matters |
|---|---|
| Coin | `GetLootSlotLink` is nil for a coin slot, so money in the window is dropped. |
| Loot type | Pick-pocketing and skinning open a window on the *same creature GUID* as the kill. The GUID set keeps the first window opened and drops the rest. So an NPC's windows today are "the first window opened on each creature": usually its kill loot, sometimes its pick-pocket or skinning loot, never both. |
| Item sources | Disenchanting and opened containers (lockboxes, clams, bags) name an item GUID; neither GUID parser matches, so these windows are not recorded at all. |
| Window context | The mob's level and rank at the kill, the instance and difficulty, the player's level, whether a slot is a quest item. |
| Corpse identity | Two group members looting one corpse are two windows from two installs. The GUID that would show it is the same corpse stays local. |

These are protocol and addon changes. Both belong to other lanes (`packages/protocol`, `addon/`); this spec
says what the loot tables need from them and the tables wait for them.

## 4. Source types

Each source type is its own table with its own denominator. A rate never mixes them.

| Type | Source | Denominator | Recorded today |
|---|---|---|---|
| Kill loot | creature | kill windows on that creature id | yes, mixed with the next two |
| Pick-pocketing | creature | pick-pocket windows on that creature id | mixed into kill loot when first |
| Skinning (and herb/ore gathering from creatures) | creature | skinning windows on that creature id | mixed into kill loot when first |
| Gathering and chests | object | windows on that object id, per `gatherKind` | yes |
| Disenchanting | item | disenchants of that item id | no |
| Opened containers | item | openings of that item id | no |

**What the record needs:** a `lootType` (`kill`, `pickpocket`, `skinning`, `gather`, `disenchant`,
`container`, `fishing`), set from the spell cast just before the window, as `gatherContext` already does for
objects (Pick Pocket, Skinning, Disenchant by spell id and English name), and `sourceItemId` for the two item
sources. The local GUID set keys on GUID and loot type, so the kill window and the skinning window on one
corpse are both kept.

**Old windows:** windows without `lootType` stay in the kill table, which keeps the label "first window opened
on each creature" until enough typed windows exist to stand on their own. They are never re-sorted by guessing
(a window with leather from a beast is not a skinning window unless the record says so).

**Disenchanting:** the denominator is disenchants of one item id. The client's own files say what exists
(the item's quality, level and class from `ItemSparse`); our uploads say what came out. A table per item level
band and quality, as Wowhead has, is a *shared* table (section 7) and needs the volume that section names.

**Containers:** the denominator is openings of one container item id. One opening is one window, however many
slots it shows.

## 5. Money in loot windows

**Record:** the coin slot's copper (`GetLootSlotInfo` reports the slot as money; the amount is parsed from the
slot text or read from `LOOT_SLOT_MONEY` where the client has it), on the same loot record as `copper`.

**Numbers:** per source and loot type, the share of windows with any coin (out of all windows on that source),
and the median and range of copper among those windows (out of the windows with coin). Never an average: one
shared-loot window splits coin and drags a mean.

**Day one:** nothing; coin is not recorded (section 3).

## 6. Window context

Each context field splits a denominator, so each needs its own volume before it is shown.

| Context | Recorded by | Used for |
|---|---|---|
| Mob level | the creature's `UnitLevel` from the loot target or the last sighting of that GUID | rates by level for creatures that span levels |
| Mob rank | `UnitClassification` (the same five `NPC_RANKS`) | elite and rare loot apart from normal |
| Instance and difficulty | `GetInstanceInfo` at the window: instance map id and difficulty id, as `encounter` records already carry | dungeon and raid loot apart from the open world |
| Player level | `UnitLevel("player")`, reported as a band of 5 levels | level-gated drops (grey-level loot changes) |
| Quest-only | `GetLootSlotInfo`'s quest-item flag | see below |

**Quest-only items** only drop for players on the quest, and no window says who was on it. A rate over all
windows would be wrong, so a quest-only item never gets a rate: its row reads "seen in N windows from M
installs, quest item" with no frequency.

**Rule for every split:** a split row shows a rate only when its own windows come from 3 installs; otherwise it
reads like the unsplit row (section 9), "N windows from M installs". The unsplit row stays the headline.

## 7. Shared tables built from our own data

Wowhead lists "world drops" and zone-wide tables because the emulator databases share one loot table across
many creatures. We do not have those tables and will not copy them (section 11). We can find them in our own
windows:

- An item is a **shared drop** when public rates (3 installs each) from at least 10 distinct sources hold it,
  across at least 2 zones, and no one source's rate differs from the pooled rate by more than its own 95%
  interval allows. The pooled rate's denominator is the sum of those sources' windows.
- The group is labelled by what it is derived from ("shared by 14 creatures of level 20 to 25 in our windows"),
  never by a guessed table name, and each member keeps its own row.

This is an inference over many public rates. It needs many sources each past 3 installs; with the corpus of
section 2 it cannot run. It is a later slice.

## 8. Boss loot per encounter

The `encounter` record already carries the instance, difficulty, success and the bosses' creature ids
(`npcIds`). Boss loot is the kill-loot table of those creature ids, inside that instance, per difficulty:

- Denominator: loot windows on the boss's creature id in that instance and difficulty.
- Beside it, as its own count and never in the denominator: successful encounters reported (a kill nobody
  looted is no window).
- A boss chest (an object opened after the encounter) is a source of its own, joined to the encounter by the
  instance and the `npcIds` of the encounter that ended in the minutes before.
- Group loot: every group member with the addon sees the same corpse. Until the record carries a corpse key
  (section 3), one kill seen by five installs is five windows. The table says "windows, not kills" as all
  tables do; the corpse key is what lets it count a kill once.

The client's files (`DungeonEncounter`, `JournalEncounter`, read by `kb/src/client-snapshot.ts`) say which
encounters exist. Whether the Forever build fills them is `[?]`. Our uploads say what dropped.

## 9. The dense item-source and NPC loot tables (built now)

From our own uploads only: addon loot windows with `sourceEvidence: "loot-api"`, folded voters, the corpus
time. No game-file or baseline row is read for what drops.

**One reading of the windows**, `lootTablesFromRecords(records, asOf)` in `kb/src/loot-tables.ts`: per
source, its windows, its installs, the first and last capture day, and per item the windows holding it.
An item counts once per window however many stacks it shows, as `rollupDrops` counts it, and the public rows
equal `rollupDrops`' public rates. A window with no reporter (no install id) or no source is left out and
counted as left out. Recorder windows never enter it; the existing pending count still shows beside it.

**The NPC loot table** (NPC page, Drops tab), three states:

| Windows on the NPC | The tab shows |
|---|---|
| 0 | "Nobody has looted this NPC in Forever yet." (as today) |
| from 1 or 2 installs | "N loot windows from M installs, dated D1 to D2. A rate needs windows from 3 installs: K more." No item is listed: which items an NPC drops is a fact, and it is not one until 3 installs looted it. |
| from 3+ installs | One row per item: item, windows with the item, out of N windows, observed frequency, installs, and a line under the table: the method, the window dates, and the corpus time. With no item in any window, the measured zero "No items observed in N loot windows from M installs, dated D1 to D2." |

**The item-source table** (item page, Dropped by tab): one row per source that 3 installs looted and whose
windows held the item, with the same columns and the same line. Windows holding the item on sources still
short of 3 installs are not listed by source; they are one sentence: "N loot windows with this item from M
installs, on sources fewer than 3 installs have looted. A rate needs windows from 3 installs on the same
source."

**The pending line** stays as it is on both pages ("N more loot windows reported, not yet in the rates").

**Not in this slice:** the MCP `item_page` and `npc_page` tools (their schemas are frozen; their text is
unchanged), the object page, the bulk export and the drops list page, any split of section 4 to 8.

## 10. Honest on day one, and what needs volume

| Part | Day one | Needs |
|---|---|---|
| NPC loot table and item-source table, with denominators and dates | Honest: empty, and each page says "0 windows" or "N windows from M installs" | Nothing; fills as windows arrive |
| Rates on those tables | None exist (section 2) | Windows from 3 installs per source; a rate settles later under the Wilson rule of the coverage spec |
| Kill loot apart from pick-pocket and skinning | No: today's NPC windows are the first window opened per creature | `lootType` on the record and an addon release |
| Disenchanting, containers | Not recorded | `lootType`, `sourceItemId`, addon release |
| Money | Not recorded | Coin on the record, addon release |
| Context splits (level, rank, instance, difficulty, player level) | Not recorded | Context fields, then 3 installs per split row |
| Quest-only flag | Not recorded | The flag; never a rate |
| Shared tables | Cannot run | Public rates from at least 10 sources per item |
| Boss loot per encounter | Encounters are recorded; boss windows are kill windows without the instance on the record | Instance and difficulty on the loot record, and a corpse key to count a kill once |

## 11. The reference loot stays local

pfQuest's loot data is built from GPL emulator databases. It is local only (`publishable: false`,
[Classic baseline](2026-10-17-classic-baseline-design.md)). Nothing from it is published, quoted or committed
in a loot table, a test fixture, a spec or a PR body: not a row, not an item list, not a count. The tables in
this spec read only our uploads, and the client's own files for what exists. The coverage spec's use of the
baseline as a private "expected" list does not reach a loot page.

## 12. Slices

1. **This PR:** the spec; `kb/src/loot-tables.ts`; the NPC loot table and the item-source table with
   denominators, dates, method and the "what is missing" line.
2. Protocol and addon (their lanes): `lootType`, `sourceItemId`, coin, window context, corpse key; the GUID
   set keyed by GUID and loot type.
3. Typed tables: kill, pick-pocket, skinning, gathering, disenchanting, containers, each its own denominator.
4. Money per source.
5. Boss loot per encounter and difficulty.
6. Context splits, once typed windows reach 3 installs per split.
7. Shared tables.
8. MCP text (behaviour only), the object page and the bulk export read the same tables.

## Open questions

1. Should the item page's "sources short of 3 installs" sentence also give how many such sources there are?
   Proposed: no; the window and install counts say what is missing without hinting at an unconfirmed source.
2. Player level as a band of 5 is a privacy choice as much as a statistical one. Is 5 right?
3. Should windows recorded before `lootType` exists ever join the typed kill table, or stay apart for good?
