"use client";

import { deriveOrder, orderSteps, type MovedPoint } from "@/lib/talents/order";
import { entryAtRank, nodeMap, pointsSpent } from "@/lib/talents/rules";
import type { PlanSet, TalentCatalog } from "@/lib/talents/types";

// The order a set's points are spent in, under the trees: whether it is planned, provisional or unknown, the points
// in turn with the level each arrives at, and where the points a take-back or a tree reset moved went. The calculator
// keeps the set and its undo; this shows the set and hands back the one edit made here, a provisional order for a set
// whose order is unknown.

const LABELS = {
  planned: ["Planned order.", "The points in the order they were spent in this calculator. A plan, not a record of play."],
  provisional: [
    "Provisional order.",
    "Made by the calculator when asked: the tree's reading order, each point as soon as the rules allow. Edits keep the label until the set is reset. Not a recommendation or a record of play.",
  ],
  unknown: [
    "Spend order unknown.",
    "This set came without a spend order the calculator can use, from an older link or with one that did not fit, so none is shown and none is guessed.",
  ],
} as const;

export default function LevelingOrder({ catalog, set, setName, moved, onEdit, onMessage }: {
  catalog: TalentCatalog;
  set: PlanSet;
  /** "set 1" or "set 2". */
  setName: string;
  /** The points the last take-back or tree reset moved to keep the order legal: where each was, and is now. */
  moved: MovedPoint[];
  /** The set an edit made here, and what to say about it. */
  onEdit: (next: PlanSet, message: string) => void;
  onMessage: (text: string) => void;
}) {
  const nodes = nodeMap(catalog);
  const steps = orderSteps(catalog, set);
  /** The talent a node's `rank`-th point buys: a choice node's chosen entry, a tiered node's entry at that rank. */
  function point(id: number, rank: number): string {
    const node = nodes.get(id)!;
    const entry = node.kind === "choice" ? node.entries[set.ranks[id]?.choice ?? 0] ?? node.entries[0] : entryAtRank(node, rank - 1);
    return `${entry.name}, rank ${rank}`;
  }

  function generate() {
    const next = deriveOrder(catalog, set);
    if (next === set) {
      onMessage("No legal order fits these points on this tree, so none was made.");
      return;
    }
    onEdit(next, `Made a provisional order for ${setName}: the tree's reading order, each point as soon as the rules allow. It is not a recommendation or a record of play. Undo takes it back.`);
  }

  const [label, about] = set.order && set.orderOrigin ? LABELS[set.orderOrigin] : LABELS.unknown;
  return (
    <section aria-labelledby="spend-order" className="space-y-3 border-t border-line p-4 text-sm text-fg-2">
      <h2 id="spend-order" className="text-base font-semibold text-fg">Spend order, {setName}</h2>
      {pointsSpent(set.ranks) === 0
        ? <p>No points in {setName} yet. Each point you spend joins the order in turn.</p>
        : <p><span className="font-semibold text-fg">{label}</span> {about}</p>}
      {!set.order && <button type="button" className="btn text-sm" onClick={generate}>Create a provisional order</button>}
      {moved.length > 0 && (
        <div className="space-y-1">
          <p>{moved.length === 1 ? "This point" : `These ${moved.length} points`} changed places to keep the order legal:</p>
          <ul className="list-disc space-y-1 pl-5">
            {moved.map((m) => <li key={`${m.id}:${m.rank}`}>{point(m.id, m.rank)}: was level {m.from}, now level {m.to}</li>)}
          </ul>
        </div>
      )}
      {steps && steps.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-fg-2 hover:text-fg">All {steps.length} points in order</summary>
          <ol className="list-decimal space-y-1 pl-6">
            {steps.map((s, i) => <li key={i}>Level {s.level}: {point(s.id, s.rank)}</li>)}
          </ol>
        </details>
      )}
    </section>
  );
}
