# Build watch output

What the build watch ([docs/BUILD_WATCH.md](../../../../../docs/BUILD_WATCH.md)) writes here and beside
this folder. The rules for every file in `web/src/data/game-data/` (Blizzard's data, not under our
licence, labelled unconfirmed, no tooltip text) are in [../README.md](../README.md) and
[docs/DATA_POLICY.md](../../../../../docs/DATA_POLICY.md).

Anything from a build players cannot play yet is marked `spoiler`. Encrypted blocks are skipped and
counted, never decrypted. Column names come from [WoWDBDefs](https://github.com/wowdev/WoWDBDefs)
(CC BY-SA 4.0).

## Layout

The build watch writes no folder of its own. A new build's pull request replaces the files the site reads
(see [../README.md](../README.md)): `talents/<class>.json`, `raid-<build>.json` (and removes the old one),
`map.json`, `addon/modules/raid_data.lua`, and the import in `raid.ts`. It also writes three files of its own:

```
web/src/data/game-data/
  spell-values.json                  numbers of the spells talents show: effects, duration, a hash of the tooltip
                                     (everloot.spell-values/1; one spell per line; no tooltip text)
  client-digests.json                rows and a content hash per client table the extractor reads
                                     (everloot.client-digests/1; one table per line; counts and hashes only)
  changes/<product>-<buildId>.json   one changelog entry per build
```

`spell-values.json` is the comparison baseline for spell number changes, since the trimmed talent files
leave those numbers out. `client-digests.json` is the same idea for the read set: the watch diffs the new
build's digests against it and the entry's `readSet` section reports added, removed and changed tables by
name, row count and hash difference (never rows or values).

## Changelog entries

Shape: `ChangeEntry` in `kb/src/build-watch/changes.ts` (zod; schema string `everloot.game-changes/2`,
bumped when the shape changes; entries from before `readSet` are `/1` and still parse). The site's `/changes` timeline reads the files in `changes/`: sort by
`detectedAt`, hide entries and items with `spoiler: true` unless the reader turned spoilers on.

```
ChangeEntry {
  schema, label, id ("<product>-<buildId>"), product
  live             false for a beta; then every item below is a spoiler
  spoiler          same as !live
  detectedAt       ISO time the build was read
  build, previous  { version, buildId, buildConfig }; previous is null for the first entry
  initial          first entry of a product: a baseline, no changes listed
  encryptedBlocks  { total, tables: [{ table, blocks }] }
  source           { definitions (WoWDBDefs commit), library, extractedAt }
  catalog          { classes, nodes } after this build
  talents          null when initial; otherwise lists of
                     classesAdded, classesRemoved (classId, className, spoiler), added, removed, moved, ranks, gates, prereqs,
                     replaced, spellValues, pointLevels
                   each item: classId, className, tree, nodeId, name, spoiler, spellIds (the spells the node
                   holds; absent before 2026-11-26), and the before/after
  raidBuffs        { comparedTo (version of the raid file compared with),
                     scopeChanges: [{ id, label, before, after, beforeRanks, afterRanks, spoiler }],
                     spellChanges: [{ id, label, spellId, name, change, spoiler }] }
  mapChanges       null when initial; [{ kind (continent|zone|entrance), id, name, change, spoiler }]
  readSet          null when initial or when no digests are committed; otherwise
                     tables { before, after }, rows { before, after },
                     addedTables [{ table, fileDataID, rows }], removedTables [{ table, fileDataID }],
                     changedTables [{ table, rowsBefore, rowsAfter, changed }],
                     layoutChanged (the WoWDBDefs commit differs, so a layout change may read as a table change)
                   counts, names and hash differences only; never rows or values
  warnings
}
```

## Entity pages

Spell and zone pages show their own lines from these entries in a "Changes across builds" section
(`kb/src/build-watch/entity-changes.ts`): spell values and talent nodes by spell id, raid buff spells, and
zone map changes by map id. A non-live entry and any item marked `spoiler` give no line. The tooltip
text hash is never shown, only that the text changed.

A hotfix that changes no build does not change the game files, so it never appears here. The blue
tracker covers hotfixes.
