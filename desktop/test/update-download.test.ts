import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  download: vi.fn(async () => "verified-installer.exe"),
  install: vi.fn(async () => undefined),
}));
vi.mock("electron", () => ({
  app: { requestSingleInstanceLock: () => true, getVersion: () => "0.1.7", on: vi.fn(), quit: vi.fn(), whenReady: () => new Promise(() => {}) },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(name, handler) },
}));
vi.mock("../src/main/jobs", () => ({ companionJobs: () => ({ deps: {}, notices: [] }) }));
vi.mock("../src/main/engine", () => ({ createEngine: () => ({ onChange: vi.fn(), snapshot: () => ({ files: [], jobs: { upload: { state: "idle" }, prices: { state: "idle" }, ask: { state: "idle" } }, log: [] }) }) }));
vi.mock("../src/main/chat", () => ({ createChat: () => ({}) }));
vi.mock("../src/main/builds", () => ({ createBuildsSync: () => ({ status: () => ({}) }) }));
vi.mock("../src/main/account", () => ({ accountInfo: () => null }));
vi.mock("../src/main/settings", async (original) => {
  const actual = await original<typeof import("../src/main/settings")>();
  return { ...actual, loadSettings: () => ({ settings: actual.defaultSettings(), error: null }) };
});
vi.mock("../src/main/self-update", async (original) => ({
  ...await original<typeof import("../src/main/self-update")>(), downloadUpdate: h.download, runInstaller: h.install,
}));
// Exercise the installer path on every test host, without running an installer.
vi.mock("../src/main/updates", async (original) => {
  const actual = await original<typeof import("../src/main/updates")>();
  return { ...actual, checkForUpdates: (current: string, send: typeof fetch) => actual.checkForUpdates(current, send, "win32") };
});

const release = (version: string) => ({
  tag_name: `desktop-v${version}`, body: `- Changes in ${version}`,
  assets: [`Everloot-DesktopApp-${version}-win-x64-setup.exe`, "SHA256SUMS"].map((name) => ({
    name, browser_download_url: `https://github.com/Everloot/everloot/releases/download/desktop-v${version}/${name}`,
  })),
});
// Calls arrive as they would from the bundled page at the top of the window.
const fromPage = { senderFrame: { url: new URL("../src/main/renderer/index.html", import.meta.url).href, parent: null } };
const call = async (name: string, event: unknown = fromPage) => h.handlers.get(name)!(event);
const state = async () => await call("state") as import("../src/shared/types").AppState;
let send: ReturnType<typeof vi.fn>;
// The app keeps its files under EVERLOOT_DATA_DIR; without it, it would use the real profile on this machine.
let data: string;
const note = () => join(data, "updates", "last-attempt.json");

beforeEach(async () => {
  vi.resetModules();
  h.handlers.clear();
  h.download.mockClear();
  h.install.mockClear();
  vi.spyOn(process, "on").mockReturnValue(process);
  send = vi.fn(async () => new Response(JSON.stringify([release("0.1.8")])));
  vi.stubGlobal("fetch", send);
  data = mkdtempSync(join(tmpdir(), "everloot-update-data-"));
  vi.stubEnv("EVERLOOT_DATA_DIR", data);
  await import("../src/main/index");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(data, { recursive: true, force: true }); });

test("download refreshes an old offer and skips directly to the newest release", async () => {
  await call("checkForUpdates");
  expect((await state()).update?.latest).toBe("0.1.8");
  send.mockImplementation(async () => new Response(JSON.stringify([release("0.1.8"), release("0.1.9")])));
  await call("updateDownload");
  expect(h.download).toHaveBeenCalledWith(expect.objectContaining({ version: "0.1.9", url: expect.stringContaining("desktop-v0.1.9/"), sumsUrl: expect.stringContaining("desktop-v0.1.9/") }));
  expect((await state()).update).toMatchObject({ latest: "0.1.9", notes: [{ text: "Changes in 0.1.9" }] });
});

test("a failed fresh check never downloads the stale offer", async () => {
  await call("checkForUpdates");
  send.mockImplementation(async () => new Response("offline", { status: 503 }));
  await call("updateDownload");
  expect(h.download).not.toHaveBeenCalled();
  expect((await state()).updateProgress).toMatchObject({ stage: "failed", error: expect.stringContaining("503") });
});

test("an offer removed from the release list downloads nothing", async () => {
  await call("checkForUpdates");
  send.mockImplementation(async () => new Response("[]"));
  await call("updateDownload");
  expect(h.download).not.toHaveBeenCalled();
  expect((await state()).update).toBeNull();
  expect((await state()).updateProgress.stage).toBe("idle");
});

test("repeated clicks during the fresh check start only one download", async () => {
  await call("checkForUpdates");
  let respond!: (response: Response) => void;
  send.mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }));
  const first = call("updateDownload");
  await call("updateDownload");
  expect(send).toHaveBeenCalledTimes(2); // Initial offer and one fresh check.
  respond(new Response(JSON.stringify([release("0.1.9")])));
  await first;
  expect(h.download).toHaveBeenCalledTimes(1);
});

test("a previously downloaded version is replaced when a newer release appears", async () => {
  await call("checkForUpdates");
  await call("updateDownload");
  expect((await state()).updateProgress.stage).toBe("ready");
  send.mockImplementation(async () => new Response(JSON.stringify([release("0.1.9")])));
  await call("updateDownload");
  expect(h.download).toHaveBeenLastCalledWith(expect.objectContaining({ version: "0.1.9" }));
  expect((await state()).update?.latest).toBe("0.1.9");
  expect((await state()).updateProgress.stage).toBe("ready");
});

test("restart offers the new release instead of installing an outdated downloaded installer", async () => {
  await call("checkForUpdates");
  await call("updateDownload");
  send.mockImplementation(async () => new Response(JSON.stringify([release("0.1.9")])));
  expect(await call("updateRestart")).toBe(false);
  expect(h.install).not.toHaveBeenCalled();
  expect((await state()).update?.latest).toBe("0.1.9");
  expect((await state()).updateProgress.stage).toBe("idle");
});

test("restart still installs a verified installer that is the latest release", async () => {
  await call("checkForUpdates");
  await call("updateDownload");
  expect(await call("updateRestart")).toBe(true);
  expect(h.install).toHaveBeenCalledWith("verified-installer.exe");
  // The next start compares this note with its own version.
  expect(JSON.parse(readFileSync(note(), "utf8"))).toEqual({ version: "0.1.8" });
});

test("an installer that does not start leaves no note and says so", async () => {
  await call("checkForUpdates");
  await call("updateDownload");
  h.install.mockRejectedValueOnce(new Error("spawn EACCES"));
  expect(await call("updateRestart")).toBe(false);
  expect(existsSync(note())).toBe(false);
  expect((await state()).updateProgress).toMatchObject({ stage: "failed", error: expect.stringContaining("EACCES") });
});

test("restart stays open when the fresh release check fails", async () => {
  await call("checkForUpdates");
  await call("updateDownload");
  send.mockImplementation(async () => new Response("offline", { status: 503 }));
  expect(await call("updateRestart")).toBe(false);
  expect(h.install).not.toHaveBeenCalled();
  expect((await state()).updateProgress).toMatchObject({ stage: "failed", error: expect.stringContaining("503") });
});

test("a call from anything but the app's page is refused before the handler runs", async () => {
  await call("checkForUpdates");
  const other = { senderFrame: { url: "https://everloot.app/", parent: null } };
  await expect(call("updateDownload", other)).rejects.toThrow("only answered for the app's own page");
  await expect(call("updateDownload", { senderFrame: null })).rejects.toThrow("only answered for the app's own page");
  expect(h.download).not.toHaveBeenCalled();
});
