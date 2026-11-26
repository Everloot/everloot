/**
 * One entry per game build in the game-data changelog: what the new build changed compared with the
 * data already committed. The site's /changes timeline reads these files, so this file is the contract
 * and a change to the shape bumps `CHANGE_SCHEMA`. The files live in `web/src/data/game-data/changes/`, one per
 * build, named `<product>-<buildId>.json`. Documented in web/src/data/game-data/changes/README.md.
 *
 * The data is Blizzard's, read from files the launcher downloads, and labelled like all of it.
 */
import { z } from "zod";
import { LABEL, Unlock } from "../talents/catalog.js";
import { Scope } from "../raid-buffs.js";

const ScopeOrMixed = z.union([Scope, z.literal("mixed")]);

export const CHANGE_SCHEMA = "everloot.game-changes/2";
/** Entries written before the read-set section; they stay valid as committed. */
export const LEGACY_CHANGE_SCHEMA = "everloot.game-changes/1";

export const BuildRef = z.object({ version: z.string(), buildId: z.number().int(), buildConfig: z.string() });
export type BuildRef = z.infer<typeof BuildRef>;

/** Which talent a change is about. `spoiler` is true for anything from a build that players cannot play yet. */
const Where = z.object({
  classId: z.number().int(),
  className: z.string().nullable(),
  tree: z.string().nullable(),
  nodeId: z.number().int(),
  /** Talent name; a choice or tiered node joins its entries with " / ". */
  name: z.string(),
  spoiler: z.boolean(),
  /** The spells the node holds (before the change for a removed node), so a spell's page finds its talent's changes.
   *  Absent in entries written before 2026-11-26; an optional addition, so the schema string stays. */
  spellIds: z.array(z.number().int()).optional(),
});

const Position = z.object({ tree: z.string().nullable(), x: z.number().int(), y: z.number().int(), row: z.number().int(), col: z.number().int() });
const Prereqs = z.array(z.object({ nodeId: z.number().int(), rule: z.enum(["any", "all"]) }));

const ClassRef = z.object({ classId: z.number().int(), className: z.string().nullable(), spoiler: z.boolean() });

export const TalentChanges = z.object({
  classesAdded: z.array(ClassRef),
  classesRemoved: z.array(ClassRef),
  added: z.array(Where.extend({ kind: z.enum(["single", "tiered", "choice"]), maxRanks: z.number().int() })),
  removed: z.array(Where.extend({ maxRanks: z.number().int() })),
  moved: z.array(Where.extend({ from: Position, to: Position })),
  /** Maximum ranks changed. */
  ranks: z.array(Where.extend({ before: z.number().int(), after: z.number().int() })),
  /** The row gate or the node-rank gate changed. */
  gates: z.array(Where.extend({ before: Unlock, after: Unlock })),
  prereqs: z.array(Where.extend({ before: Prereqs, after: Prereqs })),
  /** The node now holds different spells (a talent was swapped for another). */
  replaced: z.array(Where.extend({ before: z.array(z.number().int()), after: z.array(z.number().int()) })),
  /** Numbers of a spell a talent shows. `text` compares a hash of the tooltip text, never the text. */
  spellValues: z.array(Where.extend({
    spellId: z.number().int(),
    spellName: z.string().nullable(),
    changes: z.array(z.object({ field: z.string(), before: z.union([z.number(), z.string(), z.null()]), after: z.union([z.number(), z.string(), z.null()]) })),
  })),
  /** Talent points: the level each one arrives at. */
  pointLevels: z.array(z.object({ classId: z.number().int(), className: z.string().nullable(), before: z.array(z.number().int()), after: z.array(z.number().int()), spoiler: z.boolean() })),
});
export type TalentChanges = z.infer<typeof TalentChanges>;

export const RaidBuffChanges = z.object({
  /** Version of the committed raid file this one was compared with; null when there was none. */
  comparedTo: z.string().nullable(),
  scopeChanges: z.array(z.object({ id: z.string(), label: z.string(), before: ScopeOrMixed.nullable(), after: ScopeOrMixed.nullable(), beforeRanks: z.string(), afterRanks: z.string(), spoiler: z.boolean() })),
  /** Changes below the entry's scope: a spell id added or removed, or the talent tree the effect needs. */
  spellChanges: z.array(z.object({ id: z.string(), label: z.string(), spellId: z.number().int().nullable(), name: z.string().nullable(), change: z.string(), spoiler: z.boolean() })),
});
export type RaidBuffChanges = z.infer<typeof RaidBuffChanges>;

/** A zone, continent or dungeon entrance on the world map that appeared, vanished or moved. */
export const MapChanges = z.array(z.object({
  kind: z.enum(["continent", "zone", "entrance"]), id: z.number().int(), name: z.string(), change: z.string(), spoiler: z.boolean(),
}));
export type MapChanges = z.infer<typeof MapChanges>;

/**
 * What changed in the client tables the extractor reads. Counts, booleans and table names only; the
 * per-table hash difference is in `changed`, and the values themselves are never in the entry.
 */
export const ReadSet = z.object({
  tables: z.object({ before: z.number().int(), after: z.number().int() }),
  rows: z.object({ before: z.number().int(), after: z.number().int() }),
  addedTables: z.array(z.object({ table: z.string(), fileDataID: z.number().int().nullable(), rows: z.number().int() })),
  removedTables: z.array(z.object({ table: z.string(), fileDataID: z.number().int().nullable() })),
  /** Tables whose content hash changed; `changed` is that hash difference, never a row diff. */
  changedTables: z.array(z.object({ table: z.string(), rowsBefore: z.number().int(), rowsAfter: z.number().int(), changed: z.boolean() })),
  /** The pinned WoWDBDefs commit differs, so a layout change may read as a table change. */
  layoutChanged: z.boolean(),
});
export type ReadSet = z.infer<typeof ReadSet>;

export const ChangeEntry = z.object({
  schema: z.union([z.literal(LEGACY_CHANGE_SCHEMA), z.literal(CHANGE_SCHEMA)]),
  label: z.literal(LABEL),
  /** `<product>-<buildId>`; also the file name. */
  id: z.string(),
  product: z.string(),
  /** False for a beta or any build players cannot play yet. Everything in a non-live entry is a spoiler. */
  live: z.boolean(),
  spoiler: z.boolean(),
  detectedAt: z.string(),
  build: BuildRef,
  /** The build of the data this entry was compared with; null for the first entry of a product. */
  previous: BuildRef.nullable(),
  /** The first entry of a product records a baseline and lists no changes. */
  initial: z.boolean(),
  /** Blocks of the tables we read that Blizzard encrypts. They are skipped, never decrypted. */
  encryptedBlocks: z.object({ total: z.number().int(), tables: z.array(z.object({ table: z.string(), blocks: z.number().int() })) }),
  /** Where the extraction came from, for the record. */
  source: z.object({ definitions: z.string().nullable(), library: z.string(), extractedAt: z.string() }),
  /** Size of the committed talent catalog after this build. */
  catalog: z.object({ classes: z.number().int(), nodes: z.number().int() }),
  talents: TalentChanges.nullable(),
  raidBuffs: RaidBuffChanges.nullable(),
  mapChanges: MapChanges.nullable(),
  /** The client read set; null for a baseline or when there is no committed digest file to compare with. */
  readSet: ReadSet.nullable().optional(),
  warnings: z.array(z.string()),
}).refine((e) => e.schema !== CHANGE_SCHEMA || e.readSet !== undefined, {
  message: "a /2 entry carries readSet (null when there is nothing to compare with)",
  path: ["readSet"],
});
export type ChangeEntry = z.infer<typeof ChangeEntry>;

export const changeFileName = (product: string, buildId: number) => `${product}-${buildId}.json`;

/** True when the entry lists at least one difference. */
export function hasChanges(entry: ChangeEntry): boolean {
  const t = entry.talents;
  const talentCount = t ? t.classesAdded.length + t.classesRemoved.length + t.added.length + t.removed.length + t.moved.length + t.ranks.length
    + t.gates.length + t.prereqs.length + t.replaced.length + t.spellValues.length + t.pointLevels.length : 0;
  const r = entry.readSet;
  const readSetCount = r ? r.addedTables.length + r.removedTables.length + r.changedTables.length : 0;
  return talentCount + (entry.raidBuffs ? entry.raidBuffs.scopeChanges.length + entry.raidBuffs.spellChanges.length : 0) + (entry.mapChanges?.length ?? 0) + readSetCount > 0;
}
