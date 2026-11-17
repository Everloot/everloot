import { describe, expect, test } from "vitest";
import { factSections, withFacts, type FactNames } from "./character-facts";
import { buildShowcase, type ShowcaseInput } from "./character-showcase";
import type { StoredFact } from "./private-sync-store";

const NOW = new Date("2026-11-06T12:00:00Z");
const NAMES: FactNames = { catalog: { titles: new Map([[1, { name: "Private" }]]) } };
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

  test("achievements: only the titles the catalog agrees on; earned achievements are not counted from sync", () => {
    const facts = [at("achievements", { titleIds: [1, 2] })];
    expect(factSections(facts, NAMES, NOW).collections).toEqual({ state: "shown", asOf: "2026-11-05", data: { achievements: null, points: null, titles: ["Private"], recent: [], categories: [], quests: null } });
    expect(factSections(facts, { catalog: null }, NOW).collections).toBeUndefined();
    const page = buildShowcase(withFacts(base, factSections(facts, NAMES, NOW)), NOW);
    expect(page.headlines.find((h) => h.label === "Achievement points")).toBeUndefined();
  });

  test("a retired category or a stored shape it does not know is left out, never guessed", () => {
    const retired = { category: "gear", capturedAt: "2026-11-05T10:00:00.000Z", data: { equipped: [] } } as unknown as StoredFact;
    const s = factSections([retired, at("achievements", { achievements: [] }), at("raids", { lockouts: [{ instance: 1 }] })], NAMES, NOW);
    expect(s).toEqual({});
  });
});

describe("withFacts", () => {
  test("synced raids replace the empty section and date the header", () => {
    expect(withFacts(base, {}).raids).toEqual({ state: "empty" });
    const input = withFacts(base, factSections([at("raids", { lockouts: [] }, "2026-11-05T23:00:00.000Z")], NAMES, NOW));
    expect(input.raids).toMatchObject({ state: "shown", asOf: "2026-11-05" });
    expect(input.lastUpload).toBe("2026-11-05");
  });
});
