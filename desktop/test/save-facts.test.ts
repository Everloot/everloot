import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as svParse from "../../web/src/lib/sv-parse";
import { summarizeCharacters } from "../src/main/characters";
import { characterRealms, ownRealms } from "../src/main/market";
import { saveFacts } from "../src/main/save-facts";

// Counts the parses; the parser itself is the real one.
vi.mock("../../web/src/lib/sv-parse", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../web/src/lib/sv-parse")>();
  return { ...real, parseEverlootTable: vi.fn(real.parseEverlootTable), parseEverlootLua: vi.fn(real.parseEverlootLua) };
});

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-facts-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const save = (realm: string) => `EverlootDB = { ["version"] = "0.3.14", ["installId"] = "x", ["records"] = {},
  ["lastScans"] = { ["${realm}"] = { ["at"] = "2026-10-18T00:00:00Z" } },
  ["asks"] = { { ["id"] = "ask:1", ["question"] = "Thrall", ["askedAt"] = "2026-10-18T00:00:00Z" } } }`;

test("one parse per write serves the realms, the scan ages and the pending asks", () => {
  const parse = vi.mocked(svParse.parseEverlootTable);
  parse.mockClear();
  const sv = join(dir(), "Everloot.lua");
  writeFileSync(sv, save("Nightslayer"));
  expect(ownRealms([sv])).toEqual(["Nightslayer"]);
  expect(ownRealms([sv])).toEqual(["Nightslayer"]);
  expect(saveFacts(sv).scans).toEqual([{ realm: "Nightslayer", at: "2026-10-18T00:00:00Z" }]);
  expect(saveFacts(sv).asks.map((a) => a.id)).toEqual(["ask:1"]);
  expect(parse).toHaveBeenCalledTimes(1);
  // The next logout writes the file again: it is read once more.
  writeFileSync(sv, save("Doomhowl"));
  expect(ownRealms([sv])).toEqual(["Doomhowl"]);
  expect(saveFacts(sv).scans.map((s) => s.realm)).toEqual(["Doomhowl"]);
  expect(parse).toHaveBeenCalledTimes(2);
});

test("a broken file still fails the realm read each time it is asked; a missing one is skipped", () => {
  const d = dir();
  const sv = join(d, "Everloot.lua");
  writeFileSync(sv, `EverlootDB = { ["version"] = `);
  expect(() => ownRealms([sv])).toThrow(svParse.LuaParseError);
  expect(() => ownRealms([sv])).toThrow(svParse.LuaParseError);
  expect(() => saveFacts(sv)).toThrow(svParse.LuaParseError);
  expect(ownRealms([join(d, "missing.lua")])).toEqual([]);
});

const gold = (character: string, realm: string, copper: number) =>
  `{ ["character"] = "${character}", ["realm"] = "${realm}", ["capturedAt"] = "2026-10-18T10:00:00Z", ["currentCopper"] = ${copper}, ["peakCopper"] = ${copper} }`;

test("the Overview and Market page take character realms from the same parse, richest character first", () => {
  const table = vi.mocked(svParse.parseEverlootTable), lua = vi.mocked(svParse.parseEverlootLua);
  const sv = join(dir(), "Everloot.lua");
  const text = `EverlootDB = { ["version"] = "0.3.14", ["installId"] = "x", ["records"] = {
    ["gold_snapshot"] = { ${gold("Arthas", "Doomhowl", 10)}, ${gold("Jaina", "Nightslayer", 900)}, ${gold("Arthas", "Doomhowl", 50)} },
    ["money_event"] = { { ["character"] = "Thrall", ["realm"] = "Skull Rock", ["capturedAt"] = "2026-10-18T10:00:00Z", ["category"] = "loot", ["copper"] = 5 } } },
    ["lastScans"] = { ["Nightslayer"] = { ["at"] = "2026-10-18T00:00:00Z" } } }`;
  writeFileSync(sv, text);
  table.mockClear(); lua.mockClear();
  // The order the Characters page lists them in.
  const listed = summarizeCharacters(text).characters.map((c) => c.realm);
  expect(listed).toEqual(["Nightslayer", "Doomhowl", "Skull Rock"]);
  lua.mockClear();
  for (let i = 0; i < 3; i++) {
    expect(characterRealms([sv])).toEqual(listed);
    expect(ownRealms([sv])).toEqual(["Nightslayer"]);
  }
  expect(table).toHaveBeenCalledTimes(1);
  expect(lua).not.toHaveBeenCalled();
});

test("a file the Characters page skips suggests no realm, and a broken one does not fail the suggestions", () => {
  const d = dir();
  const noInstall = join(d, "a.lua"), broken = join(d, "b.lua");
  writeFileSync(noInstall, `EverlootDB = { ["version"] = "0.3.14", ["records"] = { ["gold_snapshot"] = { ${gold("Arthas", "Doomhowl", 10)} } } }`);
  writeFileSync(broken, `EverlootDB = { ["version"] = `);
  expect(characterRealms([noInstall, broken, join(d, "missing.lua")])).toEqual([]);
});
