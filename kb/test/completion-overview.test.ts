import { expect, test } from "vitest";
import {
  completionProgress, doneOf, missingOf, overviewOf, rowsOf,
  type AchievementEntry, type ChainEntry, type CompletionFacts, type FactionEntry, type OwnedCharacter, type TitleEntry,
} from "../src/completion.js";

// A small agreed catalog: two achievement categories, two reputation headers plus a faction without one and a major
// one, two titles and two chains. One character is part way through most of it.
const achievement = (achievementId: number, name: string, category: string, points: number, criteriaCount = 1): [number, AchievementEntry] =>
  [achievementId, { achievementId, name, category, points, criteriaCount }];
const faction = (factionId: number, name: string, header?: string, major = false): [number, FactionEntry] =>
  [factionId, { factionId, name, ...(header ? { header } : {}), major }];
const title = (titleId: number, name: string): [number, TitleEntry] => [titleId, { titleId, name }];
const chain = (questLineId: number, name: string, questIds: number[], truncated = false): [number, ChainEntry] =>
  [questLineId, { questLineId, name, questIds, truncated }];

const facts: CompletionFacts = {
  achievements: new Map([
    achievement(1, "Ten Quests", "Quests", 5, 10),
    achievement(2, "Explore Kalimdor", "Exploration", 10, 4),
    achievement(3, "Explore Eastern Kingdoms", "Exploration", 10, 4),
    achievement(4, "Fifty Quests", "Quests", 10, 50),
  ]),
  factions: new Map([
    faction(72, "Stormwind", "Alliance"),
    faction(69, "Darnassus", "Alliance"),
    faction(76, "Orgrimmar", "Horde"),
    faction(59, "Thorium Brotherhood"),
    faction(2000, "Renown Guild", undefined, true),
  ]),
  titles: new Map([title(4, "Private"), title(5, "Corporal")]),
  chains: new Map([chain(900, "The Defias", [7, 8, 9, 10]), chain(901, "Cut short", [20, 2], true), chain(902, "Done chain", [20, 21])]),
  owned: [],
};

const character: OwnedCharacter = {
  installId: "owner-install", characterKey: "0a1b2c3d", class: "MAGE", level: 40,
  achievements: new Map([
    [1, { completed: false, criteriaMet: 8, criteriaTotal: 10 }],
    [2, { completed: true, earnedByMe: true, criteriaMet: 4, criteriaTotal: 4, earnedOn: "2026-10-12" }],
    [3, { completed: true, earnedByMe: false, criteriaMet: 4, criteriaTotal: 4 }],
    [4, { completed: false, criteriaMet: 0, criteriaTotal: 1, quantity: 30, required: 50 }],
  ]),
  factions: new Map([
    [72, { reaction: 8, standing: 42999, floor: 42000, ceiling: 43000 }],
    [69, { reaction: 5, standing: 8500, floor: 3000, ceiling: 9000 }],
    [59, { reaction: 12, standing: 300, floor: 0, ceiling: 0 }],
    [2000, { reaction: 8, standing: 1, floor: 0, ceiling: 1 }],
  ]),
  titles: new Set([4]),
  quests: new Set([7, 8, 9, 20, 21]),
};

test("the overview has one bar per achievement category, reputation with its headers, titles and quest chains", () => {
  const o = overviewOf(facts, character);
  expect(o.categories.map((c) => [c.id, c.label, c.done, c.total])).toEqual([
    ["achievements-exploration", "Exploration", 1, 2],
    ["achievements-quests", "Quests", 0, 2],
    ["reputation", "Reputation", 1, 4],
    ["reputation-alliance", "Alliance", 1, 2],
    ["reputation-horde", "Horde", 0, 1],
    ["titles", "Titles", 1, 2],
    ["quests", "Quest chains", 1, 3],
  ]);
  expect(o.categories[0].points).toEqual({ have: 10, of: 20 });
  expect(o.categories[1].points).toEqual({ have: 0, of: 15 });
  expect(o.categories[2].points).toBeUndefined();
  expect(o.categories[3].group).toBe("Alliance");
  expect(o.categories[1].group).toBe("Quests");
});

test("the total adds each kind once: headers are a breakdown of reputation, not more reputation", () => {
  const o = overviewOf(facts, character);
  // Achievements 1 of 4, reputation 1 of 4 (the major faction is left out), titles 1 of 2, chains 1 of 3.
  expect(o.total).toEqual({ done: 4, total: 13 });
});

test("with no character the totals are the catalog's and every done is zero", () => {
  for (const o of [overviewOf(facts), overviewOf(facts, null)]) {
    expect(o.total).toEqual({ done: 0, total: 13 });
    expect(o.categories.every((c) => c.done === 0)).toBe(true);
    expect(o.categories.map((c) => c.total)).toEqual([2, 2, 4, 2, 1, 2, 3]);
    expect(o.categories[0].points).toEqual({ have: 0, of: 20 });
  }
});

test("an empty catalog is an empty overview, not a crash", () => {
  const o = overviewOf({ achievements: new Map(), factions: new Map(), titles: new Map(), chains: new Map(), owned: [] }, character);
  expect(o.total).toEqual({ done: 0, total: 0 });
  expect(o.categories.map((c) => c.id)).toEqual(["reputation", "titles", "quests"]);
});

test("missing achievements are by name with the partial state; an account-wide one earned elsewhere is missing here", () => {
  const missing = missingOf(facts, character, "achievements");
  expect(missing.map((r) => r.entry.name)).toEqual(["Explore Eastern Kingdoms", "Fifty Quests", "Ten Quests"]);
  expect(missing[0].progress).toBeUndefined();
  expect(missing[1].progress).toEqual({ have: 30, of: 50, unit: "progress" });
  expect(missing[2].progress).toEqual({ have: 8, of: 10, unit: "criteria" });
});

test("done achievements carry earnedOn when the upload did", () => {
  const done = doneOf(facts, character, "achievements");
  expect(done).toHaveLength(1);
  expect(done[0].entry.name).toBe("Explore Kalimdor");
  expect(done[0].earnedOn).toBe("2026-10-12");
});

test("reputation rows carry the standing and what the next one needs; an unscaled row keeps its raw value", () => {
  const missing = missingOf(facts, character, "reputation");
  expect(missing.map((r) => r.entry.name)).toEqual(["Darnassus", "Orgrimmar", "Thorium Brotherhood"]);
  expect(missing[0]).toMatchObject({ standing: "Friendly", toNext: 500 });
  expect(missing[1].standing).toBeUndefined();
  expect(missing[2]).toMatchObject({ value: 300 });
  expect(missing[2].standing).toBeUndefined();
  const done = doneOf(facts, character, "reputation");
  expect(done.map((r) => [r.entry.name, r.standing])).toEqual([["Stormwind", "Exalted"]]);
});

test("titles and quest chains: known versus missing, done versus how far, and a truncated chain is never done", () => {
  expect(doneOf(facts, character, "titles").map((r) => r.entry.name)).toEqual(["Private"]);
  expect(missingOf(facts, character, "titles").map((r) => r.entry.name)).toEqual(["Corporal"]);
  const chains = rowsOf(facts, character, "quests");
  expect(chains.map((r) => [r.entry.name, r.done, r.have, r.total, r.truncated])).toEqual([
    ["Cut short", false, 1, 2, true],
    ["Done chain", true, 2, 2, false],
    ["The Defias", false, 3, 4, false],
  ]);
});

test("with no character everything is missing and nothing is done", () => {
  for (const kind of ["achievements", "reputation", "titles", "quests"] as const) {
    expect(doneOf(facts, null, kind)).toEqual([]);
    expect(missingOf(facts, undefined, kind)).toHaveLength(rowsOf(facts, null, kind).length);
  }
  expect(missingOf(facts, null, "reputation").every((r) => r.standing === undefined && r.value === undefined)).toBe(true);
});

test("a major faction is in no bar and no row, even at the top standing", () => {
  const o = overviewOf(facts, character);
  // The character is at the top standing with the major faction too; only Stormwind counts.
  expect(o.categories.find((c) => c.id === "reputation")).toMatchObject({ done: 1, total: 4 });
  const names = rowsOf(facts, character, "reputation").map((r) => r.entry.name);
  expect(names).not.toContain("Renown Guild");
  expect(doneOf(facts, character, "reputation").map((r) => r.entry.factionId)).toEqual([72]);
});

test("a faction with no header is in the reputation bar and no header bar", () => {
  const o = overviewOf(facts, character);
  const headerTotal = o.categories.filter((c) => c.kind === "reputation" && c.group).reduce((s, c) => s + c.total, 0);
  expect(headerTotal).toBe(3);
  expect(o.categories.find((c) => c.id === "reputation")!.total).toBe(4);
});

test("an achievement with every criterion met but not complete is missing with no progress; a done one without a date has no earnedOn", () => {
  const c: OwnedCharacter = {
    ...character,
    achievements: new Map([
      [1, { completed: false, criteriaMet: 10, criteriaTotal: 10 }],
      [2, { completed: true, criteriaMet: 4, criteriaTotal: 4 }],
    ]),
  };
  const missing = missingOf(facts, c, "achievements");
  expect(missing.find((r) => r.entry.achievementId === 1)!.progress).toBeUndefined();
  const done = doneOf(facts, c, "achievements");
  expect(done.map((r) => r.entry.achievementId)).toEqual([2]);
  expect("earnedOn" in done[0]).toBe(false);
});

test("the overview agrees with completionProgress for the same character", () => {
  const p = completionProgress("owner-install", "0a1b2c3d", { ...facts, owned: [character] }).characters[0];
  const o = overviewOf(facts, character);
  const achievements = o.categories.filter((c) => c.kind === "achievements");
  expect(achievements.reduce((s, c) => s + c.done, 0)).toBe(p.achievements.done);
  expect(achievements.reduce((s, c) => s + c.points!.have, 0)).toBe(p.achievements.points);
  expect(o.categories.find((c) => c.id === "reputation")).toMatchObject({ done: p.reputation.exalted, total: p.reputation.total });
  expect(o.categories.find((c) => c.id === "titles")).toMatchObject({ done: p.titles.known, total: p.titles.total });
  expect(o.categories.find((c) => c.id === "quests")).toMatchObject({ done: p.quests.chainsDone, total: p.quests.chainsTotal });
});
