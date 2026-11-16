# Empty loot windows: drop rates that count every lootable kill

Status: steps 1, 2 and 4 built on 2026-11-13; step 3 is a release step. Raised by an outside data user (Bragon) on a
call with Carlos.

## The problem

A drop rate is `windowsWithItem / lootWindows` for a source. The addon writes a loot row only for a source that put
something in the window: `lootCapture` (`addon/modules/openworld.lua`) builds its sources from the filled loot slots
through `GetLootSourceInfo`, and skips a source with no items and no coin. A corpse that opens an empty window has no
slot, so it has no source and no row. It never enters the denominator, and every item that does not always drop reads
too high. Bragon measured one mob at about 15-20% in play where the site showed 3 of 4 windows. Skinning, herbs, ore
and fishing are not affected: they always yield something.

The public feed agrees: on 2026-11-13, 0 of 10,844 public loot rows have neither items nor coin. "Empty" in the feed
today means coin only.

The server side is already ready for empty windows. The protocol accepts a loot row with `items: []` and no `copper`
(the array has no minimum, a source id is the only requirement), and the rollup counts such a row in the source's
windows (`kb/test/drop-rollup.test.ts`: "an empty window still counts in the kills of an item that did drop") and as a
measured zero when nothing ever dropped (`web/src/app/database/gap-rendering.test.tsx`). Only the addon drops them.

## What the client gives us (build 1.60.1.70938, read from the CDN)

- `LOOT_OPENED` passes `autoLoot` and `isFromItem` only (`LootDocumentation.lua`). No source.
- Blizzard's own loot window opens empty windows on purpose: `LootFrame.lua` plays `LOOT_WINDOW_OPEN_EMPTY` when the
  list is empty. So an empty window does open on Forever.
- `GetLootSourceInfo` is per slot. With zero slots there is nothing to ask.
- `COMBAT_LOG_EVENT_UNFILTERED` is restricted on Forever (see `addon/modules/pulls.lua`), so a kill cannot be counted
  from the combat log.
- `UnitIsDead` and `UnitIsTapDenied` are documented (`UnitDocumentation.lua`). `CanLootUnit(guid)` (hasLoot, canLoot)
  is a mainline global; globals are mostly undocumented, so it needs an in-game check.

## Proposal

### 1. Record the empty window (addon)

On `LOOT_OPENED` with `GetNumLootItems() == 0`, `isFromItem` false and `IsFishingLoot()` false, take the corpse the
player opened: the GUID of `softinteract`, `mouseover` or `target`, accepted only when exactly one of them is a dead
creature (`UnitIsDead`, GUID type `Creature`), it is not tap-denied, and that GUID has no kill window yet in
`EverlootDB.lootSources`. Write a loot row with `items: []`, `lootType: "kill"` and a new
`sourceEvidence: "empty-window"`. Anything ambiguous writes nothing.

Why a new evidence value: the source comes from the unit the player interacted with, not from the loot API, and the
protocol's comment says target guesses are withheld. A separate value keeps those rows apart and lets the rollup count
them as denominators only.

### 2. Accept it (protocol, intake, rollup)

- `packages/protocol`: `sourceEvidence` becomes `"loot-api" | "empty-window"`; a refinement refuses an `empty-window`
  row that has items or coin. Minor version bump.
- `kb/src/drop-rollup.ts`: `isCountedLootEvidence` is the one rule; `lootWindowsFromRecords` and `lootSource` take
  `empty-window` rows as windows with nothing in them, so rates, settling, coverage and the open data follow. The loot
  tables (`loot-tables.ts`) count windows themselves and use the same rule. `edges.ts`, `object-spawns.ts` and the
  open data's item edges keep reading `loot-api` only (an empty row adds no edge, item or pin).
- Tests: an empty-window row lowers the rate of an item from the same source; one with items is refused; a target
  guess with items is still withheld.

### 3. Restart the rates (data)

Rates built without empty windows stay too high until new windows outweigh them. When the addon that writes empty
windows is tagged, add one scope to `kb/curated/recheck.json`:

```json
{ "since": "<the release time, ISO>", "source": "addon-v<version> empty loot windows", "type": "drops",
  "note": "Windows before this left out empty corpses; rates restart from the release." }
```

`recheckLootRecords` then rebuilds every rate from windows captured after that time, and nothing is deleted. Until
enough new windows exist, sources show fewer public rates. That is honest. Adding the scope before the release would
empty the rates with nothing to replace them, so it waits for the tag.

### 4. Say what the number is (site)

The open-data docs already call the rate "a share of loot windows, not a kill-based drop chance". Pages and the API
should say the same next to the rate, with the window count, until the empty-window addon has been out for a while.

## What this still misses

- Corpses the player never opens. If Forever does not show an empty corpse as lootable, players skip it and the
  window never opens. Then only kill counting fixes the rate: watch nameplate and target units die while not
  tap-denied, and ask `CanLootUnit` whether a corpse has loot. That is a larger change and waits on step 1's probe.
- Area loot. If several corpses are looted in one window, an empty corpse among them has no slot either.
- Group loot. Only the looter's window is seen.

## In-game checks before code (Carlos)

1. Kill a mob that often drops nothing. Does its corpse sparkle, and does right-click open an empty window?
2. In that window: `/dump UnitGUID("target"), UnitGUID("mouseover"), UnitGUID("softinteract")`.
3. `/dump CanLootUnit(UnitGUID("target"))` on a looted corpse, an untouched corpse with loot and an empty one.
4. Kill two mobs together and loot one. Does one window hold both corpses' loot (area loot)?

The answers decide between step 1 as written and kill counting.
