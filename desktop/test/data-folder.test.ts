import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// The home folder the delete refuses is a temp folder here, so a broken check cannot reach the real one.
const fakeHome = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:os", async (load) => {
  const os = await load<typeof import("node:os")>();
  return { ...os, homedir: () => fakeHome.dir || os.tmpdir() };
});

const { dataUsage, deleteLocalData, partOf, pruneSettledLists } = await import("../src/main/data-folder");
const { createSentState } = await import("../../companion/src/sent-state");
const { uploadFile } = await import("../../companion/src/uploader");

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "everloot-data-folder-")); });
afterEach(() => { fakeHome.dir = ""; rmSync(root, { recursive: true, force: true }); });

const put = (path: string, bytes: number) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, "x".repeat(bytes)); };

/** A data folder with something in every part, as a real install has it. */
function filled(dir: string): void {
  put(join(dir, "backups", "ACC-20261101T000000Z.lua"), 1000);
  put(join(dir, "backups", "ACC-20261102T000000Z.lua"), 1500);
  put(join(dir, "updates", "Everloot-DesktopApp-0.1.15-win-x64-setup.exe"), 4000);
  put(join(dir, "updates", "last-attempt.json"), 20);
  put(join(dir, "chat.json"), 300);
  put(join(dir, "answers.json"), 50);
  put(join(dir, "sent.json"), 700);
  put(join(dir, "settled-1.60.1.70450.json"), 200);
  put(join(dir, "settings.json"), 400);
  put(join(dir, "window.json"), 60);
  put(join(dir, "config.json"), 90);
  put(join(dir, "everloot-key.txt"), 69);
  put(join(dir, "everloot-key-origin.txt"), 21);
  put(join(dir, "anthropic.key"), 110);
  put(join(dir, "sent.json.corrupt-1234"), 33);
  put(join(dir, "chat.json.tmp"), 7);
}

test("the size is broken down by part, and adds up to the total", () => {
  const dir = join(root, "data");
  filled(dir);
  const u = dataUsage(dir);
  expect(u.parts).toEqual({ backups: 2500, updates: 4020, chat: 350, uploads: 900, settings: 750, other: 40 });
  expect(u.total).toBe(2500 + 4020 + 350 + 900 + 750 + 40);
});

test("a data folder that does not exist yet is empty", () => {
  expect(dataUsage(join(root, "none"))).toEqual({ total: 0, parts: { backups: 0, updates: 0, chat: 0, uploads: 0, settings: 0, other: 0 } });
});

test("each top-level name lands in its part", () => {
  expect(partOf("settled-1.60.1.70450.json")).toBe("uploads");
  expect(partOf("settled-x.json")).toBe("other");
  expect(partOf("openai.key")).toBe("settings");
  expect(partOf("settings.json.corrupt-abc")).toBe("other");
  expect(partOf("settings.json.tmp")).toBe("other");
});

test("settled lists not refreshed for a week are deleted; the current one and other files stay", () => {
  const now = Date.UTC(2026, 10, 2);
  const day = 24 * 3_600_000;
  put(join(root, "settled-1.60.1.70450.json"), 10);
  put(join(root, "settled-1.59.0.69000.json"), 10);
  put(join(root, "sent.json"), 10);
  utimesSync(join(root, "settled-1.60.1.70450.json"), new Date(now - day), new Date(now - day));
  utimesSync(join(root, "settled-1.59.0.69000.json"), new Date(now - 8 * day), new Date(now - 8 * day));
  utimesSync(join(root, "sent.json"), new Date(now - 90 * day), new Date(now - 90 * day));
  expect(pruneSettledLists(root, now)).toEqual(["settled-1.59.0.69000.json"]);
  expect(readdirSync(root).sort()).toEqual(["sent.json", "settled-1.60.1.70450.json"]);
  expect(pruneSettledLists(join(root, "none"), now)).toEqual([]);
});

test("upload history keeps only the ids still in that install's save file", () => {
  const path = join(root, "sent.json");
  const state = createSentState(path);
  state.add("install-a", ["a:1", "a:2", "a:3"]);
  state.add("install-b", ["b:1"]);
  expect(state.keepOnly("install-a", new Set(["a:2", "a:3", "a:4"]))).toBe(1);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ "install-a": ["a:2", "a:3"], "install-b": ["b:1"] });
  // Nothing to drop: the file is not written again.
  writeFileSync(path, "{\"untouched\":[]}");
  expect(state.keepOnly("install-a", new Set(["a:2", "a:3"]))).toBe(0);
  expect(state.keepOnly("install-c", new Set())).toBe(0);
  expect(readFileSync(path, "utf8")).toBe("{\"untouched\":[]}");
});

test("an upload drops the receipts of rows the addon has replaced", async () => {
  const file = join(root, "Everloot.lua");
  writeFileSync(file, `EverlootDB = { version = "0.3.14", installId = "abcd-1234-ef56-7890", records = { loot = {
    { eventId = "epoch:2", capturedAt = "2026-10-27T00:00:00Z", sourceNpcId = 42, sourceEvidence = "loot-api", items = { { itemId = 5, count = 1 } } },
  } } }`);
  const path = join(root, "sent.json");
  createSentState(path).add("abcd-1234-ef56-7890", ["epoch:1", "epoch:2"]);
  const send = vi.fn();
  const r = await uploadFile(file, { endpoint: "https://everloot.app", state: createSentState(path), fetch: send as unknown as typeof fetch });
  expect(r.sent).toBe(0);
  expect(send).not.toHaveBeenCalled();
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ "abcd-1234-ef56-7890": ["epoch:2"] });
});

test("delete empties the data folder, keeps the folder, and leaves the game folder alone", () => {
  const dir = join(root, "data");
  const game = join(root, "World of Warcraft", "_forever_");
  const save = join(game, "WTF", "Account", "ACC", "SavedVariables", "Everloot.lua");
  put(save, 123);
  put(join(game, "Interface", "AddOns", "Everloot", "Everloot.toc"), 10);
  filled(dir);
  expect(deleteLocalData(dir, game)).toEqual([]);
  expect(existsSync(dir)).toBe(true);
  expect(readdirSync(dir)).toEqual([]);
  expect(readFileSync(save, "utf8")).toBe("x".repeat(123));
  expect(existsSync(join(game, "Interface", "AddOns", "Everloot", "Everloot.toc"))).toBe(true);
  // A folder that is not there yet has nothing to delete.
  expect(deleteLocalData(join(root, "none"), null)).toEqual([]);
});

test("delete refuses a data folder that overlaps the game folder, and deletes nothing", () => {
  const game = join(root, "game");
  put(join(game, "WTF", "Account", "ACC", "SavedVariables", "Everloot.lua"), 5);
  // The data folder inside the game folder, and the game folder inside the data folder.
  expect(() => deleteLocalData(join(game, "data"), game)).toThrow(/overlap/);
  expect(() => deleteLocalData(root, game)).toThrow(/overlap/);
  expect(() => deleteLocalData(game, game)).toThrow(/overlap/);
  expect(existsSync(join(game, "WTF", "Account", "ACC", "SavedVariables", "Everloot.lua"))).toBe(true);
});

test("delete refuses the home folder", () => {
  fakeHome.dir = join(root, "home");
  put(join(fakeHome.dir, "Documents", "notes.txt"), 5);
  expect(() => deleteLocalData(fakeHome.dir, null)).toThrow(/not a folder the app can empty/);
  expect(existsSync(join(fakeHome.dir, "Documents", "notes.txt"))).toBe(true);
});
