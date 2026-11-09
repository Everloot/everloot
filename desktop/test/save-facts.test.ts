import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as svParse from "../../web/src/lib/sv-parse";
import { summarizeCharacters } from "../src/main/characters";
import { summarizeFiles, summarizeSavedVariables } from "../src/main/inspect";
import { characterRealms, ownRealms } from "../src/main/market";
import { charactersFromFiles, saveFacts } from "../src/main/save-facts";
import { BROKEN, CHARACTERS, DB, NO_INSTALL, UPLOAD_TEXTS, save } from "./save-fixtures";

// Counts the parses; the parser itself is the real one.
vi.mock("../../web/src/lib/sv-parse", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../web/src/lib/sv-parse")>();
  return { ...real, parseEverlootTable: vi.fn(real.parseEverlootTable), parseEverlootLua: vi.fn(real.parseEverlootLua) };
});

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-facts-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });


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


test("the Overview, the Market page and the Characters page take the characters from the same parse, richest first", () => {
  const table = vi.mocked(svParse.parseEverlootTable), lua = vi.mocked(svParse.parseEverlootLua);
  const sv = join(dir(), "Everloot.lua");
  const text = CHARACTERS;
  writeFileSync(sv, text);
  table.mockClear(); lua.mockClear();
  // The order the Characters page lists them in.
  const listed = summarizeCharacters(text).characters.map((c) => c.realm);
  expect(listed).toEqual(["Nightslayer", "Doomhowl", "Skull Rock"]);
  table.mockClear(); lua.mockClear();
  for (let i = 0; i < 3; i++) {
    expect(characterRealms([sv])).toEqual(listed);
    expect(ownRealms([sv])).toEqual(["Nightslayer"]);
    // The Characters page and the chat's my_characters read the same parse.
    expect(charactersFromFiles([sv]).characters.map((c) => c.character)).toEqual(["Jaina", "Arthas", "Thrall"]);
  }
  expect(table).toHaveBeenCalledTimes(1);
  expect(lua).not.toHaveBeenCalled();
});

test("a file the Characters page skips shows no character and suggests no realm, and a broken one fails neither", () => {
  const d = dir();
  const noInstall = join(d, "a.lua"), broken = join(d, "b.lua");
  writeFileSync(noInstall, NO_INSTALL);
  writeFileSync(broken, BROKEN);
  expect(characterRealms([noInstall, broken, join(d, "missing.lua")])).toEqual([]);
  expect(charactersFromFiles([noInstall, broken, join(d, "missing.lua")])).toEqual({ characters: [], progress: [], talents: [] });
});


test("the Upload page reads the shared parse and shows what the upload's own parser shows, refusals included", () => {
  const d = dir();
  const sent = join(d, "sent.json");
  writeFileSync(sent, JSON.stringify({ "inst-1": ["a", "b"] }));
  const texts = UPLOAD_TEXTS;
  const confirmedFor = (id: string) => (id === "inst-1" ? 2 : 0);
  for (const [name, text] of Object.entries(texts)) {
    const file = join(d, `${name}.lua`);
    writeFileSync(file, text);
    const { file: _f, writtenAt: _w, bytes: _b, ...shown } = summarizeFiles([file], sent)[0];
    expect(shown, name).toEqual(summarizeSavedVariables(text, confirmedFor));
  }
  expect(summarizeFiles([join(d, "whole.lua")], sent)[0]).toMatchObject({ ok: true, records: 3, confirmed: 2, pendingAsks: 1, scanRealms: ["Nightslayer", "Doomhowl"] });
});

test("after a logout the Upload page costs no parse of its own: the jobs' parse serves it", () => {
  const table = vi.mocked(svParse.parseEverlootTable), lua = vi.mocked(svParse.parseEverlootLua);
  const d = dir();
  const sv = join(d, "Everloot.lua"), sent = join(d, "sent.json");
  writeFileSync(sv, DB);
  table.mockClear(); lua.mockClear();
  // The state push after the write reads the file first.
  expect(ownRealms([sv])).toEqual(["Nightslayer", "Doomhowl"]);
  for (let i = 0; i < 3; i++) expect(summarizeFiles([sv], sent)[0]).toMatchObject({ ok: true, records: 3 });
  expect(table).toHaveBeenCalledTimes(1);
  expect(lua).not.toHaveBeenCalled();
});