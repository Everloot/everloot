"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { hasNodeFrames, loadGameAssets, type GameAssets } from "@/lib/talents/assets";
import { entryAtRank, nodeMap, pointsByTree } from "@/lib/talents/rules";
import type { Ranks, TalentCatalog } from "@/lib/talents/types";
import GameTree from "./GameTree";
import TalentTooltip, { type TipContent } from "./TalentTooltip";
import { withoutUnknownAmounts } from "./armory-text";
import TalentTreeView, { arrowTarget, assetOf, CLASS_TEXT, type TipMode } from "./TalentTreeView";

// A character's build drawn on the calculator's trees, read-only: the same tree pictures (the game's look when the
// asset files are there, the text tiles otherwise), every rank filled in, no points to spend. Hover, focus or the
// arrow keys move through the talents and show their tooltips; nothing changes the build.

const none = () => {};

export default function ArmoryTalentTrees({ catalog, ranks }: { catalog: TalentCatalog; ranks: Ranks }) {
  const [assets, setAssets] = useState<GameAssets | null>(null);
  const [tip, setTip] = useState<{ id: number; mode: TipMode } | null>(null);
  const [roving, setRoving] = useState<Record<number, number>>({});

  useEffect(() => {
    let live = true;
    void loadGameAssets().then((a) => { if (live) setAssets(a); });
    return () => { live = false; };
  }, []);

  const nodes = nodeMap(catalog);
  const perTree = pointsByTree(catalog, ranks);
  const game = assets !== null && hasNodeFrames(assets);
  const onTip = (id: number | null, mode: TipMode) => setTip((cur) => (id === null ? (cur?.mode === mode ? null : cur) : { id, mode }));

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") setTip(null);
    const id = Number((e.target as HTMLElement).closest("[data-node]")?.getAttribute("data-node"));
    if (!id) return;
    const target = arrowTarget(catalog, id, e.key);
    if (target === undefined) return;
    e.preventDefault();
    if (!target) return;
    setRoving((r) => ({ ...r, [target.treeId]: target.id }));
    document.getElementById(target.kind === "choice" ? `talent-${target.id}-0` : `talent-${target.id}`)?.focus();
  }

  let content: TipContent | null = null;
  const tipNode = tip ? nodes.get(tip.id) ?? null : null;
  if (assets && tipNode) {
    const rank = ranks[tipNode.id]?.rank ?? 0;
    const entries = tipNode.kind === "choice" ? tipNode.entries : [entryAtRank(tipNode, rank)];
    const raw = entries.map((e) => assetOf(assets, e)?.text).filter(Boolean).join("\n\n");
    const { text, dropped } = withoutUnknownAmounts(raw);
    content = {
      title: entries.map((e) => e.name).join(" or "),
      rank: `Rank ${rank}/${tipNode.maxRanks}`,
      text: text || null,
      // With every [?] written out of the text, only the note about the left-out amount remains.
      partial: text.includes("[?]"),
      note: dropped ? "This rank's amount is not in the game files we read, so the text leaves it out." : null,
      lock: null,
      label: `${assets.label} · build ${assets.version}`,
    };
  }

  return (
    <div className="grid gap-4 md:grid-cols-3" onKeyDown={onKeyDown}>
      {catalog.trees.map((tree) => {
        const points = perTree.get(tree.id) ?? 0;
        const props = {
          catalog, tree, ranks, available: 0, spent: points, selected: null, readOnly: true,
          roving: roving[tree.id] ?? catalog.nodes.find((n) => n.treeId === tree.id)!.id,
          onAdd: none, onTip,
          onSelect: (id: number) => setRoving((r) => ({ ...r, [tree.id]: id })),
        };
        return (
          <section key={tree.id} className="min-w-0 space-y-2" aria-label={tree.name}>
            <p className="flex items-baseline justify-between gap-3">
              <span className={`text-base font-semibold ${CLASS_TEXT[catalog.classSlug] ?? "text-fg"}`}>{tree.name}</span>
              <span className={`font-mono text-xl tabular-nums ${points === 0 ? "text-muted" : "text-fg"}`}>{points}</span>
            </p>
            {game ? <GameTree {...props} assets={assets} /> : <TalentTreeView {...props} assets={assets} />}
          </section>
        );
      })}
      {content && tipNode && <TalentTooltip anchorId={tipNode.kind === "choice" ? `talent-${tipNode.id}-0` : `talent-${tipNode.id}`} id="talent-tooltip" content={content} />}
    </div>
  );
}
