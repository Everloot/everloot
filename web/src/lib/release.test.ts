import Database from "better-sqlite3";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { openDb } from "../../../kb/src/db";
import { replaceSourceRows } from "../../../kb/src/entities";
import { snapshot } from "../../../kb/src/snapshot";

let release = "";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-release-"));
  const source = openDb(join(dir, "source.sqlite"));
  await replaceSourceRows(source, "curated", ["lore_page"], [{
    kind: "lore_page", extId: "1", name: "Thrall", body: "Warchief of the Horde",
    gameVersion: "lore", sourceUrl: "https://example.test/thrall", retrievedAt: "2023-11-13",
  }]);
  release = join(dir, "release", "release.sqlite");
  snapshot(source, release, new Date("2026-10-15T00:00:00Z"));
  source.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock("@opennextjs/cloudflare");
});

async function load(path: string) {
  vi.stubEnv("KB_SNAPSHOT_PATH", path);
  return import("./release");
}

test("getRelease returns the same open handle twice", async () => {
  const { getRelease } = await load(release);
  const a = await getRelease();
  const b = await getRelease();
  expect(a).not.toBeNull();
  expect(a).toBe(b);
  expect(a?.manifest.counts.curated).toBe(1);
});

test("a missing release is null and logged once", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { getRelease } = await load(join(tmpdir(), "no-such-release.sqlite"));
  expect(await getRelease()).toBeNull();
  expect(await getRelease()).toBeNull();
  expect(error).toHaveBeenCalledTimes(1);
  expect(error.mock.calls[0][0]).toBe("[release] knowledge release unavailable");
});

test("after a failed open the release is not re-hashed for 60 seconds", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { getRelease } = await load(join(tmpdir(), "no-such-release.sqlite"));
  expect(await getRelease()).toBeNull();
  expect(await getRelease()).toBeNull();
  expect(error).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date("2026-10-15T12:01:01Z"));
  expect(await getRelease()).toBeNull();
  expect(error).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

test("releasePath falls back to the bundled release when the env var is blank", async () => {
  const { releasePath } = await load("  ");
  expect(releasePath()).toBe(join(process.cwd(), ".release", "2026-10-05-everloot-public.sqlite"));
});

/** The Worker's context as OpenNext hands it over. */
function onWorker(env: Record<string, unknown>) {
  vi.doMock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env }) }));
}

/** D1 stood in for by a binding over better-sqlite3 with D1's surface. */
function fakeD1(db: Database.Database) {
  return {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        all: async () => ({ results: db.prepare(sql).all(...values) }),
        first: async () => db.prepare(sql).get(...values) ?? null,
      }),
    }),
  };
}

/** A copy of the release as the D1 import leaves it: with the release_meta row it writes last, or not. */
function imported(meta: "row" | "no-table" | "no-row"): { d1: Database.Database; sha256: string } {
  const copy = join(mkdtempSync(join(tmpdir(), "everloot-d1-")), "d1.sqlite");
  copyFileSync(release, copy);
  const manifest = readFileSync(`${release}.manifest.json`, "utf8");
  const sha256 = JSON.parse(manifest).sha256 as string;
  const d1 = new Database(copy);
  if (meta !== "no-table") d1.exec("CREATE TABLE release_meta (id INTEGER PRIMARY KEY CHECK (id = 1), sha256 TEXT NOT NULL, manifest TEXT NOT NULL)");
  if (meta === "row") d1.prepare("INSERT INTO release_meta (id, sha256, manifest) VALUES (1, ?, ?)").run(sha256, manifest);
  return { d1, sha256 };
}

test("on the Worker with a KNOWLEDGE_D1 binding, the release is read from D1, not the file", async () => {
  const { d1, sha256 } = imported("row");
  onWorker({ KNOWLEDGE_D1: fakeD1(d1), KNOWLEDGE_RELEASE_SHA256: sha256 });
  const { getRelease } = await load(join(tmpdir(), "no-such-release.sqlite"));
  const opened = await getRelease();
  expect(opened?.manifest.sha256).toBe(sha256);
  expect(await opened?.db.get("SELECT name FROM entities WHERE ext_id = ?", "1")).toEqual({ name: "Thrall" });
  expect(await getRelease()).toBe(opened);
});

test("a D1 release without its release_meta table or row, or with another hash, is unavailable", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const [meta, expected] of [["no-table", null], ["no-row", null], ["row", "0".repeat(64)]] as const) {
    vi.resetModules();
    const { d1, sha256 } = imported(meta);
    onWorker({ KNOWLEDGE_D1: fakeD1(d1), KNOWLEDGE_RELEASE_SHA256: expected ?? sha256 });
    // The file is there and valid: D1 is the release on the Worker, so it is never the fallback.
    const { getRelease } = await load(release);
    expect(await getRelease()).toBeNull();
  }
  expect(error).toHaveBeenCalledTimes(3);
  expect(String(error.mock.calls[0][1])).toMatch(/no release_meta table/);
  expect(String(error.mock.calls[1][1])).toMatch(/no release_meta row/);
  expect(String(error.mock.calls[2][1])).toMatch(/this build expects/);
});

test("on the Worker without the binding, the release is the file, as on Node", async () => {
  onWorker({});
  const { getRelease } = await load(release);
  expect((await getRelease())?.manifest.counts.curated).toBe(1);
});
