import { mkdtempSync } from "node:fs";
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

