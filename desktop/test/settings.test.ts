import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { defaultSettings, loadSettings, mergeSettings, saveSettings } from "../src/main/settings";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-desktop-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test("a fresh install uploads and refreshes prices, asks nothing until set up, and has no consent yet", () => {
  const s = defaultSettings();
  expect(s).toMatchObject({ gameFolder: null, endpoint: "https://everloot.app", upload: true, prices: true, consentedAt: null });
  expect(s.ask).toEqual({ enabled: false, mcpUrl: "https://everloot.app/mcp", tokenFile: null });
});

test("a settings file saved with a byte order mark still loads", () => {
  const path = join(dir(), "settings.json");
  writeFileSync(path, "\uFEFF" + JSON.stringify({ gameFolder: "C:/WoW/_classic_era_", consentedAt: "2026-10-18T00:00:00Z" }));
  const r = loadSettings(path);
  expect(r.error).toBeNull();
  expect(r.settings).toMatchObject({ gameFolder: "C:/WoW/_classic_era_", consentedAt: "2026-10-18T00:00:00Z" });
});

test("a patch changes only known keys and keeps the old value for a bad one", () => {
  const base = defaultSettings();
  const merged = mergeSettings(base, {
    gameFolder: "C:/WoW/_classic_era_", upload: false, endpoint: "http://localhost:3000/",
    ask: { enabled: true, tokenFile: "C:/keys/t.txt", mcpUrl: "not a url" },
    bogus: 1, launchAtLogin: "yes",
  });
  expect(merged.gameFolder).toBe("C:/WoW/_classic_era_");
  expect(merged.upload).toBe(false);
  expect(merged.endpoint).toBe("http://localhost:3000");
  expect(merged.ask).toEqual({ enabled: true, mcpUrl: "https://everloot.app/mcp", tokenFile: "C:/keys/t.txt" });
  expect(merged.launchAtLogin).toBe(false);
  expect("bogus" in merged).toBe(false);
  expect(mergeSettings(merged, { gameFolder: null, ask: { tokenFile: null } })).toMatchObject({ gameFolder: null, ask: { tokenFile: null, enabled: true } });
});

test("the folder kept over the Forever suggestion is remembered, and cleared by null", () => {
  expect(defaultSettings().keptGameFolder).toBeNull();
  const kept = mergeSettings(defaultSettings(), { keptGameFolder: "C:/WoW/_classic_beta_" });
  expect(kept.keptGameFolder).toBe("C:/WoW/_classic_beta_");
  expect(mergeSettings(kept, { upload: false }).keptGameFolder).toBe("C:/WoW/_classic_beta_");
  expect(mergeSettings(kept, { keptGameFolder: null }).keptGameFolder).toBeNull();
});

test("settings round-trip through the file, written whole", () => {
  const path = join(dir(), "nested", "settings.json");
  const s = mergeSettings(defaultSettings(), { gameFolder: "D:/Games/WoW/_anniversary_", consentedAt: "2026-10-18T00:00:00.000Z" });
  saveSettings(path, s);
  expect(loadSettings(path)).toEqual({ settings: s, error: null });
  expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
});

test("a missing file is the defaults and a damaged one is the defaults plus an error to show", () => {
  const path = join(dir(), "settings.json");
  expect(loadSettings(path)).toEqual({ settings: defaultSettings(), error: null });
  writeFileSync(path, "{ not json");
  const loaded = loadSettings(path);
  expect(loaded.settings).toEqual(defaultSettings());
  expect(loaded.error).toMatch(/settings\.json could not be read/);
  writeFileSync(path, "[1,2]");
  expect(loadSettings(path).settings).toEqual(defaultSettings());
});

test("the player pages are off until the player turns them on", () => {
  const path = join(dir(), "settings.json");
  expect(defaultSettings().players).toBe(false);
  writeFileSync(path, JSON.stringify({ gameFolder: "D:\\Games\\WoW" }));
  expect(loadSettings(path).settings.players).toBe(false);
  writeFileSync(path, JSON.stringify({ gameFolder: "D:\\Games\\WoW", players: true }));
  expect(loadSettings(path).settings.players).toBe(true);
});

test("the census starts on for a new setup and stays off for one finished before the switch existed", () => {
  const path = join(dir(), "settings.json");
  expect(defaultSettings().census).toBe(true);
  writeFileSync(path, JSON.stringify({ gameFolder: "D:\\Games\\WoW", consentedAt: "2026-10-18T00:00:00Z" }));
  expect(loadSettings(path).settings.census).toBe(false);
  writeFileSync(path, JSON.stringify({ gameFolder: "D:\\Games\\WoW", consentedAt: null }));
  expect(loadSettings(path).settings.census).toBe(true);
  writeFileSync(path, JSON.stringify({ consentedAt: "2026-10-18T00:00:00Z", census: true }));
  expect(loadSettings(path).settings.census).toBe(true);
});

test("a damaged settings file is kept under its own name, so the next Save does not write over it", () => {
  const d = dir(), path = join(d, "settings.json");
  writeFileSync(path, '{ "gameFolder": "D:\\Games\\WoW", oops');
  const loaded = loadSettings(path);
  expect(loaded.settings).toEqual(defaultSettings());
  const kept = readdirSync(d).filter((n) => n.startsWith("settings.json.corrupt-"));
  expect(kept).toHaveLength(1);
  expect(loaded.error).toContain(kept[0]);
  saveSettings(path, mergeSettings(loaded.settings, { gameFolder: "E:/WoW/_classic_era_" }));
  expect(readFileSync(join(d, kept[0]), "utf8")).toBe('{ "gameFolder": "D:\\Games\\WoW", oops');
  // A second damaged file gets a name of its own.
  writeFileSync(path, "[1,2]");
  expect(loadSettings(path).error).toMatch(/settings\.json\.corrupt-/);
  expect(readdirSync(d).filter((n) => n.startsWith("settings.json.corrupt-"))).toHaveLength(2);
});
