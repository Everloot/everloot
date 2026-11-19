import type { ZoneEntrance, ZoneNpc } from "@/lib/zones";

const WIDTH = 1000;

/**
 * A still picture of one zone: its own map art when we have it, otherwise the outline, with a point for
 * every NPC players have placed and a diamond for every dungeon or raid entrance. It is a plain SVG with
 * no script, so it reads the same without JavaScript. The outline is dashed: its corners come from the
 * game files and no player has confirmed them. `width` and `height` are the zone's size in yards, which
 * sets the picture's shape.
 */
export default function ZonePreview({ name, width, height, art, npcs, entrances }: {
  name: string; width: number; height: number; art: string | null; npcs: ZoneNpc[]; entrances: ZoneEntrance[];
}) {
  const h = Math.round((WIDTH * Math.abs(height)) / Math.max(Math.abs(width), 1));
  const px = (x: number) => (x / 100) * WIDTH;
  const py = (y: number) => (y / 100) * h;
  return (
    <figure data-zone-preview className="min-w-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${h}`}
        role="img"
        aria-label={`${name}: ${art ? "map" : "outline"} with ${npcs.length} NPCs and ${entrances.length} dungeon or raid entrances`}
        className="block w-full max-h-[32rem] rounded-card border border-line bg-panel"
      >
        {art && <image href={art} x={0} y={0} width={WIDTH} height={h} preserveAspectRatio="none" />}
        {!art && <rect x={2} y={2} width={WIDTH - 4} height={h - 4} rx={6} fill="none" className="stroke-edge" strokeWidth={3} strokeDasharray="14 10" />}
        {npcs.map((n) => (
          <circle key={n.npcId} cx={px(n.x)} cy={py(n.y)} r={7} className={n.vendor ? "fill-warning" : "fill-accent"} stroke="#000" strokeOpacity={0.6} strokeWidth={2} />
        ))}
        {entrances.map((e) => (
          <rect
            key={e.names.join("|")} x={px(e.x) - 9} y={py(e.y) - 9} width={18} height={18}
            transform={`rotate(45 ${px(e.x)} ${py(e.y)})`} className="fill-fg" stroke="#000" strokeOpacity={0.6} strokeWidth={2}
          />
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />NPC</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-warning" />Vendor</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2 w-2 rotate-45 bg-fg" />Dungeon or raid entrance</span>
      </figcaption>
    </figure>
  );
}
