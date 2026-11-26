"use client";

import { useState } from "react";
import Link from "next/link";
import Segmented from "@/components/ui/Segmented";
import type { MapZoneView, MarkKind } from "./entity-map";

/** Each kind's legend label, shape and colour. Filled when agreed, hollow (the same colour as an edge) when only the game files give it. */
const KINDS: Record<MarkKind, { label: string; shape: string; fill: string; edge: string }> = {
  npc: { label: "NPC", shape: "rounded-full", fill: "bg-accent", edge: "border-accent" },
  vendor: { label: "Vendor", shape: "rounded-full", fill: "bg-warning", edge: "border-warning" },
  giver: { label: "Quest giver", shape: "rounded-full", fill: "bg-accent", edge: "border-accent" },
  turnin: { label: "Turn-in", shape: "rounded-full", fill: "bg-warning", edge: "border-warning" },
  object: { label: "Object", shape: "rounded-[2px]", fill: "bg-fg", edge: "border-fg" },
  entrance: { label: "Dungeon or raid entrance", shape: "rotate-45", fill: "bg-fg", edge: "border-fg" },
  place: { label: "Place", shape: "rounded-full", fill: "bg-fg-2", edge: "border-fg-2" },
};
const ORDER = Object.keys(KINDS) as MarkKind[];

function Mark({ kind, agreed, className = "" }: { kind: MarkKind; agreed: boolean; className?: string }) {
  const k = KINDS[kind];
  return <span aria-hidden="true" data-mark={kind} data-agreed={agreed} className={`block h-3 w-3 ${k.shape} ${agreed ? k.fill : `border-2 ${k.edge}`} ${className}`.trim()} />;
}

/**
 * An entity's positions on its zone's map, one zone at a time with a switcher when they span zones, each kind in its
 * colour and a legend of the kinds shown. The art loads lazily (it sits under the fold on most pages), and the
 * picture is decoration for the pin tables below, which carry the same positions as text.
 */
export default function EntityMap({ name, zones }: { name: string; zones: MapZoneView[] }) {
  const [shown, setShown] = useState(zones[0]?.mapId);
  const zone = zones.find((z) => z.mapId === shown) ?? zones[0];
  if (!zone) return null;
  const kinds = ORDER.filter((k) => zone.marks.some((m) => m.kind === k));
  const hollow = zone.marks.some((m) => !m.agreed);
  return (
    <section data-entity-map aria-labelledby="entity-map" className="mb-6">
      <h2 id="entity-map" className="mb-2 text-h2-sm text-fg sm:text-h2">Map</h2>
      {zones.length > 1 && (
        <div data-zone-switcher className="mb-2 max-w-full overflow-x-auto">
          <Segmented label={`Zones where ${name} is placed`} value={zone.mapId} onChange={setShown} options={zones.map((z) => ({ value: z.mapId, label: z.name }))} />
        </div>
      )}
      <figure className="max-w-3xl">
        <div role="img" aria-label={`${name} on the map of ${zone.name}: ${zone.marks.length} ${zone.marks.length === 1 ? "position" : "positions"}`} className="relative overflow-hidden rounded-card border border-line bg-panel" style={{ aspectRatio: zone.ratio }}>
          {/* The zone's picture from the asset bucket as it is; next/image would only proxy it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={zone.mapId} src={zone.art} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          {zone.marks.map((m, i) => (
            <span key={`${m.kind}-${m.x}-${m.y}-${i}`} title={`${m.label} · ${m.x}, ${m.y}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${m.x}%`, top: `${m.y}%` }}>
              <Mark kind={m.kind} agreed={m.agreed} className="ring-2 ring-black/60" />
            </span>
          ))}
        </div>
        <figcaption data-map-legend className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {kinds.map((k) => <span key={k} className="inline-flex items-center gap-1.5"><Mark kind={k} agreed />{KINDS[k].label}</span>)}
          {hollow && <span>Hollow: from the game files, unconfirmed</span>}
          <Link href={zone.href} className="ml-auto text-meta text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Open on the world map</Link>
        </figcaption>
      </figure>
    </section>
  );
}
