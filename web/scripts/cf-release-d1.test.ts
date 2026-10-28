import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { openDb } from "../../kb/src/db";
import { replaceSourceRows } from "../../kb/src/entities";
import { openD1Release } from "../../kb/src/public-snapshot";
import type { D1Like } from "../../kb/src/release-db";
import { getDocument, search } from "../../kb/src/search";
import { snapshot } from "../../kb/src/snapshot";
import { splitText, STATEMENT_BYTES, writeD1Release } from "./cf-release-d1.mjs";

/** Longer than one D1 statement, with quotes, accents and a character outside the BMP to cut around. */
const LONG = `Thrall's saga. ${"Durotar’s red earth, Orgrimmar’s walls; the Horde's warchief rides. 🐺 ".repeat(4_000)}The end.`;

let release = "";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-cf-d1-"));
  const source = openDb(join(dir, "source.sqlite"));
  await replaceSourceRows(source, "curated", ["lore_page"], [
    { kind: "lore_page", extId: "1", name: "Thrall", body: LONG, gameVersion: "lore", sourceUrl: "https://example.test/1", retrievedAt: "2023-11-13" },
    ...Array.from({ length: 300 }, (_, i) => ({
      kind: "lore_page" as const, extId: String(i + 2), name: `Page ${i + 2}`, body: `Grommash and the Warsong clan, page ${i + 2}. ${"x".repeat(400)}`,
      gameVersion: "lore" as const, sourceUrl: `https://example.test/${i + 2}`, retrievedAt: "2023-11-13",
    })),
  ]);
  release = join(dir, "release", "release.sqlite");
  snapshot(source, release, new Date("2026-10-28T00:00:00Z"));
  source.close();
});

function fakeD1(db: Database.Database): D1Like {
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        all: async <T>() => ({ results: db.prepare(sql).all(...values) as T[] }),
        first: async <T>() => (db.prepare(sql).get(...values) as T | undefined) ?? null,
      }),
    }),
  };
}

/** The import as `wrangler d1 execute --file` runs it, into a new, empty database. */
function execute(files: string[]): Database.Database {
  const db = new Database(":memory:");
  for (const file of files) db.exec(readFileSync(file, "utf8"));
  return db;
}

const write = (partBytes = 64 * 1024) => writeD1Release({ release, out: mkdtempSync(join(tmpdir(), "everloot-d1-sql-")), partBytes, log: () => {} });

test("the imported release reads the same as the file: rows, long bodies, search and release_meta", async () => {
  const { files, sha256, rows, longest } = await write();
  expect(rows).toBe(301);
  expect(files.length).toBeGreaterThan(1);
  expect(longest).toBeLessThanOrEqual(STATEMENT_BYTES);
  const d1 = execute(files);
  const opened = await openD1Release(fakeD1(d1), sha256);
  const file = new Database(release, { readonly: true });
  expect(opened.manifest).toEqual(JSON.parse(readFileSync(`${release}.manifest.json`, "utf8")));
  const thrall = (await search(file, "thrall"))[0]!;
  expect((await getDocument(opened.db, thrall.id))?.body).toBe(LONG);
  for (const q of ["thrall", "grommash warsong", "durotar warchief", "page 150"]) {
    expect(await search(opened.db, q, 25)).toEqual(await search(file, q, 25));
  }
  // FTS5 throws on an index that does not match its content table.
  expect(() => d1.prepare("INSERT INTO entities_fts(entities_fts, rank) VALUES ('integrity-check', 1)").run()).not.toThrow();
  file.close();
});

test("an import with a file left out stops at release_meta and leaves no row", async () => {
  const { files } = await write();
  const d1 = new Database(":memory:");
  const skipped = files.filter((_, i) => i !== 1);
  for (const file of skipped.slice(0, -1)) d1.exec(readFileSync(file, "utf8"));
  expect(() => d1.exec(readFileSync(skipped.at(-1)!, "utf8"))).toThrow(/CHECK constraint failed/);
  expect(d1.prepare("SELECT count(*) AS n FROM release_meta").get()).toEqual({ n: 0 });
});

test("a release whose manifest hash is not the file's is refused before anything is written", async () => {
  const manifestPath = `${release}.manifest.json`;
  const original = readFileSync(manifestPath, "utf8");
  writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(original), sha256: "0".repeat(64) }));
  try {
    await expect(write()).rejects.toThrow(/hash does not match/);
  } finally {
    writeFileSync(manifestPath, original);
  }
});

test("splitText keeps every piece's literal under the limit and never cuts a character", () => {
  const pieces = splitText(LONG, 1_000);
  expect(pieces.join("")).toBe(LONG);
  for (const p of pieces) {
    expect(Buffer.byteLength(`'${p.replaceAll("'", "''")}'`)).toBeLessThanOrEqual(1_000);
    expect(p).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  }
});
