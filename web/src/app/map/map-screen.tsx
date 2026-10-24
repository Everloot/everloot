import type { Metadata } from "next";
import Link from "next/link";
import { preload } from "react-dom";
import JsonLd from "@/components/JsonLd";
import { webApplicationJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { mapBoundsFromRecords } from "../../../../kb/src/map-bounds";
import { allZones } from "../../../../kb/src/world-map-near";
import { zoneToMap } from "../../../../kb/src/world-coords";
import { STORAGE_UNREACHABLE, uploadStore } from "@/lib/upload-store";
import { dataAgeLabel } from "@/lib/data-age";
import {
  categoryCounts, continentPath, parseDeepLink, parseMapUrl, parseViewState, parseZoneLink, visibleItems, type MapItems,
} from "@/lib/map-view";
import { CONTINENTS, continentCandidates, continentMap, continentPinSet, continentTreasureCandidates, observedFacts, WORLD_MAP } from "@/lib/world-map";
import { instanceHref, instanceRows, loadSightings } from "@/lib/instances";
import { publicZones, zoneHref } from "@/lib/zones";
import WorldMapView from "@/components/WorldMapView";
import { LIST_LIMIT } from "@/components/map/MapList";
import { continentArt, instanceThumbs, loadSiteAssets, poiIcons } from "@/lib/game-assets";
import { SiteCredit } from "@/components/Footer";

export const TITLE = "WoW Forever World Map";
export const DESCRIPTION = "Zones, entrances, flight masters and flight paths, and player-observed NPCs on one map of WoW: Forever, from game files. No game art.";
/** The same description when the game's map pictures are shown. */
export const withArt = (text: string) => text.replace(" No game art.", " The map pictures are the game's own.");

export type MapQuery = {
  continent?: string | string[]; zone?: string | string[]; x?: string | string[]; y?: string | string[]; spoilers?: string | string[];
  at?: string | string[]; z?: string | string[]; pin?: string | string[]; show?: string | string[]; q?: string | string[]; view?: string | string[];
};
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const continentName = (id: number) => CONTINENTS.find((c) => c.id === id)?.name ?? `Continent ${id}`;
const continentTitle = (id: number) => `WoW Forever Map: ${continentName(id)}`;
export const continentDescription = (id: number) =>
  `Every zone, dungeon and raid entrance, flight master and flight path in ${continentName(id)}, WoW: Forever, from game files. No game art.`;

/**
 * Where a request lands: the zone or spot a link asks for, and the continent that holds it. A link into a
 * held-back zone with spoilers off stays on the continent asked for (or the page's own) and says why.
 */
export function resolveMap(query: MapQuery, pageContinent: number | null) {
  const spoilers = one(query.spoilers) === "1";
  const { zones: everyZone, held } = allZones(WORLD_MAP);
  // /map?zone=<id>&x=&y= puts a ring on the spot; /map?zone=<id> alone opens that zone fitted to the view.
  const deep = parseDeepLink(query);
  const zoneOnly = parseZoneLink(query);
  const askedZone = deep?.mapId ?? zoneOnly;
  const target = askedZone !== null ? everyZone.find((z) => z.mapId === askedZone) : undefined;
  const hiddenTarget = Boolean(target && held.has(target.mapId) && !spoilers);
  const asked = Number(one(query.continent));
  const fallback = pageContinent ?? (CONTINENTS.some((c) => c.id === asked) ? asked : 0);
  const continentId = target && !hiddenTarget ? target.continentId : fallback;
  return { spoilers, everyZone, deep, zoneOnly, target, hiddenTarget, continentId };
}

/** The query as an address, without the keys given; repeated keys keep their first value. */
export function queryString(query: MapQuery, drop: readonly string[] = []): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    const value = one(v as string | string[] | undefined);
    if (value !== undefined && !drop.includes(k)) q.set(k, value);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * `/map` and both continent pages are indexed only bare. Any parameter (a zone, a pin, a camera, a search)
 * makes a view of the continent page: canonical to it, and not indexed.
 */
export async function mapMetadata(query: MapQuery, pageContinent: number | null): Promise<Metadata> {
  const assets = await loadSiteAssets();
  const art = (text: string) => (assets?.maps.length ? withArt(text) : text);
  const bare = Object.values(query).every((v) => v === undefined);
  const { continentId } = resolveMap(query, pageContinent);
  const meta = pageContinent === null
    ? pageMetadata({ title: TITLE, description: art(DESCRIPTION), path: "/map", image: "/map/opengraph-image" })
    : pageMetadata({ title: continentTitle(pageContinent), description: art(continentDescription(pageContinent)), path: continentPath(pageContinent), image: "/map/opengraph-image" });
  if (bare) return meta;
  return { ...meta, alternates: { ...meta.alternates, canonical: continentPath(continentId) }, robots: { index: false, follow: true } };
}

/** The map screen for `/map` (pageContinent null: the continent comes from the link, else the first) or a continent page. */
export async function renderMapScreen(query: MapQuery, pageContinent: number | null) {
  const { spoilers, everyZone, deep, zoneOnly, target, hiddenTarget, continentId } = resolveMap(query, pageContinent);
  const link = target && !hiddenTarget ? deep : null;
  const zoneId = target && !hiddenTarget && !deep ? target.mapId : null;
  const path = continentPath(continentId);
  const title = pageContinent === null ? TITLE : continentTitle(pageContinent);

  const [corpus, sightings] = await Promise.all([uploadStore.loadCorpus(), loadSightings()]);
  const records = corpus.unreachable ? [] : corpus.records;
  const seen = sightings.unreachable ? {} : sightings;
  const map = continentMap(continentId, mapBoundsFromRecords(records), WORLD_MAP, spoilers);
  const facts = observedFacts(records);
  const all = continentPinSet(continentId, facts, spoilers, WORLD_MAP, seen);
  // Each instance's page, for an entrance card's Open instance page.
  const instancePages = Object.fromEntries([...instanceRows(seen).values()].map((r) => [r.instanceMapId, instanceHref(r.instanceMapId, r.name)]));
  const vb = map.viewBox;
  // The game's own map pictures under the outlines, only when the asset URL is set and the upload has them.
  // A held-back zone's picture follows its outline: none unless spoilers are on.
  const assets = vb ? await loadSiteAssets() : null;
  const art = continentArt(assets, continentId, spoilers);
  // The continent picture is the page's largest paint, but Leaflet asks for it only once the map's script has run.
  // A preload in the page's head starts it with the HTML.
  if (art?.continent) preload(art.continent.url, { as: "image", fetchPriority: "high" });
  const lead = pageContinent === null ? DESCRIPTION : continentDescription(continentId);
  // Each dungeon's and raid's loading screen beside its entrance in the list; a later map's only with spoilers on.
  const allThumbs = instanceThumbs(assets, spoilers);
  // The game's minimap icons for the legend and the pins, where the upload has them.
  const poi = poiIcons(assets);
  const thumbs = Object.fromEntries(map.entrances.flatMap((p) => p.names).filter((n) => allThumbs[n]).map((n) => [n, allThumbs[n]]));
  const thumbShown = Object.keys(thumbs).length > 0;

  // The page carries what its List tab names (zones, entrances, flight masters, the first player points); the
  // flight paths and every point come from /api/map/pins once the map loads, so they are not inlined twice.
  const full: MapItems = { zones: map.zones, ...all };
  const url = parseMapUrl(query);
  const shownPins = visibleItems(full, { ...url.show, npc: true, vendor: true }, spoilers).pins;
  // The instance ids only open a card's instance page, so they come with the pins answer and not the page.
  const entrances = full.entrances.map(({ instanceMapIds: _ids, ...e }) => e);
  const items: MapItems = { ...full, entrances, flightLines: [], pins: shownPins.slice(0, LIST_LIMIT) };
  const focus = zoneId ?? link?.mapId ?? null;
  const scope = focus !== null ? map.zones.find((z) => z.mapId === focus) ?? null : null;
  const zonePages = Object.fromEntries(publicZones().filter((z) => z.continentId === continentId).map((z) => [z.mapId, zoneHref(z.mapId, z.name)]));

  const at = link ? zoneToMap(everyZone, link.mapId, link.x / 100, link.y / 100) : null;
  const marker = link && target && at ? { x: at.x, y: at.y, label: `${target.name} ${link.x}, ${link.y}`, mapId: target.mapId } : null;

  // The spoiler switch keeps the zone or spot; a held-back zone asked for opens on its own continent once shown.
  const switchHref = (() => {
    const q = new URLSearchParams();
    if (deep) { q.set("zone", String(deep.mapId)); q.set("x", String(deep.x)); q.set("y", String(deep.y)); }
    else if (zoneOnly !== null) q.set("zone", String(zoneOnly));
    if (!spoilers) q.set("spoilers", "1");
    const s = q.toString();
    return `${continentPath(target ? target.continentId : continentId)}${s ? `?${s}` : ""}`;
  })();

  const notice = (hiddenTarget && target) || corpus.unreachable ? (
    <>
      {hiddenTarget && target && <p>{target.name} is held back as possibly unreleased. Turn spoilers on to see {deep ? "this spot" : "this zone"}.</p>}
      {corpus.unreachable && <p>{STORAGE_UNREACHABLE} The in-game cross-check and player-observed points are missing; the map itself does not depend on them.</p>}
    </>
  ) : null;

  // The sidebar's foot: the full-screen map has no site footer, so the credit line comes along.
  const meta = (
    <>
      {(map.confirmedZones > 0 || map.disagreements.length > 0) && (
        <p data-cross-check>
          <span className="text-fg-2">In-game cross-check.</span> Where 3 installs agree on a zone&apos;s corners, we compare them with the game files:
          {" "}{map.confirmedZones} zone{map.confirmedZones === 1 ? "" : "s"} match within a yard.
          {map.disagreements.length > 0 && <> These differ, so treat their outlines as unconfirmed: {map.disagreements.map((d) => d.name).join(", ")}.</>}
        </p>
      )}
      {!corpus.unreachable && <p>{dataAgeLabel(corpus.dataAsOf)}</p>}
      <SiteCredit />
      <p><Link href="/docs/guides/find#map" className="text-fg-2 hover:text-accent">How the map works</Link></p>
    </>
  );

  return (
    <article data-map-page>
      <JsonLd data={webApplicationJsonLd({ name: title, path: pageContinent === null ? "/map" : path, description: art ? withArt(lead) : lead })} />
      {vb ? (
        <WorldMapView
          key={`${continentId}-${spoilers}-${link ? `${link.mapId}-${link.x}-${link.y}` : zoneId ?? ""}`}
          title={title}
          name={map.name}
          continentId={continentId}
          continents={CONTINENTS.map((c) => ({ id: c.id, name: c.name }))}
          base={vb}
          items={items}
          pinsUrl={`/api/map/pins?continent=${continentId}${spoilers ? "&spoilers=1" : ""}`}
          seed={{
            counts: categoryCounts(full, spoilers, scope),
            pins: { npc: shownPins.filter((p) => p.kind === "npc").length, vendor: shownPins.filter((p) => p.kind === "vendor").length },
          }}
          candidates={[...continentCandidates(continentId, facts, spoilers), ...continentTreasureCandidates(continentId, seen)]}
          zonePages={zonePages}
          instancePages={instancePages}
          spoilers={spoilers}
          spoilerHref={switchHref}
          art={art}
          thumbs={thumbShown ? thumbs : undefined}
          poi={poi}
          marker={marker}
          zoneId={zoneId}
          view={parseViewState(query)}
          url={url}
          notice={notice}
          meta={meta}
        />
      ) : (
        <div className="space-y-3">
          <h1 className="text-title-sm text-fg sm:text-title">{title}</h1>
          {notice && <div className="text-sm text-warning">{notice}</div>}
          <p className="w-full max-w-wide rounded-card border border-line bg-panel p-5 text-sm text-fg-2">Nothing is placed on this continent yet.</p>
        </div>
      )}
    </article>
  );
}
