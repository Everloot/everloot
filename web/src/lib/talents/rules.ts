import type { Ranks, TalentCatalog, TalentNode } from "./types";

// Point rules. Pure functions over a catalog and a Ranks map; nothing here knows about React.
//
// A node may take a point when:
//   - it is below its max rank,
//   - the build has a point left,
//   - the points spent in its tree on rows above reach its gate (and, for `pointsTotal`, the points
//     spent anywhere else do),
//   - every prerequisite is at full rank.
// A point may be taken back only if the build that results is still legal for every node that has
// points: gates still met, prerequisites still full. That one check covers "a later row depends on
// this point" and gates that count points from several rows.

export type Refusal = "unknown-node" | "max-rank" | "no-points" | "prereq" | "gate" | "empty" | "dependents";

export interface Verdict {
  ok: boolean;
  reason?: Refusal;
}

const OK: Verdict = { ok: true };
const no = (reason: Refusal): Verdict => ({ ok: false, reason });

export function rankOf(ranks: Ranks, id: number): number {
  return ranks[id]?.rank ?? 0;
}

export function nodeMap(catalog: TalentCatalog): Map<number, TalentNode> {
  return new Map(catalog.nodes.map((n) => [n.id, n]));
}

export function pointsSpent(ranks: Ranks): number {
  return Object.values(ranks).reduce((sum, r) => sum + r.rank, 0);
}

/** Points spent per tree id. Every tree is present, even at zero. */
export function pointsByTree(catalog: TalentCatalog, ranks: Ranks): Map<number, number> {
  const out = new Map(catalog.trees.map((t) => [t.id, 0]));
  for (const n of catalog.nodes) out.set(n.treeId, (out.get(n.treeId) ?? 0) + rankOf(ranks, n.id));
  return out;
}

/** Points a character has at a level: one per level from the first point level. */
export function pointsAtLevel(catalog: TalentCatalog, level: number): number {
  const { firstPointLevel, maxLevel, pointLevels } = catalog.rules;
  if (pointLevels) return pointLevels.filter((l) => l <= level).length;
  return Math.max(0, Math.min(level, maxLevel) - firstPointLevel + 1);
}

/** The lowest level that can hold this many points. */
export function levelFor(catalog: TalentCatalog, points: number): number {
  if (points <= 0) return 1;
  const { firstPointLevel, pointLevels } = catalog.rules;
  if (pointLevels) return pointLevels[Math.min(points, pointLevels.length) - 1];
  return firstPointLevel + points - 1;
}

/** The catalog as one set's points see it. The second set opens at the level the rules give for it, so every point the
 *  levels before that give arrives there instead; the first set is the catalog as it is. The order engine reads its
 *  levels from this, so a step, a moved point or a refusal says the level that set's point comes at. */
export function forSet(catalog: TalentCatalog, slot: 0 | 1): TalentCatalog {
  if (slot === 0) return catalog;
  const { rules } = catalog;
  const pointLevels = Array.from({ length: pointsAtLevel(catalog, rules.maxLevel) }, (_, i) => Math.max(levelFor(catalog, i + 1), rules.dualSpecLevel));
  return { ...catalog, rules: { ...rules, pointLevels } };
}

/** Which entry of a node a rank falls in: a tiered node buys its entries in order. */
export function entryAtRank(node: TalentNode, rank: number) {
  if (node.kind !== "tiered") return node.entries[0];
  let bought = 0;
  for (const entry of node.entries) {
    bought += entry.maxRanks ?? 1;
    if (rank < bought) return entry;
  }
  return node.entries[node.entries.length - 1];
}

function gateMet(catalog: TalentCatalog, node: TalentNode, ranks: Ranks): boolean {
  const unlock = node.unlock;
  if (!unlock) return true;
  if (unlock.ranksInNodes?.some((r) => rankOf(ranks, r.nodeId) < r.ranks)) return false;
  if (unlock.pointsInTree) {
    let above = 0;
    for (const other of catalog.nodes) {
      if (other.treeId === node.treeId && other.row < node.row) above += rankOf(ranks, other.id);
    }
    if (above < unlock.pointsInTree) return false;
  }
  if (unlock.pointsTotal) {
    if (pointsSpent(ranks) - rankOf(ranks, node.id) < unlock.pointsTotal) return false;
  }
  return true;
}

// "Bought" means at full rank. Every listed prerequisite is needed; if "any of" nodes are listed,
// at least one of those is needed as well. Full rank is our reading, not confirmed in the game.
function prereqsMet(nodes: Map<number, TalentNode>, node: TalentNode, ranks: Ranks): boolean {
  const full = (id: number) => {
    const need = nodes.get(id);
    return need !== undefined && rankOf(ranks, id) >= need.maxRanks;
  };
  const any = node.anyOf ?? [];
  return node.prereqs.every(full) && (any.length === 0 || any.some(full));
}

/** Is every node with points legal? Used to decide whether a point can be taken back. */
export function isLegal(catalog: TalentCatalog, ranks: Ranks): boolean {
  const nodes = nodeMap(catalog);
  return catalog.nodes.every(
    (n) => rankOf(ranks, n.id) === 0 || (gateMet(catalog, n, ranks) && prereqsMet(nodes, n, ranks)),
  );
}

export function canAdd(catalog: TalentCatalog, ranks: Ranks, id: number, available: number): Verdict {
  const nodes = nodeMap(catalog);
  const node = nodes.get(id);
  if (!node) return no("unknown-node");
  if (rankOf(ranks, id) >= node.maxRanks) return no("max-rank");
  // What the talent itself needs comes before the budget, so a locked talent says why it is locked.
  if (!prereqsMet(nodes, node, ranks)) return no("prereq");
  if (!gateMet(catalog, node, ranks)) return no("gate");
  if (pointsSpent(ranks) >= available) return no("no-points");
  return OK;
}

export function canRemove(catalog: TalentCatalog, ranks: Ranks, id: number): Verdict {
  const node = nodeMap(catalog).get(id);
  if (!node) return no("unknown-node");
  if (rankOf(ranks, id) === 0) return no("empty");
  return isLegal(catalog, withRank(ranks, id, rankOf(ranks, id) - 1, ranks[id]?.choice)) ? OK : no("dependents");
}

/** The ranks with one node set to `rank` and, for a choice node, `choice`; at 0 the node is left out. */
export function withRank(ranks: Ranks, id: number, rank: number, choice?: number): Ranks {
  const next = { ...ranks };
  if (rank <= 0) delete next[id];
  else next[id] = choice === undefined ? { rank } : { rank, choice };
  return next;
}

/** Take a point. For a choice node, `choice` picks the entry; picking the other entry of a node
 *  that already has its point swaps the choice and costs nothing. Returns the same object when
 *  nothing changes, so callers can tell a refused click from a real one. */
export function add(catalog: TalentCatalog, ranks: Ranks, id: number, available: number, choice = 0): Ranks {
  const node = nodeMap(catalog).get(id);
  if (!node) return ranks;
  if (node.kind === "choice") {
    if (choice < 0 || choice >= node.entries.length) return ranks;
    const current = ranks[id];
    if (current && current.rank > 0) {
      return current.choice === choice ? ranks : withRank(ranks, id, current.rank, choice);
    }
    if (!canAdd(catalog, ranks, id, available).ok) return ranks;
    return withRank(ranks, id, 1, choice);
  }
  if (!canAdd(catalog, ranks, id, available).ok) return ranks;
  return withRank(ranks, id, rankOf(ranks, id) + 1);
}

export function remove(catalog: TalentCatalog, ranks: Ranks, id: number): Ranks {
  if (!canRemove(catalog, ranks, id).ok) return ranks;
  return withRank(ranks, id, rankOf(ranks, id) - 1, ranks[id]?.choice);
}

/** Why a click was refused, in a sentence. */
export function refusalText(reason: Refusal, node: TalentNode, catalog: TalentCatalog, ranks: Ranks = {}): string {
  const tree = catalog.trees.find((t) => t.id === node.treeId)?.name ?? "this tree";
  switch (reason) {
    case "max-rank": return "Already at full rank.";
    case "no-points": return "No points left at this level.";
    case "prereq": return "Needs the talent above it at full rank.";
    case "gate":
      {
        const short = node.unlock?.ranksInNodes?.find((r) => rankOf(ranks, r.nodeId) < r.ranks);
        if (short) {
          const other = catalog.nodes.find((n) => n.id === short.nodeId);
          return `Needs ${short.ranks} ${short.ranks === 1 ? "rank" : "ranks"} in ${other?.entries[0].name ?? "another talent"}.`;
        }
      }
      return node.unlock?.pointsInTree
        ? `Needs ${node.unlock.pointsInTree} points spent in ${tree} on rows above.`
        : `Needs ${node.unlock?.pointsTotal ?? 0} points spent in the class's trees.`;
    case "empty": return "No points here.";
    case "dependents": return "A talent further down depends on this point.";
    default: return "Not available.";
  }
}

// ---- undo and redo ----------------------------------------------------------------------------

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const startHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [] });

/** Record a new state. The same object in gives the same history out, so a refused click leaves
 *  no undo step. */
export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present], present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
