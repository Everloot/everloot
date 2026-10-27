/**
 * The Legacy perk catalog: WoW: Forever's Legacy system, the points spent on perks, as its trait trees appear in
 * one build's game files. "Legacy" is the game system's name; this has nothing to do with the code elsewhere in the
 * repository that reads old data formats or old sign-in sessions.
 *
 * Everything here is found in game files, unconfirmed. Each rule a planner would need also says how it was read
 * (`Confidence`), and a rule the files do not settle has no value at all: no default and no guess. How each field
 * is derived is in docs/LEGACY_PERKS.md. A change to the shape bumps the schema.
 *
 * The data is Blizzard's, read from files the launcher downloads, and it never goes into the CC BY-SA release.
 */
import { z } from "zod";
import { BuildStamp, LABEL } from "../talents/catalog.js";

export const LEGACY_PERKS_SCHEMA = "everloot.legacy-perks/1";

/** The trait system the Legacy trees belong to (`TraitTree.TraitSystemID`), the same in builds 70450 to 70634. */
export const LEGACY_TRAIT_SYSTEM_ID = 45;

/**
 * How a value was read, on top of the label every value carries.
 * - "stored": the files store it, and what it means is the column's own (a rank count, a link between two nodes).
 * - "inferred": the files store a number, but what it does in play is read from a column name or a WoWDBDefs
 *   comment. It may be shown; nothing enforces it until it is confirmed in game or by Blizzard.
 * - "unknown": the tables we read do not settle it. There is no value, and none may be assumed.
 */
export const Confidence = z.enum(["stored", "inferred", "unknown"]);
export type Confidence = z.infer<typeof Confidence>;
/** Ranks and prerequisites are read as the files store them, or not at all. */
const StoredOrUnknown = Confidence.exclude(["inferred"]);
/** The cost, the cap and where a gate counts are column-name readings until confirmed: never stored. */
const InferredOrUnknown = Confidence.exclude(["stored"]);

/** A reading is unknown exactly when it has no value. */
const settled = (r: { value: unknown; confidence: Confidence }) => (r.confidence === "unknown") === (r.value === null);
const SETTLED = { message: "a reading has a value unless it is unknown, and an unknown one has none" };

export const Cap = z.object({
  /** TraitCurrency.SourcedMax, which WoWDBDefs describes as capping the summed TraitCurrencySource amounts. */
  value: z.number().int().positive().nullable(),
  confidence: InferredOrUnknown,
  /** The table and column it was read from, or what was missing. */
  from: z.string(),
}).refine(settled, SETTLED);

export const Currency = z.object({
  /** TraitCurrency.ID: the currency the Legacy trees spend (TraitTreeXTraitCurrency). */
  id: z.number().int(),
  cap: Cap,
});

export const Cost = z.object({
  /** Points per rank: the tree's TraitCost.Amount. That it is charged per rank is read from the column name. */
  value: z.number().int().positive().nullable(),
  confidence: InferredOrUnknown,
  from: z.string(),
  /** TraitTreeXTraitCost.TraitCostID; null when the tree has no single cost row. */
  traitCostId: z.number().int().nullable(),
  /** TraitCost.TraitCurrencyID; null exactly when the cost is unknown. */
  currencyId: z.number().int().nullable(),
}).refine(settled, SETTLED)
  .refine((c) => (c.value === null) === (c.currencyId === null), { message: "a known cost names its currency, and an unknown one names none" });

export const Ranks = z.object({
  /** Most ranks the node can hold: single, its entry's MaxRanks; tiered, the sum of its entries'; choice, the largest. */
  value: z.number().int().positive().nullable(),
  confidence: StoredOrUnknown,
  from: z.string(),
}).refine(settled, SETTLED);

export const Entry = z.object({
  /** TraitNodeEntry.ID. */
  id: z.number().int(),
  definitionId: z.number().int(),
  spellId: z.number().int(),
  /**
   * The definition's override name, else the shown spell's name; null when there is no name row (it may sit in an
   * encrypted block we skip) or when the definition has no VisibleSpellID column to say which spell is shown.
   */
  name: z.string().nullable(),
  /** TraitNodeEntry.MaxRanks; null when the row has no such column, never 0 in its place. */
  maxRanks: z.number().int().nullable(),
});
export type Entry = z.infer<typeof Entry>;

export const Prereq = z.object({
  nodeId: z.number().int(),
  /**
   * "any": buying that node is enough (TraitEdge type 2). "all": it must be bought, as must every other "all" node
   * (type 3). null: the edge is there but its rule is not resolved, so its confidence is "unknown".
   */
  rule: z.enum(["any", "all"]).nullable(),
  confidence: StoredOrUnknown,
}).refine((p) => (p.confidence === "unknown") === (p.rule === null), { message: "a prerequisite has a rule unless it is unresolved, and an unresolved one has none" });

export const Node = z.object({
  /** TraitNode.ID, stable across builds; a saved plan names nodes by it. */
  id: z.number().int(),
  /** Position as the client stores it; null when the row has no such column. */
  x: z.number().int().nullable(),
  y: z.number().int().nullable(),
  /** TraitNode.Type 0 single, 1 tiered (entries bought in order), 2 choice; null when it is absent or a type WoWDBDefs does not name. */
  kind: z.enum(["single", "tiered", "choice"]).nullable(),
  /** TraitNode.Flags as stored, null when absent. WoWDBDefs names only bit 1 (ShowMultipleIcons); the other bits are not interpreted. */
  flags: z.number().int().nullable(),
  ranks: Ranks,
  /** In buy order (TraitNodeXTraitNodeEntry.Index). */
  entries: z.array(Entry),
  prereqs: z.array(Prereq),
});
export type Node = z.infer<typeof Node>;

export const Gate = z.object({
  /** TraitCond.ID: a condition of type 0 (Available) asking for points spent. */
  condId: z.number().int(),
  /** TraitCond.SpentAmountRequired of TraitCond.TraitCurrencyID. */
  amount: z.number().int().positive(),
  currencyId: z.number().int(),
  /** The node group the condition is attached to (TraitNodeGroupXTraitCond) and its nodes: what the gate guards. */
  guardedGroupId: z.number().int(),
  guards: z.array(z.number().int()),
  /**
   * Where the points are counted: the group TraitCond.TraitNodeGroupID names, and its nodes. That the column means
   * this is read from its name ("inferred"); with no group named, it is "unknown" and no group or node is filled in.
   */
  countedGroupId: z.number().int().nullable(),
  counted: z.array(z.number().int()),
  confidence: InferredOrUnknown,
  from: z.string(),
}).refine((g) => (g.confidence === "unknown") === (g.countedGroupId === null), { message: "a gate counts in a named group unless where it counts is unknown" })
  .refine((g) => g.countedGroupId !== null || !g.counted.length, { message: "a gate that counts somewhere unknown names no counted nodes" });
export type Gate = z.infer<typeof Gate>;

export const Tree = z.object({
  /** TraitTree.ID. No table we read names a Legacy tree. */
  id: z.number().int(),
  /** TraitTreeXTraitCurrency.TraitCurrencyID; null when the tree lists none, or more than one. */
  currencyId: z.number().int().nullable(),
  cost: Cost,
  /** By id. */
  nodes: z.array(Node),
  /** By condition id. */
  gates: z.array(Gate),
});
export type Tree = z.infer<typeof Tree>;

/** A tree, node or entry an earlier catalog listed and the files no longer hold. Its id stays, so a saved plan that names it can say what happened. */
export const Withdrawn = z.object({
  kind: z.enum(["tree", "node", "entry"]),
  id: z.number().int(),
  /** The tree it belonged to when it was last seen, and for an entry, its node. */
  treeId: z.number().int(),
  nodeId: z.number().int().optional(),
  /** Its last name: an entry's, or a node's first entry's; null for a tree, or when it had none. */
  name: z.string().nullable(),
  /** The version of the last build whose files held it, and of the first that did not. */
  lastSeen: z.string(),
  withdrawnIn: z.string(),
});
export type Withdrawn = z.infer<typeof Withdrawn>;

export const LegacyPerkCatalog = z.object({
  schema: z.literal(LEGACY_PERKS_SCHEMA),
  label: z.literal(LABEL),
  credit: z.string(),
  build: BuildStamp,
  traitSystemId: z.number().int(),
  /** The currencies the trees spend, by id. */
  currencies: z.array(Currency),
  /** The trees of the Legacy trait system that hold nodes, by id. */
  trees: z.array(Tree),
  /** Trees of the Legacy trait system with no nodes. */
  emptyTreeIds: z.array(z.number().int()),
  /** Trees, then nodes, then entries, each by id. */
  withdrawn: z.array(Withdrawn),
  /**
   * Every table read, by name, with its row count and content hash by the rule of client-digests.json, and the
   * encrypted blocks the extraction skipped in it. Only SpellName may have any: elsewhere they refuse the build.
   */
  tables: z.array(z.object({ table: z.string(), rows: z.number().int(), hash: z.string(), encryptedBlocks: z.number().int() })),
  /** What the extraction could not resolve, or noticed and did not interpret. */
  warnings: z.array(z.string()),
});
export type LegacyPerkCatalog = z.infer<typeof LegacyPerkCatalog>;
