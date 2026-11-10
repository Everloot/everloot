import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { openPublicSnapshot } from "../../../kb/src/public-snapshot";
import { buildLoreRelease } from "@/test/lore-release";

// The lore sitemap's bill: it asks the release for the archive pages of every name a database kind holds, a batch of
// 2,000 names per query (lib/lore-forever.ts NAME_BATCH), through the (type, name) index. These tests hold the count
// and the query shape on the fixture release, with every query the release answers recorded.
const seen = vi.hoisted(() => ({ queries: [] as { sql: string; params: unknown[] }[] }));
vi.mock("./release", async (importOriginal) => {
  const real = await importOriginal<typeof import("./release")>();
  return {
    ...real,
    getRelease: async () => {
      const release = await real.getRelease();
      if (!release) return release;
      return {
        ...release,
        db: {
          ...release.db,
          all: (sql: string, ...params: unknown[]) => { seen.queries.push({ sql, params }); return release.db.all(sql, ...params); },
        },
      };
    },
  };
});
// The names players agreed on, sized per test; the game files' lists (zones, instances, factions, titles,
// achievements) are the committed ones.
const agreed = vi.hoisted(() => ({ npcs: new Map<number, string>(), items: new Map<number, string>(), quests: new Map<number, string>(), objects: new Map<number, string>() }));
vi.mock("./rollup-compute", () => ({
  loadItemFacts: async () => ({ unreachable: false }),
  loadWorldFacts: async () => ({ unreachable: false }),
}));
vi.mock("./names", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./names")>()),
  npcNames: () => agreed.npcs,
  itemNames: () => agreed.items,
  questTitles: () => agreed.quests,
  objectNames: () => agreed.objects,
}));

const BATCH = 2_000;
const named = (prefix: string, n: number) => new Map(Array.from({ length: n }, (_, i) => [i + 1, `${prefix} ${i + 1}`] as [number, string]));
/** The names the sitemap asks for, as `loreHeadsNamed` counts them: trimmed, blank ones dropped, ASCII case folded. */
const unique = (names: string[]) => new Set(names.map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/[A-Z]/g, (c) => c.toLowerCase()))).size;

let release = "";
beforeAll(async () => { release = await buildLoreRelease({ links: true }); });
beforeEach(() => {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  seen.queries = [];
  for (const set of Object.values(agreed)) set.clear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test("5,000 names of one type are 3 queries of at most 2,000 names; a name that differs only in case is asked once", async () => {
  const { loreHeadsNamed } = await import("./lore");
  const names = [...named("Npc", 5_000).values(), "NPC 1", " Npc 2 ", ""];
  await loreHeadsNamed("npc", names, BATCH);
  expect(seen.queries).toHaveLength(3);
  expect(seen.queries.map((q) => (JSON.parse(q.params.at(-1) as string) as string[]).length)).toEqual([2_000, 2_000, 1_000]);
});

test("each query reads through the (type, name) index, never a scan of the archive", async () => {
  const { loreHeadsNamed } = await import("./lore");
  await loreHeadsNamed("npc", ["Thrall", "Hogger"], BATCH);
  const [query] = seen.queries;
  // One type, the names as one JSON parameter: the shape the entities_type_name index answers.
  expect(query!.sql).toMatch(/json_extract\(data, '\$\.type'\) = \?/);
  expect(query!.sql).toMatch(/name COLLATE NOCASE IN \(SELECT value FROM json_each\(\?\)\)/);
  const db = openPublicSnapshot(release).db;
  try {
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${query!.sql}`).all(...query!.params) as { detail: string }[]).map((p) => p.detail).join("\n");
    expect(plan).toMatch(/SEARCH entities USING INDEX entities_type_name/);
    expect(plan).not.toMatch(/SCAN entities\b/);
  } finally {
    db.close();
  }
});

test("the sitemap asks Σ ceil(unique names per type / 2,000) queries across the five archive types", async () => {
  agreed.npcs = named("Npc", 5_000);
  agreed.items = named("Item", 2_001);
  agreed.quests = named("Quest", 3);
  agreed.objects = named("Object", 1_999);
  const { lorePaths } = await import("./lore-forever");
  const { LINKED_TYPES, loadLinkNames, namesOfType } = await import("./lore-links");
  const sets = await loadLinkNames("all");
  const perType = Object.fromEntries(LINKED_TYPES.map((type) => [type, unique(namesOfType(type, sets)!)]));
  const budget = Object.values(perType).reduce((sum, n) => sum + Math.ceil(n / BATCH), 0);

  expect(LINKED_TYPES).toEqual(["npc", "item", "quest", "zone", "other"]);
  expect(await lorePaths()).not.toBeNull();
  expect(seen.queries).toHaveLength(budget);
  // The agreed kinds as sized above: 3 + 2 + 1 queries. Zones and instances are one query, and objects with the game
  // files' factions, titles and achievements are a few (the committed counts are in lib/lore-forever.ts).
  expect(perType).toMatchObject({ npc: 5_000, item: 2_001, quest: 3 });
  expect(Math.ceil(perType.zone! / BATCH)).toBe(1);
  expect(budget).toBe(3 + 2 + 1 + 1 + Math.ceil(perType.other! / BATCH));
});
