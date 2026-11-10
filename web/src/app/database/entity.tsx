import type { ReactNode } from "react";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import GameIcon from "@/components/game/GameIcon";
import { AgreementMeter, GET_THE_ADDON, QUALITY_TEXT, type Quality } from "@/components/ui";
import { UNCONFIRMED_TITLE } from "@/components/ui/Badge";
import { trailFor } from "@/lib/breadcrumbs";
import { breadcrumbJsonLd, type Crumb } from "@/lib/jsonld";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { WORLD_MAP } from "@/lib/world-map";

// The layout every database entity page shares (item, NPC, quest, object, vendor), read like an item
// database: a compact title with its type line, the tooltip box and the quick facts side by side,
// then full-width tabs of dense tables. Stacked on a phone. No breadcrumb on screen: the trail is
// only the BreadcrumbList JSON-LD.

/**
 * The quiet "unconfirmed" marker as an edge: a 1 px dashed frame around what it wraps (the header icon),
 * with the tooltip and sr-only text of the `files` Badge. Never a chip or a sentence.
 */
export function Unconfirmed({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span data-unconfirmed title={UNCONFIRMED_TITLE} className={`inline-flex rounded-[3px] border border-dashed border-edge ${className}`.trim()}>
      {children}
      <span className="sr-only"> unconfirmed</span>
    </span>
  );
}

/**
 * The header's icon: the game icon, or an empty frame of the same size when there is none to show. An item's icon
 * (the page passes the game's question mark where its own is missing) has its quality border and no frame; with no
 * asset files an item has no icon at all.
 */
export function EntityIcon({ src, quality, unconfirmed = false, item = false }: { src?: string | null; quality?: Quality; unconfirmed?: boolean; item?: boolean }) {
  if (item) return src ? (
    <span className="shrink-0" data-unconfirmed={unconfirmed || undefined} title={unconfirmed ? UNCONFIRMED_TITLE : undefined}>
      <GameIcon src={src} quality={quality} size={40} className="rounded-[3px]" />
      {unconfirmed && <span className="sr-only"> unconfirmed</span>}
    </span>
  ) : null;
  const icon = src
    ? <GameIcon src={src} size={40} className="rounded-[3px]" />
    : <span aria-hidden="true" className="block h-10 w-10 rounded-[3px] bg-panel" />;
  return unconfirmed ? <Unconfirmed className="shrink-0 p-px">{icon}</Unconfirmed> : <span className="shrink-0">{icon}</span>;
}

/**
 * The page title: an optional icon, the name (in its quality colour for items) and one 13 px type line
 * ("Trade Goods · Cloth · ID 2589"). The trail feeds the BreadcrumbList JSON-LD only; the layout already
 * emits it for routes lib/breadcrumbs.ts knows, so it is emitted here only for the others.
 */
export function EntityHeader({ trail, title, quality, icon, meta = [] }: {
  trail: Crumb[]; title: ReactNode; quality?: Quality; icon?: ReactNode; meta?: ReactNode[];
}) {
  const page = trail[trail.length - 1];
  const emitJsonLd = trail.length > 1 && page && !trailFor(page.path);
  const parts = meta.filter((m) => m !== null && m !== undefined && m !== false && m !== "");
  return (
    <header data-page-header className="mb-4 flex min-w-0 items-center gap-3">
      {emitJsonLd && <JsonLd data={breadcrumbJsonLd(trail)} />}
      {icon}
      <div className="min-w-0">
        <h1 className={`text-title-sm [overflow-wrap:anywhere] sm:text-title ${quality ? QUALITY_TEXT[quality] : "text-fg"}`}>{title}</h1>
        {parts.length > 0 && (
          <p data-entity-meta className="text-meta text-muted">
            {parts.map((part, i) => <span key={i}>{i > 0 && <span aria-hidden="true"> · </span>}{part}</span>)}
          </p>
        )}
      </div>
    </header>
  );
}

/**
 * The top band: the tooltip box (or a map thumbnail) at left, the quick facts beside it (two 280 px columns
 * of them on a wide screen, so the band stays short); stacked on a phone. No box (a tooltip with no lines to
 * show) leaves the facts alone at the same width.
 */
export function EntityTop({ box, facts }: { box: ReactNode; facts: ReactNode }) {
  if (!box) return facts ? <section aria-label="Quick facts" className="mb-6 min-w-0 sm:max-w-[280px] lg:max-w-[584px]">{facts}</section> : null;
  return (
    <div className="mb-6 grid items-start gap-4 sm:grid-cols-[minmax(0,320px)_minmax(0,280px)] sm:gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,584px)]">
      <div className="min-w-0">{box}</div>
      <section aria-label="Quick facts" className="min-w-0">{facts}</section>
    </div>
  );
}

/**
 * A quick fact's value, or while it is not agreed the agreement meter: empty until an install reports it, then how
 * many of the 3 have (`reported`, a count short of 3), never the value they reported.
 */
export const known = (value: ReactNode, reported = 0) =>
  (value === null || value === undefined || value === "" ? <AgreementMeter count={reported} withText={reported > 0} /> : value);

/**
 * An empty tab: one line. The agreement meter and "Get the addon" for what players report; a plain line
 * (and its own link, if any) for what the game files would give.
 */
export function EmptyTab({ message, players = true, action = GET_THE_ADDON }: { message: string; players?: boolean; action?: { href: string; label: string } | null }) {
  return (
    <p data-empty-state className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-meta text-fg-2">
      {players && <AgreementMeter count={0} />}
      <span>{message}</span>
      {action && <Link href={action.href} className={LINK}>{action.label}</Link>}
    </p>
  );
}

/** What a player-data tab says when storage cannot be read: unrecorded, never zero. */
export function Unreachable() {
  return <p className="py-3 text-meta text-fg-2">{STORAGE_UNREACHABLE}</p>;
}

/** An observed frequency as a percentage with one decimal. */
export const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

/** The header of a frequency column; what a loot window is goes in its tooltip, not in a sentence under the table. */
export const FREQUENCY = <span title="A loot window is a recorded loot, not a verified kill, so a frequency is not a drop chance.">Observed frequency</span>;

/** The shared link style for a name in a table. */
export const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** The zone a UiMap id names, as the zone pages say it; "Map <id>" for one the map does not draw. */
export const zoneName = (mapId: number): string => WORLD_MAP.zones.find((z) => z.uiMapId === mapId)?.name ?? `Map ${mapId}`;

/** A Map cell of a pin table: the zone by name, with the UiMap id in the tooltip for anyone matching it to the game files. */
export const MapName = ({ mapId }: { mapId: number }) => <span title={`UiMap ${mapId}`}>{zoneName(mapId)}</span>;

/** The header of a pin table's link column: the <th> has a name for screen readers and no visible word. */
export const MAP_LINK_HEADER = <span className="sr-only">Map link</span>;

/** A pin table's link to the map. Each one says where it goes (WCAG 2.4.4), since every row's link reads the same. */
export function ShowOnMap({ href, mapId, x, y }: { href: string; mapId: number; x: number; y: number }) {
  return <Link href={href} className={LINK} aria-label={`Show ${zoneName(mapId)} at ${x}, ${y} on the map`}>Show on the map</Link>;
}
