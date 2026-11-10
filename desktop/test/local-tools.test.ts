import { expect, test } from "vitest";
import { LOCAL_SOURCE, STATUS_SOURCE, gold, localTools, type AppStatus } from "../src/main/local-tools";
import type { CharactersInfo } from "../src/shared/types";

const NOW = Date.parse("2026-10-19T08:00:00Z");

const info: CharactersInfo = {
  characters: [{
    id: "key:00000001", character: "Volvik", realm: "Nightslayer", gold: 1234_56_78, peakGold: 2000_00_00, gearSlots: 15, itemLevel: 61,
    spent: { repairs: 50_00_00, auction: 100_00_00 }, earned: { loot: 300_00_00 },
    history: [], week: { earned: 20_00_00, spent: 35_00_00 }, equipped: [], days: [], receipts: [],
  }],
  progress: [{ key: "Volvik-Nightslayer", class: "Warrior", level: 60, achievements: 12, achievementsInProgress: 3, reputations: 20, exalted: 2, titles: 1, quests: 40, talentPoints: 51,
    professions: [{ name: "Blacksmithing", rank: 300, maxRank: 300 }], lockouts: [{ instance: "Molten Core", difficulty: "40 Player", killed: 6, total: 10, resetAt: "2026-10-20T12:00:00Z" }] }],
  talents: [],
};

const ok = { state: "ok" as const, message: "3 records sent", at: "2026-10-19T07:00:00Z" };
const status: AppStatus = {
  version: "0.1.0", gameFolder: "C:\\Users\\carlos\\Games\\_classic_era_", files: 1, paused: false,
  switches: { upload: true, prices: true, ask: false },
  jobs: { upload: ok, prices: { state: "error", message: "HTTP 503 from everloot.app", at: "2026-10-19T07:01:00Z" }, ask: { state: "off", message: "", at: null } },
  addonInstalled: "0.3.3", update: { current: "0.1.0", latest: "0.2.0", url: "https://example.test/r", newer: true, notes: [], downloadUrl: null, publishedAt: null, sumsUrl: null, installable: false },
  errors: [{ at: "2026-10-19T07:01:00Z", level: "error", text: "prices: HTTP 503 from everloot.app writing C:\\Users\\carlos\\x" }],
};

const tools = (data: Partial<Parameters<typeof localTools>[0]> = {}) =>
  localTools({ characters: () => info, scans: () => [], followed: () => [], status: () => status, ...data }, () => NOW);

const run = async (name: string, data?: Partial<Parameters<typeof localTools>[0]>) => tools(data).find((t) => t.name === name)!.run({});

test("gold reads as gold, silver and copper", () => {
  expect(gold(1234_56_78)).toBe("1,234g 56s");
  expect(gold(56_78)).toBe("56s 78c");
  expect(gold(78)).toBe("78c");
  expect(gold(null)).toBe("unknown");
});

test("my_characters lists gold, the week, gear and progress with the local source", async () => {
  const out = await run("my_characters");
  expect(out).toContain("Volvik-Nightslayer: 1,234g 56s; peak 2,000g 0s; last 7 days earned 20g 0s, spent 35g 0s, net -15g 0s; item level 61 over 15 slots; spent by category all time: repairs 50g 0s, auction 100g 0s");
  expect(out).toContain("Volvik-Nightslayer: level 60 Warrior, 12 achievements (3 in progress), 2 of 20 reputations exalted, 1 titles");
  // Professions and raid lockouts never leave the computer, so the model provider never gets them either.
  for (const text of ["Blacksmithing", "Molten Core", "lockout", "profession"]) expect(out).not.toContain(text);
  expect(out.trim().split("\n").at(-1)).toBe(`Source: ${LOCAL_SOURCE}`);
});

test("with no characters the tool says so instead of an empty result", async () => {
  const out = await run("my_characters", { characters: () => ({ characters: [], progress: [], talents: [] }) });
  expect(out).toMatch(/No characters in the account files yet/);
  expect(out).toContain(`Source: ${LOCAL_SOURCE}`);
});

test("my_realm_scans gives each realm's last scan as a date and an age, plus the followed realms", async () => {
  const out = await run("my_realm_scans", {
    scans: () => [{ realm: "Nightslayer", at: "2026-10-19T05:30:00Z" }, { realm: "Doomhowl", at: "2026-10-15T08:00:00Z" }, { realm: "Dreamscythe", at: null }],
    followed: () => ["Doomhowl", "Maladath"],
  });
  expect(out.split("\n")).toEqual([
    "Nightslayer: last full scan 2026-10-19T05:30:00Z (3 h ago)",
    "Doomhowl: last full scan 2026-10-15T08:00:00Z (4 d ago)",
    "Dreamscythe: last full scan never",
    "Realms followed for the prices file: Doomhowl, Maladath",
    `Source: ${LOCAL_SOURCE}`,
  ]);
  expect(await run("my_realm_scans")).toMatch(/No auction scans in the account files yet/);
});

test("my_app_status says what runs, what failed and why, the addon and app versions, with the app's own source", async () => {
  expect((await run("my_app_status")).split("\n")).toEqual([
    "Everloot Desktop App 0.1.0",
    "Game folder: ~\\Games\\_classic_era_, watching 1 account file",
    "Upload: ok at 2026-10-19T07:00:00Z, 3 records sent",
    "Prices: FAILED at 2026-10-19T07:01:00Z: HTTP 503 from everloot.app",
    "/ask answers: turned off in Settings",
    "Addon installed: 0.3.3",
    "A newer app release exists: 0.2.0 (current 0.1.0); the Overview links to it",
    "Latest errors in the log:",
    "  2026-10-19T07:01:00Z prices: HTTP 503 from everloot.app writing ~\\x",
    `Source: ${STATUS_SOURCE}`,
  ]);
  const bare = await run("my_app_status", { status: () => ({ ...status, gameFolder: null, files: 0, paused: true, addonInstalled: null, update: null, errors: [] }) });
  expect(bare).toContain("Everloot Desktop App 0.1.0, paused from the tray");
  expect(bare).toContain("Game folder: not set");
  expect(bare).toContain("Addon: not installed");
  expect(bare).toContain("App release check: not run yet or GitHub unreachable");
  expect(bare).toContain("No errors in the log.");
});

test("the tools take no arguments and their names carry the my_ prefix the system prompt names", () => {
  for (const t of tools()) {
    expect(t.name).toMatch(/^my_/);
    expect(t.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
  }
});
