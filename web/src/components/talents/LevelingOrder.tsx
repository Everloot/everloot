"use client";

import { useEffect, useRef } from "react";
import { DATA_SIZE } from "@/design/tokens";
import { deriveOrder, orderSteps, prefixRanks, type MovedPoint } from "@/lib/talents/order";
import { entryAtRank, levelFor, nodeMap, pointsAtLevel, pointsByTree, pointsSpent } from "@/lib/talents/rules";
import type { PlanSet, Ranks, TalentCatalog, TalentNode } from "@/lib/talents/types";

// The order a set's points are spent in, under the trees: whether it is planned, provisional or unknown, the points
// in turn with the level each arrives at, and where the points a take-back or a tree reset moved went. The calculator
// keeps the set and its undo; this shows the set and hands back the one edit made here, a provisional order for a set
// whose order is unknown. A known order can also be previewed, the trees showing the set as it stood after each point
// (read only), and each point can move one place earlier or later, which the calculator does through the order engine.

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

/** The catalog as one set's points see it. The second set opens at the level the rules give for it, so every point the
 *  levels before that give arrives there instead; the first set is the catalog as it is. The order engine reads its
 *  levels from this, so a step, a moved point or a refusal says the level that set's point comes at. */
export function forSet(catalog: TalentCatalog, slot: 0 | 1): TalentCatalog {
  if (slot === 0) return catalog;
  const { rules } = catalog;
  const pointLevels = Array.from({ length: pointsAtLevel(catalog, rules.maxLevel) }, (_, i) => Math.max(levelFor(catalog, i + 1), rules.dualSpecLevel));
  return { ...catalog, rules: { ...rules, pointLevels } };
}

/** The talent a node's `rank`-th point buys, with that rank: a choice node's chosen entry, a tiered node's entry at
 *  that rank. */
export function pointName(node: TalentNode, ranks: Ranks, rank: number): string {
  const entry = node.kind === "choice" ? node.entries[ranks[node.id]?.choice ?? 0] ?? node.entries[0] : entryAtRank(node, rank - 1);
  return `${entry.name}, rank ${rank}`;
}

export default function LevelingOrder({ catalog, set, slot, setName, moved, preview, onPreview, onMove, refused, onEdit, onMessage }: {
  catalog: TalentCatalog;
  set: PlanSet;
  /** Which set this is: the second's points wait for the level it opens at. */
  slot: 0 | 1;
  /** "set 1" or "set 2". */
  setName: string;
  /** The points the last take-back or tree reset moved to keep the order legal: where each was, and is now. */
  moved: MovedPoint[];
  /** How many of the order's points the trees show while the preview is on; null while it is off. */
  preview: number | null;
  /** Show the trees after this many points, or the whole set again (null). Nothing in the set changes. */
  onPreview: (points: number | null) => void;
  /** Move the point at place `from` to place `to` (from 0), one place earlier or later. */
  onMove: (from: number, to: number) => void;
  /** The last move refused: the point's place and why, which the status line has read out. Said again under its row. */
  refused: { at: number; text: string } | null;
  /** The set an edit made here, and what to say about it. */
  onEdit: (next: PlanSet, message: string) => void;
  onMessage: (text: string) => void;
}) {
  const nodes = nodeMap(catalog);
  const schedule = forSet(catalog, slot);
  const steps = orderSteps(schedule, set);
  const point = (id: number, rank: number) => pointName(nodes.get(id)!, set.ranks, rank);

  function generate() {
    const next = deriveOrder(catalog, set);
    if (next === set) {
      onMessage("No legal order fits these points on this tree, so none was made.");
      return;
    }
    onEdit(next, `Made a provisional order for ${setName}: the tree's reading order, each point as soon as the rules allow. It is not a recommendation or a record of play. Undo takes it back.`);
  }

  /** The point the preview stops at, said in full: "Point 7 of 51, level 16: Talent 12, rank 2". */
  const at = (points: number) => {
    const s = steps![points - 1];
    return `Point ${points} of ${steps!.length}, level ${s.level}: ${point(s.id, s.rank)}`;
  };
  function toggle() {
    if (preview !== null) {
      onPreview(null);
      onMessage("Preview off. The trees show the whole set again.");
      return;
    }
    onPreview(1);
    onMessage(`Preview on. ${at(1)}.`);
  }
  // The buttons say where the preview went; the slider says it itself (its value text).
  function step(points: number) {
    if (!steps || points < 1 || points > steps.length) return;
    onPreview(points);
    onMessage(`${at(points)}.`);
  }

  // A move keeps the focus on the moved point's arrow, now in its new row (the rows are keyed by point). A row that went
  // under the site header or into the cookie banner's strip comes 8 px clear of them, as a talent does in the
  // calculator, and only for the keyboard's focus: a press never scrolls the page under the pointer.
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !list.current?.contains(el) || !el.matches(":focus-visible")) return;
    const top = DATA_SIZE.header + 8;
    const bottom = window.innerHeight - (parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom) || 0);
    const box = el.getBoundingClientRect();
    if (box.top < top) window.scrollBy(0, box.top - top);
    else if (box.bottom > bottom) window.scrollBy(0, Math.min(box.bottom - bottom, box.top - top));
  }, [set]);

  const [label, about] = set.order && set.orderOrigin ? LABELS[set.orderOrigin] : LABELS.unknown;
  const { dualSpecLevel } = catalog.rules;
  const shown = preview === null ? null : prefixRanks(set, preview);
  const split = shown && pointsByTree(catalog, shown);
  return (
    <section aria-labelledby="spend-order" className="space-y-3 border-t border-line p-4 text-sm text-fg-2">
      <h2 id="spend-order" className="text-base font-semibold text-fg">Spend order, {setName}</h2>
      {pointsSpent(set.ranks) === 0
        ? <p>No points in {setName} yet. Each point you spend joins the order in turn.</p>
        : <p><span className="font-semibold text-fg">{label}</span> {about}</p>}
      {slot === 1 && steps && steps.length > 0 && (
        <p>
          Set 2 opens at level {dualSpecLevel}, so its first {pointsAtLevel(catalog, dualSpecLevel)} points all come at
          level {dualSpecLevel}. That level is from the beta notes, not the game files.
        </p>
      )}
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
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn text-sm" aria-pressed={preview !== null} onClick={toggle}>
            Preview point by point: {preview === null ? "off" : "on"}
          </button>
          <p className="min-w-0 flex-1 basis-60">Shows the trees after each point in turn, with the level it comes at. Nothing changes while the preview is on.</p>
        </div>
      )}
      {steps && preview !== null && split && (
        <div role="group" aria-label="Spend order preview" className="space-y-2 rounded-control border border-line bg-canvas p-3">
          <p className="text-fg [overflow-wrap:anywhere]">
            <span className="font-semibold">Point {preview} of {steps.length}, level {steps[preview - 1].level}:</span>{" "}
            {point(steps[preview - 1].id, steps[preview - 1].rank)}.
          </p>
          <p>Points by tree: {catalog.trees.map((t) => `${t.name} ${split.get(t.id) ?? 0}`).join(", ")}. Turn the preview off to change points.</p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn flex-none px-3 text-sm" aria-label="Previous point" aria-disabled={preview === 1} onClick={() => step(preview - 1)}>Previous</button>
            <input
              type="range"
              min={1}
              max={steps.length}
              value={preview}
              aria-label="Point to preview"
              aria-valuetext={at(preview)}
              onChange={(e) => onPreview(Number(e.target.value))}
              className="min-w-0 flex-1 accent-[rgb(var(--accent))]"
            />
            <button type="button" className="btn flex-none px-3 text-sm" aria-label="Next point" aria-disabled={preview === steps.length} onClick={() => step(preview + 1)}>Next</button>
          </div>
        </div>
      )}
      {steps && steps.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-fg-2 hover:text-fg">All {steps.length} points in order</summary>
          {/* Each point's arrows move it one place; the engine refuses a move the rules do not allow and says why.
              Their names are in their labels only, so a row's text is the point and its level. On a wide screen the list
              stays narrow, so each row's arrows sit beside its text. */}
          <ol ref={list} className="max-w-2xl list-decimal space-y-1 pl-6">
            {steps.map((s, i) => {
              const what = point(s.id, s.rank);
              return (
                <li key={`${s.id}:${s.rank}`}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Level {s.level}: {what}</span>
                    {(["earlier", "later"] as const).map((way) => {
                      const to = way === "earlier" ? i - 1 : i + 1;
                      // Nothing to move past: the first point, the last, or another point of the same talent.
                      const stuck = to < 0 || to >= steps.length || steps[to].id === s.id;
                      return (
                        <button key={way} type="button" className="btn size-11 flex-none !px-0" aria-label={`Move ${what} ${way}`} aria-disabled={stuck}
                          disabled={preview !== null} onClick={() => onMove(i, to)}>
                          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className={way === "earlier" ? "rotate-180" : undefined}>
                            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        </button>
                      );
                    })}
                  </div>
                  {/* For the eye only, beside the arrow that was pressed: the status line, far up the page on a phone, has
                      read it out. */}
                  {refused?.at === i && <p aria-hidden="true" data-move-refusal className="mt-1 text-xs text-warning [overflow-wrap:anywhere]">{refused.text}</p>}
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </section>
  );
}
