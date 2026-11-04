import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { openDb, openExistingReadOnlyDb, type DB } from "../src/db.js";
import { ALL_KINDS } from "../src/entities.js";
import { SOURCES } from "../src/sources.js";

/** SHA-256 of the file bytes, so a read-only open can be proven not to have touched them. */
function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const LORE_ROW = {
  kind: "lore_page",
  ext_id: "1",
  name: "Thrall",
  body: "A troll shaman.",
  game_version: "lore",
  source_id: "warcraft-wiki-2023",
  source_url: "https://warcraft.wiki.gg/Thrall",
  licence: "CC-BY-SA-4.0",
  retrieved_at: "2023-11-13",
};

/** A real populated file, created with the writer opener and closed cleanly. */
function populatedDb(name = "populated.sqlite"): string {
  const file = join(mkdtempSync(join(tmpdir(), "kb-ro-")), name);
  const db = openDb(file);
  db.prepare(
    "INSERT INTO entities (kind, ext_id, name, body, game_version, source_id, source_url, licence, retrieved_at)" +
      " VALUES (@kind, @ext_id, @name, @body, @game_version, @source_id, @source_url, @licence, @retrieved_at)",
  ).run(LORE_ROW);
  db.close();
  return file;
}

test("openDb creates the schema and registers every source", () => {
  const db = openDb(":memory:");
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name);
  expect(tables).toEqual(expect.arrayContaining(["api_cache", "entities", "entities_fts", "sources"]));
  const sources = db.prepare("SELECT id, licence, publishable FROM sources ORDER BY id").all();
  expect(sources).toHaveLength(Object.keys(SOURCES).length);
  expect(sources).toContainEqual({ id: "blizzard-api", licence: "blizzard-developer-api-terms", publishable: 0 });
  expect(sources).toContainEqual({ id: "warcraft-wiki-2023", licence: "CC-BY-SA-4.0", publishable: 1 });
});

test("name lookups use the entities_name index", () => {
  const db = openDb(":memory:");
  const plan = db
    .prepare("EXPLAIN QUERY PLAN SELECT * FROM entities WHERE name = ? COLLATE NOCASE")
    .all("Thrall") as { detail: string }[];
  expect(plan.some((row) => row.detail.includes("entities_name"))).toBe(true);
});

test("openDb is safe to call twice on the same file", () => {
  const file = join(mkdtempSync(join(tmpdir(), "kb-db-")), "kb.sqlite");
  openDb(file).close();
  const again = openDb(file);
  expect(again.prepare("SELECT count(*) AS n FROM sources").get()).toEqual({ n: Object.keys(SOURCES).length });
});

test("a missing database is refused and neither the file nor its directory is created", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "kb-ro-")), "absent");
  const missing = join(dir, "kb.sqlite");
  expect(() => openExistingReadOnlyDb(missing)).toThrow(/exist|found/i);
  expect(existsSync(missing)).toBe(false);
  expect(existsSync(dir)).toBe(false);
});

test("a blank path is refused", () => {
  expect(() => openExistingReadOnlyDb("")).toThrow();
  expect(() => openExistingReadOnlyDb("   ")).toThrow();
});

test("an empty initialized database is refused rather than served as an empty knowledge base", () => {
  const file = join(mkdtempSync(join(tmpdir(), "kb-ro-")), "empty.sqlite");
  openDb(file).close();
  expect(() => openExistingReadOnlyDb(file)).toThrow(/entit|empty|populat/i);
});

test("bytes that are not a database are refused", () => {
  const file = join(mkdtempSync(join(tmpdir(), "kb-ro-")), "notes.sqlite");
  writeFileSync(file, "these are not sqlite bytes at all");
  expect(() => openExistingReadOnlyDb(file)).toThrow();
});

test("a database missing the core tables is refused", () => {
  const file = join(mkdtempSync(join(tmpdir(), "kb-ro-")), "other.sqlite");
  const db = new Database(file);
  db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  db.close();
  expect(() => openExistingReadOnlyDb(file)).toThrow(/table|entities/i);
});

test("a populated database opens read-only, serves reads, and is not modified", () => {
  const file = populatedDb();
  const before = sha256File(file);

  const ro = openExistingReadOnlyDb(file);
  expect(ro.prepare("SELECT name FROM entities WHERE name = ?").get("Thrall")).toMatchObject({ name: "Thrall" });
  expect(ro.prepare("SELECT count(*) AS n FROM entities_fts WHERE entities_fts MATCH ?").get("Thrall")).toEqual({ n: 1 });
  expect(() => ro.exec("DELETE FROM entities")).toThrow();
  expect(() => ro.prepare("UPDATE entities SET name = ? WHERE name = ?").run("Someone", "Thrall")).toThrow();
  ro.close();

  expect(sha256File(file)).toBe(before);
});

test("a failed readiness check leaves no open handle behind", () => {
  const empty = join(mkdtempSync(join(tmpdir(), "kb-ro-")), "empty.sqlite");
  openDb(empty).close();
  expect(() => openExistingReadOnlyDb(empty)).toThrow();
  // A closed-on-failure handle means the file can still be reopened for writing.
  const writer = openDb(empty);
  expect(writer.prepare("SELECT count(*) AS n FROM sources").get()).toEqual({ n: Object.keys(SOURCES).length });
  writer.close();
});

/** A minimal row of the given kind, written straight to entities. */
function insertRow(db: DB, kind: string): void {
  db.prepare(
    "INSERT INTO entities (kind, ext_id, name, body, game_version, source_id, source_url, licence, retrieved_at)" +
      " VALUES (@kind, @ext_id, @name, '', 'forever', 'curated', @source_url, 'CC-BY-SA-4.0', '2026-11-03')",
  ).run({ kind, ext_id: kind, name: `${kind} sample`, source_url: `https://example.test/${kind}` });
}

test("the entities table accepts every ALL_KINDS value", () => {
  const db = openDb(":memory:");
  for (const kind of ALL_KINDS) expect(() => insertRow(db, kind)).not.toThrow();
  const { n } = db.prepare("SELECT count(*) AS n FROM entities").get() as { n: number };
  expect(n).toBe(ALL_KINDS.length);
});
