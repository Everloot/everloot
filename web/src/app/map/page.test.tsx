import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { edgeDegraded } from "@/lib/cf-edge-cache";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
const world = vi.hoisted(() => ({ empty: false }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("@/lib/world-map", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/world-map")>();
  return {
    ...real,
    continentMap: (...args: Parameters<typeof real.continentMap>) =>
      world.empty ? { ...real.continentMap(...args), viewBox: null, zones: [], entrances: [] } : real.continentMap(...args),
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, className, "aria-current": current }: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) => (
    <a href={href} className={className} aria-current={current}>{children}</a>
  ),
}));
// A redirect ends the render with where it goes, as Next's own does.
vi.mock("next/navigation", () => ({
  permanentRedirect: (to: string) => { throw new Error(`308 ${to}`); },
  redirect: (to: string) => { throw new Error(`307 ${to}`); },
  notFound: () => { throw new Error("404"); },
}));
// What the page hands the map view is what lands in the page's HTML (the props travel with it), so a test can weigh it.
const handed = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("@/components/WorldMapView", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/WorldMapView")>();
  return { default: (props: Parameters<typeof real.default>[0]) => { handed.props = props as never; return real.default(props); } };
});

import MapPage, { generateMetadata as mapMeta } from "./page";
import ContinentMapPage, { generateMetadata as continentMeta } from "./[continent]/page";
import { WORLD_MAP } from "@/lib/world-map";
import { CATEGORY_GROUPS, type MapItems } from "@/lib/map-view";

const renderWith = async (query: Record<string, string>) => renderToStaticMarkup(await MapPage({ searchParams: Promise.resolve(query) }));
const renderContinent = async (slug: string, query: Record<string, string> = {}) =>
  renderToStaticMarkup(await ContinentMapPage({ params: Promise.resolve({ continent: slug }), searchParams: Promise.resolve(query) }));
const SLUGS: Record<string, string> = { "0": "eastern-kingdoms", "1": "kalimdor" };
const render = async (continent?: string) => (continent ? renderContinent(SLUGS[continent]!) : renderWith({}));
/** Where a page sent the request, or null when it rendered. */
const sentTo = async (page: () => Promise<unknown>) => { try { await page(); return null; } catch (e) { return (e as Error).message; } };

const elwynn = WORLD_MAP.zones.find((z) => z.uiMapId === 1429)!.bounds;
const report = (installId: string, right: number) => ({
  kind: "map_bounds", installId, capturedAt: "2026-10-17T00:00:00Z", mapId: 1429, continentId: 0,
  left: elwynn.left, top: elwynn.top, right, bottom: elwynn.bottom,
});

beforeEach(() => {
  store.loadCorpus.mockReset();
  world.empty = false;
});

test("with no reports the whole map still shows, from the game files", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-17T00:00:00.000Z" });
  const html = await render();
  expect(html).toContain("Stormwind Stockade");
  expect(html).toContain("Elwynn Forest");
  expect(html).toContain("Dungeon and raid entrances");
  expect(html).toContain("Flight masters");
  expect(html).toContain("Stormwind, Elwynn");
  expect(html).not.toContain("In-game cross-check");
  expect(html).not.toContain("Storage unreachable");
  expect(edgeDegraded(html)).toBe(false);
  // Every category in its group, each with its count on the continent.
  for (const c of CATEGORY_GROUPS.flatMap((g) => g.categories)) expect(html).toContain(`>${c.label}</span>`);
  for (const g of CATEGORY_GROUPS) expect(html).toContain(`<legend class="mb-0.5 text-sm font-medium text-fg">${g.label}</legend>`);
  // A count says what the List tab lists: the flight masters' count is the rows under that heading.
  const count = (name: string) => Number(html.match(new RegExp(`>${name}</span><span data-count[^>]*><span class="sr-only">, </span>(\\d+)<`))?.[1]);
  const section = (id: string) => html.slice(html.indexOf(`id="${id}"`), html.indexOf("</section>", html.indexOf(`id="${id}"`)));
  const rows = (id: string) => section(id).split("<li").length - 1;
  expect(count("Flight masters")).toBeGreaterThan(0);
  expect(count("Flight masters")).toBe(rows("map-list-flights"));
  expect(count("Dungeon entrances") + count("Raid entrances")).toBe(rows("map-list-entrances"));
  expect(count("Raid entrances")).toBeGreaterThan(0);
  expect(count("Zones")).toBe(rows("map-list-zones"));
  // The flight paths are not in the page, but their count is.
  expect(count("Flight paths")).toBeGreaterThan(0);
  // Nothing gathers or trains yet: those rows say what fills them, rather than hiding.
  for (const name of ["Herbs", "Ore", "Chests and treasure", "Trainers", "Quest givers"]) expect(count(name), name).toBe(0);
  expect(html.match(/waiting for player uploads/g)?.length).toBe(8);
});

test("the map fills the screen: one shell with a sidebar, a rail, a phone bar and the List tab, and no ad", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const html = await render();
  expect(html).toContain("data-map-shell");
  expect(html).toMatch(/<h1[^>]*>WoW Forever World Map<\/h1>/);
  expect(html).toContain('id="map-panel"');
  expect(html).toContain("data-map-rail");
  expect(html).toContain("data-map-bar");
  // Categories first; the List tab is in the page too, hidden until chosen, so the page reads without JavaScript.
  expect(html).toMatch(/data-map-categories="true"(?! hidden)/);
  expect(html).toMatch(/<div hidden="" data-map-list="true">|<div data-map-list="true" hidden="">/);
  expect(html).toContain("Search the map");
  expect(html).toContain("Show all");
  expect(html).toContain("Hide all");
  expect(html).not.toMatch(/data-ad-slot|adsbygoogle/);
});

test("the continent tabs link both continent pages, the current one marked, keeping spoilers and the sidebar", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const html = await renderContinent("kalimdor", { spoilers: "1" });
  expect(html).toMatch(/href="\/map\/kalimdor\?spoilers=1" class="[^"]*" aria-current="page">Kalimdor</);
  expect(html).toMatch(/href="\/map\/eastern-kingdoms\?spoilers=1" class="[^"]*">Eastern Kingdoms</);
  const listed = await renderContinent("kalimdor", { show: "flight,zone", view: "list" });
  expect(listed).toMatch(/href="\/map\/eastern-kingdoms\?show=flight%2Czone&amp;view=list"/);
  // The address's sidebar state is the page's: the List tab open, only those categories on.
  expect(listed).toMatch(/<div data-map-list="true">|<div data-map-list="true"(?! hidden)/);
  const label = (name: string) => listed.split("<label").find((l) => l.includes(`>${name}</span>`))!;
  expect(label("Flight masters")).toContain('checked=""');
  expect(label("Flight paths")).not.toContain('checked=""');
});

test("old ?continent= links go to the continent's page with the rest of their address", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  expect(await sentTo(() => renderWith({ continent: "1" }))).toBe("308 /map/kalimdor");
  expect(await sentTo(() => renderWith({ continent: "0", spoilers: "1" }))).toBe("308 /map/eastern-kingdoms?spoilers=1");
  // An unknown continent opened the first; a zone link opens its own zone's continent, whatever continent said.
  expect(await sentTo(() => renderWith({ continent: "7" }))).toBe("308 /map/eastern-kingdoms");
  expect(await sentTo(() => renderWith({ continent: "0", zone: "1411", x: "50", y: "50" }))).toBe("308 /map/kalimdor?zone=1411&x=50&y=50");
  // A continent page with ?continent= drops it; a zone of the other continent goes to that one's page.
  expect(await sentTo(() => renderContinent("kalimdor", { continent: "1" }))).toBe("307 /map/kalimdor");
  expect(await sentTo(() => renderContinent("eastern-kingdoms", { zone: "1411" }))).toBe("307 /map/kalimdor?zone=1411");
  expect(await sentTo(() => renderContinent("outland"))).toBe("404");
  // A held-back zone with spoilers off stays where it was asked for, and says why (below).
  expect(await sentTo(() => renderContinent("eastern-kingdoms", { zone: "2482" }))).toBeNull();
  // Every link that opened a page before still opens one.
  const links: Record<string, string>[] = [{}, { zone: "1411" }, { zone: "1429", x: "40", y: "60" }, { at: "-512,1830", z: "1.5" }, { pin: "f12" }, { spoilers: "1" }];
  for (const q of links) {
    expect(await sentTo(() => renderWith(q)), JSON.stringify(q)).toBeNull();
  }
});

test("the bare pages are indexed; any other address is a view of its continent page, not indexed", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const map = await mapMeta({ searchParams: Promise.resolve({}) });
  expect(map.alternates?.canonical).toBe("/map");
  expect(map.robots).toBeUndefined();
  for (const slug of ["eastern-kingdoms", "kalimdor"]) {
    const bare = await continentMeta({ params: Promise.resolve({ continent: slug }), searchParams: Promise.resolve({}) });
    expect(bare.alternates?.canonical).toBe(`/map/${slug}`);
    expect(bare.robots).toBeUndefined();
    const view = await continentMeta({ params: Promise.resolve({ continent: slug }), searchParams: Promise.resolve({ pin: "f1", show: "flight" }) });
    expect(view.alternates?.canonical).toBe(`/map/${slug}`);
    expect(view.robots).toEqual({ index: false, follow: true });
  }
  const zone = await mapMeta({ searchParams: Promise.resolve({ zone: "1411" }) });
  expect(zone.alternates?.canonical).toBe("/map/kalimdor");
  expect(zone.robots).toEqual({ index: false, follow: true });
});

test("a continent page lists its zones, entrances and flight masters in the page itself, under its own title", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const html = await renderContinent("kalimdor");
  expect(html).toMatch(/<h1[^>]*>WoW Forever Map: Kalimdor<\/h1>/);
  for (const name of ["Durotar", "Ragefire Chasm", "Orgrimmar, Durotar"]) expect(html).toContain(name);
  expect(html).not.toContain("Elwynn Forest");
  expect(html).toContain('"@type":"WebApplication"');
});

test("the page carries no flight paths and at most 100 player points: the map fetches them from the pins route", async () => {
  const many = Array.from({ length: 150 }, (_, i) => sightings(1000 + i, 1429, 10 + (i % 80), 20, `Guard ${i}`)).flat();
  store.loadCorpus.mockResolvedValue({ uploads: 3, records: many });
  await renderContinent("eastern-kingdoms");
  const props = handed.props as { items: MapItems; pinsUrl: string; seed: { pins: { npc: number; vendor: number } } };
  expect(props.pinsUrl).toBe("/api/map/pins?continent=0");
  expect(props.items.flightLines).toEqual([]);
  expect(props.items.pins).toHaveLength(100);
  expect(props.seed.pins).toEqual({ npc: 150, vendor: 0 });
  // The List tab still says how many more there are.
  const html = await renderContinent("eastern-kingdoms");
  expect(html).toContain("and 50 more on the map.");
  // What the page hands the map weighs far less than the whole set it used to inline.
  const { GET } = await import("@/app/api/map/pins/route");
  const full = await (await GET(new Request("https://everloot.app/api/map/pins?continent=0"))).text();
  expect(JSON.stringify(props.items).length).toBeLessThan(full.length / 2);
  await renderContinent("eastern-kingdoms", { spoilers: "1" });
  expect((handed.props as { pinsUrl: string }).pinsUrl).toBe("/api/map/pins?continent=0&spoilers=1");
});

test("unreadable storage says so, keeps the map, and shows no data age", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const html = await render("1");
  expect(html).toContain("Storage unreachable");
  // Marked for the edge cache, so this render is kept a minute rather than the page's hour.
  expect(edgeDegraded(html)).toBe(true);
  expect(html).toContain("Kalimdor");
  expect(html).toContain("Ragefire Chasm");
  expect(html).toContain("Durotar");
  expect(html).not.toContain("Data as of");
});

test("/map alone opens Eastern Kingdoms", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  expect(await render()).toMatch(/href="\/map\/eastern-kingdoms" class="[^"]*" aria-current="page">Eastern Kingdoms</);
});

test("a continent with nothing placed says so and draws no map or legend", async () => {
  world.empty = true;
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const html = await render();
  expect(html).toContain("Nothing is placed on this continent yet.");
  expect(html).toMatch(/<h1[^>]*>WoW Forever World Map<\/h1>/);
  expect(html).not.toContain("Search the map");
  expect(html).not.toContain("data-map-shell");
});

test("the map has no footer, so its sidebar carries the site's one credit line, the data age and the guide", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-17T00:00:00.000Z" });
  const html = await render();
  const meta = html.slice(html.indexOf("data-map-meta"));
  expect(meta).toContain("data-site-credit");
  expect(meta).toContain('href="/methodology#credits"');
  expect(meta).toContain("Data as of");
  expect(meta).toContain('href="/docs/guides/find#map"');
  // No credit block of its own, and no third-party project.
  expect(html).not.toMatch(/Map data read from the WoW: Forever game files, build/);
  expect(html).not.toContain("data-game-credit");
  expect(html).not.toMatch(/OpenMap|warcraft\.wiki|creativecommons/);
});

test("a held-back zone or unreachable storage is said over the map, where a phone sees it too", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const html = await renderWith({ zone: "2482" });
  const notice = html.slice(html.indexOf("data-map-notice"));
  expect(notice).toContain("is held back as possibly unreleased");
  expect(notice).toContain("Storage unreachable");
});

test("agreeing installs that differ from the files are named; matching ones are counted", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, records: ["a", "b", "c"].map((i) => report(i, elwynn.right + 300)) });
  const differs = await render();
  expect(differs).toContain("In-game cross-check");
  expect(differs).toContain("treat their outlines as unconfirmed: Elwynn Forest");
  store.loadCorpus.mockResolvedValue({ uploads: 3, records: ["a", "b", "c"].map((i) => report(i, elwynn.right)) });
  const matches = await render();
  expect(matches).toContain("1 zone match within a yard");
  expect(matches).not.toContain("treat their outlines");
});

const sightings = (npcId: number, mapId: number, x: number, y: number, name: string) =>
  ["a", "b", "c"].map((installId) => ({
    kind: "npc_sighting", installId, npcId, name, mapId, x, y, level: 5, reaction: "friendly", positionKind: "npc", capturedAt: "2026-10-17T00:00:00Z",
  }));

test("spoilers are off by default: held-back zones are named nowhere in the page", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  for (const continent of ["0", "1"]) {
    const html = await render(continent);
    expect(html).toContain("Show spoilers");
    expect(html).not.toMatch(/Mount Hyjal|Riverglades|Shen&#x27;dralas|Shen'dralas/);
    expect(html).toContain("Flight masters");
  }
});

test("with spoilers on, held-back zones show with the unconfirmed label, and the switch turns them off", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const html = await renderContinent("kalimdor", { spoilers: "1" });
  expect(html).toContain("Mount Hyjal");
  expect(html).toContain("found in game files, unconfirmed");
  expect(html).toContain('href="/map/kalimdor"');
  expect(html).toContain("Hide spoilers");
});

test("player-observed points show only with 3 agreeing installs, and a pin in a held-back zone needs spoilers", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 3,
    records: [...sightings(7, 1429, 40, 60, "Guard Marlow"), ...sightings(8, 2482, 50, 50, "Hyjal Warden"),
      ...["a", "b"].map((i) => ({ ...sightings(9, 1429, 10, 10, "Two Installs")[0], installId: i }))],
  });
  const plain = await render();
  expect(plain).not.toContain("Hyjal Warden");
  const kalimdor = await renderContinent("kalimdor");
  expect(kalimdor).not.toContain("Hyjal Warden");
  expect(plain).toContain("Guard Marlow");
  expect(plain).toContain('href="/database/npcs/7"');
  expect(plain).not.toContain("Two Installs");
  expect(await renderContinent("kalimdor", { spoilers: "1" })).toContain("Hyjal Warden");
  // Two installs are a count in the sidebar, never a point: the NPC's name and spot stay out of the page.
  expect(plain).toMatch(/data-category-note="true"[^>]*>1 more seen by 1 or 2 installs</);
  await render();
  expect((handed.props as { candidates: unknown }).candidates).toEqual([{ category: "npc", mapId: 1429, count: 1 }]);
});

test("a deep link opens the continent of its zone with a marker on the spot", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const html = await renderWith({ zone: "1411", x: "50", y: "50" });
  expect(html).toContain("Kalimdor");
  // The ring and its label are drawn in the browser; the sidebar names the zone in view.
  expect(html).toMatch(/data-map-zone[^>]*><p[^>]*>Durotar</);
  expect(html).toContain("All of Kalimdor");
});

test("a zone link without a spot opens that zone fitted to the view, on its continent", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const html = await renderWith({ zone: "1411" });
  expect(html).toContain("Kalimdor");
  expect(html).toMatch(/data-map-zone[^>]*><p[^>]*>Durotar</);
  // The zone link survives the spoiler switch, and there is no ring (that is for a spot).
  expect(html).toContain("zone=1411");
  expect(html).toContain("Show spoilers");
  const eastern = await renderWith({ zone: "1429" });
  expect(eastern).toMatch(/data-map-zone[^>]*><p[^>]*>Elwynn Forest</);
  expect(eastern).toContain("Eastern Kingdoms");
});

test("a zone link into a held-back zone says so without naming the view, until spoilers are on", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const off = await renderWith({ zone: "2482" });
  expect(off).toContain("is held back as possibly unreleased. Turn spoilers on to see this zone.");
  expect(off).not.toMatch(/data-map-zone[^>]*><p[^>]*>Mount Hyjal/);
  const on = await renderWith({ zone: "2482", spoilers: "1" });
  expect(on).toMatch(/data-map-zone[^>]*><p[^>]*>Mount Hyjal/);
});

test("a spot link with a zone id still puts the spot first: the pin link keeps working next to the zone link", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const html = await renderWith({ zone: "1429", x: "40", y: "60" });
  expect(html).toContain("zone=1429&amp;x=40&amp;y=60");
});

test("a deep link into a held-back zone says so without drawing it, until spoilers are on", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const off = await renderWith({ zone: "2482", x: "50", y: "50" });
  expect(off).toContain("is held back as possibly unreleased");
  expect(off).not.toContain("Mount Hyjal 50, 50");
  const on = await renderWith({ zone: "2482", x: "50", y: "50", spoilers: "1" });
  expect(on).toMatch(/data-map-zone[^>]*><p[^>]*>Mount Hyjal/);
  expect(on).toContain("zone=2482");
});

test("a broken deep link opens the plain map", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const html = await renderWith({ zone: "abc", x: "50", y: "50" });
  expect(html).toContain("Eastern Kingdoms");
  expect(html).not.toMatch(/data-map-zone[^>]*><p[^>]*>Durotar/);
});

test("a spot out of range keeps the zone but drops the spot", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [] });
  const html = await renderWith({ zone: "1411", x: "500", y: "50" });
  expect(html).toMatch(/data-map-zone[^>]*><p[^>]*>Durotar/);
  expect(html).not.toContain("x=500");
});