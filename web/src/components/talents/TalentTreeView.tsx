import { canAdd, entryAtRank, entryRankAt, rankOf, refusalText } from "@/lib/talents/rules";
import type { GameAssets } from "@/lib/talents/assets";
import type { Ranks, TalentCatalog, TalentEntry, TalentNode, TalentTree } from "@/lib/talents/types";
import { spokenUnknowns } from "@/lib/placeholder";
import { SPOKEN_AMOUNT_NOTE, withoutUnknownAmounts } from "./armory-text";

// One tree: a grid of talents with the prerequisite lines behind it. Plain buttons, no pictures.
// Colour only names the class; state is also written out (rank, "locked", "full") for anyone who
// cannot tell the colours apart.

// Four columns plus the gate column fit a 390 px phone (358 px of content). Tiles are tall enough
// for a four-line name; the names are never cut, and each tile also carries its full name as a
// title and in its accessible label.
const W = 78; // talent width, px
const H = 88;
const GAP = 6;
const LABEL = 20; // width of the row-gate column

// Written out in full so Tailwind can see each class name.
export const CLASS_TEXT: Record<string, string> = {
  warrior: "text-class-warrior", paladin: "text-class-paladin", hunter: "text-class-hunter",
  rogue: "text-class-rogue", priest: "text-class-priest", shaman: "text-class-shaman",
  mage: "text-class-mage", warlock: "text-class-warlock", druid: "text-class-druid",
};
const CLASS_BORDER: Record<string, string> = {
  warrior: "border-class-warrior", paladin: "border-class-paladin", hunter: "border-class-hunter",
  rogue: "border-class-rogue", priest: "border-class-priest", shaman: "border-class-shaman",
  mage: "border-class-mage", warlock: "border-class-warlock", druid: "border-class-druid",
};

export type TipMode = "hover" | "focus" | "press";

export interface TreeHandlers {
  onAdd(id: number, choice?: number): void;
  onSelect(id: number): void;
  /** A tooltip opens or closes: hover and focus set it, long press too, their end clears it. */
  onTip(id: number | null, mode: TipMode): void;
  /** The node that holds this tree's one tab stop. */
  roving: number;
}

export interface Props extends TreeHandlers {
  catalog: TalentCatalog;
  tree: TalentTree;
  ranks: Ranks;
  available: number;
  spent: number;
  selected: number | null;
  /** The node the spend order's preview stops at, marked as the current step. Absent without a preview. */
  highlighted?: number | null;
  /** The asset files, when the page has them; null shows the text tiles. */
  assets: GameAssets | null;
  /** A build shown, not edited (the armory): labels leave out whether a point can be taken. */
  readOnly?: boolean;
}

/** What a node's entry says in the asset manifest. */
export const assetOf = (assets: GameAssets | null, entry: TalentEntry) => (entry.definitionId === null ? undefined : assets?.spells.get(entry.definitionId));

/**
 * An entry's tooltip at a rank (from 1): the text the files give for that rank, else the spell's stored text, which
 * stays the same at every rank (`perRank` false).
 */
export function textAt(assets: GameAssets | null, entry: TalentEntry, rank: number): { text: string | null; partial: boolean; perRank: boolean } | undefined {
  const a = assetOf(assets, entry);
  if (!a) return undefined;
  const at = a.ranks?.[rank - 1];
  return at ? { ...at, perRank: true } : { text: a.text, partial: a.partial, perRank: false };
}

/** The entries a node's tooltip shows for the rank held, each with its text: before the first point, the first rank. */
export function heldTexts(assets: GameAssets | null, node: TalentNode, rank: number) {
  if (node.kind === "choice") return node.entries.map((entry) => ({ entry, tip: textAt(assets, entry, 1) }));
  const held = entryRankAt(node, Math.max(1, rank));
  return [{ entry: held.entry, tip: textAt(assets, held.entry, held.rank) }];
}

/**
 * A node's name and tooltip text, for aria-describedby: a screen reader gets it without hover, and never the `[?]`
 * mark. `readOnly` (the armory) words a missing amount out as its tooltip does and ends with the tooltip's note.
 */
export function describeNode(assets: GameAssets | null, node: TalentNode, rank: number, readOnly = false): string {
  let dropped = false;
  const text = heldTexts(assets, node, rank).map(({ entry, tip }) => {
    const raw = tip?.text ?? "";
    const words = readOnly ? withoutUnknownAmounts(raw) : { text: raw, dropped: false };
    dropped ||= words.dropped;
    return `${entry.name}. ${spokenUnknowns(words.text)}`.trim();
  }).join(" ");
  return dropped ? `${text} ${SPOKEN_AMOUNT_NOTE}` : text;
}

// A name never splits inside a word: a long single word gets a smaller size so it fits the tile.
// Sizes are measured against the 78 px tile (about 72 px of text).
export function nameSize(name: string): string {
  const longest = Math.max(...name.split(/\s+/).map((w) => w.length));
  return longest >= 15 ? "text-[9px]" : longest >= 12 ? "text-[10px]" : "";
}

/** `readOnly` (a build shown, not edited) leaves out whether a point can be taken. */
export function nodeLabel(catalog: TalentCatalog, node: TalentNode, ranks: Ranks, available: number, readOnly = false): string {
  const rank = rankOf(ranks, node.id);
  const name = node.kind === "choice" ? node.entries.map((e) => e.name).join(" or ") : entryAtRank(node, rank).name;
  if (readOnly) return `${name}, rank ${rank} of ${node.maxRanks}, row ${node.row}`;
  const verdict = canAdd(catalog, ranks, node.id, available);
  const state = rank >= node.maxRanks ? "full" : verdict.ok ? "can take a point" : `locked. ${refusalText(verdict.reason!, node, catalog, ranks)}`;
  return `${name}, rank ${rank} of ${node.maxRanks}, row ${node.row}, ${state}`;
}

/**
 * The node an arrow key moves focus to from `id`: undefined for a key that is not an arrow, null when there is none
 * that way. Left and right stay on the row. Up and down stay in the column if they can; otherwise they go to the next
 * row that has anything, at the nearest column.
 */
export function arrowTarget(catalog: TalentCatalog, id: number, key: string): TalentNode | null | undefined {
  const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const dir = arrows[key];
  if (!dir) return undefined;
  const from = catalog.nodes.find((n) => n.id === id);
  if (!from) return null;
  const peers = catalog.nodes.filter((n) => n.treeId === from.treeId && n.id !== id);
  if (dir[0] === 0) {
    return peers
      .filter((n) => n.row === from.row && Math.sign(n.col - from.col) === dir[1])
      .sort((a, b) => Math.abs(a.col - from.col) - Math.abs(b.col - from.col))[0] ?? null;
  }
  const below = peers.filter((n) => Math.sign(n.row - from.row) === dir[0]);
  const inColumn = below.filter((n) => n.col === from.col).sort((a, b) => Math.abs(a.row - from.row) - Math.abs(b.row - from.row))[0];
  if (inColumn || below.length === 0) return inColumn ?? null;
  const nextRow = below.reduce((best, n) => (Math.abs(n.row - from.row) < Math.abs(best - from.row) ? n.row : best), below[0].row);
  return below.filter((n) => n.row === nextRow).sort((a, b) => Math.abs(a.col - from.col) - Math.abs(b.col - from.col))[0] ?? null;
}

/** The preview's mark on its node: a ring inside the tile's own border, so it never covers the focus ring outside it. */
const MARK = "pointer-events-none absolute inset-0 rounded-md border-2 border-accent";

export default function TalentTreeView({ catalog, tree, ranks, available, spent, selected, roving, highlighted = null, assets, readOnly = false, onAdd, onSelect, onTip }: Props) {
  const nodes = catalog.nodes.filter((n) => n.treeId === tree.id);
  const rows = Math.max(...nodes.map((n) => n.row));
  const cols = Math.max(...nodes.map((n) => n.col));
  const width = cols * W + (cols - 1) * GAP;
  const height = rows * H + (rows - 1) * GAP;
  const left = (col: number) => LABEL + GAP + (col - 1) * (W + GAP);
  const top = (row: number) => (row - 1) * (H + GAP);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const slug = catalog.classSlug;
  const gateOfRow = (row: number) => Math.min(...nodes.filter((n) => n.row === row).map((n) => n.unlock?.pointsInTree ?? 0));

  return (
    <div role="group" aria-label={`${tree.name} talents, ${spent} ${spent === 1 ? "point" : "points"}`} className="overflow-x-auto" data-tree-scroll>
      <div className="relative mx-auto" style={{ width: LABEL + GAP + width, height }}>
        {Array.from({ length: rows }, (_, i) => i + 1).map((row) => (
          <span key={row} aria-hidden="true" className="absolute font-mono text-xs text-muted text-right" style={{ left: 0, top: top(row) + H / 2 - 8, width: LABEL }}>
            {gateOfRow(row)}
          </span>
        ))}
        <svg aria-hidden="true" className="absolute inset-0 pointer-events-none" width={LABEL + GAP + width} height={height}>
          {nodes.flatMap((n) => [...n.prereqs, ...(n.anyOf ?? [])].map((p) => {
            const from = byId.get(p);
            if (!from) return null;
            const met = rankOf(ranks, p) >= from.maxRanks;
            return (
              <line
                key={`${p}-${n.id}`}
                x1={left(from.col) + W / 2} y1={top(from.row) + H / 2}
                x2={left(n.col) + W / 2} y2={top(n.row) + H / 2}
                stroke="currentColor" strokeWidth={met ? 3 : 2} strokeDasharray={met ? undefined : "4 4"}
                className={met ? "text-fg-2" : "text-edge"}
              />
            );
          }))}
        </svg>
        {nodes.map((node) => {
          const rank = rankOf(ranks, node.id);
          const full = rank >= node.maxRanks;
          const open = canAdd(catalog, ranks, node.id, available).ok;
          const tone = rank > 0 ? `${CLASS_BORDER[slug]} border-2` : open ? "border-edge border" : "border-line border border-dashed";
          const text = rank > 0 || open ? "text-fg" : "text-muted";
          const base = `bg-panel rounded-lg ${tone} ${text} select-none [-webkit-touch-callout:none] touch-manipulation`;
          const style = { left: left(node.col), top: top(node.row), width: W, height: H };
          const tabIndex = roving === node.id ? 0 : -1;
          const common = { "data-node": node.id, "data-row": node.row, "data-col": node.col, "data-tree": tree.id };
          const marked = highlighted === node.id;

          if (node.kind === "choice") {
            return (
              <div key={node.id} role="group" aria-label={nodeLabel(catalog, node, ranks, available, readOnly)} data-highlighted={marked || undefined} className={`absolute flex flex-col overflow-hidden ${base}`} style={style}>
                {node.entries.map((entry, i) => {
                  const picked = rank > 0 && ranks[node.id]?.choice === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      id={`talent-${node.id}-${i}`}
                      aria-pressed={picked}
                      aria-current={marked && picked ? "step" : undefined}
                      tabIndex={tabIndex}
                      {...common}
                      onFocus={() => onSelect(node.id)}
                      onClick={() => onAdd(node.id, i)}
                      className={`flex-1 px-1 text-xs leading-tight text-center ${picked ? `${CLASS_TEXT[slug]} font-semibold` : ""} ${i > 0 ? "border-t border-line" : ""}`}
                    >
                      {entry.name}{picked ? " (chosen)" : ""}
                    </button>
                  );
                })}
                {marked && <span aria-hidden="true" className={MARK} />}
              </div>
            );
          }

          return (
            <button
              key={node.id}
              type="button"
              id={`talent-${node.id}`}
              aria-label={nodeLabel(catalog, node, ranks, available, readOnly)}
              title={node.entries.map((e) => e.name).join(" / ")}
              tabIndex={tabIndex}
              {...common}
              data-selected={selected === node.id || undefined}
              data-highlighted={marked || undefined}
              aria-current={marked ? "step" : undefined}
              style={style}
              aria-describedby={assets ? `talent-desc-${node.id}` : undefined}
              onFocus={() => { onSelect(node.id); onTip(node.id, "focus"); }}
              onBlur={() => onTip(null, "focus")}
              onPointerEnter={(e) => { if (e.pointerType === "mouse") onTip(node.id, "hover"); }}
              onPointerLeave={(e) => { if (e.pointerType === "mouse") onTip(null, "hover"); }}
              onClick={() => onAdd(node.id)}
              className={`absolute flex flex-col items-center justify-between px-0.5 py-1 text-caption leading-tight text-center ${base}`}
            >
              <span className={`w-full min-w-0 [overflow-wrap:anywhere] hyphens-auto ${nameSize(entryAtRank(node, rank).name)}`}>{entryAtRank(node, rank).name}</span>
              <span className={`font-mono tabular-nums ${rank > 0 ? CLASS_TEXT[slug] : ""}`}>
                {rank}/{node.maxRanks}{full ? " full" : ""}
              </span>
              {assets && <span id={`talent-desc-${node.id}`} className="sr-only">{describeNode(assets, node, rank, readOnly)}</span>}
              {marked && <span aria-hidden="true" className={MARK} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
