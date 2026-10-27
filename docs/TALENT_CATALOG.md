# Talent catalog and raid buff table

Two files read out of a client snapshot (`npm run kb -- client-extract`), one set per game build.
Both are game file data: Blizzard's, labelled **found in game files, unconfirmed**, stamped with the
build, kept apart from the CC BY-SA data, and **not published**. The extractor reads only what
Blizzard's CDN serves every player. Encrypted blocks are skipped and counted, never decrypted. See
[DATA_POLICY](DATA_POLICY.md).

```
npm run kb -- client-extract --product wow_classic_beta
npm run kb -- client-catalog data/client/wow_classic_beta-<build>-<config>.sqlite
npm run kb -- raid-buffs-diff <old>/raid-buffs.json <new>/raid-buffs.json
```

Output goes to `data/catalog/<product>-<build>-<config>/`: `talents/<class>.json`,
`talents/index.json` and `raid-buffs.json`. The site reads a trimmed copy (`web/src/data/game-data/talents/`, see that folder's README); the build watch ([BUILD_WATCH](BUILD_WATCH.md)) regenerates it for each new build. Column names come from
[WoWDBDefs](https://github.com/wowdev/WoWDBDefs) (CC BY-SA 4.0), which also supplies the file data ids
of the tables. `client-extract --refresh` re-reads a build already marked processed, which is how an
older snapshot gets the newer tables.

## Talent catalog

The shape is in `kb/src/talents/catalog.ts` (zod schemas; `ClassCatalog` is one class file). The
`schema` field is `everloot.talent-catalog/2`; a change to the shape bumps it. Changes from /1:
`unlock.pointsInTree` became `unlock.spentRequired` (an object), `unlock.ranksInNode` became the array
`unlock.ranksInNodes`, and `pointCurrencyId` and `Node.positionRepaired` were added.

```
ClassCatalog {
  schema, label, build { product, buildId, version, buildConfig, definitions, extractedAt }
  classId, className, specId, traitTreeId
  pointLevels: number[]            level each talent point arrives at
  pointCurrencyId | null           the trait currency those points are counted in
  trees: Tree[]                    the class's talent trees, in client order
  warnings: string[]
}
Tree { id, name, skillLineId, order, nodes: Node[], edges: Edge[] }
Node {
  id, x, y, row, col               x, y as stored; row, col are the grid cell inside the tree, from 0
  positionRepaired?: true          the stored position was ten times too large; row, col use the corrected value
  kind: "single" | "tiered" | "choice"
  maxRanks
  entries: Entry[]
  prereqs: { nodeId, rule: "any" | "all" }[]
  unlock: { spentRequired?: SpentRequired, ranksInNodes?: { nodeId, ranks }[] }
}
SpentRequired { amount, scope: "tree" | "class" | "unconfirmed", gateGroupId, currencyId, traitTreeId, companionGroupId? }
Entry {
  definitionId, spellId, name | null, maxRanks
  iconFileId | null, iconFile: "present" | "encrypted" | "absent" | "unchecked"
  description | null, auraDescription | null      raw client text, $ tokens kept
  effects: { index, basePoints, dieSides, periodMs, chainTargets, miscValue, radiusYards | null }[]
  durationMs | null
}
Edge { from, to, type: "visual" | "sufficient" | "required" | "exclusive" }
```

How the fields are derived, and what is not confirmed:

- **Class.** `SkillLineXTraitTree` links a skill line to the class's trait tree. The skill line's
  `SkillRaceClassInfo.ClassMask` names the class, if exactly one bit is set. Otherwise the tree is
  skipped and a warning says so. `specId` is the class's `ChrSpecialization` row. Forever has no
  specializations, so there is one per class.
- **Trees.** `TraitNodeGroupDisplayInfo` lists three node groups per class tree, with a skill line
  (the tree name) and an order. A node belongs to the tree whose group lists it.
- **Row gates.** Each tree also has smaller node groups, one per row, and each carries a `TraitCond`
  of type "available" with `SpentAmountRequired` (5, 10, 15, 20, 25, 30 in build 70450). A node in
  such a group gets `unlock.spentRequired`: the amount, the gate group, the condition's currency and the
  trait tree it names. When a node is in several gated groups, the largest amount is kept. Row 0 has no
  gate. **Where the points are counted** is `scope`. The condition names the whole class tree and one
  currency shared by all three talent trees, which on its own suggests class-wide spending, so the
  default is `"unconfirmed"`. The build also lists groups that hold exactly the nodes above each gated
  row (companion groups). Where one matches the nodes above the row inside this talent tree, `scope` is
  `"tree"` and `companionGroupId` names it. Where one matches the nodes above the row across all three
  talent trees, it is `"class"`. The condition row itself also names a node group, `TraitCond.TraitNodeGroupID`:
  in build 70532 every spend condition of the class trees sets it, and in 130 of the 131 gates where this match
  finds a companion it names that companion (one gate names another group; the 31 gates with no companion name
  one too). The catalog does not use that field yet. It points the same way as the match, but its meaning is
  read from the column name, so even `"tree"` remains an inference. The addon `talents` selftest is what would
  confirm it in game.
- **Rank gates on nodes.** Conditions tied to a node that name another node become `unlock.ranksInNodes`,
  one entry per condition. One node has any in build 70450 (a Rogue node). The meaning of that field is
  inferred from the column names.
- **Kind.** `TraitNode.Type`: 0 single, 1 tiered (entries bought in order), 2 choice. No choice node
  exists in build 70450. `maxRanks` is the entry's for single, the sum for tiered, the largest for
  choice.
- **Edges.** `TraitEdge.Type`: 0 visual only, 2 "sufficient for availability" (`prereqs` rule `any`),
  3 "required for availability" (`all`), 4 mutually exclusive. Types 1 and 5 are deprecated in
  WoWDBDefs and are left out. Edges that lead to a node outside the tree are left out too. The index
  warnings count each of the two groups separately.
- **Names.** The spell name comes from `SpellName` through `TraitDefinition.SpellID`. A name in an
  encrypted block is `null`.
- **Points.** `pointLevels` comes from `TraitCurrencySource` rows for the tree's currency that carry a
  player level, no node entry and an amount above 0. The currency is the class tree's first one by
  `TraitTreeXTraitCurrency.Index` (`pointCurrencyId`). Legacy points (a second currency, capped at 16,
  earned through achievements) are not class talent points and are not in the catalog. Their trees are
  listed in `otherTraitTrees` in the index.
- **Icons and text.** For the spell the client shows (`TraitDefinition.VisibleSpellID`, else `SpellID`):
  `iconFileId` is `SpellMisc.SpellIconFileDataID`. The image is never exported. `iconFile` says whether
  that id is in the build's root listing and not flagged encrypted (a lookup only, no download); the
  extractor stores the answers in a `FileStatus` table of the snapshot. `description` and
  `auraDescription` are `Spell.Description_lang` and `AuraDescription_lang` as stored. The tokens
  point at the other fields, assuming the usual convention (not checked in game): `$s1` is
  `effects[0].basePoints` (`$s2` the second), `$d` is `durationMs`, `$a1` is `radiusYards`, `$t1` is
  `periodMs`, `$x1` is `chainTargets`. Rendering the tokens is a later step; this file only keeps the
  inputs. Like everything here it is Blizzard's text and stays local until the publish step.
- **Row and column.** The talent frame places nodes on a grid of 600 units. Each tree has its own
  origin (the most common remainder of the stored values modulo 600, per axis), and `row` and `col` are
  the stored position snapped to the nearest grid step, counted from the tree's first used row and
  column. A column with no node in it still leaves a gap.
- **Off-grid nodes.** A node is off the grid when a stored value is more than 100 units from a grid line
  or more than 12 steps from the middle of the tree. If dividing that value by ten puts it on the grid
  (one node in build 70450 has this decimal shift), `row` and `col` use the divided value,
  `positionRepaired` is true and `x`, `y` keep the stored numbers. If the same spell sits on an on-grid
  node of the same tree, the off-grid node is a leftover and is left out (two nodes in build 70450, each
  with a newer node carrying the same spell). Two on-grid nodes with the same spell are both kept.
  Anything left out, repaired or unfixable is a warning in the class file and in `talents/index.json`,
  as is a class tree node that is in none of the three talent trees.
- **Missing tables.** A required table that is absent or empty gives a warning in the index, and an
  index with no class gives one more, so an empty catalog is never silent.

Nodes are sorted by id, which is the order the client writes them in a loadout string.

## Raid buff table

`raid-buffs.json` (`RaidBuffTable` in `kb/src/raid-buffs.ts`, schema `everloot.raid-buffs/2`). The list
is `kb/lists/raid-buffs.yaml`: spell ids, picked by hand, and labels. It holds no scope, so the scope of
each spell always comes from the build being read, and a same-named helper spell is not pulled in. For
each listed id the tool records effect, aura, both implicit target ids and the largest radius of its
aura-applying `SpellEffect` rows (difficulty 0). An id with none is in `missingSpells`; an entry with
none at all is in `notFound`. The header of the yaml file says how the ids were chosen and which were
left out.

`scope` per spell: `raid`, `party`, `enemy`, `single`, `self`, `area` or `unknown`. The target ids are
read first. 20 is party, 56 raid, 21 and 25 one target, 1 the caster, 6, 15 and 16 an enemy, 30 and 31
everyone near; 0, 18 and 22 name no one. Any other id gives `unknown`, with the raw ids kept. An area
aura effect type (35 party, 65 raid) must agree with the targets; if it does not, the spell is
`unknown`. Target ids 20 and 56 were checked against a real change: Classic Era's Battle Shout uses 20
and its tooltip says "party members", and Forever build 70450 uses 56 and says "party or raid members".
In the order of reach, `unknown` ranks above `single` and `self`, so a target we cannot read is never
hidden behind one we can.

An entry is not collapsed. `byRank` lists the scope of each rank (rank `null`: no "Rank N" subtext), and
`scope` is the shared scope, or `"mixed"` when the spells disagree. `raid-buffs-diff` compares two tables
and lists entries whose scope, or the scope of any rank, changed. A table for each build is how a change
like the 2026-10-16 party-to-raid one shows up.

## Table definitions

The extractor resolves WoWDBDefs `master` to one commit at the start of a run and fetches every layout
from that commit, so the `definitions` value in the snapshot is the commit actually used. If GitHub
cannot be reached it is empty and the library reads `master`.
