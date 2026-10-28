import { expect, test } from "vitest";
import { openDb } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { search, toFtsQuery } from "../src/search.js";

const row = (extId: string, name: string, body = ""): EntityInput => ({
  kind: "lore_page",
  extId,
  name,
  body,
  gameVersion: "lore",
  sourceUrl: `https://example.test/${extId}`,
  retrievedAt: "2023-11-13",
});

test("replaceSourceRows inserts rows with the source licence", async () => {
  const db = openDb(":memory:");
  const n = await replaceSourceRows(db, "curated", ["lore_page"], [row("1", "Thrall", "Warchief of the Horde")]);
  expect(n).toBe(1);
  const r = db.prepare("SELECT licence, source_id FROM entities").get();
  expect(r).toEqual({ licence: "CC-BY-SA-4.0", source_id: "curated" });
});

test("re-running replaces instead of duplicating", async () => {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "curated", ["lore_page"], [row("1", "Thrall"), row("2", "Jaina")]);
  await replaceSourceRows(db, "curated", ["lore_page"], [row("1", "Thrall")]);
  const { n } = db.prepare("SELECT count(*) AS n FROM entities").get() as { n: number };
  expect(n).toBe(1);
  expect(await search(db, "jaina")).toHaveLength(0);
});

test("a failed import rolls back and keeps the previous rows", async () => {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "curated", ["lore_page"], [row("1", "Thrall")]);
  async function* broken() {
    yield row("2", "Jaina");
    throw new Error("boom");
  }
  await expect(replaceSourceRows(db, "curated", ["lore_page"], broken())).rejects.toThrow("boom");
  expect(await search(db, "thrall")).toHaveLength(1);
});

test("rows of a kind outside the declared kinds are rejected", async () => {
  const db = openDb(":memory:");
  await expect(
    replaceSourceRows(db, "curated", ["creator"], [row("1", "Thrall")]),
  ).rejects.toThrow("lore_page");
});

test("refuses to replace existing rows with an empty import", async () => {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "curated", ["lore_page"], [row("1", "Thrall")]);
  await expect(replaceSourceRows(db, "curated", ["lore_page"], [])).rejects.toThrow(
    "refusing to replace 1 curated row(s) with an empty import",
  );
  expect(await search(db, "thrall")).toHaveLength(1);
});

test("an empty import into an empty source is fine", async () => {
  const db = openDb(":memory:");
  expect(await replaceSourceRows(db, "curated", ["lore_page"], [])).toBe(0);
});

test("search finds by name and body and returns provenance", async () => {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "curated", ["lore_page"], [row("1", "Thrall", "Warchief of the Horde")]);
  const hits = await search(db, "warchief");
  expect(hits[0]).toMatchObject({ name: "Thrall", sourceUrl: "https://example.test/1", licence: "CC-BY-SA-4.0" });
});

test("toFtsQuery quotes terms so punctuation cannot break FTS syntax", () => {
  expect(toFtsQuery('Ahn\'Qiraj "gates" (AQ)')).toBe('"ahn" "qiraj" "gates" "aq"');
  expect(toFtsQuery("  ")).toBe("");
});
