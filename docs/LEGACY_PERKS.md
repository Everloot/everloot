# Legacy perk catalog

WoW: Forever's Legacy system, the points a player spends on perks, sits in the game files as three trait trees.
`web/src/data/game-data/legacy-perks.json` is one build's catalog of them, read from the client tables Everloot
already extracts. It comes from the game files only: no other site, guide or forum post supplies a value, and nothing
from a third party ships in it (source decision, 2026-10-27, the maintainer). Like every game-file layer it is
Blizzard's data, labelled **found in game files, unconfirmed**, stamped with its build and kept outside our licence.
See [DATA_POLICY](DATA_POLICY.md) and the [source audit](sources/2026-10-27-class-legacy-dungeon-source-audit.md) it
follows.

"Legacy" here is the game system's name. The catalog has nothing to do with the [legacy-data policy](LEGACY_DATA_POLICY.md)
(uploads from before event ids) or with the code that reads old data formats and old sign-in sessions.

No page or planner reads the file yet. A planner may enforce only the rules the catalog marks `stored`. The cost, the
cap and where a spend gate counts its points are `inferred`: they may be shown, labelled as unconfirmed readings, and
nothing enforces them until each is confirmed in game or by Blizzard.

## Regenerate

From `kb/`, after a `client-extract` of the build (see [TALENT_CATALOG](TALENT_CATALOG.md)):

```
npx tsx src/legacy-perks/build-catalog.ts data/client/wowf-<build>-<config>.sqlite
```

It writes `../web/src/data/game-data/legacy-perks.json` (`--out` to change that). The file already there is the
previous catalog, which is how withdrawn ids carry over (below). The build watch does not regenerate this file: after
a new build, run the command and commit the result with the build in the message. Do not edit the file by hand;
`kb/test/legacy-perks.test.ts` fails if it is not exactly what the generator writes for it.

## What it reads

Nineteen tables, all already in `CLIENT_TABLES` (`kb/src/client-snapshot.ts`); this catalog added none:

| Tables | For |
|---|---|
| `TraitTree`, `TraitNode`, `TraitNodeXTraitNodeEntry`, `TraitNodeEntry`, `TraitDefinition`, `SpellName` | trees, nodes, entries, ranks and names |
| `TraitEdge` | prerequisites |
| `TraitNodeGroupXTraitNode`, `TraitCond`, `TraitNodeGroupXTraitCond`, `TraitNodeXTraitCond`, `TraitNodeEntryXTraitCond` | spend gates, and conditions it does not model |
| `TraitTreeXTraitCurrency`, `TraitCurrency` | the currency and its cap |
| `TraitTreeXTraitCost`, `TraitCost`, `TraitNodeXTraitCost`, `TraitNodeGroupXTraitCost`, `TraitNodeEntryXTraitCost` | the cost, and anything that overrides it |

Not read, so not in the file: spell descriptions, tooltip text and icons (they stay out of git, as for the talent
catalog), how points are earned (`TraitCurrencySource` and the achievement tables) and the per-rank effect values
(`TraitDefinitionEffectPoints` points at curves that are not read).

## Shape

The zod schemas are in `kb/src/legacy-perks/catalog.ts`; `schema` is `everloot.legacy-perks/1`, and a change to the
shape bumps it.

```
LegacyPerkCatalog {
  schema, label, credit, build { product, buildId, version, buildConfig, definitions, extractedAt }
  traitSystemId                     45
  currencies: { id, cap: Reading }[]
  trees: Tree[]                     by id
  emptyTreeIds: number[]            trees of the system with no nodes
  withdrawn: Withdrawn[]            ids an earlier catalog listed that the files no longer hold
  tables: { table, rows, hash }[]   every table read, with the row count and hash client-digests.json uses
  warnings: string[]
}
Reading { value | null, confidence: "stored" | "inferred" | "unknown", from }
Tree { id, currencyId | null, cost: Reading & { traitCostId | null, currencyId | null }, nodes: Node[], gates: Gate[] }
Node {
  id, x, y                          x, y as stored
  kind: "single" | "tiered" | "choice" | null
  flags                             TraitNode.Flags as stored
  ranks: Reading
  entries: { id, definitionId, spellId, name | null, maxRanks }[]    in buy order
  prereqs: { nodeId, rule: "any" | "all" | null, confidence }[]
}
Gate { condId, amount, currencyId, guardedGroupId, guards[], countedGroupId | null, counted[], confidence, from }
Withdrawn { kind: "tree" | "node" | "entry", id, treeId, nodeId?, name | null, lastSeen, withdrawnIn }
```

## Confidence

Every value is found in game files and unconfirmed. `confidence` says how much reading sits on top of that:

- **stored**: the files store it, and what it means is the column's own: an id, a rank count, a link between two nodes.
- **inferred**: the files store a number, and what it does in play is read from a column name or a WoWDBDefs comment.
- **unknown**: the tables do not settle it. The value is `null`, and no default takes its place.

A reading is `unknown` exactly when its value is `null`; the schema refuses anything else, so a guessed value cannot
slip in. `from` names the table and column a value came from, or what was missing. The schema also holds the rest of
the contract: ranks and prerequisites are `stored` or `unknown`; the cost, the cap and where a gate counts are
`inferred` or `unknown`, never `stored`, so confirming one in game is a change to the schema. An unknown cost names no
currency, a gate that counts somewhere unknown names no group and no nodes, and a prerequisite is `unknown` exactly
when its rule is `null`.

| Rule | Read from | Confidence |
|---|---|---|
| Trees, nodes, entries | `TraitTree.TraitSystemID` 45, the nodes of those trees, their entries | stored |
| Ranks | `TraitNodeEntry.MaxRanks`: a single node's entry; a tiered node, the sum; a choice node, the largest | stored |
| Prerequisites | `TraitEdge.Type` 2 (SufficientForAvailability) is `any`, 3 (RequiredForAvailability) is `all` | stored |
| Gate amount and guarded nodes | `TraitCond.SpentAmountRequired`, on the group `TraitNodeGroupXTraitCond` links it to | stored |
| Where a gate counts | the group `TraitCond.TraitNodeGroupID` names | inferred; unknown when it names none |
| Cost | `TraitTreeXTraitCost` to `TraitCost.Amount`, charged per rank by the column's name | inferred |
| Cap | `TraitCurrency.SourcedMax`, which WoWDBDefs describes as capping the summed point sources | inferred |

How the rest is read:

- **Trees.** The trees of trait system 45 that hold nodes, by id. Trees of the system with no nodes are listed in
  `emptyTreeIds`. No table we read names a Legacy tree, so a tree has no name.
- **Names.** The definition's `OverrideName_lang`, else the `SpellName` of `VisibleSpellID`, else of `SpellID`, as in
  the talent catalog. A name in an encrypted block is `null`.
- **Kind.** `TraitNode.Type` 0 single, 1 tiered, 2 choice. A type WoWDBDefs does not name leaves `kind` `null` and
  the ranks unknown, with a warning.
- **Edges.** Type 0 is drawn and asks nothing. Types 1 and 5 (deprecated in WoWDBDefs), type 4 (mutually exclusive, not
  modelled) and unnamed types are left out with a warning, as are edges that leave the Legacy trees.
- **Gates.** Only a condition of type 0 that asks for points spent and nothing else becomes a gate. Any other condition
  on a Legacy group, node or entry (a level, a quest, an achievement, condition flags) is a warning, so the nodes it
  guards are known to carry a rule the catalog does not show.
- **Cost.** A tree with no cost row, more than one, an amount of 0, a cost that names no currency or a cost that
  follows a curve has an unknown cost.
  So does a tree that `TraitNodeXTraitCost`, `TraitNodeGroupXTraitCost` or `TraitNodeEntryXTraitCost` overrides for any
  of its nodes, groups or entries: the tree cost is never applied in their place.
- **Cap.** A `SourcedMax` of 0, or no currency row, gives an unknown cap.

## What the files leave open

As of build 1.60.1.70634, which holds the same Legacy rows as the builds the source audit read:

- **Where a gate counts.** Each tree's two conditions name the tree's 7-node group. Read by the column name, points
  spent in the other two trees would not count. The source audit sets out the analogy with the class trees and the
  one check in the game that would settle it.
- **Cost and cap.** That a cost of 1 is charged per rank, and that 16 is the most points a character can hold, are
  readings of column names. The 16 also matches the points Blizzard said beta testers would be granted, and the point
  sources add up to 146; neither number becomes a spend default.
- **Six nodes named "Unknown".** Two per tree, in the third and fourth columns: 113508 and 113506 (tree 1187), 113511
  and 113510 (1188), 113513 and 113512 (1189). Their entries all use spell 1317256, which the files name "Unknown".
  They carry `TraitNode.Flags` 10 where the other 21 nodes carry 8, and no other node in the build carries 10. They
  sit in no node group, so no gate guards them, and an edge leads from each third-column one to the fourth. WoWDBDefs
  names only bit 1 of that column, so whether they can be bought is not known. The catalog keeps them with their flags
  and two warnings; each counts 1 rank in its tree's 25. A planner should not offer them until that is known.
- **How points are earned**, and whether the points belong to the account or the character: not in the tables this
  catalog reads.

## Withdrawal

A saved plan names perks by id, so an id never silently disappears:

- A tree, node or entry the previous catalog listed and this build lacks goes into `withdrawn` with its last name, the
  last build that held it (`lastSeen`) and the first that did not (`withdrawnIn`). A node's name is its first entry's.
- It stays there through later builds. If it comes back, it leaves the list and is a current node again.
- A tree still in the trait system, even with no nodes left, is not withdrawn; its nodes are.

The generator refuses, writing nothing and leaving the committed file as it is, when a table it reads is missing from
the snapshot or one of the six core tables is empty, when trait system 45 holds no tree with nodes, and when the
previous catalog comes from a newer build. Those mean an extraction problem or a change a maintainer must look at, not
perks that left the game, so none of them can withdraw an id. If Blizzard asks for the data to be taken down, a
maintainer deletes the file, as [DATA_POLICY](DATA_POLICY.md) says.

## Build 1.60.1.70634

Trees 1187, 1188 and 1189 (and 1118, with no nodes) spend currency 4225, cap 16. Each tree has 9 nodes, 25 ranks with
every node maxed, a cost of 1, a 5-point and a 10-point gate and 3 prerequisite edges, all `any`. The 27 nodes are 26
single and one tiered, Talented (node 110298, five one-rank entries), with 31 entries in all. Nothing is withdrawn.
The two warnings are the six "Unknown" nodes' flags and their shared spell.

## Checks

`kb/test/legacy-perks.test.ts`, on made-up tables and on the committed file:

- trees, nodes, entries, ranks, names and prerequisites as above, and a class tree never appears;
- cost, cap and gate counting are never `stored`, overrides and missing rows make them unknown, and the schema refuses a
  value on an unknown reading;
- conditions it does not model, unknown edge types, differing flags and shared spells are warnings;
- withdrawn ids are kept, carried forward and released when they come back, and the refusals above hold;
- the same rows give the same bytes in any order, and the committed file is exactly what the generator writes;
- the committed file holds no text, descriptions or icons, and its tables' row counts and hashes match
  `client-digests.json` whenever both come from the same build.
