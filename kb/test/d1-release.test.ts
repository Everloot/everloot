import Database from "better-sqlite3";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { replaceSourceRows } from "../src/entities.js";
import { openD1Release } from "../src/public-snapshot.js";
import { d1ReleaseDb, type D1Like } from "../src/release-db.js";
import { getByName, getEntity, search } from "../src/search.js";
import { snapshot } from "../src/snapshot.js";

/**
 * The release imported into D1 (web/scripts/cf-release-d1.mjs) is served only when its release_meta row
 * holds a manifest that passes the file's checks and the sha256 the deployment expects. D1 is stood in for
 * by a binding over better-sqlite3 with D1's surface: prepare, bind, all() -> { results }, first() -> row | null.
 */

function fakeD1(db: DB): D1Like {
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        all: async <T>() => ({ results: db.prepare(sql).all(...values) as T[] }),
        first: async <T>() => (db.prepare(sql).get(...values) as T | undefined) ?? null,
      }),
    }),
  };
}

/** An exporter release, a writable copy of it standing in for the D1 import, and its manifest's text and hash. */
async function imported(): Promise<{ d1: DB; manifest: string; sha256: string }> {
  const dir = mkdtempSync(join(tmpdir(), "kb-d1-"));
  const live = openDb(join(dir, "kb.sqlite"));
  await replaceSourceRows(live, "curated", ["lore_page"], [
    { kind: "lore_page", extId: "1", name: "Thrall", body: "Warchief of the Horde", gameVersion: "lore", sourceUrl: "https://example.test/1", retrievedAt: "2023-11-13" },
    { kind: "lore_page", extId: "2", name: "Jaina Proudmoore", body: "Lord Admiral of Kul Tiras", gameVersion: "lore", sourceUrl: "https://example.test/2", retrievedAt: "2023-11-13" },
  ]);
  const release = join(dir, "release", "release.sqlite");
  snapshot(live, release, new Date("2026-10-28T12:00:00Z"));
  live.close();
  copyFileSync(release, join(dir, "d1.sqlite"));
  const manifest = readFileSync(`${release}.manifest.json`, "utf8");
  return { d1: new Database(join(dir, "d1.sqlite")), manifest, sha256: JSON.parse(manifest).sha256 as string };
}

function writeMeta(db: DB, sha256: string, manifest: string): void {
  db.exec("CREATE TABLE release_meta (id INTEGER PRIMARY KEY CHECK (id = 1), sha256 TEXT NOT NULL, manifest TEXT NOT NULL)");
  db.prepare("INSERT INTO release_meta (id, sha256, manifest) VALUES (1, ?, ?)").run(sha256, manifest);
}

test("a D1 release with its release_meta row serves the same reads as the file", async () => {
  const { d1, manifest, sha256 } = await imported();
  writeMeta(d1, sha256, manifest);
  const release = await openD1Release(fakeD1(d1), sha256);
  expect(release.manifest.sha256).toBe(sha256);
  expect(release.manifest.counts).toEqual({ "warcraft-wiki-2023": 0, curated: 2 });
  const hits = await search(release.db, "who is thrall");
  expect(hits.map((h) => h.name)).toEqual(await search(d1, "who is thrall").then((r) => r.map((h) => h.name)));
  expect(hits[0]).toMatchObject({ name: "Thrall", snippet: "Warchief of the Horde" });
  expect(await getByName(release.db, "jaina proudmoore")).toMatchObject([{ name: "Jaina Proudmoore" }]);
  expect(await getEntity(release.db, hits[0]!.id)).toMatchObject({ name: "Thrall" });
  expect(await getEntity(release.db, -1)).toBeUndefined();
});

test("a D1 database without release_meta is refused: not an imported release", async () => {
  const { d1, sha256 } = await imported();
  await expect(openD1Release(fakeD1(d1), sha256)).rejects.toThrow(/no release_meta table/);
});

test("a release_meta table without its row is refused: the import did not finish", async () => {
  const { d1, manifest, sha256 } = await imported();
  writeMeta(d1, sha256, manifest);
  d1.exec("DELETE FROM release_meta");
  await expect(openD1Release(fakeD1(d1), sha256)).rejects.toThrow(/no release_meta row/);
});

test("a release other than the one the deployment expects is refused", async () => {
  const { d1, manifest, sha256 } = await imported();
  writeMeta(d1, sha256, manifest);
  await expect(openD1Release(fakeD1(d1), "0".repeat(64))).rejects.toThrow(/this build expects 0{64}/);
  await expect(openD1Release(fakeD1(d1), "")).rejects.toThrow(/no release sha256 configured/);
});

test("release_meta must agree with its own manifest, and the manifest must pass the file's checks", async () => {
  const mismatched = await imported();
  writeMeta(mismatched.d1, "f".repeat(64), mismatched.manifest);
  await expect(openD1Release(fakeD1(mismatched.d1), mismatched.sha256)).rejects.toThrow(/does not match its manifest/);

  const foreign = await imported();
  writeMeta(foreign.d1, foreign.sha256, JSON.stringify({ ...JSON.parse(foreign.manifest), notice: "another notice" }));
  await expect(openD1Release(fakeD1(foreign.d1), foreign.sha256)).rejects.toThrow(/notice does not match/);

  const broken = await imported();
  writeMeta(broken.d1, broken.sha256, "{not json");
  await expect(openD1Release(fakeD1(broken.d1), broken.sha256)).rejects.toThrow(/not valid JSON: D1 release_meta/);
});

test("an emptied D1 release is refused even with a valid release_meta row", async () => {
  const { d1, manifest, sha256 } = await imported();
  writeMeta(d1, sha256, manifest);
  d1.exec("DELETE FROM entities");
  await expect(openD1Release(fakeD1(d1), sha256)).rejects.toThrow(/no entities/);
});

test("d1ReleaseDb answers a missing row as undefined, as better-sqlite3 does", async () => {
  const { d1 } = await imported();
  const db = d1ReleaseDb(fakeD1(d1));
  expect(await db.get("SELECT id FROM entities WHERE id = ?", -1)).toBeUndefined();
  expect(await db.all("SELECT id FROM entities WHERE id = ?", -1)).toEqual([]);
});
