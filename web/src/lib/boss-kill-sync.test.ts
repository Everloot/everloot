import { expect, test } from "vitest";
import { recordSchemas } from "@everloot/protocol";
import { bossKillCapture, bossKillSyncOn, parseBossKillRow } from "./boss-kill-sync";
import { prepareUpload } from "./upload-batches";
const row = { kind: "boss_kill_owned", installId: "install-1234", characterKey: "abcd1234", encounterId: 2916,
  instanceMapId: 48, difficulty: 1, firstKillAt: "2026-11-01T00:00:00Z", lastKillAt: "2026-11-02T00:00:00Z", killCount: 2 };
const now = new Date("2026-11-14T00:00:00Z");
test("the shipped addon shape needs no capturedAt or class, and in-place updates advance its capture", () => {
  expect(parseBossKillRow(row)?.capturedAt).toBe(row.lastKillAt);
  const next = { ...row, lastKillAt: "2026-11-03T00:00:00Z", killCount: 3 };
  const capture = bossKillCapture([parseBossKillRow(row)!, parseBossKillRow(next)!], now)!;
  expect(capture.capturedAt).toBe(next.lastKillAt);
  expect(capture.kills).toHaveLength(1);
  expect(capture.kills[0]!.killCount).toBe(3);
  expect(JSON.stringify(capture.kills)).not.toContain(row.characterKey);
});
test("malformed counts, dates, keys and encounter ids are refused", () => {
  for (const change of [{ killCount: 0 }, { killCount: 1.5 }, { encounterId: -1 }, { difficulty: -1 },
    { characterKey: "a name" }, { firstKillAt: "2026-11-03T00:00:00Z" }, { lastKillAt: "tomorrow" }]) {
    expect(parseBossKillRow({ ...row, ...change })).toBeNull();
  }
});
test("one install's capture never mixes with another's or with another character's", () => {
  const newer = parseBossKillRow({ ...row, installId: "other-1234", lastKillAt: "2026-11-03T00:00:00Z", killCount: 3 })!;
  expect(bossKillCapture([parseBossKillRow(row)!, newer], now)!.kills[0]!.killCount).toBe(3);
  expect(bossKillCapture([newer, { ...newer, characterKey: "aaaaaaaa" }], now)).toBeNull();
  expect(bossKillCapture([parseBossKillRow({ ...row, lastKillAt: "2099-01-01T00:00:00Z" })!], now)).toBeNull();
});
test("no public upload or public protocol schema accepts a boss-kill row", () => {
  expect(Object.hasOwn(recordSchemas, "boss_kill_owned")).toBe(false);
  const upload = prepareUpload({ addonVersion: "0.3.23", records: [row] }, {}, []);
  expect(upload.batches).toHaveLength(0);
});
test("private sync plus a separate explicit gate are required", () => {
  expect(bossKillSyncOn({ EVERLOOT_CHARACTER_LINKS: "1", EVERLOOT_PRIVATE_SYNC: "1" })).toBe(false);
  expect(bossKillSyncOn({ EVERLOOT_CHARACTER_LINKS: "1", EVERLOOT_PRIVATE_SYNC: "1", EVERLOOT_BOSS_KILL_SYNC: "1" })).toBe(true);
  expect(bossKillSyncOn({ EVERLOOT_BOSS_KILL_SYNC: "1" })).toBe(false);
});
