import { beforeEach, expect, test, vi } from "vitest";
import type { AppState } from "../src/shared/types";

type Item = { label?: string; click?: () => void };
const h = vi.hoisted(() => ({ menu: [] as { label?: string; click?: () => void }[], tooltip: "", builds: 0, tooltips: 0 }));
vi.mock("electron", () => ({
  Menu: { buildFromTemplate: (items: Item[]) => { h.menu = items; h.builds++; return items; } },
  Tray: class { on() {} setToolTip(t: string) { h.tooltip = t; h.tooltips++; } setContextMenu() {} destroy() {} },
  nativeImage: { createFromPath: () => ({}) },
}));
const { createTray } = await import("../src/main/tray");

const job = { state: "idle" as const, message: "", at: null };
const base: AppState = {
  version: "0.1.11", platform: "win32", dataFolder: "D:\\data", notice: null, foreverFolder: null,
  settings: {
    gameFolder: null, keptGameFolder: null, endpoint: "https://everloot.app", upload: true, census: true, players: false, prices: true,
    ask: { enabled: false, mcpUrl: "https://everloot.app/mcp", tokenFile: "" }, market: { realms: [], dismissed: [] }, consentedAt: "2026-10-18T00:00:00Z", launchAtLogin: false, startInTray: true,
  },
  engine: { files: [], jobs: { upload: job, prices: job, ask: job }, log: [], paused: false },
  update: null, updateProgress: { stage: "idle", percent: 0, error: null }, staleScans: [], account: { signedIn: false, hint: null },
  builds: { state: "off", message: "", syncedAt: null, builds: null },
};
const update = (installable: boolean): AppState["update"] => ({
  current: "0.1.11", latest: "0.1.12", url: "https://github.com/Everloot/everloot/releases/tag/desktop-v0.1.12", newer: true, notes: [],
  downloadUrl: "https://example.test/setup.exe", publishedAt: null, sumsUrl: installable ? "https://example.test/SHA256SUMS" : null, installable,
});
const actions = { show: vi.fn(), runNow: vi.fn(), setPaused: vi.fn(), openExternal: vi.fn(), quit: vi.fn() };
const item = (label: RegExp) => h.menu.find((i) => i.label && label.test(i.label));

beforeEach(() => { vi.clearAllMocks(); h.builds = 0; h.tooltips = 0; });

test("with no newer app the menu has no update item and the tooltip says nothing about one", () => {
  createTray("tray.png", actions).update(base);
  expect(item(/update/i)).toBeUndefined();
  expect(h.tooltip).toBe("Everloot Desktop App");
});

test("an update the app can install opens its update panel, and says Restart once it is downloaded", () => {
  const tray = createTray("tray.png", actions);
  tray.update({ ...base, update: update(true) });
  expect(h.tooltip).toBe("Everloot Desktop App · update 0.1.12 available");
  item(/^Update Everloot Desktop App to 0\.1\.12$/)!.click!();
  expect(actions.show).toHaveBeenCalledWith("update");
  expect(actions.openExternal).not.toHaveBeenCalled();
  tray.update({ ...base, update: update(true), updateProgress: { stage: "ready", percent: 100, error: null } });
  expect(item(/^Restart to update to 0\.1\.12$/)).toBeDefined();
});

test("where the app cannot install itself, the item opens the release page", () => {
  createTray("tray.png", actions).update({ ...base, update: update(false), engine: { ...base.engine, paused: true } });
  expect(h.tooltip).toBe("Everloot Desktop App (paused) · update 0.1.12 available");
  item(/^Update Everloot Desktop App to 0\.1\.12$/)!.click!();
  expect(actions.openExternal).toHaveBeenCalledWith("https://github.com/Everloot/everloot/releases/tag/desktop-v0.1.12");
  expect(actions.show).not.toHaveBeenCalled();
});

test("the menu is rebuilt only when something in it changes, so a download's progress does not reopen it", () => {
  const tray = createTray("tray.png", actions);
  const downloading = (percent: number): AppState => ({ ...base, update: update(true), updateProgress: { stage: "downloading", percent, error: null } });
  tray.update(downloading(1));
  const builds = h.builds, tooltips = h.tooltips;
  for (let p = 2; p <= 99; p++) tray.update(downloading(p));
  expect(h.builds).toBe(builds);
  expect(h.tooltips).toBe(tooltips);
  tray.update({ ...downloading(100), updateProgress: { stage: "ready", percent: 100, error: null } });
  expect(h.builds).toBe(builds + 1);
  expect(item(/^Restart to update to 0\.1\.12$/)).toBeDefined();
});

test("an item from a menu that was kept acts on the newest state", () => {
  const tray = createTray("tray.png", actions);
  tray.update({ ...base, update: update(false) });
  // Same labels, so the menu is kept; the release can now be installed here, and the click must know.
  tray.update({ ...base, update: update(true) });
  item(/^Update Everloot Desktop App to 0\.1\.12$/)!.click!();
  expect(actions.show).toHaveBeenCalledWith("update");
  expect(actions.openExternal).not.toHaveBeenCalled();
});
