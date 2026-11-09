import { describe, expect, test } from "vitest";
import { factSections, withFacts, type FactNames } from "./character-facts";
import { buildShowcase, type ShowcaseInput } from "./character-showcase";
import type { StoredFact } from "./private-sync-store";

const NOW = new Date("2026-11-06T12:00:00Z");
const NAMES: FactNames = {
  item: (id) => (id === 16_842 ? "Earthfury Helmet" : null),
  catalog: {
    achievements: new Map([[6, { points: 10 }], [7, { points: 25 }]]),
    factions: new Map([[76, { name: "Orgrimmar", major: false }], [2600, { name: "The Severed Threads", major: true }]]),
    titles: new Map([[1, { name: "Private" }]]),
  },
  talentTrees: { trees: [{ id: 1, name: "Elemental" }, { id: 2, name: "Enhancement" }], nodeTree: new Map([[10, 1], [11, 2], [12, 2]]) },
};
const at = (category: StoredFact["category"], data: Record<string, unknown>, capturedAt = "2026-11-05T10:00:00.000Z"): StoredFact => ({ category, capturedAt, data });

const base: ShowcaseInput = {
  sample: false, path: "/characters/forever/forever-pioneer/thrallina", name: "Thrallina", level: 60, race: "Orc", class: "SHAMAN",
  faction: "Horde", realm: "Forever Pioneer", title: null, guild: null, lastUpload: "2026-11-01",
  gear: { state: "empty" }, stats: { state: "unsupported" }, talents: { state: "empty" }, professions: { state: "empty" }, reputations: { state: "empty" },
  pvp: { state: "empty" }, raids: { state: "empty" }, collections: { state: "empty" },
};

describe("factSections", () => {
  test("nothing synced is nothing: every section stays empty, never a zero", () => {
    const input = withFacts(base, factSections([], NAMES, NOW));
    expect(input).toEqual(base);
    const page = buildShowcase(input, NOW);
    // Stats stay unsupported (no collector records them); everything else is empty.
    expect(page.sections.every((s) => s.section.state === (s.key === "stats" ? "unsupported" : "empty"))).toBe(true);
    expect(page.blocks).toEqual([]);
  });

  test("gear: the game's slots in order, names only where 3 installs agree, the capture's date", () => {
    const s = factSections([at("gear", { equipped: [
      { slot: "Finger0Slot", itemId: 99, itemLevel: 60 },
      { slot: "HeadSlot", itemId: 16_842, itemLevel: 66 },
      { slot: "SecondaryHandSlot", itemId: 98, itemLevel: 62 },
    ] })], NAMES, NOW);
    expect(s.gear).toEqual({ state: "shown", asOf: "2026-11-05", data: [
      { slot: "head", itemId: 16_842, name: "Earthfury Helmet", quality: null, itemLevel: 66 },
      { slot: "finger1", itemId: 99, name: null, quality: null, itemLevel: 60 },
      { slot: "offHand", itemId: 98, name: null, quality: null, itemLevel: 62 },
    ] });
  });

  test("talents: points per tree from the class's catalog; a node the catalog does not know leaves the trees out", () => {
    const talents = { class: "SHAMAN", treeId: 1, specId: null, points: 6, nodes: [{ nodeId: 10, ranks: 1 }, { nodeId: 11, ranks: 3 }, { nodeId: 12, ranks: 2 }] };
    expect(factSections([at("talents", talents)], NAMES, NOW).talents).toEqual({ asOf: "2026-11-05", trees: [{ name: "Elemental", points: 1 }, { name: "Enhancement", points: 5 }] });
    expect(factSections([at("talents", { ...talents, nodes: [...talents.nodes, { nodeId: 77, ranks: 1 }] })], NAMES, NOW).talents).toBeUndefined();
    expect(factSections([at("talents", talents)], { ...NAMES, talentTrees: null }, NOW).talents).toBeUndefined();
  });

  test("professions, as the client named them", () => {
    expect(factSections([at("professions", { professions: [{ name: "Mining", skillLine: 186, rank: 280, maxRank: 300 }] })], NAMES, NOW).professions)
      .toEqual({ state: "shown", asOf: "2026-11-05", data: [{ name: "Mining", rank: 280, maxRank: 300 }] });
  });

  test("reputations: only factions the catalog agrees on; renown as renown; without the catalog, nothing", () => {
    const facts = [at("reputations", { factions: [
      { factionId: 76, reaction: 7, standing: 30_000, floor: 21_000, ceiling: 42_000 },
      { factionId: 2600, reaction: 3, standing: 500, floor: 0, ceiling: 2500 },
      { factionId: 999, reaction: 8, standing: 42_999, floor: 42_000, ceiling: 43_000 },
    ] })];
    expect(factSections(facts, NAMES, NOW).reputations).toEqual({ state: "shown", asOf: "2026-11-05", data: [
      { faction: "Orgrimmar", standing: "Revered", value: 9000, max: 21_000 },
      { faction: "The Severed Threads", renown: true },
    ] });
    expect(factSections(facts, { ...NAMES, catalog: null }, NOW).reputations).toBeUndefined();
  });

  test("raids: a lockout that has reset since the capture is gone; none left is 'no lockout', not a zero", () => {
    const lockouts = [
      { instance: "Molten Core", instanceId: 409, difficulty: "40 Player", difficultyId: 9, killed: 6, total: 10, resetAt: "2026-11-10T15:00:00.000Z" },
      { instance: "Onyxia's Lair", instanceId: 249, difficulty: null, difficultyId: null, killed: 1, total: 1, resetAt: "2026-11-06T09:00:00.000Z" },
    ];
    expect(factSections([at("raids", { lockouts })], NAMES, NOW).raids).toEqual({ state: "shown", asOf: "2026-11-05", data: {
      lockouts: [{ instance: "Molten Core", difficulty: "40 Player", killed: 6, total: 10, resets: "2026-11-10", bosses: [] }], guildKills: null,
    } });
    expect(factSections([at("raids", { lockouts: [lockouts[1]] })], NAMES, NOW).raids)
      .toEqual({ state: "shown", asOf: "2026-11-05", data: { lockouts: [], guildKills: null } });
  });

  test("achievements: earned count, points and titles the catalog agrees on; without the catalog, nothing", () => {
    const facts = [at("achievements", { achievements: [{ id: 6, on: "2026-10-01" }, { id: 7, on: null }, { id: 8, on: null }], titleIds: [1, 2] })];
    expect(factSections(facts, NAMES, NOW).collections).toEqual({ state: "shown", asOf: "2026-11-05", data: { achievements: 3, points: 35, titles: ["Private"], recent: [], categories: [], quests: null } });
    expect(factSections(facts, { ...NAMES, catalog: null }, NOW).collections).toBeUndefined();
  });

  test("stats, in the page's group order with percent and thousands formatting; unknown keys and empty groups are dropped", () => {
    const s = factSections([at("stats", { stats: {
      block: 4.5, strength: 1234, agility: 90, stamina: 1_234_567, intellect: 0, spirit: 12, armor: 3000, meleeCrit: 12.345, meleeHit: 0, bogus: 7,
    } })], NAMES, NOW).stats;
    expect(s).toEqual({ state: "shown", asOf: "2026-11-05", data: [
      { group: "Attributes", stats: [
        { label: "Strength", value: "1,234" }, { label: "Agility", value: "90" }, { label: "Stamina", value: "1,234,567" },
        { label: "Intellect", value: "0" }, { label: "Spirit", value: "12" },
      ] },
      { group: "Melee", stats: [{ label: "Crit", value: "12.35%" }] },
      { group: "Defense", stats: [{ label: "Armor", value: "3,000" }, { label: "Block", value: "4.50%" }] },
    ] });
  });

  test("a stats fact with nothing known leaves the section out", () => {
    expect(factSections([at("stats", { stats: { bogus: 1 } }), at("stats", { stats: "nope" })], NAMES, NOW).stats).toBeUndefined();
  });

  test("pvp: the stored numbers as the page's data, an absent one null; no known number leaves the section out", () => {
    const s = factSections([at("pvp", { rank: 9, rankPoints: 12_500, rankThreshold: 15_000, rankMax: 14, season: 2, honorableKills: 1234 })], NAMES, NOW).pvp;
    expect(s).toEqual({ state: "shown", asOf: "2026-11-05", data: { rank: 9, rankPoints: 12_500, rankThreshold: 15_000, rankMax: 14, season: 2, honorableKills: 1234 } });
    expect(factSections([at("pvp", { honorableKills: 7 })], NAMES, NOW).pvp).toMatchObject({ data: { rank: null, honorableKills: 7 } });
    expect(factSections([at("pvp", { rank: null, honorableKills: null }), at("pvp", { rank: "9" })], NAMES, NOW).pvp).toBeUndefined();
  });

  test("pvp: unranked with nothing else to draw leaves the section out, not an empty card", () => {
    expect(factSections([at("pvp", { rank: 0, rankPoints: 0, rankThreshold: 0 })], NAMES, NOW).pvp).toBeUndefined();
    expect(factSections([at("pvp", { rank: 0, honorableKills: 0 })], NAMES, NOW).pvp).toMatchObject({ data: { honorableKills: 0 } });
    expect(factSections([at("pvp", { rank: 0, season: 3 })], NAMES, NOW).pvp).toMatchObject({ data: { season: 3 } });
    expect(factSections([at("pvp", { rank: 0, rankPoints: 40, rankThreshold: 500 })], NAMES, NOW).pvp).toMatchObject({ data: { rankPoints: 40 } });
  });

  test("expertise is a percent, as Forever's character window shows it", () => {
    const s = factSections([at("stats", { stats: { strength: 1, agility: 1, stamina: 1, intellect: 1, spirit: 1, expertise: 7.6 } })], NAMES, NOW).stats;
    expect(s).toMatchObject({ data: [{ group: "Attributes" }, { group: "Melee", stats: [{ label: "Expertise", value: "7.60%" }] }] });
  });

  test("a stored shape it does not know is left out, never guessed", () => {
    const s = factSections([at("gear", { equipped: "nope" }), at("professions", { list: [] }), at("raids", { lockouts: [{ instance: 1 }] })], NAMES, NOW);
    expect(s).toEqual({});
  });
});

describe("withFacts", () => {
  test("synced pvp replaces the empty section and dates the header", () => {
    expect(withFacts(base, {}).pvp).toEqual({ state: "empty" });
    const input = withFacts(base, factSections([at("pvp", { rank: 3 }, "2026-11-05T23:00:00.000Z")], NAMES, NOW));
    expect(input.pvp).toMatchObject({ state: "shown", asOf: "2026-11-05", data: { rank: 3 } });
    expect(input.lastUpload).toBe("2026-11-05");
  });

  test("synced stats replace the unsupported line and date the header; without a fact they stay unsupported", () => {
    expect(withFacts(base, {}).stats).toEqual({ state: "unsupported" });
    const input = withFacts(base, factSections([at("stats", { stats: { strength: 10 } }, "2026-11-05T23:00:00.000Z")], NAMES, NOW));
    expect(input.stats).toEqual({ state: "shown", asOf: "2026-11-05", data: [{ group: "Attributes", stats: [{ label: "Strength", value: "10" }] }] });
    expect(input.lastUpload).toBe("2026-11-05");
    const page = buildShowcase({ ...input, lastUpload: "2026-11-05" }, NOW);
    expect(page.sections.find((x) => x.key === "stats")).toMatchObject({ asOf: "2026-11-05", stale: false });
    const old = buildShowcase(withFacts(base, factSections([at("stats", { stats: { strength: 10 } }, "2026-10-01T10:00:00.000Z")], NAMES, NOW)), NOW);
    expect(old.sections.find((x) => x.key === "stats")).toMatchObject({ asOf: "2026-10-01", stale: true });
  });

  test("synced talents sit beside the planned builds; the header's date is the newest shown capture", () => {
    const planned: ShowcaseInput = { ...base, talents: { state: "shown", asOf: "2026-10-20", data: { trees: [], code: null, planned: [{ name: "Raid", slug: "abc123" }] } } };
    const input = withFacts(planned, factSections([
      at("talents", { class: "SHAMAN", treeId: 1, specId: null, points: 1, nodes: [{ nodeId: 10, ranks: 1 }] }, "2026-11-04T10:00:00.000Z"),
      at("professions", { professions: [{ name: "Mining", skillLine: null, rank: 1, maxRank: 75 }] }, "2026-11-05T23:00:00.000Z"),
    ], NAMES, NOW));
    // Every tree of the class, a tree with no points spent included: 1 / 0 is the build, not a missing value.
    expect(input.talents).toEqual({ state: "shown", asOf: "2026-11-04", data: { trees: [{ name: "Elemental", points: 1 }, { name: "Enhancement", points: 0 }], code: null, planned: [{ name: "Raid", slug: "abc123" }] } });
    expect(input.lastUpload).toBe("2026-11-05");
  });
});
