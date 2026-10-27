import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { confirmedCounts, newestScans, scanReminder, staleScans, summarizeFiles, summarizeSavedVariables } from "../src/main/inspect";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-inspect-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const SV = `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "inst-1", ["clientBuild"] = "1.60.1.70450",
  ["records"] = { ["loot"] = { { ["sourceNpcId"] = 7, ["items"] = {} }, { ["sourceNpcId"] = 8, ["items"] = {} } }, ["npc_sighting"] = { { ["npcId"] = 1 } } },
  ["asks"] = { { ["id"] = "ask:inst-1:1", ["question"] = "what drops bindings", ["askedAt"] = "2026-10-18T00:00:00Z" } },
  ["lastScans"] = { ["Nightslayer"] = { ["at"] = "2026-10-18T00:00:00Z" } } }`;

test("switching sites changes the displayed confirmation count even for a cached save file", () => {
  const d = dir();
  const file = join(d, "Everloot.lua"), sent = join(d, "sent.json");
  writeFileSync(file, SV);
  writeFileSync(sent, JSON.stringify({ "inst-1": ["a"], "https://test.example|inst-1": ["a", "b"] }));
  expect(summarizeFiles([file], sent, "https://test.example/")[0].confirmed).toBe(2);
  expect(summarizeFiles([file], sent, "https://everloot.app")[0].confirmed).toBe(1);
});

test("a file summary counts records per kind, asks, scan realms and confirmed events, and never includes the records", () => {
  const s = summarizeSavedVariables(SV, (id) => (id === "inst-1" ? 5 : 0));
  expect(s).toMatchObject({ ok: true, addonVersion: "0.3.3", clientBuild: "1.60.1.70450", records: 3, confirmed: 5, pendingAsks: 1, scanRealms: ["Nightslayer"], scans: [{ realm: "Nightslayer", at: "2026-10-18T00:00:00Z" }] });
  expect(s.kinds).toEqual([{ kind: "loot", count: 2 }, { kind: "npc_sighting", count: 1 }]);
  expect(JSON.stringify(s)).not.toContain("sourceNpcId");
});

test("a damaged file reports the parser's reason instead of counts", () => {
  const s = summarizeSavedVariables("EverlootDB = { version = ", () => 0);
  expect(s.ok).toBe(false);
  expect(s.error).toBeTruthy();
  expect(s.kinds).toEqual([]);
});

test("confirmed counts come from sent.json per install; a missing or damaged file counts nothing", () => {
  const d = dir();
  const sent = join(d, "sent.json");
  expect(confirmedCounts(sent)("inst-1")).toBe(0);
  writeFileSync(sent, JSON.stringify({ "inst-1": ["a", "b"], other: 3 }));
  expect(confirmedCounts(sent)("inst-1")).toBe(2);
  expect(confirmedCounts(sent)("other")).toBe(0);
  writeFileSync(sent, "{nope");
  expect(confirmedCounts(sent)("inst-1")).toBe(0);
});

test("summaries carry the file's size and write time, and a missing file is an error row", () => {
  const d = dir();
  const sv = join(d, "Everloot.lua");
  writeFileSync(sv, SV);
  const [ok, missing] = summarizeFiles([sv, join(d, "none.lua")], join(d, "sent.json"));
  expect(ok).toMatchObject({ file: sv, ok: true, bytes: SV.length });
  expect(ok.writtenAt).toMatch(/^\d{4}-/);
  expect(missing).toMatchObject({ ok: false, bytes: 0 });
  expect(missing.error).toBeTruthy();
});

test("stale scans are the realms older than a day or undated, oldest first, and the reminder names the oldest", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const scans = [
    { realm: "Fresh", at: "2026-10-18T10:00:00Z" },
    { realm: "Old", at: "2026-10-15T12:00:00Z" },
    { realm: "Undated", at: null },
    { realm: "Older", at: "2026-10-10T12:00:00Z" },
  ];
  const stale = staleScans(scans, now);
  expect(stale.map((s) => s.realm)).toEqual(["Undated", "Older", "Old"]);
  expect(scanReminder(stale, now)).toBe("Scan Undated again: no dated scan (+2 more)");
  expect(scanReminder(stale.slice(1), now)).toBe("Scan Older again: last full scan 8 d ago (+1 more)");
  expect(scanReminder([], now)).toBeNull();
});

test("summarizeFiles parses a file once per write: a new confirmed count shows without a rewrite, a rewrite is re-read", () => {
  const d = mkdtempSync(join(tmpdir(), "everloot-inspect-memo-")); dirs.push(d);
  const sv = join(d, "Everloot.lua"), sent = join(d, "sent.json");
  writeFileSync(sv, `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "inst", ["records"] = { ["drop"] = { { ["a"] = 1 } } } }`);
  writeFileSync(sent, JSON.stringify({ inst: ["e1"] }));
  expect(summarizeFiles([sv], sent)[0]).toMatchObject({ ok: true, records: 1, confirmed: 1 });
  writeFileSync(sent, JSON.stringify({ inst: ["e1", "e2", "e3"] }));
  expect(summarizeFiles([sv], sent)[0].confirmed).toBe(3);
  const later = new Date(Date.now() + 5000);
  writeFileSync(sv, `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "inst", ["records"] = { ["drop"] = { { ["a"] = 1 }, { ["a"] = 2 } } } }`);
  utimesSync(sv, later, later);
  expect(summarizeFiles([sv], sent)[0]).toMatchObject({ records: 2, confirmed: 3 });
});

test("a realm scanned from two account files is listed once, with its newest scan, newest first", () => {
  const all = [
    { realm: "Nightslayer", at: "2026-10-15T08:00:00Z" }, { realm: "Doomhowl", at: null },
    { realm: "Nightslayer", at: "2026-10-19T05:00:00Z" }, { realm: "Dreamscythe", at: "2026-10-18T00:00:00Z" },
  ];
  expect(newestScans(all)).toEqual([
    { realm: "Nightslayer", at: "2026-10-19T05:00:00Z" }, { realm: "Dreamscythe", at: "2026-10-18T00:00:00Z" }, { realm: "Doomhowl", at: null },
  ]);
});
