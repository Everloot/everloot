import { expect, test } from "vitest";
import { diagnostics, hideHome, reportDiagnostics } from "../src/shared/diagnostics";
import type { AppState } from "../src/shared/types";

const state: AppState = {
  version: "0.1.0", platform: "win32", dataFolder: "C:\\Users\\carlos\\AppData\\Roaming\\Everloot", notice: null, foreverFolder: null,
  settings: {
    gameFolder: "D:\\Games\\World of Warcraft\\_classic_era_", keptGameFolder: null, endpoint: "https://everloot.app", upload: true, census: true, players: false, prices: true,
    ask: { enabled: true, mcpUrl: "https://everloot.app/mcp", tokenFile: "C:\\Users\\carlos\\secret\\token.txt" },
    market: { realms: ["Nightslayer"] }, consentedAt: "2026-10-18T00:00:00Z", launchAtLogin: false, startInTray: true,
  },
  engine: {
    files: ["D:\\Games\\World of Warcraft\\_classic_era_\\WTF\\Account\\ACC\\SavedVariables\\Everloot.lua"],
    jobs: { upload: { state: "ok", message: "sent 3 new events", at: "2026-10-18T10:00:00Z" }, prices: { state: "idle", message: "", at: null }, ask: { state: "error", message: "token file missing", at: "2026-10-18T10:01:00Z" } },
    log: Array.from({ length: 120 }, (_, i) => ({ at: `2026-10-18T09:${String(i % 60).padStart(2, "0")}:00Z`, level: i === 119 ? "error" as const : "info" as const, text: `line ${i}` })),
    paused: false,
  },
  update: { current: "0.1.0", latest: "0.2.0", url: "https://github.com/Everloot/everloot/releases/tag/desktop-v0.2.0", newer: true, notes: [], downloadUrl: null, publishedAt: null, sumsUrl: null, installable: false }, updateProgress: { stage: "idle", percent: 0, error: null }, staleScans: [], account: { signedIn: true, hint: "9f3c" },
  builds: { state: "forbidden", message: "This key can't read your saved builds.", syncedAt: null, builds: null },
};

test("the report has version, settings without the token, jobs and the last hundred log lines, with home folders hidden", () => {
  const text = diagnostics(state, 100, new Date("2026-10-18T12:00:00Z"));
  expect(text).toContain("Everloot Desktop App 0.1.0 on win32, 2026-10-18T12:00:00.000Z");
  expect(text).toContain("data folder: ~\\AppData\\Roaming\\Everloot");
  expect(text).toContain("token file ~\\secret\\token.txt");
  expect(text).not.toContain("carlos");
  expect(text).toContain("upload: ok, sent 3 new events (2026-10-18T10:00:00Z)");
  expect(text).toContain("upload: true, census: true, prices: true, ask: true");
  expect(text).toContain("ask: error, token file missing");
  expect(text).toContain("update: 0.2.0 (newer)");
  expect(text).toContain("account: signed in with an everloot.app key");
  expect(text).not.toContain("9f3c");
  expect(text).toContain("saved builds: forbidden, This key can't read your saved builds.");
  expect(text).toContain("log (last 100 of 120):");
  expect(text).not.toContain("line 19\n");
  expect(text).toContain("line 20\n");
  expect(text.trimEnd().endsWith("ERROR line 119")).toBe(true);
});

test("home folders on every platform collapse to a tilde", () => {
  expect(hideHome("/Users/ana/Library/Application Support/Everloot")).toBe("~/Library/Application Support/Everloot");
  expect(hideHome("/home/ana/.config/everloot and C:\\Users\\Ana B\\x")).toBe("~/.config/everloot and ~\\x");
  expect(hideHome("D:\\Games\\WoW")).toBe("D:\\Games\\WoW");
});

test("diagnostics hide account directories and account labels in job logs", () => {
  const text = diagnostics({ ...state, engine: { ...state.engine,
    files: [...state.engine.files, "/games/WTF/Account/OTHER/SavedVariables/Everloot.lua"],
    log: [{ at: "now", level: "error", text: "upload ACC: failed reading D:\\Games\\WTF\\Account\\ACC\\SavedVariables\\Everloot.lua" },
      { at: "now", level: "info", text: "ask OTHER: answered" }],
  } });
  expect(text).not.toContain("ACC");
  expect(text).not.toContain("OTHER");
  expect(text).toContain("upload <account>: failed");
  expect(text).toContain("ask <account>: answered");
});

test("a bounded bug report keeps its version header and latest failure with account names hidden", () => {
  const text = reportDiagnostics("Everloot Desktop App 0.1.7\n" + "old log line\n".repeat(500) + "upload ACC: latest failure in WTF/Account/ACC/SavedVariables/Everloot.lua");
  expect(text.length).toBeLessThanOrEqual(4000);
  expect(text.startsWith("Everloot Desktop App 0.1.7")).toBe(true);
  expect(text).toContain("latest failure");
  expect(text).not.toContain("ACC");
});
