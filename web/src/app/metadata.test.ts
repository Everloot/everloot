import { expect, test, vi } from "vitest";
import type { Metadata } from "next";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "@/lib/seo";
import { TALENT_CLASSES } from "@/lib/talents/catalogs";

// Some pages open the upload store or the knowledge release only when they render, never on import.
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, permanentRedirect: () => {}, usePathname: () => "/" }));

/** Every docs page without a dynamic segment, so a new one is checked without being listed. Only /docs leads with "WoW Forever". */
const docsRoutes = Object.entries(import.meta.glob<{ metadata: Metadata }>("./docs/**/page.tsx"))
  .filter(([file]) => !file.includes("["))
  .map(([file, load]): [string, () => Promise<{ metadata: Metadata }>, boolean] => {
    const path = file.slice(1).replace(/\/page\.tsx$/, "");
    return [path, load, path === "/docs"];
  });

/** Every static route that exports `metadata`, with whether its title must lead with "WoW Forever". */
const routes: [string, () => Promise<{ metadata: Metadata }>, boolean][] = [
  ...docsRoutes,
  ["/about", () => import("./about/page"), false],
  ["/addon", () => import("./addon/page"), true],
  ["/addons", () => import("./addons/page"), true],
  ["/addons/polestar", () => import("./addons/polestar/page"), false],
  ["/addons/polestar/packs", () => import("./addons/polestar/packs/page"), true],
  ["/addons/polestar/wanted", () => import("./addons/polestar/wanted/page"), true],
  ["/addons/ecosystem", () => import("./addons/ecosystem/page"), true],
  ["/addons/popular", () => import("./addons/popular/page"), true],
  ["/census", () => import("./census/page"), true],
  ["/changes", () => import("./changes/page"), true],
  ["/accessibility", () => import("./accessibility/page"), false],
  ["/contact", () => import("./contact/page"), false],
  ["/database", () => import("./database/page"), true],
  // The lists are generated: a filtered or sorted view is noindex. Their plain URL is checked here.
  ["/database/drops", async () => ({ metadata: await (await import("./database/drops/page")).generateMetadata({}) }), true],
  ["/database/factions", async () => ({ metadata: await (await import("./database/factions/page")).generateMetadata({}) }), true],
  ["/database/items", async () => ({ metadata: await (await import("./database/items/page")).generateMetadata({}) }), true],
  ["/database/npcs", async () => ({ metadata: await (await import("./database/npcs/page")).generateMetadata({}) }), true],
  ["/database/objects", async () => ({ metadata: await (await import("./database/objects/page")).generateMetadata({}) }), true],
  ["/database/quest-chains", async () => ({ metadata: await (await import("./database/quest-chains/page")).generateMetadata({}) }), true],
  ["/database/quests", async () => ({ metadata: await (await import("./database/quests/page")).generateMetadata({}) }), true],
  ["/database/titles", async () => ({ metadata: await (await import("./database/titles/page")).generateMetadata({}) }), true],
  ["/database/vendors", async () => ({ metadata: await (await import("./database/vendors/page")).generateMetadata({}) }), true],
  // A filtered list of guides is noindex; the plain list is checked here.
  ["/guides", async () => ({ metadata: await (await import("./guides/page")).generateMetadata({ searchParams: Promise.resolve({}) }) }), true],
  ["/lore", () => import("./lore/page"), false],
  ["/lore/coverage", async () => ({ metadata: await (await import("./lore/coverage/page")).generateMetadata() }), false],
  // The map's description depends on whether the game's map pictures are on, so it is generated.
  ["/map", async () => ({ metadata: await (await import("./map/page")).generateMetadata({ searchParams: Promise.resolve({}) }) }), true],
  ...(["eastern-kingdoms", "kalimdor"] as const).map((slug): [string, () => Promise<{ metadata: Metadata }>, boolean] => [
    `/map/${slug}`,
    async () => ({ metadata: await (await import("./map/[continent]/page")).generateMetadata({ params: Promise.resolve({ continent: slug }), searchParams: Promise.resolve({}) }) }),
    true,
  ]),
  ["/methodology", () => import("./methodology/page"), true],
  ["/players", async () => ({ metadata: await (await import("./players/page")).generateMetadata({ searchParams: Promise.resolve({}) }) }), false],
  ["/privacy", () => import("./privacy/page"), false],
  ["/search", () => import("./search/page"), false],
  ["/security", () => import("./security/page"), false],
  ["/terms", () => import("./terms/page"), false],
  ["/tools/auctions", () => import("./tools/auctions/page"), true],
  ["/tools/collections", () => import("./tools/collections/page"), true],
  ["/tools/farming-routes", async () => ({ metadata: await (await import("./tools/farming-routes/page")).generateMetadata({}) }), true],
  ["/tools/gold-ledger", () => import("./tools/gold-ledger/page"), true],
  ["/tools/guild-board", () => import("./tools/guild-board/page"), true],
  ["/tools/professions", () => import("./tools/professions/page"), true],
  ["/tools/raid", () => import("./tools/raid/page"), true],
  ["/tools/talents", () => import("./tools/talents/page"), true],
  ["/upload", () => import("./upload/page"), true],
  ["/wow-forever", () => import("./wow-forever/page"), true],
];

const text = (v: unknown) => (typeof v === "string" ? v : "");

function checkComplete(path: string, m: Metadata, mustLead: boolean) {
  const title = text(m.title);
  expect(title, path).not.toBe("");
  if (mustLead) expect(title, path).toContain("WoW Forever");
  expect(text(m.description).length, `${path} description: ${m.description}`).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
  expect(text(m.description).length, `${path} description: ${m.description}`).toBeLessThanOrEqual(DESCRIPTION_MAX);
  expect(m.alternates?.canonical, path).toBe(path);
  expect(m.alternates?.types, path).toEqual({ "application/rss+xml": "/changes/feed.xml" });
  const og = m.openGraph as { title?: string; description?: string; url?: string; images?: { url: string }[] } | undefined;
  const tw = m.twitter as { card?: string; title?: string; description?: string; images?: { url: string }[] } | undefined;
  expect(og?.title, path).toBe(`${title} · Everloot`);
  expect(og?.description, path).toBe(m.description);
  expect(og?.url, path).toBe(path);
  expect(og?.images?.length, path).toBeGreaterThan(0);
  expect(tw?.card, path).toBe("summary_large_image");
  expect(tw?.title, path).toBe(`${title} · Everloot`);
  expect(tw?.description, path).toBe(m.description);
  expect(tw?.images?.length, path).toBeGreaterThan(0);
}

test.each(routes)("%s has a complete title, description, Open Graph and Twitter set", async (path, load, mustLead) => {
  checkComplete(path, (await load()).metadata, mustLead);
});

test("the map descriptions still fit when the game's map pictures are on", async () => {
  const { DESCRIPTION, continentDescription, withArt } = await import("./map/map-screen");
  const { CONTINENTS } = await import("@/lib/world-map");
  for (const text of [DESCRIPTION, ...CONTINENTS.map((c) => continentDescription(c.id))]) {
    expect(withArt(text), text).not.toBe(text);
    expect(withArt(text).length, withArt(text)).toBeLessThanOrEqual(DESCRIPTION_MAX);
  }
});

test("every MCP tool page has a description that fits", async () => {
  const { generateMetadata } = await import("./docs/mcp/tools/[tool]/page");
  const { liveToolNames } = await import("@/lib/guild-switch");
  const { toolHref } = await import("@/lib/docs/nav");
  for (const name of liveToolNames()) {
    const slug = toolHref(name).split("/").pop()!;
    const m = await generateMetadata({ params: Promise.resolve({ tool: slug }) });
    within(m.description, name);
  }
});

test("every docs page without a dynamic segment is checked", () => {
  expect(docsRoutes.map(([path]) => path)).toEqual(expect.arrayContaining(["/docs", "/docs/quickstart", "/docs/guides/account", "/docs/cookbook/ask-claude"]));
});

const within = (description: unknown, label: string) => {
  expect(text(description).length, `${label}: ${description}`).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
  expect(text(description).length, `${label}: ${description}`).toBeLessThanOrEqual(DESCRIPTION_MAX);
};

test("every instance description fits, whatever its kind and name", async () => {
  const { instanceDescription, instanceRows } = await import("@/lib/instances");
  const rows = [...instanceRows({}).values()];
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) within(instanceDescription(row), `instance ${row.instanceMapId}`);
  // A row the game files do not name falls back to its id; its kind may be unknown.
  for (const raid of [true, false, null]) within(instanceDescription({ instanceMapId: 99999, name: null, raid }), `unnamed ${raid}`);
  expect(instanceDescription(rows.find((r) => r.name === "Ragefire Chasm")!)).toBe(
    "Ragefire Chasm, a WoW: Forever dungeon: where its entrance is, the bosses players have reported killing, the kills for each and when each was last seen.",
  );
});

test("every API endpoint page has a description that fits and starts with its summary", async () => {
  const { generateMetadata } = await import("./docs/api/[endpoint]/page");
  const { API_ROUTES } = await import("@everloot/protocol");
  const { endpointSlug } = await import("@/lib/docs/nav");
  for (const route of API_ROUTES) {
    const m = await generateMetadata({ params: Promise.resolve({ endpoint: endpointSlug(route) }) });
    within(m.description, `${route.method} ${route.path}`);
    expect(text(m.description).startsWith(`${route.summary}.`), route.path).toBe(true);
  }
});

test("every guild family description fits and counts the rows of the page's three tables", async () => {
  const { generateMetadata } = await import("./guilds/[slug]/page");
  const { FAMILIES } = await import("@/data/families");
  for (const family of FAMILIES) {
    const m = await generateMetadata({ params: Promise.resolve({ slug: family.slug }) });
    within(m.description, family.slug);
    expect(text(m.description).startsWith(family.summary), family.slug).toBe(true);
  }
  const olympus = await generateMetadata({ params: Promise.resolve({ slug: "olympus" }) });
  expect(text(olympus.description)).toMatch(/ \d+ guild halls?, \d+ claims? and \d+ sighted names?\.$/);
});

test("the routes with their own social card point at it", async () => {
  for (const [path, load] of routes.filter(([p]) => ["/tools/raid", "/map", "/changes"].includes(p))) {
    const og = (await load()).metadata.openGraph as { images: { url: string }[] };
    expect(og.images[0].url, path).toBe(`${path}/opengraph-image`);
  }
});

test("every talent class page leads with WoW Forever and has its own card", async () => {
  const { generateMetadata } = await import("./tools/talents/[class]/page");
  for (const slug of TALENT_CLASSES) {
    const m = await generateMetadata({ params: Promise.resolve({ class: slug }) });
    checkComplete(`/tools/talents/${slug}`, m, true);
    expect(text(m.title)).toMatch(/^WoW Forever \w+ Talent Calculator$/);
    expect((m.openGraph as { images: { url: string }[] }).images[0].url).toBe(`/tools/talents/${slug}/opengraph-image`);
  }
});

test("the titles asked for are the titles used", async () => {
  expect((await routes.find(([p]) => p === "/tools/talents")![1]()).metadata.title).toBe("WoW Forever Talent Calculator");
  expect((await routes.find(([p]) => p === "/tools/raid")![1]()).metadata.title).toBe("WoW Forever Raid Buff Planner");
  expect((await routes.find(([p]) => p === "/map")![1]()).metadata.title).toBe("WoW Forever World Map");
  expect((await routes.find(([p]) => p === "/map/kalimdor")![1]()).metadata.title).toBe("WoW Forever Map: Kalimdor");
  expect((await routes.find(([p]) => p === "/addons")![1]()).metadata.title).toBe("WoW Forever Addons");
  expect((await routes.find(([p]) => p === "/changes")![1]()).metadata.title).toBe("WoW Forever Patch Notes and Blizzard Posts");
  expect((await routes.find(([p]) => p === "/tools/professions")![1]()).metadata.title).toBe("WoW Forever Profession Hubs");
  const { generateMetadata } = await import("./tools/talents/[class]/page");
  expect((await generateMetadata({ params: Promise.resolve({ class: "hunter" }) })).title).toBe("WoW Forever Hunter Talent Calculator");
});
