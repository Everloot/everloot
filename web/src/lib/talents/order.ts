import {
  add, canAdd, canRemove, entryAtRank, isLegal, levelFor, nodeMap, pointsAtLevel, pointsSpent, rankOf, refusalText, remove,
  withRank, type Refusal, type Verdict,
} from "./rules";
import type { PlanSet, Ranks, TalentCatalog } from "./types";

// The order a set's points are spent in, one node id per point. Pure functions over a catalog and a
// PlanSet, like the point rules they use.
//
// An order is legal when every point could be taken where it stands: the points before it meet its row
// gate and prerequisites, and it is among the points the levels give (the k-th point arrives at
// levelFor(k); past the table's last point there is no level). A set's order is legal or unknown (null),
// never guessed: deriveOrder makes one only when asked, and labels the set provisional.
//
// Edits keep the label, "planned" or "provisional", and keep an unknown order unknown, until the set has
// no points left: an empty set starts over as planned. A loaded order keeps the label it came with when it
// is complete and legal (adoptOrder). Every edit returns the same set when it is refused or changes
// nothing, so it leaves no undo step, and none changes a set it was given, so undo brings back exactly
// what was there.

/** A set with no points: its order is known (empty), and what the player takes next is planned. */
export const emptySet = (): PlanSet => ({ ranks: {}, order: [], orderOrigin: "planned" });

/** Why an order is not legal: it does not spend these ranks' points, or the point at `index` (from 0),
 *  on node `id`, could not be taken there. */
export type OrderVerdict =
  | { ok: true }
  | { ok: false; reason: "extra-points" | "missing-points" }
  | { ok: false; reason: Refusal; index: number; id: number };

/** The most points the levels give. */
const most = (catalog: TalentCatalog) => pointsAtLevel(catalog, catalog.rules.maxLevel);

/** One more point on a node, with the choice the plan made for it. */
const spend = (prefix: Ranks, id: number, ranks: Ranks) => withRank(prefix, id, rankOf(prefix, id) + 1, ranks[id]?.choice);

/** Is `order` a legal way to spend `ranks`: each node as often as its rank, and each point one the rules
 *  allow after the points before it? */
export function validateOrder(catalog: TalentCatalog, ranks: Ranks, order: number[]): OrderVerdict {
  const left = new Map(Object.entries(ranks).filter(([, r]) => r.rank > 0).map(([id, r]) => [Number(id), r.rank]));
  for (const id of order) {
    const points = left.get(id);
    if (!points) return { ok: false, reason: "extra-points" };
    left.set(id, points - 1);
  }
  if ([...left.values()].some((points) => points > 0)) return { ok: false, reason: "missing-points" };
  let prefix: Ranks = {};
  for (const [index, id] of order.entries()) {
    const verdict = canAdd(catalog, prefix, id, most(catalog));
    if (!verdict.ok) return { ok: false, reason: verdict.reason!, index, id };
    prefix = spend(prefix, id, ranks);
  }
  return { ok: true };
}

/** `steps` in a legal order that keeps as close to the given one as the rules allow: each point is taken
 *  as soon as it can be, and one that cannot be yet waits for the points it needs. The rules only open
 *  more as points are added, so this finds a legal order whenever there is one. Null when there is none. */
function arrange(catalog: TalentCatalog, ranks: Ranks, steps: number[]): number[] | null {
  const waiting = [...steps];
  const order: number[] = [];
  let prefix: Ranks = {};
  while (waiting.length > 0) {
    const next = waiting.findIndex((id) => canAdd(catalog, prefix, id, most(catalog)).ok);
    if (next < 0) return null;
    const [id] = waiting.splice(next, 1);
    order.push(id);
    prefix = spend(prefix, id, ranks);
  }
  return order;
}

/** The set for loaded talents and the order that came with them (a link, a saved build). The order and
 *  its label are kept only when the order is complete and legal; otherwise the order is unknown. */
export function adoptOrder(catalog: TalentCatalog, ranks: Ranks, order: number[] | null, origin: PlanSet["orderOrigin"]): PlanSet {
  if (pointsSpent(ranks) === 0) return emptySet();
  // A label read back from storage is checked too: anything but the two is not trusted.
  const labelled = origin === "planned" || origin === "provisional";
  return order && labelled && validateOrder(catalog, ranks, order).ok
    ? { ranks, order, orderOrigin: origin }
    : { ranks, order: null, orderOrigin: null };
}

/** Made only on request: a legal order for the set's points, generated, so the whole set is provisional.
 *  Points go in the tree's reading order, each as soon as the rules allow it. The same set back when it
 *  has no points, no legal order exists for them, or it already holds this order. */
export function deriveOrder(catalog: TalentCatalog, set: PlanSet): PlanSet {
  const steps = catalog.nodes.flatMap((n) => Array<number>(rankOf(set.ranks, n.id)).fill(n.id));
  const order = steps.length > 0 && steps.length === pointsSpent(set.ranks) ? arrange(catalog, set.ranks, steps) : null;
  if (!order || (set.orderOrigin === "provisional" && sameOrder(set.order, order))) return set;
  return { ranks: set.ranks, order, orderOrigin: "provisional" };
}

const sameOrder = (a: number[] | null, b: number[]) => a !== null && a.length === b.length && a.every((id, i) => id === b[i]);

/** Take a point, as `add` does, and put it last in a known order. A choice node that has its point swaps
 *  its entry for nothing and keeps its place. The same set back when the point is refused. */
export function addPoint(catalog: TalentCatalog, set: PlanSet, id: number, available: number, choice?: number): PlanSet {
  // Never past the points the levels give, so the order stays legal whatever budget comes in.
  const ranks = add(catalog, set.ranks, id, Math.min(available, most(catalog)), choice);
  if (ranks === set.ranks) return set;
  const bought = rankOf(ranks, id) > rankOf(set.ranks, id);
  return { ranks, order: set.order && bought ? [...set.order, id] : set.order, orderOrigin: set.orderOrigin };
}

/** Take a point back: the node's latest point leaves the order. A later point that could then no longer
 *  be taken where it stands waits behind the points it needs (movedLater says which). The same set back
 *  when the rules refuse, or when what stays has no legal order (canRemovePoint says why). */
export function removePoint(catalog: TalentCatalog, set: PlanSet, id: number): PlanSet {
  if (!canRemove(catalog, set.ranks, id).ok) return set;
  return rest(catalog, set, remove(catalog, set.ranks, id), set.order && withoutLast(set.order, id));
}

/** Why a point cannot be taken back: the rules' reason, or "dependents" when the points that stay could
 *  not all be taken in any legal order. */
export function canRemovePoint(catalog: TalentCatalog, set: PlanSet, id: number): Verdict {
  const verdict = canRemove(catalog, set.ranks, id);
  return verdict.ok && removePoint(catalog, set, id) === set ? { ok: false, reason: "dependents" } : verdict;
}

function withoutLast(order: number[], id: number): number[] {
  const at = order.lastIndexOf(id);
  return order.filter((_, i) => i !== at);
}

/** Take every point out of one tree. The same set back when the tree has none, when another tree's
 *  talents need them, or when what stays has no legal order. */
export function resetTree(catalog: TalentCatalog, set: PlanSet, treeId: number): PlanSet {
  const inTree = new Set(catalog.nodes.filter((n) => n.treeId === treeId).map((n) => n.id));
  const ranks: Ranks = Object.fromEntries(Object.entries(set.ranks).filter(([id]) => !inTree.has(Number(id))));
  if (pointsSpent(ranks) === pointsSpent(set.ranks) || !isLegal(catalog, ranks)) return set;
  return rest(catalog, set, ranks, set.order && set.order.filter((id) => !inTree.has(id)));
}

/** The set once points have come out: empty starts over, an unknown order stays unknown, and a known one
 *  is kept legal or the change is refused. */
function rest(catalog: TalentCatalog, set: PlanSet, ranks: Ranks, steps: number[] | null): PlanSet {
  if (pointsSpent(ranks) === 0) return emptySet();
  if (!steps) return { ranks, order: null, orderOrigin: null };
  const order = arrange(catalog, ranks, steps);
  return order ? { ranks, order, orderOrigin: set.orderOrigin } : set;
}

/** Move the point at place `from` to place `to` (from 0) in a known order. The same set back when there is
 *  nothing to move, or when a point would then be taken before the rules allow (canMovePoint says which). */
export function movePoint(catalog: TalentCatalog, set: PlanSet, from: number, to: number): PlanSet {
  const order = moved(set.order, from, to);
  return order && validateOrder(catalog, set.ranks, order).ok ? { ...set, order } : set;
}

/** The verdict on the order a move would make, or null when there is nothing to move: the order is
 *  unknown, a place is outside it, or the order would not change. */
export function canMovePoint(catalog: TalentCatalog, set: PlanSet, from: number, to: number): OrderVerdict | null {
  const order = moved(set.order, from, to);
  return order && validateOrder(catalog, set.ranks, order);
}

function moved(order: number[] | null, from: number, to: number): number[] | null {
  const inside = (i: number) => Number.isInteger(i) && i >= 0 && i < (order?.length ?? 0);
  if (!order || !inside(from) || !inside(to)) return null;
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next.some((id, i) => id !== order[i]) ? next : null;
}

/** The ranks after the first `points` points of a known order; null when the order is unknown. */
export function prefixRanks(set: PlanSet, points: number): Ranks | null {
  return set.order && prefixOf(set.ranks, set.order, points);
}

const prefixOf = (ranks: Ranks, order: number[], points: number) =>
  order.slice(0, Math.max(0, points)).reduce<Ranks>((prefix, id) => spend(prefix, id, ranks), {});

export interface OrderStep {
  id: number;
  /** The node's rank once this point is taken. */
  rank: number;
  /** The level this point arrives at, from the tree's point table. */
  level: number;
}

/** Each point of a known order in turn: its node, the rank it reaches and the level it arrives at. Null
 *  when the order is unknown. */
export function orderSteps(catalog: TalentCatalog, set: PlanSet): OrderStep[] | null {
  if (!set.order) return null;
  const taken = new Map<number, number>();
  return set.order.map((id, index) => {
    const rank = (taken.get(id) ?? 0) + 1;
    taken.set(id, rank);
    return { id, rank, level: levelFor(catalog, index + 1) };
  });
}

export interface MovedPoint {
  id: number;
  /** Which of the node's points it is: the rank it reaches. */
  rank: number;
  /** The level it arrived at before the change, and the level it arrives at now. */
  from: number;
  to: number;
}

/** The points a change put behind points that used to come after them: what a removal or a tree reset
 *  moved to keep the order legal, for the page to say. Empty when either order is unknown. */
export function movedLater(catalog: TalentCatalog, before: PlanSet, after: PlanSet): MovedPoint[] {
  const was = orderSteps(catalog, before);
  const now = orderSteps(catalog, after);
  if (!was || !now) return [];
  const place = new Map(now.map((s, i) => [`${s.id}:${s.rank}`, i]));
  const kept = was.flatMap((step) => {
    const at = place.get(`${step.id}:${step.rank}`);
    return at === undefined ? [] : [{ step, at }];
  });
  return kept
    .filter((p, i) => kept.slice(i + 1).some((q) => q.at < p.at))
    .map(({ step, at }) => ({ id: step.id, rank: step.rank, from: step.level, to: now[at].level }));
}

/** Why an order is refused, in a sentence: the talent, the level its point arrives at, and the reason. */
export function orderRefusalText(catalog: TalentCatalog, ranks: Ranks, order: number[], verdict: Exclude<OrderVerdict, { ok: true }>): string {
  if (!("id" in verdict)) {
    return verdict.reason === "extra-points" ? "The order spends points the build does not have." : "The order leaves out points the build has.";
  }
  const node = nodeMap(catalog).get(verdict.id);
  if (!node) return "The order spends a point on a talent this tree does not have.";
  const before = prefixOf(ranks, order, verdict.index);
  const name = node.kind === "choice"
    ? (node.entries[ranks[node.id]?.choice ?? 0] ?? node.entries[0]).name
    : entryAtRank(node, rankOf(before, node.id)).name;
  if (verdict.reason === "no-points") {
    return `${name} would be point ${verdict.index + 1}, but only ${most(catalog)} points come by level ${catalog.rules.maxLevel}.`;
  }
  return `${name} at level ${levelFor(catalog, verdict.index + 1)}: ${refusalText(verdict.reason, node, catalog, before)}`;
}
