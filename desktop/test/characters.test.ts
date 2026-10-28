import { expect, test } from "vitest";
import { summarizeCharacters } from "../src/main/characters";

const SV = `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "x", ["records"] = {
  ["gold_snapshot"] = { { ["character"] = "Arthas", ["realm"] = "Nightslayer", ["capturedAt"] = "2026-10-17T10:00:00Z", ["currentCopper"] = 1500000, ["peakCopper"] = 2000000 }, { ["character"] = "Arthas", ["realm"] = "Nightslayer", ["capturedAt"] = "2026-10-18T10:00:00Z", ["currentCopper"] = 1700000, ["peakCopper"] = 2000000 } },
  ["gear_snapshot"] = { { ["character"] = "Arthas", ["realm"] = "Nightslayer", ["capturedAt"] = "2026-10-16T10:00:00Z", ["equipped"] = { { ["slot"] = "HeadSlot", ["itemId"] = 1, ["itemLevel"] = 60 }, { ["slot"] = "ChestSlot", ["itemId"] = 2, ["itemLevel"] = 70 } } }, { ["character"] = "Arthas", ["realm"] = "Nightslayer", ["capturedAt"] = "2026-10-18T11:00:00Z", ["equipped"] = { { ["slot"] = "HeadSlot", ["itemId"] = 1, ["itemLevel"] = 70 }, { ["slot"] = "ChestSlot", ["itemId"] = 2, ["itemLevel"] = 80 }, { ["slot"] = "LegsSlot", ["itemId"] = 3, ["itemLevel"] = 60 } } } },
  ["money_event"] = { { ["character"] = "Arthas", ["realm"] = "Nightslayer", ["capturedAt"] = "2026-10-18T09:00:00Z", ["category"] = "vendor", ["copper"] = 500 }, { ["character"] = "Arthas", ["realm"] = "Nightslayer", ["capturedAt"] = "2026-10-18T09:30:00Z", ["category"] = "loot", ["copper"] = 900 }, { ["character"] = "Arthas", ["realm"] = "Nightslayer", ["capturedAt"] = "2026-09-01T09:00:00Z", ["category"] = "loot", ["copper"] = 100 } },
  ["achievement_owned"] = { { ["characterKey"] = "0a1b2c3d", ["class"] = "PALADIN", ["level"] = 58, ["achievementId"] = 10, ["completed"] = true, ["criteriaMet"] = 1, ["criteriaTotal"] = 1 }, { ["characterKey"] = "0a1b2c3d", ["class"] = "PALADIN", ["level"] = 60, ["achievementId"] = 11, ["completed"] = false, ["criteriaMet"] = 0, ["criteriaTotal"] = 3 } },
  ["reputation_owned"] = { { ["characterKey"] = "0a1b2c3d", ["class"] = "PALADIN", ["level"] = 60, ["factionId"] = 1, ["reaction"] = 8, ["standing"] = 1, ["floor"] = 0, ["ceiling"] = 1 }, { ["characterKey"] = "0a1b2c3d", ["class"] = "PALADIN", ["level"] = 60, ["factionId"] = 2, ["reaction"] = 5, ["standing"] = 1, ["floor"] = 0, ["ceiling"] = 1 } },
  ["title_owned"] = { { ["characterKey"] = "0a1b2c3d", ["class"] = "PALADIN", ["level"] = 60, ["titleIds"] = { 1, 2 } }, { ["characterKey"] = "0a1b2c3d", ["class"] = "PALADIN", ["level"] = 60, ["titleIds"] = { 2, 3 } } },
  ["quest_owned"] = { { ["characterKey"] = "ffffffff", ["class"] = "MAGE", ["level"] = 12, ["questIds"] = { 100, 101 } } },
  ["talent_snapshot"] = { { ["class"] = "PALADIN", ["level"] = 60, ["group"] = 1, ["active"] = true, ["configId"] = 0, ["treeId"] = 1, ["exportStatus"] = "ok", ["points"] = 51, ["nodes"] = {} } },
} }`;

test("named characters get the latest gold, the peak, the latest gear snapshot and money by category", () => {
  const info = summarizeCharacters(SV);
  expect(info.characters).toHaveLength(1);
  expect(info.characters[0]).toMatchObject({ character: "Arthas", realm: "Nightslayer", gold: 1700000, peakGold: 2000000, gearSlots: 3, itemLevel: 70, spent: {}, earned: { loot: 1000, vendor: 500 } });
  expect(info.characters[0].equipped).toEqual([
    { slot: "HeadSlot", itemLevel: 70 },
    { slot: "ChestSlot", itemLevel: 80 },
    { slot: "LegsSlot", itemLevel: 60 },
  ]);
});

test("progress rows are per opaque character key: unions for titles and quests, latest state for achievements and reputations", () => {
  const info = summarizeCharacters(SV);
  expect(info.progress.map((p) => p.key)).toEqual(["0a1b2c3d", "ffffffff"]);
  expect(info.progress[0]).toMatchObject({ class: "PALADIN", level: 60, achievements: 1, achievementsInProgress: 1, reputations: 2, exalted: 1, titles: 3, quests: 0 });
  expect(info.progress[1]).toMatchObject({ class: "MAGE", level: 12, quests: 2 });
  expect(info.talents).toEqual([{ class: "PALADIN", level: 60, points: 51 }]);
});

test("gold history is the dated snapshots in order, and the week counts only money events from the last seven days", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const [c] = summarizeCharacters(SV, now).characters;
  expect(c.history).toEqual([{ at: "2026-10-17T10:00:00Z", copper: 1500000 }, { at: "2026-10-18T10:00:00Z", copper: 1700000 }]);
  expect(c.week).toEqual({ earned: 1400, spent: 0 });
});

test("thirty UTC days of money are zero-filled, oldest first, and the latest events are kept as receipts", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const [c] = summarizeCharacters(SV, now).characters;
  expect(c.days).toHaveLength(30);
  expect(c.days[0]).toEqual({ date: "2026-09-19", earned: 0, spent: 0 });
  expect(c.days[c.days.length - 1]).toEqual({ date: "2026-10-18", earned: 1400, spent: 0 });
  expect(c.receipts).toEqual([
    { at: "2026-10-18T09:30:00Z", category: "loot", copper: 900, direction: "in" },
    { at: "2026-10-18T09:00:00Z", category: "vendor", copper: 500, direction: "in" },
  ]);
});

test("receipts stop at the twelve newest events in the last thirty days", () => {
  const rows = Array.from({ length: 15 }, (_, i) => `{ ["character"] = "A", ["realm"] = "R", ["capturedAt"] = "2026-10-17T${String(i).padStart(2, "0")}:00:00Z", ["category"] = "loot", ["copper"] = ${i + 1} }`).join(", ");
  const [c] = summarizeCharacters(`EverlootDB = { ["version"] = "0.3.3", ["installId"] = "x", ["records"] = { ["money_event"] = { ${rows} } } }`, Date.parse("2026-10-18T12:00:00Z")).characters;
  expect(c.receipts).toHaveLength(12);
  expect(c.receipts[0]).toMatchObject({ at: "2026-10-17T14:00:00Z", copper: 15 });
  expect(c.receipts[11]).toMatchObject({ at: "2026-10-17T03:00:00Z", copper: 4 });
});

test("a long gold history is thinned to at most sixty points, keeping the first and the last", () => {
  const rows = Array.from({ length: 500 }, (_, i) => `{ ["character"] = "A", ["realm"] = "R", ["capturedAt"] = "2026-10-${String(1 + Math.floor(i / 20)).padStart(2, "0")}T${String(i % 20).padStart(2, "0")}:00:00Z", ["currentCopper"] = ${i}, ["peakCopper"] = ${i} }`).join(", ");
  const [c] = summarizeCharacters(`EverlootDB = { ["version"] = "0.3.3", ["installId"] = "x", ["records"] = { ["gold_snapshot"] = { ${rows} } } }`).characters;
  expect(c.history.length).toBeLessThanOrEqual(60);
  expect(c.history[0].copper).toBe(0);
  expect(c.history[c.history.length - 1].copper).toBe(499);
});

test("a file with no character data gives empty lists, not an error", () => {
  expect(summarizeCharacters(`EverlootDB = { ["version"] = "0.3.3", ["installId"] = "x", ["records"] = {} }`)).toEqual({ characters: [], progress: [], talents: [] });
});
