import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { buildCatalogIndex, catalogId, readCatalogFiles, type CatalogIndex } from "../src/catalog-index.js";
import { confirmedCatalog, confirmedLine } from "../src/catalog-confirmed.js";
import type { CompletionFacts } from "../src/completion.js";
import { openDb, type DB } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { createToolHandlers, type CompletionLoader, type ToolAnswer } from "../src/mcp-server.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "game-files");
const files = readCatalogFiles(fixtureRoot).files;
const index: CatalogIndex = buildCatalogIndex(files);
// The fixture holds one faction. A second, unagreed faction tests membership without changing the kind.
const twoFactions: CatalogIndex = buildCatalogIndex({
  ...files,
  factions: { ...files.factions!, factions: [...files.factions!.factions, { id: 2, name: "Orgrimmar", shown: true }] },
});

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

const textOf = (a: ToolAnswer): string => (typeof a === "string" ? a : a.text);
const structuredOf = (a: ToolAnswer): any => (typeof a === "string" ? {} : a.structured);

const dated = "2026-11-03T06:30:00.000Z";
/** A rollup that agrees on faction 1 only. */
const facts = { achievements: new Map(), factions: new Map([[1, { factionId: 1, name: "Stormwind", major: true }]]), titles: new Map(), chains: new Map(), owned: [] } as unknown as CompletionFacts;
const completion: CompletionLoader = async () => ({ facts, dataAsOf: dated });

async function handlersOver(rows: EntityInput[], options: { catalog?: CatalogIndex; completion?: CompletionLoader } = {}) {
  const db = openDb(":memory:");
  databases.push(db);
  await replaceSourceRows(db, "curated", ["lore_page"], rows);
  const h = createToolHandlers(db, { catalog: () => options.catalog ?? index, ...(options.completion ? { completion: options.completion } : {}) });
  return { db, h };
}

async function handlers(withCompletion = true) {
  return (await handlersOver([], withCompletion ? { completion } : {})).h;
}

test("a faction the rollup agrees on carries a confirmed line; one it does not agree on stays unconfirmed", async () => {
  const { h } = await handlersOver([], { catalog: twoFactions, completion });
  const yes = await h.get_entity({ id: catalogId("faction", "1") });
  const no = await h.get_entity({ id: catalogId("faction", "2") });
  expect(structuredOf(no).hit.name).toBe("Orgrimmar");
  expect(textOf(yes)).toMatch(/Confirmed by player uploads \(3 or more installs agree\) as of 2026-11-03\./);
  expect(structuredOf(yes).hit.confirmed.asOf).toBe("2026-11-03");
  expect(textOf(no)).not.toMatch(/Confirmed/);
  expect(structuredOf(no).hit.confirmed).toBeUndefined();
});

test("a confirmation without a recorded date says so, and the structured date stays null", async () => {
  const undated: CompletionLoader = async () => ({ facts, dataAsOf: null });
  const { h } = await handlersOver([], { completion: undated });
  const yes = await h.get_entity({ id: catalogId("faction", "1") });
  expect(textOf(yes)).toMatch(/Confirmed by player uploads \(3 or more installs agree\); date unrecorded\./);
  expect(structuredOf(yes).hit.confirmed.asOf).toBeNull();
  expect(confirmedLine("faction", "1", (await confirmedCatalog(undated))!)).toBe("Confirmed by player uploads (3 or more installs agree); date unrecorded.");
});

test("a release row is never confirmed, even when the rollup agrees on its numeric id", async () => {
  const lore: EntityInput = { kind: "lore_page", extId: "stormwind", name: "Stormwind", body: "A city of the Alliance.", gameVersion: "lore", sourceUrl: "https://example.test/stormwind", retrievedAt: "2023-11-13" };
  let releaseId = 0;
  const agreesOnRelease: CompletionLoader = async () => ({
    facts: { achievements: new Map(), factions: new Map([[releaseId, { factionId: releaseId, name: "Stormwind", major: true }]]), titles: new Map(), chains: new Map(), owned: [] } as unknown as CompletionFacts,
    dataAsOf: dated,
  });
  const { db, h } = await handlersOver([lore], { completion: agreesOnRelease });
  releaseId = (db.prepare("SELECT id FROM entities WHERE kind = 'lore_page'").get() as { id: number }).id;
  const answer = await h.get_entity({ id: releaseId });
  expect(structuredOf(answer).hit.kind).toBe("lore_page");
  expect(textOf(answer)).not.toMatch(/Confirmed/);
  expect(structuredOf(answer).hit.confirmed).toBeUndefined();
  const doc = JSON.parse(textOf(await h.fetch({ id: String(releaseId) })));
  expect(doc.text).not.toMatch(/Confirmed/);
  expect(doc.metadata.confirmed).toBeUndefined();
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
