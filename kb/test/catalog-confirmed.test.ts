import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { buildCatalogIndex, catalogId, readCatalogFiles, type CatalogIndex } from "../src/catalog-index.js";
import { confirmedCatalog, confirmedLine } from "../src/catalog-confirmed.js";
import type { CompletionFacts } from "../src/completion.js";
import { openDb, type DB } from "../src/db.js";
import { replaceSourceRows } from "../src/entities.js";
import { createToolHandlers, type ToolAnswer } from "../src/mcp-server.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "game-files");
const index: CatalogIndex = buildCatalogIndex(readCatalogFiles(fixtureRoot).files);

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

const textOf = (a: ToolAnswer): string => (typeof a === "string" ? a : a.text);
const structuredOf = (a: ToolAnswer): any => (typeof a === "string" ? {} : a.structured);

/** A rollup that agrees on faction 1 only. */
const facts = { achievements: new Map(), factions: new Map([[1, { factionId: 1, name: "Stormwind", major: true }]]), titles: new Map(), chains: new Map(), owned: [] } as unknown as CompletionFacts;
const completion = async () => ({ facts, dataAsOf: "2026-11-03T06:30:00.000Z" });

async function handlers(withCompletion = true) {
  const db = openDb(":memory:");
  databases.push(db);
  await replaceSourceRows(db, "curated", ["lore_page"], []);
  return createToolHandlers(db, { catalog: () => index, ...(withCompletion ? { completion } : {}) });
}

test("a faction the rollup agrees on carries a confirmed line; one it does not stays unconfirmed", async () => {
  const h = await handlers();
  const yes = await h.get_entity({ id: catalogId("faction", "1") });
  const no = await h.get_entity({ id: catalogId("quest_chain", "1") });
  expect(textOf(yes)).toMatch(/Confirmed by player uploads \(3 or more installs agree\) as of 2026-11-03\./);
  expect(structuredOf(yes).hit.confirmed.asOf).toBe("2026-11-03");
  expect(textOf(no)).not.toMatch(/Confirmed/);
  expect(structuredOf(no).hit.confirmed).toBeUndefined();
});

test("search_knowledge and get_by_name annotate the confirmed hit", async () => {
  const h = await handlers();
  const found = await h.search_knowledge({ query: "Stormwind", limit: 5 });
  expect(structuredOf(found).hits.find((x: any) => x.kind === "faction").confirmed.asOf).toBe("2026-11-03");
  expect(textOf(found)).toMatch(/Confirmed by player uploads/);
  const named = await h.get_by_name({ name: "Stormwind", kind: "faction" });
  expect(structuredOf(named).hits[0].confirmed.asOf).toBe("2026-11-03");
});

test("fetch appends the line as the last line of text and sets metadata.confirmed", async () => {
  const h = await handlers();
  const out = JSON.parse(textOf(await h.fetch({ id: String(catalogId("faction", "1")) })));
  expect(out.text.split("\n").pop()).toBe("Confirmed by player uploads (3 or more installs agree) as of 2026-11-03.");
  expect(out.metadata.confirmed).toEqual({ asOf: "2026-11-03" });
  const other = JSON.parse(textOf(await h.fetch({ id: String(catalogId("quest_chain", "1")) })));
  expect(other.text).not.toMatch(/Confirmed/);
  expect(other.metadata.confirmed).toBeUndefined();
});

test("with no completion loader the answer is unchanged and never throws", async () => {
  const h = await handlers(false);
  const out = JSON.parse(textOf(await h.fetch({ id: String(catalogId("faction", "1")) })));
  expect(out.metadata.confirmed).toBeUndefined();
  expect(out.text).not.toMatch(/Confirmed/);
});

test("a loader that throws or returns null leaves the answer unconfirmed", async () => {
  expect(await confirmedCatalog(undefined)).toBeNull();
  expect(await confirmedCatalog(async () => null)).toBeNull();
  expect(await confirmedCatalog(async () => { throw new Error("down"); })).toBeNull();
  expect(confirmedLine("faction", "1", (await confirmedCatalog(completion))!)).toMatch(/as of 2026-11-03\.$/);
  expect(confirmedLine("mount", "1", (await confirmedCatalog(completion))!)).toBeNull();
});
