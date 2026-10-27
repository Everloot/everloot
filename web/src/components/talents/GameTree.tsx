import { canAdd, entryAtRank, rankOf } from "@/lib/talents/rules";
import type { GameAssets } from "@/lib/talents/assets";
import { assetOf, describeNode, nodeLabel, type Props } from "./TalentTreeView";

// One tree in the game's look, used only when the asset files are there. The spec's dark background,
// the game's own 50 px node frames (round for active talents, square for passive ones) over the real
// icons. A frame colour names the state: gold is full, green can take a point or has some, grey is
// locked. The rank counter sits at the node's corner. Connector arrows are lit once the talent they
// come from is at full rank. State is also in each node's accessible name, never colour alone.

const NODE = 50;
const PITCH = 60;
const LABEL = 24;
const GOLD = "#ffd100";
/** The preview's mark on its node: a ring 7 px out, clear of the frame and of the gold focus ring 2 to 4 px out. */
const MARK = "pointer-events-none absolute -inset-[7px] border-2 border-accent";

export default function GameTree({ catalog, tree, ranks, available, spent, selected, roving, highlighted = null, assets, onAdd, onSelect, onTip }: Props & { assets: GameAssets }) {
  const frames = assets.frames;
  const nodes = catalog.nodes.filter((n) => n.treeId === tree.id);
  const rows = Math.max(...nodes.map((n) => n.row));
  const cols = Math.max(...nodes.map((n) => n.col));
  const width = LABEL + cols * PITCH;
  const height = rows * PITCH;
  const x = (col: number) => LABEL + (col - 1) * PITCH + (PITCH - NODE) / 2;
  const y = (row: number) => (row - 1) * PITCH + (PITCH - NODE) / 2;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const gateOfRow = (row: number) => Math.min(...nodes.filter((n) => n.row === row).map((n) => n.unlock?.pointsInTree ?? 0));
  const bg = assets.backgrounds.get(`${catalog.classSlug}:${tree.name}`);
  const bgUrl = bg ? frames.get(bg.element)?.url : undefined;

  return (
    <div role="group" aria-label={`${tree.name} talents, ${spent} ${spent === 1 ? "point" : "points"}`} className="overflow-x-auto rounded-lg border border-[#3d3a2e]" data-game-look data-tree-scroll>
      <div
        className="relative p-3"
        style={{ backgroundColor: "#07070d", backgroundImage: bgUrl ? `url(${bgUrl})` : undefined, backgroundSize: "cover", backgroundPosition: "center" }}
      >
        {/* A flat dark layer over the spec art, so the icons and numbers stay readable. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundColor: "rgba(4,4,10,0.55)" }} />
        <div className="relative mx-auto" style={{ width, height }}>
          {Array.from({ length: rows }, (_, i) => i + 1).map((row) => (
            <span key={row} aria-hidden="true" className="absolute text-right font-mono text-xs tabular-nums" style={{ left: 0, top: y(row) + NODE / 2 - 8, width: LABEL - 6, color: GOLD }}>
              {gateOfRow(row)}
            </span>
          ))}
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={width} height={height}>
            {nodes.flatMap((n) => [...n.prereqs, ...(n.anyOf ?? [])].map((p) => {
              const from = byId.get(p);
              if (!from) return null;
              const met = rankOf(ranks, p) >= from.maxRanks;
              const x1 = x(from.col) + NODE / 2, y1 = y(from.row) + NODE / 2;
              const x2 = x(n.col) + NODE / 2, y2 = y(n.row) + NODE / 2;
              const len = Math.hypot(x2 - x1, y2 - y1) || 1;
              const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
              const head = frames.get(met ? "talents-arrow-head-yellow" : "talents-arrow-head-gray");
              const ex = x2 - ux * (NODE / 2 + 1), ey = y2 - uy * (NODE / 2 + 1);
              const back = head ? head.height : 0;
              const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
              return (
                <g key={`${p}-${n.id}`} data-lit={met || undefined}>
                  <line x1={x1 + ux * (NODE / 2)} y1={y1 + uy * (NODE / 2)} x2={ex - ux * back} y2={ey - uy * back} stroke={met ? "#d4a017" : "#5b5b5b"} strokeWidth={4} />
                  {head && <image href={head.url} width={head.width} height={head.height} x={-head.width / 2} y={-head.height} transform={`translate(${ex} ${ey}) rotate(${angle - 90})`} />}
                </g>
              );
            }))}
          </svg>
          {nodes.map((node) => {
            const rank = rankOf(ranks, node.id);
            const full = rank >= node.maxRanks;
            const open = canAdd(catalog, ranks, node.id, available).ok;
            const state = full ? "yellow" : rank > 0 || open ? "green" : "gray";
            const tabIndex = roving === node.id ? 0 : -1;
            const common = {
              "data-node": node.id, "data-row": node.row, "data-col": node.col, "data-tree": tree.id,
              onFocus: () => { onSelect(node.id); onTip(node.id, "focus"); },
              onBlur: () => onTip(null, "focus"),
              onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === "mouse") onTip(node.id, "hover"); },
              onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === "mouse") onTip(null, "hover"); },
            };
            const pos = { left: x(node.col), top: y(node.row), width: NODE, height: NODE };
            const counter = state === "yellow" ? GOLD : state === "green" ? "#4cff4c" : "#9a9a9a";
            const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffd100]";
            const marked = highlighted === node.id;

            if (node.kind === "choice") {
              return (
                <div key={node.id} role="group" aria-label={nodeLabel(catalog, node, ranks, available)} data-highlighted={marked || undefined} className="absolute flex items-center justify-center gap-0.5" style={pos}>
                  {node.entries.map((entry, i) => {
                    const picked = rank > 0 && ranks[node.id]?.choice === i;
                    const icon = assetOf(assets, entry)?.icon;
                    return (
                      <button
                        key={i}
                        type="button"
                        id={`talent-${node.id}-${i}`}
                        aria-label={`${entry.name}${picked ? ", chosen" : ""}`}
                        aria-pressed={picked}
                        aria-current={marked && picked ? "step" : undefined}
                        aria-describedby={`talent-desc-${node.id}`}
                        tabIndex={tabIndex}
                        {...common}
                        onClick={() => onAdd(node.id, i)}
                        className={`size-6 rounded-sm border-2 bg-cover ${focusRing}`}
                        style={{ borderColor: picked ? GOLD : "#5b5b5b", backgroundImage: icon ? `url(${icon})` : undefined, backgroundColor: "#111", filter: picked || state !== "gray" ? undefined : "grayscale(1) brightness(0.55)" }}
                      />
                    );
                  })}
                  <span id={`talent-desc-${node.id}`} className="sr-only">{describeNode(assets, node, rank)}</span>
                  {marked && <span aria-hidden="true" className={`${MARK} rounded-md`} />}
                </div>
              );
            }

            const info = assetOf(assets, entryAtRank(node, rank));
            const square = info?.passive === true;
            const frame = frames.get(`talents-node-${square ? "square" : "circle"}-${state}`)?.url;
            return (
              <button
                key={node.id}
                type="button"
                id={`talent-${node.id}`}
                aria-label={nodeLabel(catalog, node, ranks, available)}
                aria-describedby={`talent-desc-${node.id}`}
                tabIndex={tabIndex}
                {...common}
                data-state={state}
                data-shape={square ? "square" : "circle"}
                data-selected={selected === node.id || undefined}
                data-highlighted={marked || undefined}
                aria-current={marked ? "step" : undefined}
                style={pos}
                onClick={() => onAdd(node.id)}
                className={`absolute select-none [-webkit-touch-callout:none] touch-manipulation ${square ? "rounded-md" : "rounded-full"} ${focusRing}`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-[5px] bg-cover bg-center ${square ? "rounded-sm" : "rounded-full"}`}
                  style={{ backgroundColor: "#16161c", backgroundImage: info?.icon ? `url(${info.icon})` : undefined, filter: state === "gray" ? "grayscale(1) brightness(0.55)" : undefined }}
                />
                <span aria-hidden="true" className="absolute inset-0 bg-contain bg-center bg-no-repeat" style={{ backgroundImage: frame ? `url(${frame})` : undefined }} />
                {node.maxRanks > 1 && (
                  <span aria-hidden="true" className="absolute -bottom-1 -right-1 rounded border px-1 font-mono text-[11px] leading-4 tabular-nums" style={{ color: counter, backgroundColor: "rgba(0,0,0,0.85)", borderColor: "#000" }}>
                    {rank}/{node.maxRanks}
                  </span>
                )}
                <span id={`talent-desc-${node.id}`} className="sr-only">{describeNode(assets, node, rank)}</span>
                {marked && <span aria-hidden="true" className={`${MARK} ${square ? "rounded-lg" : "rounded-full"}`} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
