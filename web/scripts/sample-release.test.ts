import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { sampleRelease } from "./sample-release";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test("writes a release and its manifest under the folder it is given", async () => {
  const out = mkdtempSync(join(tmpdir(), "everloot-sample-"));
  const { path } = await sampleRelease(out);
  expect(path.startsWith(out)).toBe(true);
  expect(existsSync(path)).toBe(true);
  expect(existsSync(`${path}.manifest.json`)).toBe(true);
});

test("prints a KB_SNAPSHOT_PATH line with forward slashes, so it works in .env.local on Windows", async () => {
  const { path, envLine } = await sampleRelease(mkdtempSync(join(tmpdir(), "everloot-sample-")));
  expect(envLine).not.toContain("\\");
  expect(envLine).toBe(`KB_SNAPSHOT_PATH=${path.replace(/\\/g, "/")}`);
});

test("the site opens it as a typed release", async () => {
  const { envLine } = await sampleRelease(mkdtempSync(join(tmpdir(), "everloot-sample-")));
  vi.stubEnv("KB_SNAPSHOT_PATH", envLine.slice("KB_SNAPSHOT_PATH=".length));
  const { hasTypes } = await import("../src/lib/lore");
  expect(await hasTypes()).toBe(true);
});
