import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { buildCatalogIndex, catalogId, readCatalogFiles, type CatalogIndex } from "../src/catalog-index.js";
import { openDb, type DB } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { createToolHandlers, type ToolAnswer } from "../src/mcp-server.js";

const ids = Array.from({ length: 60 }, (_, i) => 1000 + i);

// The game-file fixtures, with the first quest line grown to 60 quests.
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "game-files");
const files = readCatalogFiles(fixtureRoot).files;
const index: CatalogIndex = buildCatalogIndex({
  ...files,
  questLines: { ...files.questLines!, questLines: [{ id: 1, name: "The Missing Diplomat", questIds: ids }, ...files.questLines!.questLines.slice(1)] },
});
const chainId = catalogId("quest_chain", "1");
const shortChainId = catalogId("quest_chain", "2");

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

const row = (extId: string, name: string, extra: Partial<EntityInput> = {}): EntityInput => ({
  kind: "lore_page", extId, name, body: `${name} body`, gameVersion: "lore",
  sourceUrl: `https://example.test/${extId}`, retrievedAt: "2023-11-13", ...extra,
});

async function setup() {
  const db = openDb(":memory:");
  databases.push(db);
  await replaceSourceRows(db, "curated", ["lore_page", "quest"], [
    row("1", "Orgrimmar"),
    row("2", "A Long Road", { kind: "quest", gameVersion: "forever", body: "A long road body", data: { build: "1.60", questCount: 60, questIds: ids } }),
  ]);
  const h = createToolHandlers(db, { catalog: () => index });
  const idOf = async (name: string): Promise<number> => (structuredOf(await h.get_by_name({ name })).hits[0] as { id: number }).id;
  return { h, loreId: await idOf("Orgrimmar"), questId: await idOf("A Long Road") };
}

const textOf = (a: ToolAnswer): string => (typeof a === "string" ? a : a.text);
const structuredOf = (a: ToolAnswer): any => (typeof a === "string" ? {} : a.structured);
const docOf = (a: ToolAnswer): any => JSON.parse(textOf(a));

test("get_entity with field returns the slice and nextOffset", async () => {
  const { h, questId } = await setup();
  const out = await h.get_entity({ id: questId, field: "/questIds", offset: 0, limit: 48 });
  expect(structuredOf(out).field).toEqual({ pointer: "/questIds", value: ids.slice(0, 48), nextOffset: 48 });
  expect(structuredOf(out).hit).toMatchObject({ id: questId, name: "A Long Road" });
  expect(textOf(out)).toMatch(/nextOffset 48/);
  expect(textOf(out)).toContain("rows 1-48 of 60");
});

test("the next page has no nextOffset, and omitted offset and limit mean the first 48", async () => {
  const { h, questId } = await setup();
  const last = await h.get_entity({ id: questId, field: "/questIds", offset: 48 });
  expect(structuredOf(last).field).toEqual({ pointer: "/questIds", value: ids.slice(48) });
  expect(textOf(last)).not.toMatch(/nextOffset/);
  const first = await h.get_entity({ id: questId, field: "/questIds" });
  expect(structuredOf(first).field.value).toHaveLength(48);
});

test("limit holds the page to fewer rows, and an offset past the end is an empty page", async () => {
  const { h, questId } = await setup();
  const few = await h.get_entity({ id: questId, field: "/questIds", offset: 10, limit: 5 });
  expect(structuredOf(few).field).toEqual({ pointer: "/questIds", value: ids.slice(10, 15), nextOffset: 15 });
  const past = await h.get_entity({ id: questId, field: "/questIds", offset: 500 });
  expect(structuredOf(past).field).toEqual({ pointer: "/questIds", value: [] });
  expect(structuredOf(past).keys).toBeUndefined();
});

test("a value that is not an array comes back whole", async () => {
  const { h, questId } = await setup();
  const out = await h.get_entity({ id: questId, field: "/questCount" });
  expect(structuredOf(out).field).toEqual({ pointer: "/questCount", value: 60 });
});

test("a bad pointer lists the keys", async () => {
  const { h, questId } = await setup();
  const out = await h.get_entity({ id: questId, field: "/nope" });
  expect(structuredOf(out).keys).toEqual(["build", "questCount", "questIds"]);
  expect(structuredOf(out).field).toBeUndefined();
  expect(textOf(out)).toMatch(/^No such field \/nope/);
  expect(textOf(out)).toContain("build, questCount, questIds");
});

test("a lore page with empty data answers No such field with no keys", async () => {
  const { h, loreId } = await setup();
  const out = await h.get_entity({ id: loreId, field: "/x" });
  expect(structuredOf(out).keys).toEqual([]);
  expect(textOf(out)).toMatch(/^No such field \/x/);
  // The whole record still answers.
  expect(textOf(await h.get_entity({ id: loreId }))).toContain("Orgrimmar");
  expect(structuredOf(await h.get_entity({ id: loreId })).field).toBeUndefined();
});

test("get_entity with field on an unknown id answers as it does without one", async () => {
  const { h } = await setup();
  const out = await h.get_entity({ id: 999999, field: "/x" });
  expect(textOf(out)).toContain("No record with id 999999");
  expect(structuredOf(out)).toEqual({ hit: null });
});

test("get_entity without field is unchanged", async () => {
  const { h, questId } = await setup();
  const out = await h.get_entity({ id: questId });
  expect(Object.keys(structuredOf(out))).toEqual(["hit"]);
  expect(textOf(out)).toContain("A long road body");
});

test("fetch with field puts the slice in text", async () => {
  const { h, questId } = await setup();
  const doc = docOf(await h.fetch({ id: String(questId), field: "/questIds", offset: 48 }));
  expect(JSON.parse(doc.text)).toEqual(ids.slice(48));
  expect(doc.field).toEqual({ pointer: "/questIds", value: ids.slice(48) });
  expect(doc.field.nextOffset).toBeUndefined();
  const first = docOf(await h.fetch({ id: String(questId), field: "/questIds" }));
  expect(first.field.nextOffset).toBe(48);
  expect(JSON.parse(first.text)).toEqual(ids.slice(0, 48));
  expect(first.title).toBe("A Long Road");
});

test("fetch with a bad pointer lists the keys in text and structure", async () => {
  const { h, questId } = await setup();
  const doc = docOf(await h.fetch({ id: String(questId), field: "/nope" }));
  expect(doc.keys).toEqual(["build", "questCount", "questIds"]);
  expect(doc.field).toBeUndefined();
  expect(doc.text).toMatch(/^No such field \/nope/);
});

test("fetch with field on an unknown id keeps the existing error", async () => {
  const { h } = await setup();
  await expect(h.fetch({ id: "999999", field: "/x" })).rejects.toThrow(/No record with id/);
  await expect(h.fetch({ id: String(catalogId("quest_chain", "77")), field: "/x" })).rejects.toThrow(/No record with id/);
});

test("fetch of a release record without field is unchanged", async () => {
  const { h, questId } = await setup();
  const doc = docOf(await h.fetch({ id: String(questId) }));
  expect(doc.text).toBe("A long road body");
  expect(doc.field).toBeUndefined();
});

// The catalog records carry their structured fields in `data` too.

test("get_entity reads /questIds of a quest_chain catalog record, with its game-files label and credit", async () => {
  const { h } = await setup();
  const out = await h.get_entity({ id: chainId, field: "/questIds" });
  expect(structuredOf(out).field).toEqual({ pointer: "/questIds", value: ids.slice(0, 48), nextOffset: 48 });
  expect(structuredOf(out).hit).toMatchObject({ id: chainId, kind: "quest_chain" });
  expect(textOf(out)).toMatch(/Found in game files, unconfirmed \(build 1\.60\.1\.\d+\)\./);
  expect(textOf(out).trimEnd().endsWith(GAME_DATA_CREDIT)).toBe(true);
  const rest = await h.get_entity({ id: chainId, field: "/questIds", offset: 48 });
  expect(structuredOf(rest).field).toEqual({ pointer: "/questIds", value: ids.slice(48) });
});

test("fetch reads /questIds of a quest_chain catalog record", async () => {
  const { h } = await setup();
  const doc = docOf(await h.fetch({ id: String(chainId), field: "/questIds" }));
  expect(JSON.parse(doc.text)).toEqual(ids.slice(0, 48));
  expect(doc.field).toEqual({ pointer: "/questIds", value: ids.slice(0, 48), nextOffset: 48 });
  expect(doc.metadata).toMatchObject({ kind: "quest_chain", sourceId: "game-files", credit: GAME_DATA_CREDIT });
  const rest = docOf(await h.fetch({ id: String(chainId), field: "/questIds", offset: 48 }));
  expect(JSON.parse(rest.text)).toEqual(ids.slice(48));
  expect(rest.field.nextOffset).toBeUndefined();
  const miss = docOf(await h.fetch({ id: String(chainId), field: "/nope" }));
  expect(miss.keys).toEqual(["build", "questIds", "questCount"]);
});

test("a whole catalog record cuts long arrays and says so", async () => {
  const { h } = await setup();
  const doc = docOf(await h.fetch({ id: String(chainId) }));
  expect(doc.text).toContain(`questIds: ${ids.slice(0, 48).join(", ")}\n`);
  expect(doc.text).not.toContain(String(ids[48]));
  expect(doc.text).toContain("questIdsNextOffset: 48");
  expect(doc.text).toContain("questCount: 60");
  expect(doc.text).toMatch(/Found in game files, unconfirmed/);
  expect(doc.text.endsWith("Arrays are cut at 48 rows; read more with field and offset.")).toBe(true);
  // What the note points at works.
  expect(docOf(await h.fetch({ id: String(chainId), field: "/questIds", offset: 48 })).field.value).toEqual(ids.slice(48));
});

test("a whole catalog record with short arrays is the body as it was, with no note", async () => {
  const { h } = await setup();
  const doc = docOf(await h.fetch({ id: String(shortChainId) }));
  expect(doc.text).not.toMatch(/Arrays are cut/);
  expect(doc.text).toMatch(/^Lonely\n/);
});

test("search (the ChatGPT tool) takes no new parameters", async () => {
  const { h } = await setup();
  const out = docOf(await (h.search as (a: object) => Promise<ToolAnswer>)({ query: "Orgrimmar", field: "/x", offset: 3 }));
  expect(Object.keys(out)).toEqual(["results"]);
});
