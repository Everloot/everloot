import type { ReactNode } from "react";
import Link from "next/link";
import EdgeDegraded from "@/components/EdgeDegraded";
import JsonLd from "@/components/JsonLd";
import { AgreementMeter, Container, DataTable, Facts, GET_THE_ADDON, InShort, OpenData, QUALITY_TEXT, type Column, type Fact, type Quality } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import type { ModelPicture as ModelPictureFile } from "@/lib/game-renders";
import { breadcrumbJsonLd, entityPageJsonLd, type Crumb } from "@/lib/jsonld";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { pinLink, WORLD_MAP } from "@/lib/world-map";

// The layout every database entity page shares (item, NPC, object, quest, spell, vendor, achievement, faction, title,
// quest chain, zone and instance), read like an item database: a compact title with its type line, the tooltip box
// and the quick facts side by side, then full-width tabs of dense tables. Stacked on a phone. No breadcrumb on
// screen: the trail is only the BreadcrumbList JSON-LD.

/**
 * The page title of every database detail page: an optional icon, the name (in its quality colour for items) and
 * one 13 px type line ("Trade Goods · Cloth · ID 2589"). The trail feeds the BreadcrumbList JSON-LD only; the layout
 * already emits it for routes lib/breadcrumbs.ts knows, so it is emitted here only for the others. `aside` is one
 * quiet control at the row's end (a zone's "Open on the map"), under the title on a phone.
 */
export function EntityHeader({ trail, title, quality, icon, meta = [], aside }: {
  trail: Crumb[]; title: ReactNode; quality?: Quality; icon?: ReactNode; meta?: ReactNode[]; aside?: ReactNode;
}) {
  const page = trail[trail.length - 1];
  const emitJsonLd = trail.length > 1 && page && !trailFor(page.path);
  const parts = meta.filter((m) => m !== null && m !== undefined && m !== false && m !== "");
  return (
    <header data-slot="header" data-page-header data-entity-header className={`mb-4 flex min-w-0 items-center gap-3 ${aside ? "flex-wrap" : ""}`.trim()}>
      {emitJsonLd && <JsonLd data={breadcrumbJsonLd(trail)} />}
      {icon}
      <div className={aside ? "min-w-0 flex-[1_1_16rem]" : "min-w-0"}>
        <h1 className={`text-title-sm [overflow-wrap:anywhere] sm:text-title ${quality ? QUALITY_TEXT[quality] : "text-fg"}`}>{title}</h1>
        {parts.length > 0 && (
          <p data-entity-meta className="text-meta text-muted">
            {parts.map((part, i) => <span key={i}>{i > 0 && <span aria-hidden="true"> · </span>}{part}</span>)}
          </p>
        )}
      </div>
      {aside && <div className="min-w-0 max-sm:w-full">{aside}</div>}
    </header>
  );
}

/**
 * The top band: the tooltip box (or a map thumbnail) at left, the quick facts beside it (two 280 px columns
 * of them on a wide screen, so the band stays short); stacked on a phone. No box (a tooltip with no lines to
 * show) leaves the facts alone at the same width.
 */
export function EntityTop({ box, facts, railMap = false }: { box: ReactNode; facts: ReactNode; railMap?: boolean }) {
  if (!box) return facts ? <section data-slot="top" aria-label="Quick facts" className="entity-facts mb-6 min-w-0 sm:max-w-[280px] lg:max-w-[584px]">{facts}</section> : null;
  return (
    <div data-slot="top" className={`${railMap ? "entity-top-map " : ""}entity-top mb-6 grid items-start gap-4 sm:grid-cols-[minmax(0,320px)_minmax(0,280px)] sm:gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,584px)]`}>
      <div className="entity-box min-w-0">{box}</div>
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
export function EmptyTab({ message, reported = 0, players = true, action = GET_THE_ADDON }: { message: string; reported?: number; players?: boolean; action?: { href: string; label: string } | null }) {
  return (
    <p data-empty-state className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-meta text-fg-2">
      {players && <AgreementMeter count={reported} />}
      <span>{message}</span>
      {action && <Link href={action.href} className={LINK}>{action.label}</Link>}
    </p>
  );
}

/**
 * What an empty tab says on every entity page: what is missing, then the 3-install rule that would fill it (or, for
 * what only the game files could give, that they give nothing), so no tab stops at "yet." without saying why. One
 * table, shown through EmptyTab, so the pages word it alike.
 */
export const EMPTY = {
  position: "No agreed position yet. A pin needs 3 installs at the same spot.",
  goods: "No agreed goods yet. An item shows once 3 installs agree on it and its price in copper.",
  rewards: "No agreed rewards yet. A reward shows once 3 installs report it.",
  givers: "No agreed giver or turn-in yet. Each shows once 3 installs report it.",
  quests: "No agreed quest yet. A quest needs its giver or turn-in from 3 installs.",
  /** `what` is "this NPC", "this object", or "this" for an item's sources. */
  drops: (what: string) => `Nobody has looted ${what} in Forever yet. Rates show from one install, with reported, verified or confirmed labels.`,
  queued: "Observed, not yet public: fewer than 3 installs so far.",
  // Zone lists: what players place in a zone.
  zoneNpcs: "No agreed NPC position here yet. A pin needs 3 installs at the same spot.",
  zoneVendors: "No vendor here has prices 3 installs agree on yet.",
  zoneQuests: "No agreed giver or turn-in here yet. Each shows once 3 installs report it.",
  zoneItems: "No item has an agreed drop from a confirmed NPC or object here yet. A rate needs loot windows from 3 installs.",
  zoneTreasures: "No agreed treasure position here yet. A pin needs 3 installs at the same spot.",
  // Instance tabs.
  bosses: "No boss has 3 installs reporting it here yet, and the game files list none.",
  bossLoot: "No loot to show yet: no boss is known here. Loot shows per boss once 3 installs report the boss and the creature they fought.",
  /** `reported` is the installs that zoned in so far. */
  entrance: (reported: number) => (reported > 0
    ? `No entrance is confirmed yet. ${reported} ${reported === 1 ? "install has" : "installs have"} zoned in, and 3 installs must agree on the place.`
    : "No entrance is confirmed yet: no install has reported zoning in. An entrance is confirmed once 3 installs zone in from the same place."),
  /** `name` is the instance's name in the quest log; null when it has none. */
  instanceQuests: (name: string | null) => (name === null
    ? "Not reported yet: this instance has no name to match the quest log by."
    : `Not reported yet: no quest has 3 installs filing it under ${name} in the quest log.`),
  // Relations only the game files could fill: a plain line with no meter (EmptyTab players={false}).
  /** `build` is the client build that was read. */
  files: (build: string) => `The game files list nothing here (build ${build}).`,
  criteria: "The criteria show once three installs report the same full list.",
  factionQuests: "No quest is linked to this faction yet. A quest shows once 3 installs report it, and the reputation it gives is in none of the game files read so far.",
  titleRewards: "No achievement is linked to this title yet. The game files read so far name no title rewards; an achievement shows once 3 installs report it.",
} as const;

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

/** A position 3 installs agree on: the UiMap and the point on it, with how many installs reported it. */
export interface Pin { mapId: number; x: number; y: number; reporters: number }

/**
 * The one pin table of the entity pages: where an NPC, a vendor or an object stands, where the NPCs an item drops
 * from stand. The zone by name, the position, the installs that agree and the link to the map, in that order on
 * every page; `lead` puts a page's own columns before them (the item page's NPC). A pin on a map the world map
 * does not draw keeps its row and has no link.
 */
export function PinTable<P extends Pin>({ caption, rows, rowKey, lead = [] }: { caption: string; rows: P[]; rowKey: (pin: P) => string; lead?: Column<P>[] }) {
  const columns: Column<P>[] = [
    ...lead,
    { key: "map", header: "Map", cell: (p) => <MapName mapId={p.mapId} /> },
    { key: "at", header: "Position", numeric: true, cell: (p) => `${p.x}, ${p.y}` },
    { key: "installs", header: "Installs", numeric: true, cell: (p) => p.reporters },
    { key: "show", header: MAP_LINK_HEADER, cell: (p) => { const href = pinLink(p.mapId, p.x, p.y); return href ? <ShowOnMap href={href} mapId={p.mapId} x={p.x} y={p.y} /> : null; } },
  ];
  return <DataTable dense caption={caption} columns={columns} rows={rows} rowKey={rowKey} />;
}

/**
 * An item's or NPC's model picture (docs/ASSETS.md, "Model pictures"), first in the side column: the rail on a wide
 * screen, under the quick facts on a phone. Nothing without one, no empty box. The credit is the site footer's, as for
 * the icons.
 */
export function ModelPicture({ picture, name }: { picture: ModelPictureFile | null | undefined; name: string }) {
  if (!picture) return null;
  return (
    <div data-model-picture className="w-full sm:max-w-tip">
      {/* The picture from the asset bucket as it is; next/image would only proxy it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={picture.url} alt={`Model of ${name}`} width={picture.size} height={picture.size} loading="lazy" decoding="async" className="block aspect-square h-auto w-full rounded-control border border-line bg-panel object-contain" />
    </div>
  );
}

/**
 * The top band's picture for a page with no tooltip of its own (an instance's loading screen): the game's art as it
 * is, at the tooltip box's width, cropped to 16:9 like the wiki's dungeon pages. The page passes it only when the
 * upload has the art, so there is never an empty frame.
 */
export function EntityArt({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  return (
    <figure data-entity-art className="w-full sm:max-w-tip">
      {/* The picture from the asset bucket as it is; next/image would only proxy it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} width={width} height={height} decoding="async" className="block aspect-video h-auto w-full rounded-control border border-line bg-panel object-cover" />
    </figure>
  );
}

/** A CSS-only wide rail; its tracks exist on the first server render. */
export function EntityLayout({ children }: { children: ReactNode }) {
  return <article className="entity-layout xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-x-8">{children}</article>;
}

/** Existing page blocks keep their DOM order below xl, without duplicate maps or links. */
export function EntitySidebar({ children }: { children: ReactNode }) {
  return <div data-slot="side" data-entity-sidebar className="entity-sidebar contents xl:block xl:min-w-0 xl:[overflow-wrap:anywhere]">{children}</div>;
}

/**
 * The slots of an entity page, in the order every page renders them (each one a `data-slot`). `side` holds `media`
 * then `summary`: the xl rail, inline under the top band below xl. A slot with nothing in it renders nothing.
 */
export const ENTITY_SLOTS = ["header", "top", "notices", "side", "media", "summary", "main", "related", "map", "changes", "screenshots", "comments", "footer"] as const;

/**
 * The one template every database entity page fills, so they all read alike: the header (icon, name, type line), the
 * top band (tooltip box or art, and the quick facts), any notices about them, the side column (a model picture or map,
 * then In short), the main tabs, related (lore, more sections), map, changes, screenshots, comments, and last the
 * open-data row with its Report wrong data link and any credit line. Pages pass what they have; they never reorder.
 */
export function EntityPage({
  name, degraded, jsonLd, header, box, railMap, facts, notices, media, summary, main, related, map, changes, screenshots, comments, openData, credit,
}: {
  /** The plain name, for the quick facts' label. */
  name: string;
  /** Marks the render for the short edge cache when a read failed (EdgeDegraded). */
  degraded?: boolean;
  jsonLd?: Parameters<typeof entityPageJsonLd>[0] | null;
  header: Parameters<typeof EntityHeader>[0];
  box?: ReactNode;
  railMap?: boolean;
  facts?: Fact[] | null | false;
  notices?: ReactNode;
  media?: ReactNode;
  /** The In short lines. */
  summary?: readonly string[];
  main?: ReactNode;
  related?: ReactNode;
  map?: ReactNode;
  /** This entity's changes across builds: a later lane fills it. */
  changes?: ReactNode;
  screenshots?: ReactNode;
  comments?: ReactNode;
  openData?: Parameters<typeof OpenData>[0] | null | false;
  credit?: ReactNode;
}) {
  const inShort = summary && summary.length > 0;
  return (
    <Container width="data">
      {degraded !== undefined && <EdgeDegraded when={degraded} />}
      {jsonLd && <JsonLd data={entityPageJsonLd(jsonLd)} />}
      <EntityLayout>
        <EntityHeader {...header} />
        <EntityTop box={box} railMap={railMap} facts={facts && <Facts layout="list" label={`${name}: quick facts`} items={facts} />} />
        {notices && <div data-slot="notices">{notices}</div>}
        {(media || inShort) && (
          <EntitySidebar>
            {media && <div data-slot="media">{media}</div>}
            {inShort && <div data-slot="summary"><InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} /></div>}
          </EntitySidebar>
        )}
        {main && <div data-slot="main" className="mt-6">{main}</div>}
        {related && <div data-slot="related" className="mt-6 space-y-6 empty:hidden">{related}</div>}
        {map && <div data-slot="map">{map}</div>}
        {changes && <div data-slot="changes">{changes}</div>}
        {screenshots && <div data-slot="screenshots">{screenshots}</div>}
        {comments && <div data-slot="comments">{comments}</div>}
        {(openData || credit) && (
          // flow-root: OpenData's own top margin adds to this one in the grid and in the flow alike.
          <div data-slot="footer" className="mt-3 flow-root">
            {openData && <OpenData {...openData} />}
            {credit}
          </div>
        )}
      </EntityLayout>
    </Container>
  );
}
