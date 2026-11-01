import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, net, powerMonitor, screen, session, shell } from "electron";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readAsks } from "../../../companion/src/bridge/asks";
import { loadProviders } from "../../../companion/src/providers/config";
import type { AddonInfo, AppState, AskInfo, Job, MarketInfo, PriceLookup, Settings } from "../shared/types";
import { JOBS } from "../shared/types";
import { reportDiagnostics } from "../shared/diagnostics";
import { presetFor, type ProviderKind } from "../shared/providers";
import { accountInfo, signIn, signOut } from "./account";
import { listBackups, restoreBackup } from "./backups";
import { createBuildsSync } from "./builds";
import { compareVersions, installAddon, installedAddonVersion, newestAddonRelease, slotAddons } from "./addon";
import { fetchChanges } from "./changes";
import { charactersFromFiles } from "./characters";
import { createChat } from "./chat";
import { localTools } from "./local-tools";
import { createEngine } from "./engine";
import { connectInBrowser } from "./connect";
import { allowedExternal } from "./external";
import { candidateRoots, detectGameFolders, foreverSuggestion, realFs, resolvePickedFolder } from "./game-folder";
import { newestScans, readScanAges, staleScans, summarizeFiles } from "./inspect";
import { onReconnect } from "./online";
import { companionJobs } from "./jobs";
import { loginItemOptions } from "./login-item";
import { itemIdFrom, listRealms, ownRealms, priceRows, readPricesFile } from "./market";
import { loadSettings, mergeSettings, saveSettings } from "./settings";
import { allowedPermission, fromAppPage } from "./sender";
import { createTray } from "./tray";
import { checkForUpdates, fetchReleases, updateFrom } from "./updates";
import { downloadUpdate, pruneInstallers, runInstaller } from "./self-update";
import { fitWindow, readWindowState, writeWindowState } from "./window-state";

/** The same folder the command line uses (`companion/src/cli.ts` defaultStatePath), so both share sent.json. */
function dataFolder(): string {
  // EVERLOOT_DATA_DIR points a development run at a scratch folder instead of the real one.
  if (process.env.EVERLOOT_DATA_DIR) return process.env.EVERLOOT_DATA_DIR;
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Everloot");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Everloot");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "everloot");
}

/**
 * Remembers one network answer for a while, so opening a page twice does not ask the site twice.
 * The key (the site address) is part of it: another site in Settings is asked at once.
 */
function cached<T>(ms: number, load: () => Promise<T>, key: () => string = () => ""): () => Promise<T> {
  let value: { at: number; key: string; data: T } | null = null;
  return async () => {
    const k = key();
    if (value && value.key === k && Date.now() - value.at < ms) return value.data;
    const data = await load();
    value = { at: Date.now(), key: k, data };
    return data;
  };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const data = dataFolder();
  const settingsPath = join(data, "settings.json");
  const loaded = loadSettings(settingsPath);
  let settings: Settings = loaded.settings;
  const jobs = companionJobs(data, () => settings);
  loaded.error = [loaded.error, ...jobs.notices].filter(Boolean).join("\n") || null;
  const engine = createEngine(jobs.deps);
  let win: BrowserWindow | null = null;
  let tray: ReturnType<typeof createTray> | null = null;
  let quitting = false;

  const addonsDir = () => (settings.gameFolder ? join(settings.gameFolder, "Interface", "AddOns") : null);
  let update: AppState["update"] = null;
  let updateProgress: AppState["updateProgress"] = { stage: "idle", percent: 0, error: null };
  /** The verified installer, once downloaded, and the version it installs. */
  let downloaded: { path: string; version: string } | null = null;
  // Scan ages come from parsing each account file; remembered per file size and write time so a broadcast stays cheap.
  const scanMemo = new Map<string, { key: string; scans: ReturnType<typeof readScanAges> }>();
  const allScans = () => engine.snapshot().files.flatMap((f) => {
    try {
      const st = statSync(f), key = `${st.mtimeMs}:${st.size}`;
      const hit = scanMemo.get(f);
      if (hit && hit.key === key) return hit.scans;
      const scans = readScanAges(readFileSync(f, "utf8"));
      scanMemo.set(f, { key, scans });
      return scans;
    } catch { return []; }
  });
  const chat = createChat(data, () => settings, localTools({
    characters: () => charactersFromFiles(engine.snapshot().files),
    scans: () => newestScans(allScans()),
    followed: () => settings.market.realms,
    status: () => {
      const e = engine.snapshot();
      const dir = addonsDir();
      return {
        version: app.getVersion(), gameFolder: settings.gameFolder, files: e.files.length, paused: e.paused,
        switches: { upload: settings.upload, prices: settings.prices, ask: settings.ask.enabled }, jobs: e.jobs,
        addonInstalled: dir ? installedAddonVersion(dir) : null, update,
        errors: e.log.filter((l) => l.level === "error").slice(-5),
      };
    },
  }));
  // Saved talent builds into the EverlootBuilds slot addon: after a key is saved, on the Addon page's button, and every 15 minutes.
  const builds = createBuildsSync({
    dataFolder: data,
    endpoint: () => settings.endpoint,
    addonsDir: () => addonsDir(),
    ready: () => Boolean(settings.consentedAt),
    paused: () => engine.snapshot().paused,
    onChange: () => broadcast(),
    log: (level, text) => engine.log(level, text),
  });
  const appState = (): AppState => ({ version: app.getVersion(), platform: process.platform, dataFolder: data, notice: loaded.error, settings, foreverFolder: foreverSuggestion(settings.gameFolder, settings.keptGameFolder, realFs), engine: engine.snapshot(), update, updateProgress, staleScans: staleScans(allScans()), account: accountInfo(data), builds: builds.status() });
  const broadcast = () => {
    const s = appState();
    win?.webContents.send("state", s);
    tray?.update(s);
  };
  engine.onChange(broadcast);

  // Two system notifications only: answers landed in the game (so the player knows to /reload),
  // and a newer addon exists (once per run). Nothing else interrupts.
  const notify = (title: string, body: string, page: string) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: true });
    n.on("click", () => show(page));
    n.show();
  };
  let lastAskAt: string | null = null;
  engine.onChange((s) => {
    const ask = s.jobs.ask;
    if (ask.state !== "ok" || ask.at === lastAskAt) return;
    lastAskAt = ask.at;
    const m = /^answered (\d+)/.exec(ask.message);
    if (m && Number(m[1]) > 0) notify("Everloot answered in game", `${m[1]} answer(s) written. Type /reload to read them.`, "ask");
  });
  // The desktop release check at start is a line on the Overview and in the tray, never a notification.
  const desktopUpdateLine = async () => {
    try {
      const check = updateFrom(await releases(), app.getVersion(), process.platform, Boolean(process.env.PORTABLE_EXECUTABLE_FILE));
      update = check.latest ? check : null;
      if (update?.newer) broadcast();
    } catch { update = null; }
  };
  let addonNoticed: string | null = null;
  const addonUpdateNotice = async () => {
    const dir = addonsDir();
    if (!dir) return;
    try {
      const installed = installedAddonVersion(dir);
      const latest = newestAddonRelease(await releases());
      if (installed && latest && latest.version !== addonNoticed && compareVersions(latest.version, installed) > 0) {
        addonNoticed = latest.version;
        notify("Everloot addon update", `${latest.version} is out (you run ${installed}). Open the Addon page to update.`, "addon");
      }
    } catch { /* offline; the Addon page will say so */ }
  };
  /** Both release checks; at start, after the first Start, and once a day. */
  const checkReleases = () => { if (settings.consentedAt) { void addonUpdateNotice(); void desktopUpdateLine(); } };

  const releases = cached(10 * 60 * 1000, () => fetchReleases(fetch, `everloot-desktop/${app.getVersion()}`));
  const knownRealms = cached(10 * 60 * 1000, () => listRealms(settings.endpoint), () => settings.endpoint);
  const changes = cached(15 * 60 * 1000, () => fetchChanges(settings.endpoint), () => settings.endpoint);

  const applyLoginItem = () => {
    const options = loginItemOptions(process.platform, settings.launchAtLogin, process.env.PORTABLE_EXECUTABLE_FILE);
    if (options) app.setLoginItemSettings(options);
  };

  const show = (page?: string) => {
    if (!win) createWindow();
    else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    if (page && win) {
      const w = win;
      if (w.webContents.isLoading()) w.webContents.once("did-finish-load", () => w.webContents.send("navigate", page));
      else w.webContents.send("navigate", page);
    }
  };

  const windowPath = join(data, "window.json");
  const pagePath = join(__dirname, "renderer", "index.html");
  function createWindow(): void {
    const bounds = fitWindow(readWindowState(windowPath), screen.getAllDisplays().map((d) => d.workArea));
    win = new BrowserWindow({
      ...bounds, minWidth: 760, minHeight: 540,
      title: "Everloot Desktop App",
      backgroundColor: "#0E0F0D",
      show: false,
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.loadFile(pagePath);
    win.once("ready-to-show", () => { win?.show(); });
    // The size and place come back next time; written a moment after the last drag, and on close.
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const remember = () => { if (win && !win.isDestroyed() && !win.isMinimized() && !win.isMaximized() && !win.isFullScreen()) { try { writeWindowState(windowPath, win.getBounds()); } catch { /* read-only data folder; nothing to remember */ } } };
    const rememberSoon = () => { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(remember, 500); };
    win.on("resize", rememberSoon);
    win.on("move", rememberSoon);
    // Close keeps the app in the tray; Quit in the tray menu ends it.
    win.on("close", (e) => { if (saveTimer) clearTimeout(saveTimer); remember(); if (!quitting) { e.preventDefault(); win?.hide(); } });
    // Windows sign-out, restart or shutdown: let the window close instead of holding the session up.
    win.on("query-session-end", () => { quitting = true; });
    win.on("session-end", () => { quitting = true; });
    win.on("closed", () => { win = null; });
    win.webContents.setWindowOpenHandler(({ url }) => { if (allowedExternal(url)) void shell.openExternal(url); return { action: "deny" }; });
    win.webContents.on("will-navigate", (e) => e.preventDefault());
  }

  const pick = async (options: Electron.OpenDialogOptions) => {
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled ? null : r.filePaths[0] ?? null;
  };

  /** Every call from the page goes through here: only the bundled page, at the top of the window, is answered. */
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!fromAppPage(e.senderFrame, pagePath)) throw new Error(`${channel} is only answered for the app's own page`);
      return listener(e, ...args);
    });

  handle("state", () => appState());
  /** The settings the engine reads at start; a change to any of them restarts it, anything else does not. */
  const engineInputs = (s: Settings) => JSON.stringify([s.gameFolder, s.endpoint, s.upload, s.prices, s.ask, s.consentedAt]);
  handle("saveSettings", (_e, patch: unknown) => {
    const before = settings;
    const next = mergeSettings(settings, patch);
    // Written first: a save that fails (data folder read-only or full) changes nothing and the page hears why.
    saveSettings(settingsPath, next);
    settings = next;
    applyLoginItem();
    if (!before.consentedAt && settings.consentedAt) checkReleases();
    if ((!before.consentedAt && settings.consentedAt) || before.gameFolder !== settings.gameFolder) void builds.tick();
    if (engineInputs(before) !== engineInputs(settings)) engine.start(settings);
    else if (JSON.stringify(before.market.realms) !== JSON.stringify(settings.market.realms) && settings.prices) void engine.runNow("prices");
    else broadcast();
    return appState();
  });
  handle("detectGameFolders", () => detectGameFolders(candidateRoots({ platform: process.platform, env: process.env, home: homedir() }), realFs));
  handle("pickGameFolder", async () => { const p = await pick({ title: "Pick the game folder that holds WTF", properties: ["openDirectory"] }); return p && resolvePickedFolder(p, realFs); });
  handle("pickTokenFile", () => pick({ title: "Pick the file that holds your MCP token", properties: ["openFile"] }));
  handle("runNow", (_e, job: unknown) => { if (JOBS.includes(job as Job)) return engine.runNow(job as Job); });
  handle("setPaused", (_e, paused: unknown) => engine.setPaused(paused === true));
  handle("openDataFolder", () => shell.openPath(data).then(() => undefined));
  handle("openAddonsFolder", () => { const dir = addonsDir(); return dir && existsSync(dir) ? shell.openPath(dir).then(() => undefined) : undefined; });
  handle("openConfig", () => {
    const config = join(data, "config.json");
    // A starter file with no providers, so the editor opens on the documented shape.
    if (!existsSync(config)) writeFileSync(config, JSON.stringify({ providers: [] }, null, 2) + "\n");
    return shell.openPath(config).then(() => undefined);
  });
  handle("openExternal", (_e, url: unknown) => {
    if (typeof url !== "string" || !allowedExternal(url)) return false;
    void shell.openExternal(url);
    return true;
  });
  // A check from Settings also refreshes the sidebar's update button.
  const messageBox = (options: Electron.MessageBoxOptions) => (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
  // Windows installs download the update here, checked against SHA256SUMS, and install it on restart.
  handle("updateDownload", async () => {
    if (!update?.newer || !update.installable || updateProgress.stage === "downloading") return;
    updateProgress = { stage: "downloading", percent: 0, error: null };
    broadcast();
    try {
      // The offer may have sat in the tray for days. Skip superseded releases before downloading.
      const u = await checkForUpdates(app.getVersion(), fetch, process.platform, Boolean(process.env.PORTABLE_EXECUTABLE_FILE));
      update = u.latest ? u : null;
      if (!u.newer || !u.installable || !u.downloadUrl || !u.sumsUrl) {
        downloaded = null;
        updateProgress = { stage: "idle", percent: 0, error: null };
        broadcast();
        return;
      }
      if (downloaded?.version === u.latest) { updateProgress = { stage: "ready", percent: 100, error: null }; broadcast(); return; }
      downloaded = null;
      broadcast();
      const path = await downloadUpdate({ url: u.downloadUrl, sumsUrl: u.sumsUrl, version: u.latest ?? undefined, dir: join(data, "updates"), onProgress: (percent) => { updateProgress = { stage: "downloading", percent, error: null }; broadcast(); } });
      downloaded = { path, version: u.latest! };
      updateProgress = { stage: "ready", percent: 100, error: null };
    } catch (err) {
      updateProgress = { stage: "failed", percent: 0, error: err instanceof Error ? err.message : String(err) };
    }
    broadcast();
  });
  // Restart asks first, waits for a running upload or price refresh to finish, then hands over to the installer.
  handle("updateRestart", async () => {
    if (!downloaded || updateProgress.stage !== "ready") return false;
    // A newer release may have appeared while this verified installer waited for a restart.
    try {
      const u = await checkForUpdates(app.getVersion(), fetch, process.platform, Boolean(process.env.PORTABLE_EXECUTABLE_FILE));
      update = u.latest ? u : null;
      if (!u.newer || !u.installable || u.latest !== downloaded.version) {
        downloaded = null;
        updateProgress = { stage: "idle", percent: 0, error: null };
        broadcast();
        return false;
      }
    } catch (err) {
      updateProgress = { stage: "failed", percent: 0, error: err instanceof Error ? err.message : String(err) };
      broadcast();
      return false;
    }
    const busy = JOBS.filter((j) => engine.snapshot().jobs[j].state === "running");
    const answer = await messageBox({
      type: "question",
      buttons: ["Restart and update", "Not now"],
      defaultId: 0,
      cancelId: 1,
      title: "Restart to update",
      message: `Restart Everloot Desktop App to install ${downloaded.version}?`,
      detail: [
        "The app closes, installs the update and opens again in a few seconds.",
        "Your settings, characters, chat and backups stay in the data folder. The game and its save files are not touched.",
        busy.length ? `It waits for the running ${busy.join(" and ")} job to finish first.` : "Nothing is uploading right now.",
      ].join("\n\n"),
    });
    if (answer.response !== 0) return false;
    for (let i = 0; i < 120 && JOBS.some((j) => engine.snapshot().jobs[j].state === "running"); i++) await new Promise((r) => setTimeout(r, 500));
    // The app quits only once the installer has started; if it cannot start, the app stays open and says so.
    try {
      await runInstaller(downloaded.path);
    } catch (err) {
      downloaded = null;
      updateProgress = { stage: "failed", percent: 0, error: `the installer did not start (${err instanceof Error ? err.message : String(err)})` };
      broadcast();
      return false;
    }
    quitting = true;
    app.quit();
    return true;
  });
  // The bug report opens GitHub's form with the version and the page's diagnostics filled in, or copies them.
  handle("reportBug", async (_e, diag: unknown) => {
    const text = typeof diag === "string" ? reportDiagnostics(diag) : "";
    const answer = await messageBox({
      type: "info",
      buttons: ["Open the report on GitHub", "Copy diagnostics", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Report a bug",
      message: "Report a bug in Everloot Desktop App",
      detail: "Opens a bug report on GitHub with the app version and these diagnostics filled in: your settings (where the token file is, never the token), the files watched, each job's last state and the last log lines, with your user folder hidden. You read and edit it before sending; it needs a GitHub account. Or copy the diagnostics and post them in the Discord #bug-reports channel.",
    });
    if (answer.response === 1) { clipboard.writeText(text); return "copied"; }
    if (answer.response !== 0) return null;
    const q = new URLSearchParams({ template: "bug-report.yml", labels: "bug,desktop", part: "Desktop App", page: `Everloot Desktop App ${app.getVersion()} (${process.platform})`, diagnostics: text });
    void shell.openExternal(`https://github.com/Everloot/everloot/issues/new?${q}`);
    return "opened";
  });
  handle("accountSignIn", async (_e, key: unknown) => {
    if (typeof key !== "string") throw new Error("Paste the key first.");
    await signIn(data, settings.endpoint, key);
    void builds.signedIn();
    return appState();
  });
  // Browser sign-in: one at a time; a second press stops the first. The key it brings is checked and kept
  // the same way as a pasted one, then the window comes back to the front.
  let connecting: AbortController | null = null;
  handle("accountConnect", async () => {
    connecting?.abort();
    const mine = new AbortController();
    connecting = mine;
    const endpoint = settings.endpoint;
    try {
      const key = await connectInBrowser(endpoint, (url) => {
        if (allowedExternal(url) || new URL(url).origin === new URL(endpoint).origin) void shell.openExternal(url);
      }, undefined, mine.signal);
      await signIn(data, endpoint, key);
      void builds.signedIn();
      if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
      return appState();
    } finally {
      if (connecting === mine) connecting = null;
    }
  });
  handle("accountConnectCancel", () => { connecting?.abort(); });
  handle("accountSignOut", () => {
    signOut(data);
    builds.signedOut();
    return appState();
  });
  handle("checkForUpdates", async () => {
    const check = await checkForUpdates(app.getVersion(), fetch, process.platform, Boolean(process.env.PORTABLE_EXECUTABLE_FILE));
    update = check.latest ? check : null;
    broadcast();
    return check;
  });

  handle("uploadInfo", () => summarizeFiles(engine.snapshot().files, join(data, "sent.json"), settings.endpoint));
  handle("backups", () => listBackups(data));
  handle("openBackupsFolder", () => { const dir = join(data, "backups"); return existsSync(dir) ? shell.openPath(dir).then(() => undefined) : undefined; });
  handle("restoreBackup", async (_e, file: unknown) => {
    if (typeof file !== "string") throw new Error("Not a backup");
    const entry = listBackups(data).find((b) => b.file === file);
    if (!entry) throw new Error("That backup is gone");
    const options: Electron.MessageBoxOptions = {
      type: "warning", buttons: ["Restore", "Cancel"], defaultId: 1, cancelId: 1,
      title: "Restore a backup",
      message: `Put the ${entry.account} save file back to ${new Date(entry.at).toLocaleString()}?`,
      detail: "Do this while logged out: the game rewrites the file on logout and would undo the restore. The file as it is now is backed up first, so you can go back.",
    };
    const r = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (r.response !== 0) return null;
    return restoreBackup(file, data, engine.snapshot().files);
  });
  handle("marketInfo", async (): Promise<MarketInfo> => {
    const files = engine.snapshot().files;
    const scans = newestScans(allScans());
    const dir = addonsDir();
    const inGame = dir ? readPricesFile(dir)?.realms ?? null : null;
    const base = { own: ownRealms(files), followed: settings.market.realms, last: jobs.lastMarket(), scans, inGame };
    try {
      const k = await knownRealms();
      return { ...base, known: k.realms, dataAsOf: k.dataAsOf, error: null };
    } catch (err) {
      return { ...base, known: [], dataAsOf: null, error: err instanceof Error ? err.message : String(err) };
    }
  });
  handle("marketLookup", (_e, text: unknown): PriceLookup => {
    const itemId = typeof text === "string" ? itemIdFrom(text.slice(0, 500)) : null;
    if (itemId === null) return { itemId, rows: [], note: "Give an item id, or paste an item link from game chat." };
    const dir = addonsDir();
    const file = dir ? readPricesFile(dir) : null;
    if (!file) return { itemId, rows: [], note: "No prices file in the game yet. Turn on Market prices and press Refresh now." };
    const rows = priceRows(file, itemId).map(({ realm, dataAsOf, market, min, historical, quantity, day, reporters }) => ({ realm, dataAsOf, market, min, historical, quantity, day, reporters }));
    return { itemId, rows, note: rows.length ? null : "This item is not in the game's price file. Each realm's file keeps the 2,000 items with the most units listed, so a public price may still be on the website; a day is public once three reporters scanned it." };
  });
  handle("askInfo", (): AskInfo => {
    const pending = engine.snapshot().files.map((file) => {
      try { return { file, asks: readAsks(readFileSync(file, "utf8")) }; } catch { return { file, asks: [] }; }
    });
    let providers: string[] = [], providerError: string | null = null;
    try { providers = loadProviders(join(data, "config.json")).map((p) => p.name); }
    catch (err) { providerError = err instanceof Error ? err.message : String(err); }
    return { pending, answers: jobs.answerStore.list().slice().reverse(), providers, providerError };
  });
  handle("addonInfo", async (): Promise<AddonInfo> => {
    const dir = addonsDir();
    const local = { addonsDir: dir, installed: dir ? installedAddonVersion(dir) : null, slots: dir ? slotAddons(dir) : { prices: false, answers: false, builds: false } };
    try {
      const latest = newestAddonRelease(await releases());
      return { ...local, latest, newer: Boolean(latest && local.installed && compareVersions(latest.version, local.installed) > 0), error: null };
    } catch (err) { return { ...local, latest: null, newer: false, error: err instanceof Error ? err.message : String(err) }; }
  });
  handle("buildsSync", async () => { await builds.sync(); return appState(); });
  handle("installAddon", async (_e, version: unknown) => {
    const dir = addonsDir();
    if (!dir) throw new Error("Pick the game folder first");
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Not a version");
    return installAddon({ version, endpoint: settings.endpoint, addonsDir: dir });
  });
  handle("changes", () => changes());
  handle("charactersInfo", () => charactersFromFiles(engine.snapshot().files));

  handle("chatInfo", () => chat.info());
  handle("chatSend", (e, text: unknown) => (typeof text === "string" ? chat.send(text, (p) => { if (!e.sender.isDestroyed()) e.sender.send("chatProgress", p); }) : chat.info()));
  handle("chatClear", () => chat.clear());
  handle("chatStop", () => chat.stop());
  handle("chatSetProvider", (_e, raw: unknown) => {
    const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (!presetFor(String(c.kind))) throw new Error("Pick a provider");
    const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 2000) : undefined);
    return chat.setProvider({ kind: c.kind as ProviderKind, key: str(c.key), model: str(c.model), baseUrl: str(c.baseUrl) });
  });
  handle("chatRemoveProvider", (_e, kind: unknown) => chat.removeProvider(presetFor(String(kind)) ? (kind as ProviderKind) : undefined));
  handle("chatUseModel", (_e, kind: unknown, model: unknown) => {
    if (!presetFor(String(kind)) || typeof model !== "string") throw new Error("Pick a model");
    return chat.useModel(kind as ProviderKind, model.slice(0, 200));
  });
  handle("chatModels", (_e, kind: unknown) => (presetFor(String(kind)) ? chat.models(kind as ProviderKind) : null));


  // A stray rejection or exception becomes a line on the Log page instead of Electron's dialog; the jobs keep running.
  // Logging re-runs the engine listeners (broadcast, tray); if the error came from one of them, the handler must not throw too.
  const describe = (err: unknown) => (err instanceof Error ? err.stack ?? err.message : String(err));
  const note = (what: string, err: unknown) => { console.error(err); try { engine.log("error", `${what}: ${describe(err)}`); } catch { /* already on the console */ } };
  process.on("unhandledRejection", (err) => note("Unhandled rejection", err));
  process.on("uncaughtException", (err) => note("Uncaught exception", err));

  app.on("second-instance", () => show());
  app.on("activate", () => show());
  app.on("before-quit", () => { quitting = true; });
  app.on("window-all-closed", () => { /* stay in the tray */ });

  void app.whenReady().then(() => {
    // The page asks for no camera, microphone, location or web notifications; it only copies text.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowedPermission(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowedPermission(permission));
    tray = createTray(join(__dirname, process.platform === "darwin" ? "trayTemplate.png" : "tray.png"), {
      show, runNow: (job) => void engine.runNow(job), setPaused: (p) => engine.setPaused(p), openExternal: (url) => { if (allowedExternal(url)) void shell.openExternal(url); }, quit: () => { quitting = true; app.quit(); },
    });
    applyLoginItem();
    // The installer that brought this version, and older ones, are no longer needed.
    pruneInstallers(join(data, "updates"), app.getVersion());
    engine.start(settings);
    // A laptop that slept through the last retry would otherwise wait for the next logout.
    powerMonitor.on("resume", () => engine.recover());
    // So would a Wi-Fi drop at logout that comes back without a sleep.
    onReconnect(() => net.isOnline(), () => engine.recover());
    // Windows passes the login item's args; macOS does not, but says whether this launch came from login.
    const hidden = process.argv.includes("--hidden") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin);
    if (!settings.consentedAt || !(hidden && settings.startInTray)) createWindow();
    broadcast();
    checkReleases();
    // The app sits in the tray for weeks; look again once a day.
    setInterval(checkReleases, 24 * 60 * 60 * 1000);
    // Saved builds once at start, then every 15 minutes; each turn does nothing without a key.
    void builds.tick();
    builds.start();
  });
}
