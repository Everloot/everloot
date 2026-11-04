import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { buildCatalogIndex, catalogId, getCatalogByName, readCatalogFiles, type CatalogIndex } from "../src/catalog-index.js";
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

async function release(extra: EntityInput[] = []): Promise<DB> {
  const db = openDb(":memory:");
  databases.push(db);
  await replaceSourceRows(db, "curated", ["lore_page", "item"], [
    lore("1", "Stormwind"),
    lore("2", "Stormwind Harbor"),
    lore("3", "Champion of the Light", { kind: "item", gameVersion: "retail" }),
    ...extra,
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

const LABEL = /Found in game files, unconfirmed \(build 1\.60\.1\.\d+\)\./;

test("every catalog answer carries the game-files label and its build, in each tool that returns one", async () => {
  const h = await handlers();
  const cases: [string, string][] = [
    ["faction", "Stormwind"], ["title", "%s, Champion"], ["quest_chain", "The Missing Diplomat"], ["mount", "Gray Wolf"],
    ["instance", "Deadmines"], ["achievement", "Loremaster"], ["race", "Orc"], ["legacy_perk", "Sturdy"],
  ];
  for (const [kind, name] of cases) {
    const id = getCatalogByName(index, name, kind)[0]!.id;
    const byName = await h.get_by_name({ name, kind: kind as never });
    expect(textOf(byName), `get_by_name ${kind}`).toMatch(LABEL);
    expect(structuredOf(byName).hits[0].snippet, `get_by_name snippet ${kind}`).toMatch(LABEL);
    const entity = await h.get_entity({ id });
    expect(textOf(entity), `get_entity ${kind}`).toMatch(LABEL);
    expect(structuredOf(entity).hit.snippet).toMatch(LABEL);
    const found = await h.search_knowledge({ query: name, limit: 10, kind: kind as never });
    expect(textOf(found), `search_knowledge ${kind}`).toMatch(LABEL);
    const fetched = JSON.parse(textOf(await h.fetch({ id: String(id) })));
    expect(fetched.text, `fetch ${kind}`).toMatch(LABEL);
    expect(fetched.text.split("\n")[0]).toBe(name);
  }
});

test("an achievement's description and criteria text reach no tool answer", async () => {
  const h = await handlers();
  const id = catalogId("achievement", "1234");
  const answers = [
    textOf(await h.get_by_name({ name: "Loremaster", kind: "achievement" })), textOf(await h.get_entity({ id })),
    textOf(await h.search_knowledge({ query: "Loremaster", limit: 5 })), textOf(await h.fetch({ id: String(id) })),
    JSON.stringify(structuredOf(await h.get_entity({ id }))),
  ];
  for (const text of answers) for (const hidden of ["Learn the lore of the world", "Read the first book", "Read the second book"]) expect(text).not.toContain(hidden);
});

// Frozen: what a release-only question answers while the catalog is present. A query whose words match no catalog name
// must read exactly as it does without the catalog, so the release's "some words" fallback is not lost.
const SOME_WORDS_LINE = "No page has every word you asked for. Pages with some of them:";

test("a release-only question with the catalog present gives the release's some-words answer, unchanged", async () => {
  const db = await release([lore("10", "Thunderfury, Blessed Blade", { body: "A legendary sword." })]);
  const withCatalog = createToolHandlers(db, { catalog: () => index });
  const bare = createToolHandlers(db);
  const query = { query: "best sword Thunderfury", limit: 8 };
  const text = textOf(await withCatalog.search_knowledge(query));
  expect(text).toBe(textOf(await bare.search_knowledge(query)));
  expect(text).toBe([
    "No page has every word you asked for. Pages with some of them:",
    "",
    "[lore_page/lore] Thunderfury, Blessed Blade",
    "A legendary sword.",
    "Source: https://example.test/10 (CC-BY-SA-4.0, retrieved 2023-11-13)",
  ].join("\n"));
});

test("stopwords match no catalog name, so a question full of them still gets the release's some-words answer", async () => {
  const db = await release([
    lore("20", "The Barrens", { body: "A dry plain. Farming here is slow." }),
    lore("21", "Gold farming", { body: "Ways to earn gold." }),
  ]);
  const withCatalog = createToolHandlers(db, { catalog: () => index });
  const bare = createToolHandlers(db);
  const query = { query: "best gold farm in the barrens", limit: 10 };
  const text = textOf(await withCatalog.search_knowledge(query));
  expect(text).toBe([
    SOME_WORDS_LINE,
    "",
    "[lore_page/lore] Gold farming",
    "Ways to earn gold.",
    "Source: https://example.test/21 (CC-BY-SA-4.0, retrieved 2023-11-13)",
    "",
    "[lore_page/lore] The Barrens",
    "A dry plain. Farming here is slow.",
    "Source: https://example.test/20 (CC-BY-SA-4.0, retrieved 2023-11-13)",
  ].join("\n"));
  expect(text).not.toContain("The Missing Diplomat");
  expect(text).not.toContain(GAME_DATA_CREDIT);
  expect(text).toBe(textOf(await bare.search_knowledge(query)));
  const searched = JSON.parse(textOf(await withCatalog.search({ query: "best gold farm in the barrens" })));
  expect(searched.results.map((r: { title: string }) => r.title)).not.toContain("The Missing Diplomat");
});

test("catalog names that match only some words join the answer on the some-words path, after the release's pages", async () => {
  const db = await release([lore("30", "Gold farming", { body: "Ways to earn gold in Deadmines." })]);
  const h = createToolHandlers(db, { catalog: () => index });
  const text = textOf(await h.search_knowledge({ query: "best gold Deadmines run", limit: 10 }));
  expect(text.startsWith(SOME_WORDS_LINE)).toBe(true);
  expect(text.indexOf("Gold farming")).toBeLessThan(text.indexOf("[instance/forever] Deadmines"));
  expect(text).toMatch(LABEL);
});

test("catalog hits that match every word stay on the normal answer, with no some-words notice", async () => {
  const h = await handlers();
  const text = textOf(await h.search_knowledge({ query: "missing diplomat", limit: 5 }));
  expect(text).not.toContain(SOME_WORDS_LINE);
  expect(text).toContain("[quest_chain/forever] The Missing Diplomat");
});

test("a catalog that fails to load is read once, logged once, and the release answers", async () => {
  const db = await release();
  const calls: number[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const h = createToolHandlers(db, { catalog: () => { calls.push(1); throw new Error("bad file"); } });
    for (let i = 0; i < 3; i++) expect(textOf(await h.search_knowledge({ query: "Stormwind", limit: 5 }))).toContain("Stormwind");
    expect(calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("bad file");
  } finally {
    warn.mockRestore();
  }
});

test("the rollup is not read when no hit is a catalog record it can confirm", async () => {
  const db = await release();
  let reads = 0;
  const completion = async () => { reads += 1; return null; };
  const h = createToolHandlers(db, { catalog: () => index, completion: completion as never });
  await h.search_knowledge({ query: "Deadmines", limit: 5 });
  await h.get_by_name({ name: "Gray Wolf", kind: "mount" });
  await h.get_entity({ id: catalogId("race", "2") });
  await h.fetch({ id: String(catalogId("instance", "36")) });
  expect(reads).toBe(0);
  await h.get_by_name({ name: "Stormwind", kind: "faction" });
  expect(reads).toBe(1);
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
