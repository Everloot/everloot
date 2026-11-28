import type { Gate, LegacyPerkCatalog, Node, Tree } from "@kb/legacy-perks/catalog";

export type Purchase = readonly [nodeId: number, entryId: number];

const FORMAT = "1";
const MAX_PURCHASES = 1024;
// Each safe integer takes at most eleven base-36 digits, plus the entry and rank separators.
const MAX_CODE_LENGTH = 14 + 24 * MAX_PURCHASES;

export function encodePlan(buildId: number, purchases: readonly Purchase[]): string {
  return [FORMAT, buildId.toString(36), ...purchases.map(([nodeId, entryId]) => `${nodeId.toString(36)}-${entryId.toString(36)}`)].join(".");
}

function parseId(value: string | undefined): number | null {
  if (!value) return null;
  const id = Number.parseInt(value, 36);
  return Number.isSafeInteger(id) && id > 0 && id.toString(36) === value ? id : null;
}

export function decodePlan(code: string): { buildId: number; purchases: Purchase[] } | null {
  if (code.length > MAX_CODE_LENGTH) return null;
  const [format, build, ...ranks] = code.split(".");
  const buildId = parseId(build);
  if (format !== FORMAT || buildId === null || ranks.length > MAX_PURCHASES) return null;
  const purchases: Purchase[] = [];
  for (const rank of ranks) {
    const [node, entry, extra] = rank.split("-");
    const nodeId = parseId(node);
    const entryId = parseId(entry);
    if (nodeId === null || entryId === null || extra !== undefined) return null;
    purchases.push([nodeId, entryId]);
  }
  return { buildId, purchases };
}

export const perkName = (node: Node) => node.entries[0]?.name ?? `Perk ${node.id}`;

/** The catalog has no tree names, so the planner and reference use the same top perk as a label. */
export function treeName(tree: Tree): string | null {
  const named = tree.nodes.filter((node) => node.y !== null && node.entries[0]?.name && node.entries[0].name !== "Unknown");
  named.sort((a, b) => a.y! - b.y! || (a.x ?? Infinity) - (b.x ?? Infinity) || a.id - b.id);
  return named[0]?.entries[0]?.name ?? null;
}

export const orderedPerks = (nodes: Node[]) => [...nodes].sort((a, b) =>
  (a.x ?? Infinity) - (b.x ?? Infinity) || (a.y ?? Infinity) - (b.y ?? Infinity) || a.id - b.id);

export function isPlannable(node: Node): boolean {
  // The catalog retains the "Unknown" placeholder nodes as reference rows. Their availability is unresolved.
  return node.kind !== null && node.ranks.value !== null && node.entries.some((entry) => entry.name !== "Unknown");
}

type NextRank = { purchase: Purchase } | { reason: string };

export function createPlanner(catalog: LegacyPerkCatalog) {
  const byId = new Map(catalog.trees.flatMap((tree) => tree.nodes.map((node) => [node.id, { node, tree }] as const)));
  const withdrawnNodes = new Map(catalog.withdrawn.filter((item) => item.kind === "node").map((item) => [item.id, item]));
  const withdrawnEntries = new Map(catalog.withdrawn.filter((item) => item.kind === "entry").map((item) => [item.id, item]));
  const nameOf = (id: number) => {
    const node = byId.get(id)?.node;
    return node ? perkName(node) : withdrawnNodes.get(id)?.name ?? `node ${id}`;
  };

  function next(purchases: readonly Purchase[], node: Node, choice?: number): NextRank {
    if (!isPlannable(node)) return { reason: "Rank availability is unresolved." };
    const bought = purchases.filter(([nodeId]) => nodeId === node.id);
    const entryId = bought[0]?.[1] ?? choice ?? node.entries[0]?.id;
    const entry = node.kind === "tiered" ? node.entries.find((item) =>
      bought.filter(([, id]) => id === item.id).length < (item.maxRanks ?? 0)) : node.entries.find((item) => item.id === entryId);
    const limit = node.kind === "choice" ? entry?.maxRanks : node.ranks.value;
    if (!entry || limit == null || bought.length >= limit) return { reason: "Maximum ranks reached." };
    if (purchases.length >= MAX_PURCHASES) return { reason: "This plan is full." };

    const hasRank = (id: number) => purchases.some(([nodeId]) => nodeId === id);
    const missing = node.prereqs.filter((p) => p.rule === "all" && !hasRank(p.nodeId)).map((p) => nameOf(p.nodeId));
    const alternatives = node.prereqs.filter((p) => p.rule === "any");
    if (alternatives.length > 0 && !alternatives.some((p) => hasRank(p.nodeId))) {
      missing.push(alternatives.map((p) => nameOf(p.nodeId)).join(" or "));
    }
    if (missing.length > 0) return { reason: `Requires ${missing.join(" and ")}.` };
    return { purchase: [node.id, entry.id] };
  }

  function replay(ranks: readonly Purchase[]) {
    const purchases: Purchase[] = [];
    const skipped: string[] = [];
    for (const purchase of ranks) {
      const [nodeId, entryId] = purchase;
      const node = byId.get(nodeId)?.node;
      const withdrawn = !node ? withdrawnNodes.get(nodeId) : withdrawnEntries.get(entryId);
      if (withdrawn) {
        skipped.push(`${withdrawn.name ?? nameOf(nodeId)} (${withdrawn.kind} ${withdrawn.id}) was withdrawn in ${withdrawn.withdrawnIn}.`);
        continue;
      }
      if (!node || !node.entries.some((entry) => entry.id === entryId)) {
        skipped.push(`Node ${nodeId}, entry ${entryId} is absent from this catalog.`);
        continue;
      }
      const result = next(purchases, node, entryId);
      if ("reason" in result) skipped.push(`${perkName(node)}. ${result.reason}`);
      else if (result.purchase[1] !== entryId) skipped.push(`${perkName(node)}. Entry ${entryId} is out of order or belongs to another choice.`);
      else purchases.push(purchase);
    }
    return { purchases, skipped };
  }

  function remove(purchases: readonly Purchase[], nodeId: number): Purchase[] | null {
    const index = purchases.findLastIndex(([id]) => id === nodeId);
    if (index === -1) return null;
    const remaining = purchases.filter((_, i) => i !== index);
    return replay(remaining).skipped.length === 0 ? remaining : null;
  }

  // These totals are advisory. If an allocated rank has unknown cost, a potentially affected estimate is incomplete.
  function points(purchases: readonly Purchase[], currencyId: number): number | null {
    let spent = 0;
    for (const [nodeId] of purchases) {
      const tree = byId.get(nodeId)?.tree;
      if (!tree) return null;
      if (tree.cost.currencyId === currencyId && tree.cost.value !== null) spent += tree.cost.value;
      if (tree.cost.value === null && (tree.currencyId === null || tree.currencyId === currencyId)) return null;
    }
    return spent;
  }

  return {
    next,
    remove,
    replay,
    totals: (purchases: readonly Purchase[]) => catalog.currencies.map((currency) => ({
      currencyId: currency.id, spent: points(purchases, currency.id), cap: currency.cap.value,
    })),
    gatePoints: (gate: Gate, purchases: readonly Purchase[]) => gate.confidence === "unknown"
      ? null : points(purchases.filter(([nodeId]) => gate.counted.includes(nodeId)), gate.currencyId),
  };
}
