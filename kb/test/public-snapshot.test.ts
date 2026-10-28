import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openDb } from "../src/db.js";
import { replaceSourceRows } from "../src/entities.js";
import { importPfquest } from "../src/importers/pfquest.js";
import { openPublicSnapshot } from "../src/public-snapshot.js";
import { search } from "../src/search.js";
import { snapshot } from "../src/snapshot.js";
import { pfquestCheckout } from "./pfquest-fixture.js";

/**
 * The public release is the artifact the MCP service serves. These tests prove it can only be
 * served when it is the artifact the exporter published: manifest shape, manifest hash, registry
 * source allowlist, empty cache, exact schema, no free pages — and never through a write.
 */

const LORE = {
  kind: "lore_page",
  extId: "1",
  name: "Thrall",
  body: "Warchief",
  gameVersion: "lore",
  sourceUrl: "https://example.test/1",
  retrievedAt: "2023-11-13",
} as const;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** A genuine exporter release: the only kind of artifact that may be served. */
async function genuineRelease(): Promise<{ dbPath: string; manifestPath: string }> {
  const dir = mkdtempSync(join(tmpdir(), "kb-pub-"));
  const live = openDb(join(dir, "kb.sqlite"));
  await replaceSourceRows(live, "curated", ["lore_page"], [LORE]);
  const dbPath = join(dir, "release", "release.sqlite");
  snapshot(live, dbPath, new Date("2026-10-05T12:00:00Z"));
  live.close();
  return { dbPath, manifestPath: `${dbPath}.manifest.json` };
}

function readManifest(manifestPath: string): Record<string, any> {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function writeManifest(manifestPath: string, manifest: Record<string, any>): void {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Keep the manifest self-consistent so a DB-level check, not the hash, is what refuses. */
function rehash(manifestPath: string, dbPath: string): void {
  writeManifest(manifestPath, { ...readManifest(manifestPath), sha256: sha256(dbPath) });
}

async function editManifest(manifestPath: string, edit: (m: Record<string, any>) => void): Promise<void> {
  const manifest = readManifest(manifestPath);
  edit(manifest);
  writeManifest(manifestPath, manifest);
}

test("a release refuses omitted source counts even when its file hash matches", async () => {
  const { dbPath, manifestPath } = await genuineRelease();
  await editManifest(manifestPath, (m) => { m.counts = {}; });
  expect(() => openPublicSnapshot(dbPath)).toThrow(/counts/i);
});

/** Mutate a genuine release and return the paths, with the manifest re-hashed to match. */
async function mutatedRelease(
  mutate: (db: Database.Database) => void,
): Promise<{ dbPath: string; manifestPath: string }> {
  const { dbPath, manifestPath } = await genuineRelease();
  const db = new Database(dbPath);
  try {
    mutate(db);
  } finally {
    db.close();
  }
  rehash(manifestPath, dbPath);
  return { dbPath, manifestPath };
}

test("a genuine release opens read-only and answers sourced reads without changing its bytes", async () => {
  const { dbPath, manifestPath } = await genuineRelease();
  const before = sha256(dbPath);

  const release = openPublicSnapshot(dbPath);
  expect(release.manifest).toMatchObject({ licence: "CC-BY-SA-4.0", counts: { curated: 1, "warcraft-wiki-2023": 0 } });
  expect(release.db.prepare("SELECT name FROM entities").all()).toEqual([{ name: "Thrall" }]);
  expect(release.db.prepare("SELECT count(*) AS n FROM entities_fts WHERE entities_fts MATCH 'Warchief'").get()).toEqual({ n: 1 });
  expect(() => release.db.exec("DELETE FROM entities")).toThrow();
  release.db.close();

  expect(sha256(dbPath)).toBe(before);
  // Read-only means read-only: serving created no journal and changed no sidecar.
  for (const sidecar of ["-wal", "-shm", "-journal"]) expect(existsSync(`${dbPath}${sidecar}`)).toBe(false);
  expect(existsSync(manifestPath)).toBe(true);
});

test("a release carries name_norm and its index, and the exact-name search reads them", async () => {
  const { dbPath } = await genuineRelease();
  const release = openPublicSnapshot(dbPath);
  expect(release.db.prepare("SELECT name_norm AS norm FROM entities").all()).toEqual([{ norm: "thrall" }]);
  expect(release.db.prepare("SELECT name FROM sqlite_master WHERE name = 'entities_name_norm'").get()).toEqual({ name: "entities_name_norm" });
  expect((await search(release.db, "thrall", 1))[0].name).toBe("Thrall");
  release.db.close();
});

test("a release built before name_norm still opens and searches through the fallback", async () => {
  const { dbPath } = await mutatedRelease((db) => {
    db.exec("DROP INDEX entities_name_norm; ALTER TABLE entities DROP COLUMN name_norm; VACUUM");
  });
  const release = openPublicSnapshot(dbPath);
  expect(release.db.prepare("SELECT name FROM pragma_table_info('entities') WHERE name = 'name_norm'").all()).toEqual([]);
  expect((await search(release.db, "thrall", 1))[0].name).toBe("Thrall");
  // The lookup that runs when the pool misses: no exact row in the pool, so the fallback expression is read.
  expect((await search(release.db, "warchief", 1))[0].name).toBe("Thrall");
  release.db.close();
});

test("a release with name_norm but no index is refused", async () => {
  const { dbPath } = await mutatedRelease((db) => db.exec("DROP INDEX entities_name_norm; VACUUM"));
  expect(() => openPublicSnapshot(dbPath)).toThrow(/schema|entities_name_norm/i);
});

test("a release built from a database holding the Classic baseline carries none of it and still serves", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-pub-"));
  const live = openDb(join(dir, "kb.sqlite"));
  await replaceSourceRows(live, "curated", ["lore_page"], [LORE]);
  await importPfquest(live, pfquestCheckout(), { now: new Date("2026-10-21T00:00:00Z") });
  expect((live.prepare("SELECT count(*) AS n FROM entities WHERE source_id = 'pfquest-classic'").get() as { n: number }).n).toBe(10);
  const dbPath = join(dir, "release", "release.sqlite");
  const manifest = snapshot(live, dbPath, new Date("2026-10-21T12:00:00Z"));
  live.close();
  expect(Object.keys(manifest.counts)).not.toContain("pfquest-classic");

  const release = openPublicSnapshot(dbPath);
  expect(release.db.prepare("SELECT source_id, name FROM entities").all()).toEqual([{ source_id: "curated", name: "Thrall" }]);
  expect(release.db.prepare("SELECT id FROM sources WHERE id = 'pfquest-classic'").all()).toEqual([]);
  release.db.close();
  // VACUUM leaves no deleted baseline text in free pages of the file.
  expect(readFileSync(dbPath).includes("Field Rat")).toBe(false);
});

test("a missing or malformed manifest is refused", async () => {
  const { dbPath, manifestPath } = await genuineRelease();

  rmSync(manifestPath);
  expect(() => openPublicSnapshot(dbPath)).toThrow(/manifest/i);

  writeFileSync(manifestPath, "{ not json");
  expect(() => openPublicSnapshot(dbPath)).toThrow(/manifest/i);
});

test("a manifest with the wrong licence, notice or hash is refused", async () => {
  const licence = await genuineRelease();
  await editManifest(licence.manifestPath, (m) => (m.licence = "MIT"));
  expect(() => openPublicSnapshot(licence.dbPath)).toThrow(/licence/i);

  const notice = await genuineRelease();
  await editManifest(notice.manifestPath, (m) => (m.notice = "nothing to see here"));
  expect(() => openPublicSnapshot(notice.dbPath)).toThrow(/notice/i);

  const hash = await genuineRelease();
  await editManifest(hash.manifestPath, (m) => (m.sha256 = "0".repeat(64)));
  expect(() => openPublicSnapshot(hash.dbPath)).toThrow(/hash|sha/i);
});

test("a manifest whose counts disagree with the database is refused", async () => {
  const { dbPath, manifestPath } = await genuineRelease();
  await editManifest(manifestPath, (m) => (m.counts = { curated: 99, "warcraft-wiki-2023": 0 }));
  rehash(manifestPath, dbPath);
  expect(() => openPublicSnapshot(dbPath)).toThrow(/count/i);
});

test("an empty release is refused rather than served as an empty knowledge base", async () => {
  const { dbPath, manifestPath } = await mutatedRelease((db) => db.exec("DELETE FROM entities; VACUUM;"));
  await editManifest(manifestPath, (m) => (m.counts = { curated: 0, "warcraft-wiki-2023": 0 }));
  rehash(manifestPath, dbPath);
  expect(() => openPublicSnapshot(dbPath)).toThrow(/empty|no entit/i);
});

test("a non-publishable row is refused even when the file's own flags claim it is publishable", async () => {
  const { dbPath, manifestPath } = await mutatedRelease((db) => {
    // The exporter removed this source row entirely; a tampered file re-adds it claiming to be
    // publishable. Only the code registry may decide that, so this must still be refused.
    db.prepare("INSERT INTO sources (id, name, licence, publishable, homepage) VALUES ('blizzard-api', 'Blizzard API', 'CC-BY-SA-4.0', 1, 'https://develop.battle.net')").run();
    db.prepare(
      "INSERT INTO entities (kind, ext_id, name, body, game_version, source_id, source_url, licence, retrieved_at)" +
        " VALUES ('item', '19019', 'ZzBlizzardLeakMarker', '', 'forever', 'blizzard-api', 'https://develop.battle.net/x', 'CC-BY-SA-4.0', '2026-09-27')",
    ).run();
  });
  await editManifest(manifestPath, (m) => (m.counts = { ...m.counts, "blizzard-api": 1 }));
  rehash(manifestPath, dbPath);
  expect(() => openPublicSnapshot(dbPath)).toThrow(/publishable/i);
});

test("a leftover api_cache row is refused", async () => {
  const { dbPath } = await mutatedRelease((db) => {
    db.prepare("INSERT INTO api_cache VALUES ('k', '{\"leak\":1}', '2026-09-27', '2026-09-28')").run();
  });
  expect(() => openPublicSnapshot(dbPath)).toThrow(/api_cache/i);
});

test("an extra table or view is refused", async () => {
  const table = await mutatedRelease((db) => db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY)"));
  expect(() => openPublicSnapshot(table.dbPath)).toThrow(/schema|table|extra/i);

  const view = await mutatedRelease((db) => db.exec("CREATE VIEW recent AS SELECT name FROM entities"));
  expect(() => openPublicSnapshot(view.dbPath)).toThrow(/schema|view|extra/i);
});

test("a column added to a served table is refused", async () => {
  const { dbPath } = await mutatedRelease((db) => db.exec("ALTER TABLE entities ADD COLUMN note TEXT"));
  expect(() => openPublicSnapshot(dbPath)).toThrow(/schema|table|extra/i);
});

test("an active WAL or journal sidecar is refused", async () => {
  const { dbPath } = await genuineRelease();
  writeFileSync(`${dbPath}-wal`, Buffer.from("not an empty wal"));
  expect(() => openPublicSnapshot(dbPath)).toThrow(/wal|journal|sidecar|active/i);
  expect(statSync(`${dbPath}-wal`).size).toBeGreaterThan(0);
});

test("the serving path never runs the writable FTS integrity check", async () => {
  // A stale FTS row for a nonexistent entity breaks the writable integrity-check command but
  // nothing else this path checks: if serving refuses, the writable check leaked back in.
  const { dbPath } = await mutatedRelease((db) => {
    db.prepare("INSERT INTO entities_fts(rowid, name, body) VALUES (9999, 'ZzStaleIndexRow', 'orphan')").run();
  });
  const release = openPublicSnapshot(dbPath);
  expect(release.db.prepare("SELECT count(*) AS n FROM entities").get()).toEqual({ n: 1 });
  release.db.close();
});

test("a missing or empty database file is refused before any handle is returned", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-pub-"));
  expect(() => openPublicSnapshot(join(dir, "nothing.sqlite"))).toThrow(/not found|exist/i);

  const { dbPath, manifestPath } = await genuineRelease();
  writeFileSync(dbPath, "");
  await editManifest(manifestPath, (m) => (m.sha256 = createHash("sha256").update("").digest("hex")));
  expect(() => openPublicSnapshot(dbPath)).toThrow();
});

test("a malformed facets key in the manifest is refused", async () => {
  const fresh = await genuineRelease();
  await editManifest(fresh.manifestPath, (m) => (m.facets = "x"));
  expect(() => openPublicSnapshot(fresh.dbPath)).toThrow(/facets/);
  await editManifest(fresh.manifestPath, (m) => (m.facets = { top: { zone: [{ value: 1, n: 2 }] }, byType: {} }));
  expect(() => openPublicSnapshot(fresh.dbPath)).toThrow(/facets/);
  await editManifest(fresh.manifestPath, (m) => (m.facets = { top: { zone: [{ value: "Zul'Gurub", n: -1 }] }, byType: {} }));
  expect(() => openPublicSnapshot(fresh.dbPath)).toThrow(/facets/);
  await editManifest(fresh.manifestPath, (m) => (m.facets = { top: {}, byType: { npc: { race: [1] } } }));
  expect(() => openPublicSnapshot(fresh.dbPath)).toThrow(/facets/);
  await editManifest(fresh.manifestPath, (m) => (m.facets = { top: { zone: [{ value: "Zul'Gurub", n: 1 }] }, byType: { npc: { race: ["Orc"] } } }));
  expect(() => openPublicSnapshot(fresh.dbPath)).not.toThrow();
  // A typed release without facet totals would serve the slow scan paths: refuse it outright.
  await editManifest(fresh.manifestPath, (m) => { m.types = { other: 1 }; delete m.facets; });
  expect(() => openPublicSnapshot(fresh.dbPath)).toThrow(/facet totals/);
});

test("malformed browse letters, or a typed release without them, are refused", async () => {
  const fresh = await genuineRelease();
  for (const letters of ["x", { npc: "r" }, { npc: ["ab"] }, { npc: [1] }, { npc: ["A"] }]) {
    await editManifest(fresh.manifestPath, (m) => (m.letters = letters));
    expect(() => openPublicSnapshot(fresh.dbPath)).toThrow(/letters/);
  }
  await editManifest(fresh.manifestPath, (m) => (m.letters = { npc: ["r", "#"] }));
  expect(() => openPublicSnapshot(fresh.dbPath)).not.toThrow();
  // A typed release without them would serve a full-table scan per sitemap request: refuse it outright.
  await editManifest(fresh.manifestPath, (m) => { m.types = { other: 1 }; m.facets = { top: {}, byType: {} }; delete m.letters; });
  expect(() => openPublicSnapshot(fresh.dbPath)).toThrow(/letters/);
});

test("a release built before the type index existed still opens; a malformed types key is refused", async () => {
  const { dbPath } = await mutatedRelease((db) => {
    db.exec("DROP INDEX entities_type_name; VACUUM;");
  });
  const release = openPublicSnapshot(dbPath);
  expect(release.manifest.counts.curated).toBe(1);
  release.db.close();

  const fresh = await genuineRelease();
  expect(readManifest(fresh.manifestPath).types).toBeUndefined(); // nothing typed: say nothing
  await editManifest(fresh.manifestPath, (m) => (m.types = "x"));
  expect(() => openPublicSnapshot(fresh.dbPath)).toThrow(/types/);
  await editManifest(fresh.manifestPath, (m) => { m.types = { other: 1 }; m.damaged = -1; });
  expect(() => openPublicSnapshot(fresh.dbPath)).toThrow(/damaged/);
  await editManifest(fresh.manifestPath, (m) => { delete m.types; delete m.damaged; });
  expect(() => openPublicSnapshot(fresh.dbPath)).not.toThrow();
});
