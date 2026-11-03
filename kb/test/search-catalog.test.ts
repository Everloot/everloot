import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { buildCatalogIndex, catalogId, readCatalogFiles, type CatalogIndex } from "../src/catalog-index.js";
import { openDb, type DB } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { createToolHandlers, type ToolAnswer } from "../src/mcp-server.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "game-files");
const index: CatalogIndex = buildCatalogIndex(readCatalogFiles(fixtureRoot).files);

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

const lore = (extId: string, name: string, extra: Partial<EntityInput> = {}): EntityInput => ({
  kind: "lore_page", extId, name, body: `${name} body`, gameVersion: "lore",
  sourceUrl: `https://example.test/${extId}`, retrievedAt: "2023-11-13", ...extra,
});

async function release(): Promise<DB> {
  const db = openDb(":memory:");
  databases.push(db);
  await replaceSourceRows(db, "curated", ["lore_page", "item"], [
    lore("1", "Stormwind"),
    lore("2", "Stormwind Harbor"),
    lore("3", "Champion of the Light", { kind: "item", gameVersion: "retail" }),
  ]);
  return db;
}

const textOf = (a: ToolAnswer): string => (typeof a === "string" ? a : a.text);
const structuredOf = (a: ToolAnswer): any => (typeof a === "string" ? {} : a.structured);

async function handlers() {
  return createToolHandlers(await release(), { catalog: () => index });
}

test("search_knowledge finds a faction by name and reports its kind and page", async () => {
  const h = await handlers();
  const answer = await h.search_knowledge({ query: "Stormwind", limit: 5 });
  const hits = structuredOf(answer).hits as { kind: string; url?: string; name: string }[];
  expect(hits.map((x) => x.kind)).toContain("faction");
  const faction = hits.find((x) => x.kind === "faction")!;
  expect(faction.url).toMatch(/^https:\/\/everloot\.app\/database\/factions\//);
  expect(textOf(answer)).toContain(GAME_DATA_CREDIT);
});

test("search_knowledge puts exact names first, release before catalog on a tie", async () => {
  const h = await handlers();
  const hits = structuredOf(await h.search_knowledge({ query: "Stormwind", limit: 5 })).hits as { kind: string; name: string }[];
  expect(hits[0]).toMatchObject({ kind: "lore_page", name: "Stormwind" });
  expect(hits[1]).toMatchObject({ kind: "faction", name: "Stormwind" });
  expect(hits[2]!.name).toBe("Stormwind Harbor");
});

test("search_knowledge cuts the merge to the limit", async () => {
  const h = await handlers();
  const hits = structuredOf(await h.search_knowledge({ query: "Stormwind", limit: 2 })).hits as unknown[];
  expect(hits).toHaveLength(2);
});

test("kind narrows: a title and an item that share a word", async () => {
  const h = await handlers();
  const hits = structuredOf(await h.search_knowledge({ query: "Champion", limit: 5, kind: "title" })).hits as { kind: string }[];
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every((x) => x.kind === "title")).toBe(true);
});

test("get_by_name works for every new kind", async () => {
  const h = await handlers();
  const cases: [string, string][] = [
    ["faction", "Stormwind"], ["title", "%s, Champion"], ["quest_chain", "The Missing Diplomat"], ["mount", "Gray Wolf"],
    ["instance", "Deadmines"], ["achievement", "Loremaster"], ["race", "Orc"], ["legacy_perk", "Sturdy"],
  ];
  for (const [kind, name] of cases) {
    const answer = await h.get_by_name({ name, kind: kind as never });
    expect(structuredOf(answer).hits, `${kind} ${name}`).toHaveLength(1);
    expect(textOf(answer)).toContain(GAME_DATA_CREDIT);
  }
});

test("get_by_name lists the release record before the catalog one", async () => {
  const h = await handlers();
  const hits = structuredOf(await h.get_by_name({ name: "Stormwind" })).hits as { kind: string }[];
  expect(hits.map((x) => x.kind)).toEqual(["lore_page", "faction"]);
});

test("get_entity routes a catalog id to the index", async () => {
  const h = await handlers();
  const id = catalogId("race", "2");
  const answer = await h.get_entity({ id });
  expect(structuredOf(answer).hit).toMatchObject({ id, kind: "race", name: "Orc" });
  expect(textOf(answer)).toContain(GAME_DATA_CREDIT);
  expect(textOf(await h.get_entity({ id: id + 5000 }))).toContain("No record with id");
});

test("fetch returns a body and the game-file licence for a quest chain", async () => {
  const h = await handlers();
  const out = JSON.parse(textOf(await h.fetch({ id: String(catalogId("quest_chain", "1")) })));
  expect(out.text).toMatch(/^The Missing Diplomat\n/);
  expect(out.metadata.kind).toBe("quest_chain");
  expect(out.metadata.licence).toMatch(/Blizzard/);
  expect(out.metadata.sourceId).toBe("game-files");
  expect(out.url).toBe("https://everloot.app/database/quest-chains/1-the-missing-diplomat");
});

test("fetch of a catalog id with no catalog is the same error as any unknown id", async () => {
  const h = createToolHandlers(await release());
  await expect(h.fetch({ id: String(catalogId("quest_chain", "1")) })).rejects.toThrow(/No record with id/);
});

test("search (ChatGPT contract) lists a catalog hit with its page url", async () => {
  const h = await handlers();
  const out = JSON.parse(textOf(await h.search({ query: "Deadmines" })));
  expect(out.results[0].url).toBe("https://everloot.app/database/instances/36-deadmines");
  expect(out.results[0].id).toBe(String(catalogId("instance", "36")));
});

test("with no catalog loader, or one that returns null, the answers are exactly the release's", async () => {
  const db = await release();
  const bare = createToolHandlers(db);
  const nulled = createToolHandlers(db, { catalog: () => null });
  const asyncNull = createToolHandlers(db, { catalog: async () => null });
  for (const other of [nulled, asyncNull]) {
    for (const call of [
      (x: typeof bare) => x.search_knowledge({ query: "Stormwind", limit: 5 }),
      (x: typeof bare) => x.search_knowledge({ query: "nothing matches this", limit: 10 }),
      (x: typeof bare) => x.get_by_name({ name: "Stormwind" }),
      (x: typeof bare) => x.search({ query: "Stormwind" }),
    ]) expect(JSON.stringify(await call(other))).toBe(JSON.stringify(await call(bare)));
  }
  const text = textOf(await bare.search_knowledge({ query: "Stormwind", limit: 5 }));
  expect(text).not.toContain(GAME_DATA_CREDIT);
});
