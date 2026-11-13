import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { LEDGER_INCOME as DESKTOP_INCOME, LEDGER_LABELS as DESKTOP_LABELS, LEDGER_SPENDING as DESKTOP_SPENDING } from "../../../desktop/src/shared/ledger";
import { summarizeCharacters } from "../../../desktop/src/main/characters";
import { LEDGER_INCOME, LEDGER_LABELS, LEDGER_SPENDING, categoryLabel, characterKey, narrowLedger, rosterLabel, summarizeMoney } from "./money-ledger";
import { parseEverlootLua, parseEverlootTable } from "./sv-parse";

// The same events the addon's ledger_contract.py feeds through E.Ledger: both sides must reach these totals.
type Fixture = {
  now: string;
  events: { at: string; character: string; realm: string; category: string; copper: number }[];
  expected: { categories: { category: string; direction: string; copper: number; events: number }[]; week: { in: number; out: number; net: number } };
};
const fixture: Fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../addon/tests/fixtures/ledger-parity.json"), "utf8"));

test("the web ledger gives the totals the addon's ledger is held to", () => {
  const records = fixture.events.map((e) => ({
    kind: "money_event", installId: "i", character: e.character, realm: e.realm, category: e.category, copper: e.copper, capturedAt: e.at,
  }));
  const ledger = summarizeMoney(records, Date.parse(fixture.now));
  expect(ledger.categories).toEqual(fixture.expected.categories);
  expect(ledger.week).toEqual(fixture.expected.week);
});

test("the categories, their direction and names are the Desktop App's (and so the addon's)", () => {
  expect(LEDGER_INCOME).toEqual(DESKTOP_INCOME);
  expect(LEDGER_SPENDING).toEqual(DESKTOP_SPENDING);
  expect(LEDGER_LABELS).toEqual(DESKTOP_LABELS);
});

// A save file the way addon 0.3.22+ writes it: uploaded records, and beside them the window's ledger and roster.
const NOW = Date.parse("2026-11-12T12:00:00Z");
const s = (iso: string) => Date.parse(iso) / 1000;
const LUA = `EverlootDB = {
  ["version"] = "0.3.23",
  ["installId"] = "own-install",
  ["records"] = {
    ["gold_snapshot"] = {
      { ["installId"] = "own-install", ["capturedAt"] = "2026-11-01T10:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["currentCopper"] = 40000, ["peakCopper"] = 40000 },
      { ["installId"] = "other-install", ["capturedAt"] = "2026-11-10T10:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["currentCopper"] = 999, ["peakCopper"] = 999 },
    },
    ["money_event"] = {
      { ["installId"] = "own-install", ["capturedAt"] = "2026-11-02T09:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["category"] = "quest", ["copper"] = 700 },
      { ["installId"] = "own-install", ["capturedAt"] = "2026-11-08T09:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["category"] = "quest", ["copper"] = 1500 },
      { ["installId"] = "other-install", ["capturedAt"] = "2026-11-09T09:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["category"] = "loot", ["copper"] = 33 },
    },
  },
  ["roster"] = {
    ["k-thrall"] = { ["name"] = "Thrall", ["realm"] = "Moon Guard", ["copper"] = 52000, ["peakCopper"] = 60000, ["lastSeen"] = ${s("2026-11-11T20:00:00Z")} },
    ["k-jaina"] = { ["name"] = "Jaina", ["realm"] = "Moon Guard", ["copper"] = 9000, ["lastSeen"] = ${s("2026-11-11T21:00:00Z")} },
  },
  ["ledger"] = {
    ["events"] = {
      { ["at"] = ${s("2026-11-08T09:00:00Z")}, ["key"] = "k-thrall", ["category"] = "quest", ["copper"] = 1500 },
      { ["at"] = ${s("2026-11-09T10:00:00Z")}, ["key"] = "k-thrall", ["category"] = "repair", ["copper"] = 820 },
      { ["at"] = ${s("2026-11-09T11:00:00Z")}, ["key"] = "k-thrall", ["category"] = "vendor_spend", ["copper"] = 300, ["itemName"] = "Refreshing Spring Water", ["count"] = 20 },
      { ["at"] = ${s("2026-11-10T12:00:00Z")}, ["key"] = "k-thrall", ["category"] = "mail_out", ["copper"] = 5000, ["ownAlt"] = true },
      { ["at"] = ${s("2026-11-10T12:05:00Z")}, ["key"] = "k-jaina", ["category"] = "mail_in", ["copper"] = 5000, ["ownAlt"] = true },
      { ["at"] = ${s("2026-11-11T08:00:00Z")}, ["key"] = "k-jaina", ["category"] = "trade_in", ["copper"] = 2500 },
      { ["at"] = ${s("2026-11-11T08:30:00Z")}, ["key"] = "k-gone", ["category"] = "loot", ["copper"] = 77 },
      { ["at"] = ${s("2026-11-11T09:00:00Z")}, ["key"] = "k-jaina", ["category"] = "made_up", ["copper"] = 66 },
    },
    ["sales"] = {},
    ["daily"] = {
      ["k-thrall"] = { ["2026-11-09"] = 50000, ["2026-11-10"] = 45000 },
    },
  },
}`;

function read(text = LUA) {
  const parsed = parseEverlootLua(text);
  const { ledger, roster } = parseEverlootTable(text);
  return summarizeMoney(parsed.records, NOW, { installId: parsed.installId, ledger, roster });
}

describe("a file with the window's local ledger", () => {
  test("repairs, vendor purchases, trades and mail come from the ledger, under the roster's names", () => {
    const ledger = read();
    const thrall = narrowLedger(ledger, "1:Thrall-Moon Guard");
    expect(thrall.categories.map((c) => [c.category, c.direction, c.copper])).toEqual([
      ["mail_out", "out", 5000], ["quest", "in", 2200], ["repair", "out", 820], ["vendor_spend", "out", 300],
    ]);
    const jaina = narrowLedger(ledger, "1:Jaina-Moon Guard");
    expect(jaina.categories.map((c) => [c.category, c.copper])).toEqual([["mail_in", 5000], ["trade_in", 2500]]);
    // A key the roster cannot name, and a category the addon does not write, are left out.
    expect(JSON.stringify(ledger)).not.toContain("made_up");
    expect(ledger.receipts.some((r) => r.copper === 77)).toBe(false);
  });

  test("a money_event the ledger already holds is not counted twice; one from before the ledger still counts", () => {
    const thrall = narrowLedger(read(), "1:Thrall-Moon Guard");
    expect(thrall.receipts.filter((r) => r.category === "quest").map((r) => [r.at, r.copper])).toEqual([
      ["2026-11-08T09:00:00Z", 1500], ["2026-11-02T09:00:00Z", 700],
    ]);
  });

  test("gold moved between the player's own characters leaves the combined totals but stays a receipt", () => {
    const ledger = read();
    expect(ledger.moved).toBe(5000);
    expect(ledger.categories.map((c) => c.category)).not.toContain("mail_out");
    expect(ledger.categories.map((c) => c.category)).not.toContain("mail_in");
    // In: Jaina's trade, Thrall's quest and the other install's loot.
    expect(ledger.week).toEqual({ in: 2500 + 1500 + 33, out: 820 + 300, net: 2500 + 1500 + 33 - 1120 });
    expect(ledger.river.reduce((n, d) => n + d.out, 0)).toBe(1120);
    expect(ledger.receipts.filter((r) => r.ownAlt).map((r) => r.category).sort()).toEqual(["mail_in", "mail_out"]);
    // One character alone keeps its own transfer in its totals.
    expect(narrowLedger(ledger, "1:Thrall-Moon Guard").week.out).toBe(820 + 300 + 5000);
  });

  test("the roster's gold is current when it is newer than the last snapshot, and daily closes join the history", () => {
    const ledger = read();
    const thrall = ledger.roster.find((r) => characterKey(r) === "1:Thrall-Moon Guard")!;
    expect(thrall).toMatchObject({ copper: 52000, peakCopper: 60000, at: "2026-11-11T20:00:00Z" });
    // Jaina has no snapshot at all: the roster alone names her and her gold.
    expect(ledger.roster.find((r) => r.character === "Jaina")).toMatchObject({ install: 1, copper: 9000 });
    const history = ledger.history.find((h) => characterKey(h) === "1:Thrall-Moon Guard")!;
    expect(history.points).toEqual([
      { at: "2026-11-01T10:00:00Z", copper: 40000 }, { at: "2026-11-09T12:00:00Z", copper: 50000 }, { at: "2026-11-10T12:00:00Z", copper: 45000 },
    ]);
  });

  test("two roster characters with one name and realm (deleted and made again) stay two characters", () => {
    const twins = LUA.replace(`["k-jaina"] = {`, `["k-thrall-old"] = { ["name"] = "Thrall", ["realm"] = "Moon Guard", ["copper"] = 10, ["lastSeen"] = ${s("2026-10-01T00:00:00Z")} },
    ["k-jaina"] = {`).replace(`["events"] = {`, `["events"] = {
      { ["at"] = ${s("2026-10-05T09:00:00Z")}, ["key"] = "k-thrall-old", ["category"] = "repair", ["copper"] = 111 },`);
    const ledger = read(twins);
    const own = ledger.roster.filter((r) => r.install === 1 && r.character === "Thrall");
    // The one seen longest ago is character 1; the uploaded records, which carry only the name, join neither.
    expect(own.map((r) => [r.twin ?? null, r.copper])).toEqual(expect.arrayContaining([[1, 10], [2, 52000], [null, 40000]]));
    expect(narrowLedger(ledger, "1:Thrall-Moon Guard#1").receipts.map((r) => r.copper)).toEqual([111]);
    expect(narrowLedger(ledger, "1:Thrall-Moon Guard#2").receipts.map((r) => r.category)).toEqual(["mail_out", "vendor_spend", "repair", "quest"]);
    // This file also holds a Thrall from another install, so the label names both.
    expect(rosterLabel(own.find((r) => r.twin === 2)!, ledger.roster)).toBe("Thrall (Moon Guard, install 1, character 2)");
    expect(rosterLabel(own.find((r) => r.twin === 2)!, own.filter((r) => r.twin))).toBe("Thrall (Moon Guard, character 2)");
  });

  test("times a date cannot hold, days that do not exist and today's moving close do not break the file", () => {
    const today = new Date(NOW).toISOString().slice(0, 10);
    const odd = LUA
      .replace(`["lastSeen"] = ${s("2026-11-11T21:00:00Z")}`, `["lastSeen"] = 9007199254740991`)
      .replace(`["events"] = {`, `["events"] = {
      { ["at"] = 9007199254740991, ["key"] = "k-thrall", ["category"] = "repair", ["copper"] = 999 },`)
      .replace(`["2026-11-10"] = 45000`, `["2026-11-10"] = 45000, ["2026-99-99"] = 7, ["2026-02-30"] = 8, ["${today}"] = 46000`);
    const ledger = read(odd);
    expect(ledger.receipts.some((r) => r.copper === 999)).toBe(false);
    expect(ledger.roster.find((r) => r.character === "Jaina")).toMatchObject({ copper: 9000, at: null });
    const points = ledger.history.find((h) => characterKey(h) === "1:Thrall-Moon Guard")!.points;
    expect(points.map((p) => p.copper)).not.toContain(7);
    expect(points.map((p) => p.copper)).not.toContain(8);
    // Today's close is the gold as of now, not an observation from later today.
    expect(points.at(-1)).toEqual({ at: new Date(NOW).toISOString().replace(/\.\d{3}Z$/, "Z"), copper: 46000 });
  });

  test("a category named like an object property is shown as text", () => {
    const records = ["__proto__", "constructor", "toString"].map((category) => ({ kind: "money_event", installId: "i", character: "A", realm: "B", category, copper: 5, capturedAt: "2026-11-10T00:00:00Z" }));
    const ledger = summarizeMoney(records, NOW);
    expect(ledger.categories.map((c) => categoryLabel(c.category)).sort()).toEqual(["  proto  ", "constructor", "toString"]);
    expect(ledger.categories.every((c) => typeof categoryLabel(c.category) === "string")).toBe(true);
  });

  test("the same name and realm from another install stays its own character", () => {
    const ledger = read();
    const other = ledger.roster.find((r) => r.install === 2)!;
    expect(other).toMatchObject({ character: "Thrall", realm: "Moon Guard", copper: 999 });
    // Its money is not in this install's ledger, so it counts though it is dated after the ledger began.
    expect(narrowLedger(ledger, characterKey(other)).receipts.map((r) => [r.category, r.copper])).toEqual([["loot", 33]]);
    expect(narrowLedger(ledger, "1:Thrall-Moon Guard").receipts.some((r) => r.copper === 33)).toBe(false);
    expect(JSON.stringify(ledger)).not.toContain("own-install");
    expect(JSON.stringify(ledger)).not.toContain("other-install");
  });

  test("a file from before the ledger reads the way it always did", () => {
    const old = LUA.replace(/\["roster"\][\s\S]*$/, "}");
    const ledger = read(old);
    expect(ledger.roster.map((r) => [r.install, r.character, r.copper])).toEqual([[1, "Thrall", 40000], [2, "Thrall", 999]]);
    expect(ledger.categories.map((c) => [c.category, c.copper])).toEqual([["quest", 2200], ["loot", 33]]);
    expect(ledger.moved).toBe(0);
  });

  test("each character's spending and income match the Desktop App reading the same file", () => {
    const ledger = read();
    const desktop = summarizeCharacters(LUA, NOW).characters;
    for (const name of ["Thrall", "Jaina"]) {
      const row = desktop.find((c) => c.character === name && c.id.startsWith("key:"))!;
      const web = narrowLedger(ledger, `1:${name}-Moon Guard`).categories;
      const byDirection = (d: "in" | "out") => Object.fromEntries(web.filter((c) => c.direction === d).map((c) => [c.category, c.copper]));
      // The Desktop App keeps a category the addon never writes (L.Record refuses it); the web leaves it out.
      const { made_up: _ignored, ...earned } = row.earned;
      expect(byDirection("out")).toEqual(row.spent);
      expect(byDirection("in")).toEqual(earned);
    }
  });
});
