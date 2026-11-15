import { describe, expect, test } from "vitest";
import { buildLevelUnlocks, parseLevel, LEVELS, type LevelData } from "./level-unlocks";
const data: LevelData = {
  classes: [{ slug: "mage", name: "Mage", pointLevels: [10, 11, 60] }, { slug: "warrior", name: "Warrior", pointLevels: [10, 60] }],
  spells: [
    { id: 1, name: "First spell", rank: "Rank 2", level: 10, classSlug: "mage", href: "/database/spells/1" },
    { id: 2, name: "Other spell", level: 10, classSlug: "warrior", href: "/database/spells/2" },
    { id: 3, name: "Last spell", level: 60, classSlug: "mage", href: "/database/spells/3" },
  ],
  zones: [{ name: "Test zone", href: "/database/zones/1", min: 10, max: 20 }],
  instances: [
    { name: "Test dungeon", href: "/database/instances/1", min: 10, max: 20, raid: false },
    { name: "Test raid", href: "/database/instances/2", min: 60, max: 60, raid: true },
    { name: "Unknown raid", href: "/database/instances/3", min: null, max: null, raid: true },
  ], trainers: null,
};
describe("what opens at a level", () => {
  test("filters spells and talent rules by class, preserving ranks and shared places", () => {
    const result = buildLevelUnlocks(data, 10, "mage");
    expect(result.spells?.map((s) => [s.id, s.rank])).toEqual([[1, "Rank 2"]]);
    expect(result.talents).toEqual([{ slug: "mage", name: "Mage", gained: 1, total: 1 }]);
    expect(result.zones).toEqual(data.zones);
    expect(result.dungeons).toHaveLength(1);
    expect(buildLevelUnlocks(data, 20).dungeons).toHaveLength(1);
    expect(buildLevelUnlocks(data, 21).dungeons).toHaveLength(0);
  });
  test("keeps an empty level empty and distinguishes absent data", () => {
    const result = buildLevelUnlocks(data, 1);
    expect(result.spells).toEqual([]); expect(result.talents).toEqual([]);
    expect(result.dungeons).toEqual([]); expect(result.raids).toEqual([]);
    expect(result.hasData).toBe(false);
    expect(buildLevelUnlocks({ ...data, spells: null, zones: null }, 1)).toMatchObject({ spells: null, zones: null, trainers: null });
  });
  test("level 60 includes only raids with a supported covering range", () => {
    const result = buildLevelUnlocks(data, 60);
    expect(result.raids.map((r) => r.name)).toEqual(["Test raid"]);
    expect(result.spells?.map((s) => s.id)).toEqual([3]);
    expect(result.talents.map((t) => t.total)).toEqual([3, 2]);
    expect(result.hasData).toBe(true);
  });
  test("accepts only canonical level params from 1 to 60", () => {
    expect(LEVELS).toHaveLength(60);
    expect(LEVELS.map(String).map(parseLevel)).toEqual(LEVELS);
    for (const value of ["0", "61", "01", "1.5", "1e1", " 10", "abc"]) expect(parseLevel(value)).toBeNull();
    expect(() => buildLevelUnlocks(data, 0)).toThrow();
  });
});
