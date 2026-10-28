import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { LAUNCH } from "@/data/wow-forever";
import { MAP_DATA_EXTRACTED_AT, TALENT_DATA_EXTRACTED_AT } from "@/lib/build-stamp";
import { loadTimeline, postPath } from "@/lib/changes";
import { CLIENT_TAXONOMY, ITEMS_PER_PAGE, itemsHref } from "@/lib/items";
import { filterItems } from "../../../kb/src/item-taxonomy";
import { instanceHref, instanceRows } from "@/lib/instances";
import { loadCatalog, TALENT_CLASSES } from "@/lib/talents/catalogs";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";
import sitemap from "./sitemap";

const facts = vi.hoisted(() => ({ rates: [] as unknown[], names: [] as { installId: string; itemId: number; name: string }[], npcs: [] as unknown[], unreachable: false }));
const world = vi.hoisted(() => ({ npcs: [] as unknown[], quests: [] as unknown[], vendors: [] as unknown[], unreachable: false }));
const instances = vi.hoisted(() => ({ entrances: [] as unknown[], encounters: [] as unknown[], sightings: [] as unknown[], unreachable: false, dataAsOf: null as string | null }));
vi.mock("@/lib/rollup-compute", () => ({ loadItemFacts: async () => facts, loadWorldFacts: async () => world, loadInstanceFacts: async () => instances }));
// Two hubs a later lane might add: one that asks to be indexed and one that does not.
vi.mock("@/lib/database-hubs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/database-hubs")>();
  const hubs = [...real.DATABASE_HUBS, { href: "/database/example-listed", label: "Example" }, { href: "/database/example-unlisted", label: "Example, noindex", unlisted: true as const }];
  return { ...real, DATABASE_HUBS: hubs, DATABASE_HUB_PATHS: ["/database", "/database/items", ...hubs.filter((h) => !("unlisted" in h && h.unlisted)).map((h) => h.href)] };
});
const blue = vi.hoisted(() => ({ writeups: new Map<string, { postId: string; reviewed: { by: string; on: string }; body: string }>() }));
vi.mock("@/lib/changes", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/changes")>()), loadWriteups: () => blue.writeups }));

const news = vi.hoisted(() => ({ posts: new Map<string, unknown>() }));
vi.mock("@/lib/news", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/news")>();
  return { ...real, loadNews: () => news.posts };
});

const entries = await sitemap();
const byPath = new Map(entries.map((e) => [new URL(e.url).pathname, e]));

test("/changes is dated by its newest entry", async () => {
  const newest = (await loadTimeline())[0];
  expect(newest).toBeDefined();
  expect(byPath.get("/changes")?.lastModified).toEqual(new Date(newest.at));
});

test("a blue post's page is listed only once it has a reviewed write-up, dated by the review", async () => {
  const posts = (await loadTimeline()).filter((e) => e.type !== "build");
  const listed = (all: typeof entries) => all.map((e) => new URL(e.url).pathname).filter((p) => /^\/changes\/./.test(p) && p !== "/changes/feed.xml");
  expect(listed(entries)).toEqual([]);
  const [first, second] = posts;
  try {
    blue.writeups = new Map([[first.id, { postId: first.id, reviewed: { by: "Maintainer", on: "2026-10-21" }, body: "Our words." }]]);
    const withOne = await sitemap();
    expect(listed(withOne)).toEqual([postPath(first)]);
    expect(withOne.find((e) => e.url.endsWith(postPath(first)!))?.lastModified).toEqual(new Date("2026-10-21"));
    expect(listed(withOne)).not.toContain(postPath(second));
  } finally {
    blue.writeups = new Map();
  }
});

test("the news hub and its posts are listed only once a post is published, dated by its last change", async () => {
  const listed = (all: typeof entries) => all.map((e) => new URL(e.url).pathname).filter((p) => p === "/news" || p.startsWith("/news/"));
  expect(listed(entries)).toEqual([]);
  try {
    news.posts = new Map([["launch", { slug: "launch", title: "Launch", summary: "s", author: "a", published: "2026-10-24", updated: "2026-10-25", tags: [], sources: [], status: "published", blocks: [] }]]);
    const withOne = await sitemap();
    expect(listed(withOne)).toEqual(["/news", "/news/launch"]);
    expect(withOne.find((e) => e.url.endsWith("/news/launch"))?.lastModified).toEqual(new Date("2026-10-25"));
  } finally {
    news.posts = new Map();
  }
});

test("a guide is listed only while its page asks to be indexed, dated by its review, with the guide index; a draft never; the class hubs carry their races' traits, so they are listed without one", async () => {
  const listed = (all: typeof entries) => all.map((e) => new URL(e.url).pathname).filter((p) => /^\/(?:guides|classes)(?:\/|$)/.test(p));
  const hubs = ["/classes", ...TALENT_CLASSES.map((slug) => `/classes/${slug}`)];
  expect(listed(entries).sort()).toEqual([...hubs].sort());
  // One point on the Mage tree the site ships, made and reviewed on its build: a plan that fits.
  const mage = await loadCatalog("mage");
  const node = mage.nodes.find((n) => n.row === 1 && n.kind === "single" && !n.unlock && n.prereqs.length === 0 && !n.anyOf?.length);
  expect(node).toBeDefined();
  const ranks = { [node!.id]: { rank: 1 } };
  const file = (id: number, slug: string, { status = "published", words = 48 }: { status?: string; words?: number } = {}) => {
    const reviewed = status === "published";
    return [
      "---", `id: ${id}`, `slug: ${slug}`, "version: 1", `status: ${status}`, `title: ${slug}`, 'summary: "A test guide."', "classSlug: mage",
      "activity: leveling", "roles: [damage]", "levels: { from: 10, to: 60 }",
      `code: ${encodeBuild({ classSlug: "mage", specId: mage.specId, build: mage.build, ranks })}`, `order: ${encodeOrder(ranks, [node!.id], "planned")}`, "author: Robin",
      `reviewed: ${reviewed ? `{ by: Kai, on: 2026-10-20, build: ${mage.build} }` : "null"}`,
      `history: ${reviewed ? `[{ version: 1, on: 2026-10-20, by: Kai, build: ${mage.build}, note: First published version. }]` : "[]"}`, "---", "",
      ...["Who it is for", "Why this plan", "How to play it", "What we do not know yet"].flatMap((h) => [`## ${h}`, "", Array.from({ length: words }, (_, i) => `word${i}`).join(" "), ""]),
    ].join("\n");
  };
  const dir = mkdtempSync(join(tmpdir(), "sitemap-guides-"));
  writeFileSync(join(dir, "README.md"), "# not a guide");
  writeFileSync(join(dir, "frost-leveling.md"), file(1, "frost-leveling"));
  writeFileSync(join(dir, "fire-draft.md"), file(2, "fire-draft", { status: "draft" }));
  // Published, but under the guides' 150 words of their own: shown, and out of search.
  writeFileSync(join(dir, "thin-guide.md"), file(3, "thin-guide", { words: 2 }));
  vi.stubEnv("GUIDES_DIR", dir);
  try {
    const withGuides = await sitemap();
    expect(listed(withGuides).sort()).toEqual([...hubs, "/guides", "/guides/frost-leveling"].sort());
    expect(withGuides.find((e) => e.url.endsWith("/guides/frost-leveling"))?.lastModified).toEqual(new Date("2026-10-20"));
    expect(withGuides.find((e) => e.url.endsWith("/guides"))?.lastModified).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
  }
});

test("the game-data pages are dated by the build extraction", () => {
  expect(TALENT_DATA_EXTRACTED_AT.getTime()).toBeGreaterThan(0);
  expect(byPath.get("/map")?.lastModified).toEqual(MAP_DATA_EXTRACTED_AT);
  // Both continent pages are indexed pages of their own; no per-zone map page (the zone pages are those).
  for (const path of ["/map/eastern-kingdoms", "/map/kalimdor"]) expect(byPath.get(path)?.lastModified, path).toEqual(MAP_DATA_EXTRACTED_AT);
  expect([...byPath.keys()].filter((p) => p.startsWith("/map/")).sort()).toEqual(["/map/eastern-kingdoms", "/map/kalimdor"]);
  for (const path of ["/tools/talents", "/tools/talents/hunter", "/tools/talents/druid", "/tools/raid"]) {
    expect(byPath.get(path)?.lastModified, path).toEqual(TALENT_DATA_EXTRACTED_AT);
  }
});

test("/wow-forever is listed and dated by the day its source was read", () => {
  expect(byPath.get("/wow-forever")?.lastModified).toEqual(new Date(LAUNCH.checkedOn));
});

test("a page with no known modification time has none, instead of today's date", () => {
  for (const path of ["/about", "/privacy", "/terms", "/security", "/accessibility", "/docs"]) expect(byPath.get(path)?.lastModified, path).toBeUndefined();
});

test("changefreq and priority are gone", () => {
  for (const entry of entries) {
    expect(entry).not.toHaveProperty("changeFrequency");
    expect(entry).not.toHaveProperty("priority");
  }
});

test("the zone index is listed; a zone page only once something is on it, and never a held-back one", async () => {
  const paths = async () => (await sitemap()).map((e) => new URL(e.url).pathname);
  expect(byPath.has("/database/zones")).toBe(true);
  expect(byPath.has("/database/zones/1436-westfall")).toBe(true);
  expect(byPath.has("/database/zones/1450-moonglade")).toBe(false);
  expect([...byPath.keys()].filter((p) => p.startsWith("/database/zones/2482"))).toEqual([]);
  try {
    world.npcs = ["a", "b", "c"].map((installId) => ({ installId, npcId: 5, name: "Keeper", mapId: 1450, x: 50, y: 50, positionKind: "npc" }));
    expect(await paths()).toContain("/database/zones/1450-moonglade");
    world.unreachable = true;
    expect(await paths()).not.toContain("/database/zones/1450-moonglade");
  } finally {
    world.npcs = [];
    world.unreachable = false;
  }
});

test("an item category is listed only once half its first page has an agreed name", async () => {
  const cls = CLIENT_TAXONOMY.classes.find((c) => c.slug === "weapons")!;
  expect(byPath.has(itemsHref("weapons"))).toBe(false);
  // Named rows lead the plain list, so it takes half a page of them, wherever they sit in the id order.
  const ids = filterItems(CLIENT_TAXONOMY, { classId: cls.id }).map((r) => r[0]).reverse();
  const name = (n: number) => ids.slice(0, n).flatMap((itemId) => ["a", "b", "c"].map((installId) => ({ installId, itemId, name: `Item name ${itemId}` })));
  try {
    facts.names = name(Math.ceil(ITEMS_PER_PAGE / 2) - 1);
    expect((await sitemap()).map((e) => new URL(e.url).pathname)).not.toContain(itemsHref("weapons"));
    facts.names = name(Math.ceil(ITEMS_PER_PAGE / 2));
    expect((await sitemap()).map((e) => new URL(e.url).pathname)).toContain(itemsHref("weapons"));
  } finally {
    facts.names = [];
  }
});

test("every hub on /database is listed, the instance index and a hub added later included, unless it asks to be left out", async () => {
  const { DATABASE_HUBS } = await import("@/lib/database-hubs");
  for (const hub of DATABASE_HUBS) expect(byPath.has(hub.href), hub.href).toBe(!hub.unlisted);
  for (const path of ["/database/instances", "/database/spells", "/database/example-listed"]) expect(byPath.has(path), path).toBe(true);
  expect(byPath.has("/database/example-unlisted")).toBe(false);
  // The landing page and the all-items list stay, hub rows or not.
  for (const path of ["/database", "/database/items"]) expect(byPath.has(path), path).toBe(true);
});

test("each dungeon and raid page is listed, once, as many as the instance index has rows", () => {
  const paths = [...byPath.keys()].filter((p) => p.startsWith("/database/instances/"));
  const rows = [...instanceRows().values()];
  expect(rows.length).toBeGreaterThan(0);
  expect(paths.sort()).toEqual(rows.map((r) => instanceHref(r.instanceMapId, r.name)).sort());
  expect(paths).toContain("/database/instances/36-deadmines");
  // Dated by nothing the site knows: no made-up date on the page.
  expect(byPath.get("/database/instances/36-deadmines")?.lastModified).toBeUndefined();
});

test("an instance page is listed only while storage is readable, and one entered only from a held-back zone has none", async () => {
  const paths = async () => (await sitemap()).map((e) => new URL(e.url).pathname);
  const zoned = (mapId: number) => ["a", "b", "c"].map((installId) => ({ installId, instanceMapId: 9999, name: "Secret Vault", instanceType: "party", mapId, x: 40, y: 40, capturedAt: "2026-10-10T00:00:00.000Z" }));
  try {
    instances.entrances = zoned(2482);
    expect(await paths()).not.toContain("/database/instances/9999-secret-vault");
    instances.entrances = zoned(1436);
    expect(await paths()).toContain("/database/instances/9999-secret-vault");
    instances.unreachable = true;
    const down = await paths();
    expect(down.filter((p) => p.startsWith("/database/instances/"))).toEqual([]);
    // The index stays: it shows the files' entrances without storage.
    expect(down).toContain("/database/instances");
  } finally {
    instances.entrances = [];
    instances.unreachable = false;
  }
});

test("a zone with only a treasure on it is listed, as its page counts the treasures players pinned", async () => {
  const chest = (installId: string) => ({ installId, objectId: 500, mapId: 1450, x: 50, y: 50, capturedAt: "2026-10-10T00:00:00.000Z" });
  const paths = async () => (await sitemap()).map((e) => new URL(e.url).pathname);
  try {
    expect(await paths()).not.toContain("/database/zones/1450-moonglade");
    instances.sightings = ["a", "b"].map(chest);
    expect(await paths()).not.toContain("/database/zones/1450-moonglade");
    instances.sightings = ["a", "b", "c"].map(chest);
    expect(await paths()).toContain("/database/zones/1450-moonglade");
  } finally {
    instances.sightings = [];
  }
});
