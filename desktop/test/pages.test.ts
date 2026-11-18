import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { AppState, ChatInfo, FileSummary, JobStatus, MarketInfo } from "../src/shared/types";
import { summarizeCharacters } from "../src/main/characters";
import { addon, ask, assistantSetup, changes, characters, chat, log, market, overview, restartDialog, settings, updatePopover, upload, welcome, wipeDialog, type View } from "../src/renderer/pages";
import { PROVIDER_PRESETS, type ModelChoice } from "../src/shared/providers";
import { CHARACTERS } from "./save-fixtures";

// The pages print times in the machine's locale and zone; a snapshot needs the same text everywhere.
vi.mock("../src/renderer/format", async (real) => ({
  ...(await real<typeof import("../src/renderer/format")>()),
  when: (iso: string | null) => iso ?? "never",
  clock: (iso: string | null) => iso?.slice(11, 16) ?? "",
}));

const NOW = "2026-10-20T12:00:00Z";
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(NOW)); });
afterAll(() => { vi.useRealTimers(); });

// ---------- fixtures ----------

const FOLDER = "D:\\Games\\World of Warcraft\\_forever_";
const FILE = `${FOLDER}\\WTF\\Account\\ACC\\SavedVariables\\Everloot.lua`;
const idle: JobStatus = { state: "idle", message: "", at: null };

/** Set up and watching one save file, every job on and waiting, nothing logged. */
function appState(patch: Partial<AppState> = {}): AppState {
  return {
    version: "0.1.23", platform: "win32", dataFolder: "C:\\Users\\player\\AppData\\Roaming\\Everloot", notice: null, foreverFolder: null,
    settings: {
      gameFolder: FOLDER, keptGameFolder: null, endpoint: "https://everloot.app", upload: true, census: true, players: true, prices: true,
      ask: { enabled: true, mcpUrl: "https://everloot.app/mcp", tokenFile: null },
      market: { realms: ["Nightslayer"], dismissed: [] }, consentedAt: "2026-10-01T00:00:00Z", launchAtLogin: false, startInTray: false, dataNoticeDismissed: false, autoUpdateAddon: true,
    },
    engine: { files: [FILE], jobs: { upload: idle, prices: idle, ask: idle }, log: [], paused: false },
    update: null, updateProgress: { stage: "idle", percent: 0, error: null }, staleScans: [],
    account: { signedIn: false, hint: null },
    builds: { state: "off", message: "", syncedAt: null, builds: null },
    ...patch,
  };
}
const withSettings = (patch: Partial<AppState["settings"]>, s = appState()): AppState => ({ ...s, settings: { ...s.settings, ...patch } });
const withEngine = (patch: Partial<AppState["engine"]>, s = appState()): AppState => ({ ...s, engine: { ...s.engine, ...patch } });

/** Nothing loaded yet: every data field missing, no draft, no note. */
function view(patch: Partial<View> = {}): View {
  return {
    state: null, data: {}, candidates: [], chosenFolder: null, censusChoice: true, playersChoice: true, setupAddon: null, agreed: false,
    connecting: false, busy: "", flash: "", pickKind: "anthropic", pickOpen: false, providerDraft: null, setupNote: "", advancedOpen: null,
    liveModels: {}, live: null, copied: null, priceLookup: null, charPick: null, wipe: { stage: "ask", left: [], error: "" },
    ...patch,
  };
}

const LOG = [
  { at: "2026-10-20T11:50:00Z", level: "info" as const, text: "upload ACC: sent 12 new events" },
  { at: "2026-10-20T11:51:00Z", level: "info" as const, text: "prices: wrote 2 realms into the game" },
  { at: "2026-10-20T11:52:00Z", level: "error" as const, text: "ask ACC: the token file is missing" },
];
const chatInfo = (patch: Partial<ChatInfo> = {}): ChatInfo => ({
  messages: [], mode: "plain search", mcpUrl: "https://everloot.app/mcp", withToken: false, withAccountKey: false, provider: null, providers: [], busy: false, error: null, ...patch,
});
const MESSAGES: ChatInfo["messages"] = [
  { role: "user", text: "What drops the Bindings of the Windseeker?", at: "2026-10-20T11:00:00Z", model: null, sources: [], steps: [] },
  { role: "assistant", text: "Baron Geddon and Garr, in Molten Core.", at: "2026-10-20T11:00:05Z", model: null, sources: ["everloot.app/items/18563"], steps: [] },
];
const FILES: FileSummary[] = [{
  file: FILE, ok: true, error: null, addonVersion: "0.3.14", clientBuild: "1.60.1.70450", writtenAt: "2026-10-20T11:40:00Z", bytes: 48_000,
  kinds: [{ kind: "loot", count: 40 }, { kind: "npc_sighting", count: 12 }], records: 52, confirmed: 50, pendingAsks: 0, scanRealms: ["Nightslayer"], scans: [],
}];
const marketInfo = (patch: Partial<MarketInfo> = {}): MarketInfo => ({
  own: [], followed: ["Nightslayer"], suggested: [], known: [], dataAsOf: null, last: [], scans: [], error: null, inGame: null, ...patch,
});
const MARKET = marketInfo({
  own: ["Doomhowl"], followed: ["Nightslayer"], known: ["Doomhowl", "Nightslayer"], dataAsOf: "2026-10-20T06:00:00Z",
  last: [{ realm: "Doomhowl", house: "Alliance", items: 1200, dataAsOf: "2026-10-20T06:00:00Z", source: "scan" }],
  scans: [{ realm: "Doomhowl", at: "2026-10-20T09:00:00Z" }, { realm: "Nightslayer", at: "2026-10-15T09:00:00Z" }],
});
const CHANGES = [
  { title: "Hotfixes: October 19", link: "https://everloot.app/changes/1", date: "2026-10-19T20:00:00Z", summary: "Molten Core respawn timers." },
  { title: "Build 1.60.1.70450", link: "", date: "2026-10-18T08:00:00Z", summary: "" },
];
const USAGE = { total: 3_400_000, parts: { backups: 2_900_000, updates: 0, chat: 200_000, uploads: 250_000, settings: 4_000, other: 46_000 }, notice: false };

// ---------- reading the markup ----------

/** The words of a piece of markup: every tag dropped by walking the characters (a test helper, never a sanitiser). */
function text(html: string): string {
  let out = "";
  let inTag = false;
  for (const ch of html) {
    if (ch === "<") inTag = true;
    else if (ch === ">" && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}
const h1 = (html: string) => text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "");
/** The text of every role="status" element. */
const statusLines = (html: string) => [...html.matchAll(/<(\w+)[^>]*role="status"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => text(m[2]));
/** The first empty state's cause and the label of its button, if it has one. */
function empty(html: string): { cause: string; action: string | null } | null {
  const m = /<div class="empty">[\s\S]*?<p class="empty-cause">([\s\S]*?)<\/p>[\s\S]*?<\/div>(<button[^>]*>([\s\S]*?)<\/button>)?<\/div>/.exec(html);
  return m ? { cause: text(m[1]), action: m[3] ? text(m[3]) : null } : null;
}
/** The opening tag of the first element matching an attribute, e.g. `id="start"` or `data-run="upload"`. */
const tag = (html: string, attr: string) => new RegExp(`<[a-z]+[^>]*${attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`).exec(html)?.[0] ?? "";
const disabled = (html: string, attr: string) => {
  const t = tag(html, attr);
  expect(t, `no element with ${attr}`).not.toBe("");
  return /\sdisabled(?=[\s>=])/.test(t);
};

// ---------- pages ----------

describe("welcome", () => {
  test("with no folder found, the hint names WoW: Forever's folder on Windows and elsewhere, and Start waits", () => {
    const html = welcome(view({ state: withSettings({ consentedAt: null }) }));
    expect(h1(html)).toBe("Set up Everloot");
    expect(html).toContain("<code>World of Warcraft\\_forever_</code>");
    expect(welcome(view({ state: { ...appState(), platform: "darwin" } }))).toContain("<code>World of Warcraft/_forever_</code>");
    expect(html).not.toContain("_classic_era_");
    expect(disabled(html, 'id="start"')).toBe(true);
    expect(statusLines(html)).toEqual([]);
  });

  test("Start needs a folder and the agreement", () => {
    const candidates = [{ folder: FOLDER, product: "_forever_", files: 1, hasAccounts: true }];
    expect(disabled(welcome(view({ candidates, chosenFolder: FOLDER })), 'id="start"')).toBe(true);
    expect(disabled(welcome(view({ candidates, chosenFolder: FOLDER, agreed: true })), 'id="start"')).toBe(false);
  });

  test("a failed sign-in and a failed addon install are status lines", () => {
    const html = welcome(view({ chosenFolder: FOLDER, flash: "!The browser did not answer", setupAddon: { folder: FOLDER, installed: null, note: "!The download failed" } }));
    expect(statusLines(html)).toEqual(["The browser did not answer", "The download failed"]);
    expect(html).toContain('<p role="status" class="error small">The download failed</p>');
  });

  test("populated", () => {
    const html = welcome(view({
      state: appState({ account: { signedIn: true, hint: "9f3c" } }), agreed: true, chosenFolder: FOLDER,
      candidates: [{ folder: FOLDER, product: "_forever_", files: 1, hasAccounts: true }, { folder: "D:\\Games\\World of Warcraft\\_classic_era_", product: "_classic_era_", files: 0, hasAccounts: false }],
      setupAddon: { folder: FOLDER, installed: "0.3.14", note: "Installed the Everloot addon 0.3.14. If the game is open, restart it." },
    }));
    expect(statusLines(html)).toEqual(["Installed the Everloot addon 0.3.14. If the game is open, restart it."]);
    expect(html).toMatchSnapshot();
  });
});

describe("overview", () => {
  test("loading", () => {
    const s = appState();
    const html = overview(s, view({ state: s }));
    expect(h1(html)).toBe("Overview");
    expect(html).toContain("<span>…</span>");
    expect(html).toContain('<span class="muted">Loading…</span>');
    expect(empty(html)).toEqual({ cause: "Nothing logged since start", action: null });
  });

  test("no game folder: the lead action opens Settings and nothing can run", () => {
    const s = withSettings({ gameFolder: null });
    const html = overview(s, view({ state: s, data: { changes: [] } }));
    expect(html).toContain('<button type="button" class="btn btn-primary" data-page="settings">Open Settings</button>');
    expect(html).not.toContain('data-run="upload"');
  });

  test("a failed changes feed says why, with a retry", () => {
    const s = appState();
    expect(empty(overview(s, view({ state: s, data: { changesError: "changes feed: 503" } })).split("Latest changes")[1])).toEqual({ cause: "changes feed: 503", action: "Retry" });
  });

  test("a failed job leads to the log and asks why", () => {
    const s = withEngine({ jobs: { upload: { state: "error", message: "the site said 500", at: "2026-10-20T11:00:00Z" }, prices: idle, ask: idle } });
    const html = overview(s, view({ state: s }));
    expect(html).toContain('data-page="log">Open the log</button>');
    expect(html).toContain('<b>Upload:</b>');
    expect(html).toContain(">ask why</button>");
  });

  test("Upload now is the primary control, off while paused", () => {
    const s = appState();
    expect(tag(overview(s, view({ state: s })), 'data-run="upload"')).toContain("btn-primary");
    expect(disabled(overview(s, view({ state: s })), 'data-run="upload"')).toBe(false);
    const paused = withEngine({ paused: true });
    expect(disabled(overview(paused, view({ state: paused })), 'data-run="upload"')).toBe(true);
  });

  test("populated", () => {
    const s = withEngine({ log: LOG, jobs: { upload: { state: "ok", message: "sent 12 new events", at: "2026-10-20T11:50:00Z" }, prices: { state: "ok", message: "", at: "2026-10-20T11:51:00Z" }, ask: idle } });
    const html = overview(s, view({ state: s, data: {
      addon: { addonsDir: `${FOLDER}\\Interface\\AddOns`, installed: "0.3.13", latest: { version: "0.3.14", url: "https://github.com/Everloot/everloot/releases" }, newer: true, slots: { prices: true, answers: false, builds: false }, error: null },
      changes: CHANGES, market: MARKET, usage: USAGE,
    } }));
    expect(html).toContain('id="heroTitle">Watching 1 account file</b>');
    expect(html).toMatchSnapshot();
  });
});

describe("chat", () => {
  test("loading and empty both offer starter questions, and Send is on", () => {
    for (const c of [undefined, chatInfo()]) {
      const html = chat(view({ data: { chat: c } }));
      expect(h1(html)).toBe("Chat");
      expect(html).toContain('<div class="chat-empty">');
      expect(html).toContain('data-ask="What drops the Bindings of the Windseeker?"');
      expect(disabled(html, 'type="submit"')).toBe(false);
    }
  });

  test("while it answers, Send and the question box are off and Stop is there", () => {
    const html = chat(view({ data: { chat: chatInfo({ messages: MESSAGES.slice(0, 1), busy: true }) }, live: { text: "", tool: "search" } }));
    expect(disabled(html, 'type="submit"')).toBe(true);
    expect(disabled(html, 'id="chatText"')).toBe(true);
    expect(html).toContain('id="chatStop"');
    expect(html).toContain("Looking up search…");
  });

  test("an error is shown in the thread", () => {
    expect(chat(view({ data: { chat: chatInfo({ error: "The public server is rate limited" }) } }))).toContain('<div class="msg msg-assistant error">The public server is rate limited</div>');
  });

  test("populated", () => {
    const html = chat(view({ data: { chat: chatInfo({ messages: MESSAGES }) }, copied: { index: 1, label: "Copied" } }));
    expect(html).not.toContain("chat-empty");
    expect(html).toMatchSnapshot();
  });

  // A saved provider: the model menu keeps the saved pick selected and lists the models fetched from the provider.
  const KIND = PROVIDER_PRESETS[0].kind;
  const LIVE = { [KIND]: [{ id: "m-first", label: "First model" } as ModelChoice, { id: "m-live", label: "Live model" } as ModelChoice] };
  const SAVED = { kind: KIND, model: "m-saved", baseUrl: null };

  test("a saved provider keeps its model selected, beside the fetched models", () => {
    const html = chat(view({ data: { chat: chatInfo({ provider: SAVED, providers: [SAVED] }) }, liveModels: LIVE }));
    expect(html).toContain(`<option value="${KIND}|m-saved" selected>`);
    expect(html).toContain(`<option value="${KIND}|m-live" >Live model</option>`);
    expect(html).toContain("Assistant setup: saved providers");
    expect(html).not.toContain("Search only, no model");
  });

  test("the open setup form shows the saved providers and keeps a draft's model through a redraw", () => {
    const c = chatInfo({ provider: SAVED, providers: [SAVED] });
    const draft = { kind: KIND, key: "", baseUrl: "", model: "m-live", modelText: "" };
    const s = appState();
    const html = assistantSetup(c, "settings", view({ state: s, data: { chat: c }, pickOpen: true, pickKind: KIND, providerDraft: draft, liveModels: LIVE }));
    expect(html).toContain('id="providerForm"');
    expect(html).toContain("Saved here:");
    expect(html).toContain('data-removekind="' + KIND + '"');
    expect(html).toMatch(/<option value="m-live"[^>]*selected/);
    expect(html).not.toMatch(/<option value="m-first"[^>]*selected/);
    // Closed, the same panel offers the button instead of the form.
    expect(assistantSetup(c, "settings", view({ state: s, data: { chat: c }, pickOpen: false }))).toContain('id="assistantOpen"');
  });
});

describe("characters", () => {
  test("loading", () => {
    const s = appState();
    const html = characters(view({ state: s }));
    expect(h1(html)).toBe("Characters");
    expect(html).toContain('<section class="panel"><p class="muted">Loading…</p></section>');
  });

  test("empty says why, most fundamental cause first", () => {
    const data = { characters: { characters: [], progress: [] } };
    expect(empty(characters(view({ state: appState(), data })))).toEqual({ cause: "Save file read, no named character rows yet", action: null });
    expect(empty(characters(view({ state: withSettings({ gameFolder: null }), data })))).toEqual({ cause: "Not watching a game folder", action: "Open Settings" });
    expect(empty(characters(view({ state: withEngine({ paused: true }), data })))).toEqual({ cause: "Everloot is paused", action: "Overview" });
    expect(characters(view({ state: appState(), data }))).toContain("/everloot completion on");
  });

  test("populated, from the save fixture", () => {
    const info = summarizeCharacters(CHARACTERS, Date.parse(NOW));
    const html = characters(view({ state: appState(), data: { characters: info } }));
    expect(h1(html)).toBe(info.characters[0].character);
    expect(html).toContain("roster-row sel");
    expect(html).toMatchSnapshot();
  });
});

describe("upload", () => {
  test("loading or empty: nothing sent yet, with Upload now", () => {
    const s = appState();
    const html = upload(s, view({ state: s }));
    expect(h1(html)).toBe("Upload");
    expect(empty(html)).toEqual({ cause: "Nothing sent yet", action: "Upload now" });
    expect(disabled(html, 'id="openBackups"')).toBe(true);
  });

  test("Run now is off while paused, while off, without a save file and while running", () => {
    const run = (s: AppState) => disabled(upload(s, view({ state: s })), 'data-run="upload"');
    expect(run(appState())).toBe(false);
    expect(run(withEngine({ paused: true }))).toBe(true);
    expect(run(withSettings({ upload: false }))).toBe(true);
    expect(run(withEngine({ files: [] }))).toBe(true);
    expect(run(withEngine({ jobs: { upload: { state: "running", message: "", at: null }, prices: idle, ask: idle } }))).toBe(true);
    expect(empty(upload(withEngine({ files: [] }), view()))?.cause).toBe(`No Everloot.lua under ${FOLDER} yet`);
  });

  test("an unreadable file says why", () => {
    const s = appState();
    expect(upload(s, view({ state: s, data: { upload: [{ ...FILES[0], ok: false, error: "not an Everloot save file" }] } }))).toContain('<div class="error small">not an Everloot save file</div>');
  });

  test("populated", () => {
    const s = withEngine({ log: LOG });
    const html = upload(s, view({ state: s, busy: "", flash: "Restored ACC. Log in to see it.", data: { upload: FILES, backups: [{ file: "ACC-2026-10-20.lua", account: "ACC", at: "2026-10-20T11:40:00Z", bytes: 48_000 }] } }));
    expect(empty(html)).toBeNull();
    expect(disabled(html, 'data-restore="ACC-2026-10-20.lua"')).toBe(false);
    expect(html).toMatchSnapshot();
  });
});

describe("market", () => {
  test("loading", () => {
    const s = appState();
    const html = market(s, view({ state: s }));
    expect(h1(html)).toBe("Market");
    expect(html).toContain('<p class="muted">Loading…</p>');
  });

  test("empty: no public values, no scan, nothing written, with the refresh", () => {
    const s = appState();
    const html = market(s, view({ state: s, data: { market: marketInfo() } }));
    expect(html).toContain("The site has no public values yet.");
    expect(empty(html)).toEqual({ cause: "No full scan in your save file yet", action: null });
    expect(empty(html.split("Written into the game")[1])).toEqual({ cause: "Nothing written into the game yet", action: "Refresh prices" });
    expect(disabled(html, 'data-run="prices"')).toBe(false);
    expect(disabled(market(withSettings({ prices: false }), view({ data: { market: marketInfo() } })), 'data-run="prices"')).toBe(true);
  });

  test("a site error and a failed refresh say so", () => {
    const s = withEngine({ jobs: { upload: idle, prices: { state: "error", message: "prices: the site said 503", at: NOW }, ask: idle } });
    const html = market(s, view({ state: s, data: { market: marketInfo({ error: "market: the site said 503" }) } }));
    expect(html).toContain('<p class="muted">market: the site said 503</p>');
    expect(html).toContain('<p class="error">prices: the site said 503</p>');
  });

  test("populated", () => {
    const s = appState();
    const priceLookup = { itemId: 2589, note: null, rows: [{ realm: "Doomhowl", house: "Alliance", dataAsOf: "2026-10-20T06:00:00Z", market: 1250, min: 1100, historical: 1300, quantity: 400, day: "2026-10-19", reporters: 3 }] };
    const html = market(s, view({ state: s, data: { market: { ...MARKET, suggested: ["Skull Rock"] } }, priceLookup }));
    expect(html).toContain('data-suggestion="follow"');
    expect(html).toMatchSnapshot();
  });
});

describe("ask", () => {
  test("loading", () => {
    const s = appState();
    const html = ask(s, view({ state: s }));
    expect(h1(html)).toBe("Ask");
    expect(html).toContain("<p>Loading…</p>");
  });

  test("empty: no question waiting, nothing answered; off says it is off", () => {
    const info = { pending: [], answers: [], providers: [], providerError: null };
    const s = appState();
    expect(empty(ask(s, view({ state: s, data: { ask: info, chat: chatInfo() } })))).toEqual({ cause: "No question waiting", action: null });
    const off = withSettings({ ask: { ...s.settings.ask, enabled: false } });
    const html = ask(off, view({ state: off, data: { ask: info, chat: chatInfo() } }));
    expect(empty(html)?.cause).toBe("/ask is off");
    expect(disabled(html, 'data-run="ask"')).toBe(true);
  });

  test("a provider error and a saved note are shown", () => {
    const s = appState();
    const html = ask(s, view({ state: s, flash: "Saved.", setupNote: "!The key was refused", data: { ask: { pending: [], answers: [], providers: [], providerError: "config.json: no such provider" }, chat: chatInfo() } }));
    expect(html).toContain('<span class="error">config.json: no such provider</span>');
    expect(statusLines(html)).toEqual(["Saved.", "The key was refused"]);
  });

  test("populated", () => {
    const s = withEngine({ log: LOG });
    const html = ask(s, view({ state: s, data: {
      ask: { pending: [{ file: FILE, asks: [{ id: "ask:1", question: "price Linen Cloth on Doomhowl", askedAt: "2026-10-20T11:30:00Z" }] }], answers: [{ id: "ask:0", answer: "Linen Cloth on Doomhowl: 12s.", source: "Everloot market", answeredAt: "2026-10-20T10:00:00Z" }], providers: [], providerError: null },
      chat: chatInfo(),
    } }));
    expect(empty(html)).toBeNull();
    expect(html).toMatchSnapshot();
  });
});

describe("addon", () => {
  const latest = { version: "0.3.14", url: "https://github.com/Everloot/everloot/releases/tag/addon-v0.3.14" };
  const info = (patch = {}) => ({ addonsDir: `${FOLDER}\\Interface\\AddOns`, installed: null, latest, newer: true, slots: { prices: false, answers: false, builds: false }, error: null, ...patch });

  test("loading", () => {
    const s = appState();
    const html = addon(s, view({ state: s }));
    expect(h1(html)).toBe("Addon");
    expect(html).toContain('<div class="v">…</div>');
    expect(disabled(html, 'id="installAddon"')).toBe(true);
  });

  test("no game folder: the empty state opens Settings", () => {
    const s = withSettings({ gameFolder: null });
    expect(empty(addon(s, view({ state: s, data: { addon: info({ addonsDir: null }) } })))).toEqual({ cause: "Not watching a game folder", action: "Open Settings" });
  });

  test("not installed: Install is on, and off while installing", () => {
    const s = appState();
    const html = addon(s, view({ state: s, data: { addon: info() } }));
    expect(html).toContain('id="installAddon" >Install</button>');
    expect(disabled(html, 'id="installAddon"')).toBe(false);
    const busy = addon(s, view({ state: s, busy: "install", data: { addon: info() } }));
    expect(disabled(busy, 'id="installAddon"')).toBe(true);
    expect(busy).toContain("Installing…");
  });

  test("a failed install and a key that can't read builds are status lines", () => {
    const s = appState({ account: { signedIn: true, hint: "9f3c" }, builds: { state: "forbidden", message: "", syncedAt: null, builds: null } });
    const html = addon(s, view({ state: s, flash: "!The checksum did not match", data: { addon: info() } }));
    expect(statusLines(html)).toEqual(["The checksum did not match", "This key can't read your saved builds. Make a key with &quot;Read my saved builds&quot; on everloot.app ↗"]);
  });

  test("populated: up to date, with a reinstall link and synced builds", () => {
    const s = appState({ account: { signedIn: true, hint: "9f3c" }, builds: { state: "ok", message: "", syncedAt: "2026-10-20T11:00:00Z", builds: 2 } });
    const html = addon(s, view({ state: s, data: { addon: info({ installed: "0.3.14", newer: false, slots: { prices: true, answers: true, builds: true } }) } }));
    expect(html).toContain("<h2>Up to date</h2>");
    expect(disabled(html, 'id="buildsSync"')).toBe(false);
    expect(html).toMatchSnapshot();
  });
});

describe("changes", () => {
  test("loading", () => {
    const html = changes(view({ state: appState() }));
    expect(h1(html)).toBe("Changes");
    expect(html).toContain('<p class="muted">Loading…</p>');
  });

  test("empty and failed", () => {
    expect(empty(changes(view({ state: appState(), data: { changes: [] } })))).toEqual({ cause: "No changes fetched yet", action: null });
    expect(empty(changes(view({ state: appState(), data: { changesError: "changes feed: 503" } })))).toEqual({ cause: "changes feed: 503", action: "Retry" });
  });

  test("populated", () => {
    const html = changes(view({ state: appState(), data: { changes: CHANGES } }));
    expect(empty(html)).toBeNull();
    expect(html).toMatchSnapshot();
  });
});

describe("log", () => {
  test("empty", () => {
    const s = appState();
    const html = log(s, view({ state: s }));
    expect(h1(html)).toBe("Log");
    expect(empty(html)).toEqual({ cause: "Nothing logged since start", action: null });
    expect(html).toContain('id="pause">Pause</button>');
  });

  test("paused says Resume; a failed job offers to ask why", () => {
    const s = withEngine({ paused: true, jobs: { upload: idle, prices: idle, ask: { state: "error", message: "the token file is missing", at: NOW } } });
    const html = log(s, view({ state: s }));
    expect(html).toContain('id="pause">Resume</button>');
    expect(html).toContain(">Ask the assistant why it failed</button>");
  });

  test("populated", () => {
    const s = withEngine({ log: LOG });
    const html = log(s, view({ state: s, flash: "Copied. Paste it into the bug report." }));
    expect(empty(html)).toBeNull();
    expect(html).toMatchSnapshot();
  });
});

describe("settings", () => {
  test("loading", () => {
    const s = appState();
    const html = settings(s, view({ state: s }));
    expect(h1(html)).toBe("Settings");
    expect(html).toContain("<p>Loading…</p>");
    expect(html).toContain("The data folder holds <b>…</b>");
    expect(disabled(html, 'id="assistantOpen"')).toBe(true);
  });

  test("a saved or failed action is a status line", () => {
    const s = appState();
    expect(statusLines(settings(s, view({ state: s, flash: "!Could not check: offline", data: { chat: chatInfo(), usage: USAGE } })))[0]).toBe("Could not check: offline");
  });

  test("populated", () => {
    const s = appState({ account: { signedIn: true, hint: "9f3c" }, foreverFolder: FOLDER, runRecords: true });
    const html = settings(withSettings({ gameFolder: "D:\\Games\\World of Warcraft\\_classic_era_" }, s), view({ state: s, data: { chat: chatInfo(), usage: USAGE } }));
    expect(html).toContain('id="useForever"');
    expect(disabled(html, 'id="assistantOpen"')).toBe(false);
    expect(html).toMatchSnapshot();
  });
});

// ---------- the update and wipe dialogs ----------

describe("update", () => {
  const up = { current: "0.1.23", latest: "0.1.24", url: "https://github.com/Everloot/everloot/releases/tag/desktop-v0.1.24", newer: true, notes: [{ text: "Desktop: the Market page remembers the lookup", author: null, pr: null }], downloadUrl: null, publishedAt: "2026-10-19T00:00:00Z", sumsUrl: null, installable: true };

  test("the popover offers the download, then its progress, then the restart", () => {
    expect(updatePopover(up, { stage: "idle", percent: 0, error: null })).toContain('id="updateGet">Download and install 0.1.24</button>');
    expect(updatePopover(up, { stage: "downloading", percent: 40, error: null })).toContain('aria-valuenow="40"');
    expect(updatePopover(up, { stage: "failed", percent: 0, error: "checksum mismatch" })).toContain("The update failed: checksum mismatch");
    expect(updatePopover(up, { stage: "ready", percent: 100, error: null })).toMatchSnapshot();
  });

  test("the restart dialog turns its buttons off once restarting", () => {
    const s = appState({ update: up, updateProgress: { stage: "ready", percent: 100, error: null } });
    expect(disabled(restartDialog(s, false), 'id="restartGo"')).toBe(false);
    expect(disabled(restartDialog(s, true), 'id="restartGo"')).toBe(true);
    expect(restartDialog(s, false)).toMatchSnapshot();
  });
});

describe("wipe", () => {
  test("Delete waits for a running job", () => {
    const s = withEngine({ jobs: { upload: { state: "running", message: "", at: null }, prices: idle, ask: idle } });
    const html = wipeDialog(s, view({ state: s }));
    expect(disabled(html, 'id="wipeGo"')).toBe(true);
    expect(html).toContain("Upload is running; wait for it to finish.");
  });

  test("files another program kept are named", () => {
    const s = appState();
    expect(wipeDialog(s, view({ state: s, wipe: { stage: "left", left: ["chat.json"], error: "" } }))).toContain('<span class="mono">chat.json</span>');
  });

  test("populated", () => {
    const s = appState({ account: { signedIn: true, hint: "9f3c" } });
    const html = wipeDialog(s, view({ state: s, data: { usage: USAGE } }));
    expect(disabled(html, 'id="wipeGo"')).toBe(false);
    expect(html).toMatchSnapshot();
  });
});
