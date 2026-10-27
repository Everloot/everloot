// The talent catalog the calculator reads: what the page needs from our own catalog
// (kb/src/talents/catalog.ts, schema everloot.talent-catalog/1), read from the game files.
// `adapter.ts` turns that file into this shape. Positions are 1-based here.

export type NodeKind = "single" | "tiered" | "choice";

export interface TalentEntry {
  /** Blizzard's trait definition id. Null until the client extract supplies it. */
  definitionId: number | null;
  /** Spell id of the talent's spell, only where the source gives one. Null otherwise. */
  spellId: number | null;
  name: string;
  /** Ranks this entry takes, for a tiered node. */
  maxRanks?: number;
}

export interface TalentNode {
  id: number;
  treeId: number;
  /** 1-based grid position, top row first. */
  row: number;
  col: number;
  maxRanks: number;
  kind: NodeKind;
  /** One entry for a single node. A tiered node buys its entries in order; a choice node picks one. */
  entries: TalentEntry[];
  /** Node ids that must all be at full rank before this node can take a point. */
  prereqs: number[];
  /** If any are listed, at least one of these must be at full rank too. */
  anyOf?: number[];
  /** What must already be spent or bought before this node can take a point. */
  unlock?: {
    /** Ranks bought in other nodes; every one must hold. */
    ranksInNodes?: { nodeId: number; ranks: number }[];
    /** In nodes of this tree on rows above this one. */
    pointsInTree?: number;
    /** In every other node of the build, in any tree. */
    pointsTotal?: number;
    /** What the game files say about where the gate counts: "tree", "class", or "unconfirmed" (read as the tree). */
    scope?: "tree" | "class" | "unconfirmed";
  };
}

export interface TalentTree {
  id: number;
  name: string;
}

export interface PointRules {
  /** The first level that earns a talent point. */
  firstPointLevel: number;
  maxLevel: number;
  /** The level each talent point arrives at, from the game tables. Absent: one point per level. */
  pointLevels?: number[];
  /** Where row gates count their points: the widest doubt among the nodes. */
  gateScope?: "tree" | "class" | "unconfirmed";
  /** Level at which the second talent set unlocks. From the beta notes, not the game files. */
  dualSpecLevel: number;
  /** "unconfirmed" until checked in the game. */
  status: "confirmed" | "unconfirmed";
  note: string;
}

export interface TalentCatalog {
  classId: number;
  classSlug: string;
  className: string;
  specId: number;
  /** The game build the layout was read from, for example 1.60.1.70450. */
  build: string;
  /** "found in game files, unconfirmed" */
  label: string;
  rules: PointRules;
  trees: TalentTree[];
  nodes: TalentNode[];
}

/** Ranks spent per node id. `choice` is the chosen entry index, for choice nodes. */
export type Ranks = Record<number, { rank: number; choice?: number }>;

/** One talent set of a plan: its ranks, and the order its points are spent in, one node id per point.
 *  An unknown order (an old link, an order that could not be read) is null, and so is its label.
 *  "planned": the player chose the order in the calculator; it is not a record of play. "provisional":
 *  the tool generated it when asked. order.ts keeps every known order legal. */
export interface PlanSet {
  ranks: Ranks;
  order: number[] | null;
  orderOrigin: "planned" | "provisional" | null;
}
