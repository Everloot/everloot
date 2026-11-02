import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { openDb } from "../../../../kb/src/db";
import { replaceSourceRows } from "../../../../kb/src/entities";
import { snapshot } from "../../../../kb/src/snapshot";
import { assetsBaseUrl, CREDIT, hasNodeFrames, loadGameAssets, parseManifest } from "./assets";

const BASE = "https://assets.example.test/wow_classic_beta-70450-84bea423";
const file = (name: string, w = 50, h = 50) => ({ file: name, width: w, height: h, bytes: 1, sha256: "0".repeat(64) });
const frames = Object.fromEntries(
  ["circle", "square"].flatMap((s) => ["gray", "green", "yellow"].map((st) => [`talents-node-${s}-${st}`, file(`frames/talents-node-${s}-${st}.webp`)])),
);
const manifest = {
  schema: "everloot.game-assets/1",
  label: "found in game files, unconfirmed",
  build: { product: "wow_classic_beta", buildId: 70450, version: "1.60.1.70450", buildConfig: "b".repeat(32), extractedAt: "2026-10-18T00:00:00.000Z" },
  spells: {
    "101": { spellId: 1001, name: "Talent 1", icon: "5001.webp", passive: true, description: { text: "Deals 25 damage.", unresolved: [] } },
    "102": { spellId: 1002, name: "Talent 2", icon: null, passive: false, description: { text: "Does 4 and [?].", unresolved: ["$q9"] } },
    "103": { spellId: 1003, name: "Talent 3", icon: null, passive: null, description: null },
  },
  icons: { "5001": file("icons/5001.webp", 64, 64) },
  frames,
  backgrounds: { "warrior:Arms": { element: "talents-background-warrior-arms", nearest: false } },
  counts: {},
  missingFrames: [],
};

afterEach(() => vi.unstubAllEnvs());

test("a good manifest becomes icon URLs under the folder, tooltip text and frame pieces", () => {
  const a = parseManifest(manifest, BASE)!;
  expect(a.version).toBe("1.60.1.70450");
  expect(a.spells.get(101)).toEqual({ icon: `${BASE}/icons/5001.webp`, passive: true, text: "Deals 25 damage.", partial: false });
  expect(a.spells.get(102)).toMatchObject({ icon: null, partial: true });
  expect(a.spells.get(103)).toMatchObject({ text: null, partial: false });
  expect(a.frames.get("talents-node-circle-green")).toEqual({ url: `${BASE}/frames/talents-node-circle-green.webp`, width: 50, height: 50 });
  expect(hasNodeFrames(a)).toBe(true);
});

test("a manifest without the node frames still gives icons and tooltips, but not the frame look", () => {
  const a = parseManifest({ ...manifest, frames: {} }, BASE)!;
  expect(a.spells.size).toBe(3);
  expect(hasNodeFrames(a)).toBe(false);
});

test.each([
  ["another schema", { ...manifest, schema: "everloot.game-assets/2" }],
  ["no spells", { ...manifest, spells: {} }],
  ["a path that climbs out of the folder", { ...manifest, spells: { "101": { ...manifest.spells["101"], icon: "../secret.webp" } } }],
  ["a path that is a URL", { ...manifest, spells: { "101": { ...manifest.spells["101"], icon: "https://evil.test/x.webp" } } }],
  ["not an object", "<html>"],
  ["null", null],
])("%s is refused, so the page shows the text tiles", (_name, bad) => {
  expect(parseManifest(bad, BASE)).toBeNull();
});

test("the folder URL is read from the variable; anything that is not http(s) counts as unset", () => {
  expect(assetsBaseUrl(undefined)).toBeNull();
  expect(assetsBaseUrl("  ")).toBeNull();
  expect(assetsBaseUrl("javascript:alert(1)")).toBeNull();
  expect(assetsBaseUrl("not a url")).toBeNull();
  expect(assetsBaseUrl("https://assets.example.test/build/")).toBe("https://assets.example.test/build");
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "http://localhost:4455/b");
  expect(assetsBaseUrl()).toBe("http://localhost:4455/b");
});

test("fallback: with no URL nothing is fetched; a failing, non-OK or garbled manifest gives null and never throws", async () => {
  const fetcher = vi.fn();
  expect(await loadGameAssets(null, fetcher)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();

  expect(await loadGameAssets(BASE, vi.fn().mockRejectedValue(new Error("network")))).toBeNull();
  expect(await loadGameAssets(BASE, vi.fn().mockResolvedValue(new Response("nope", { status: 404 })))).toBeNull();
  expect(await loadGameAssets(BASE, vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })))).toBeNull();
  expect(await loadGameAssets(BASE, vi.fn().mockResolvedValue(Response.json({ schema: "x" })))).toBeNull();
});

test("a good fetch reads manifest.json from the folder", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(manifest));
  const a = await loadGameAssets(BASE, fetcher);
  expect(fetcher.mock.calls[0][0]).toBe(`${BASE}/manifest.json`);
  expect(a?.spells.size).toBe(3);
});

test("the credit line is the one the data policy names", () => {
  expect(CREDIT).toBe("Icons, tooltip text and interface art are © Blizzard Entertainment, Inc. Everloot is a fan project and is not affiliated with or endorsed by Blizzard.");
  expect(readFileSync(join(__dirname, "../../../../docs/DATA_POLICY.md"), "utf8").replace(/\s+/g, " ")).toContain(CREDIT);
});

// The API, the MCP server and the data downloads carry ids and facts, never the files or the text.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name === "data" || name === ".next") return [];
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}
const root = join(__dirname, "../../../..");

// The pages that show Blizzard's art, and the modules that read it for them. Nothing else may.
const SHOWS_ART = new Set([
  "web/src/lib/talents/assets.ts", "web/src/lib/game-assets.ts", "web/src/lib/game-assets.fixture.ts",
  "web/src/components/RaidBuilder.tsx",
  "web/src/app/page.tsx", "web/src/app/map/map-screen.tsx", "web/src/components/RaidView.tsx", "web/src/app/tools/auctions/page.tsx", "web/src/app/tools/auctions/art.ts",
  "web/src/app/tools/professions/page.tsx", "web/src/app/database/drops/page.tsx", "web/src/app/database/items/[id]/page.tsx", "web/src/app/database/items/category-page.tsx",
  "web/src/lib/tooltip.ts", // the embeddable hover card: one item per request
  "web/src/app/database/vendors/[id]/page.tsx", "web/src/app/database/npcs/[id]/page.tsx", "web/src/app/database/quests/[id]/page.tsx", "web/src/app/changes/page.tsx", "web/src/app/changes/[post]/page.tsx", "web/src/app/lore/page.tsx", "web/src/lib/spell-mentions.ts", "web/src/app/wow-forever/page.tsx", "web/src/app/tools/talents/page.tsx",
  "kb/src/cli.ts", "web/scripts/upload-game-assets.mjs", "web/scripts/game-assets-upload.mjs",
  "web/src/app/database/zones/[zone]/page.tsx",
  // The dungeon and raid list's small loading screens, and the zone list's small map pictures.
  "web/src/app/database/instances/page.tsx", "web/src/app/database/zones/page.tsx",
  // The spell page: the spell's icon and its text come from the same manifest as the item's.
  "web/src/app/database/spells/[id]/page.tsx",
  // The spell list reads the spell names to list them, under the quest list's rule. No art, no tooltip.
  "web/src/app/database/spells/page.tsx",
  // The database index reads the spell names for the count beside the link, the way the sitemap reads
  // the item names only to know whether a category has enough to list. No art, no tooltip.
  "web/src/app/database/page.tsx",
  // The quest list's reward icons, under the item lists' rule (reported or wiki-named items only).
  "web/src/app/database/quests/page.tsx",
  // The site-wide credit (footer → /methodology#credits): reads only the manifest's build and label, no art.
  "web/src/app/methodology/page.tsx",
  // The item names shown from the game files and the Warcraft Wiki: read for the item pages, and by the sitemap
  // only to know whether a category has enough names to list.
  "web/src/lib/shown-item-names.ts", "web/src/app/sitemap.ts", "web/scripts/upload-item-names.mjs",
  // The same names and the quest titles for the site's own search (/search and /search/suggest), never /api/suggest.
  "web/src/lib/shown-search-names.ts",
  // The hover card on the site's own database links, one entity per request, under the pages' rules; and the
  // icons beside the item hits of /search and the type-ahead, for the items whose pages show them.
  "web/src/lib/site-card.ts", "web/src/lib/item-icons.ts",
  // The same names and quest titles for the entity tokens on a wiki page.
  "web/src/lib/wiki-names.ts",
  // The coverage score's expected counts (coverage-expected.json, counts only) sit beside the names in the private bucket.
  "web/src/lib/coverage-compute.ts",
]);

test("nothing outside the pages that show the art can read the asset URL or the manifest modules", () => {
  const offenders = [...sources(join(root, "web/src")), ...sources(join(root, "kb/src")), ...sources(join(root, "addon")), ...sources(join(root, "web/scripts"))]
    .map((p) => ({ p: relative(root, p).replaceAll("\\", "/"), text: readFileSync(p, "utf8") }))
    .filter(({ p, text }) => /GAME_ASSETS_URL|GAME_DATA_(S3|BUCKET|ACCESS|SECRET|REGION)|talents\/assets|\.\/assets"|game-assets/.test(text) && !SHOWS_ART.has(p) && !p.startsWith("web/src/components/talents/") && !p.startsWith("web/src/components/game/") && !p.startsWith("kb/src/client-assets"))
    .map(({ p }) => p);
  expect(offenders).toEqual([]);
  // And the API and MCP code, specifically, never imports the talents folder or the site-wide reader at all.
  // Nor the item names: the shown names, the reader for them and the name ledger stay out of the API, the MCP
  // server and the bulk download (docs/DATA_POLICY.md, "Item names from the game files and the Warcraft Wiki"),
  // and so do the quest titles, item set names and spell names beside them.
  const api = [
    ...sources(join(root, "web/src/app/api")), ...sources(join(root, "web/src/app/mcp")), join(root, "web/src/lib/mcp-mount.ts"),
    join(root, "web/src/lib/bulk-export.ts"), join(root, "web/scripts/export-bulk.ts"), ...sources(join(root, "kb/src")).filter((p) => /mcp|exporters/.test(p)),
  ];
  // site-search.ts serves /api/suggest too: the shown names reach it only as an argument from a page.
  for (const p of [...api, join(root, "web/src/lib/site-search.ts")]) expect(readFileSync(p, "utf8"), p).not.toMatch(/talents\/(assets|catalogs)|GAME_ASSETS|GAME_DATA_(S3|BUCKET|ACCESS|SECRET|REGION)|game-assets|components\/game\/|shown-item-names|shown-search-names|src\/item-names|loadItemNames|loadShownNames|src\/game-names|loadQuestNames|loadItemSetNames|loadSpellNames/);
});

let release = "";
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-assets-mcp-"));
  const source = openDb(join(dir, "source.sqlite"));
  await replaceSourceRows(source, "curated", ["lore_page"], [{ kind: "lore_page", extId: "1", name: "Thrall", body: "Warchief of the Horde", gameVersion: "lore", sourceUrl: "https://example.test/thrall", retrievedAt: "2023-11-13" }]);
  release = join(dir, "release", "release.sqlite");
  snapshot(source, release, new Date("2026-10-10T00:00:00Z"));
  source.close();
});

test("with the asset URL set, the public MCP server's answers never contain it", async () => {
  vi.doMock("@/lib/intake-quota", () => ({ intakeQuota: { mcp: vi.fn().mockResolvedValue({ allowed: true, retryAfter: 0 }) } }));
  vi.doMock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: vi.fn().mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-10T06:30:00.000Z" }) } }));
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "https://assets.example.test/wow_classic_beta-70450-84bea423");
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  vi.stubEnv("EVERLOOT_MCP_PUBLIC", "1");
  vi.resetModules();
  const { POST } = await import("../../app/mcp/public/route");
  const rpc = (id: number, method: string, params: unknown) => POST(new Request("https://everloot.app/mcp/public", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }));
  const bodies = [
    await (await rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })).text(),
    await (await rpc(2, "tools/list", {})).text(),
    await (await rpc(3, "tools/call", { name: "search_knowledge", arguments: { query: "Thrall" } })).text(),
  ];
  for (const b of bodies) expect(b).not.toMatch(/assets\.example\.test|\.webp|GAME_ASSETS|Blizzard Entertainment, Inc\./);
  expect(bodies[2]).toContain("Thrall");
});
