import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { listBackups } from "../src/main/backups";
import { companionJobs } from "../src/main/jobs";
import { defaultSettings } from "../src/main/settings";

test("an upload keeps a local backup even when the site cannot be reached", async () => {
  const d = mkdtempSync(join(tmpdir(), "everloot-offline-backup-"));
  const file = join(d, "Everloot.lua");
  const text = `EverlootDB = { version = "0.3.12", installId = "abcd-1234-ef56-7890", records = { loot = {
    { eventId = "epoch:1", capturedAt = "2026-10-27T00:00:00Z", sourceNpcId = 42, sourceEvidence = "loot-api", items = { { itemId = 5, count = 1 } } },
  } } }`;
  writeFileSync(file, text);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  try {
    const data = join(d, "data");
    await expect(companionJobs(data, defaultSettings).deps.upload(file)).rejects.toThrow();
    const backups = listBackups(data);
    expect(backups).toHaveLength(1);
    expect(readFileSync(backups[0].file, "utf8")).toBe(text);
  } finally { vi.unstubAllGlobals(); rmSync(d, { recursive: true, force: true }); }
});
