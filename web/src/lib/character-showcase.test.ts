import { describe, expect, test } from "vitest";
import { sampleShowcase } from "@/data/showcase";
import { averageItemLevel, buildShowcase, GEAR_SLOTS, isPublic, PAPER_DOLL, paperDoll, reputationGroups, SECTION_TITLES, type GearRow } from "./character-showcase";

const NOW = new Date("2026-11-01T12:00:00Z");
const row = (slot: GearRow["slot"], itemLevel: number): GearRow => ({ slot, itemId: 1, name: null, quality: null, itemLevel });

describe("gear", () => {
  test("the paper doll holds every slot once, in the game's order, split into its columns and the weapons row", () => {
    expect([...PAPER_DOLL.left, ...PAPER_DOLL.right, ...PAPER_DOLL.weapons]).toEqual(Object.keys(GEAR_SLOTS));
    expect(PAPER_DOLL.left).toHaveLength(8);
    expect(PAPER_DOLL.right).toHaveLength(8);
    expect(PAPER_DOLL.weapons).toEqual(["mainHand", "offHand", "ranged"]);
  });

  test("an unworn slot is null, never dropped", () => {
    const doll = paperDoll([row("head", 60)]);
    expect(Object.keys(doll)).toEqual(Object.keys(GEAR_SLOTS));
    expect(doll.head?.itemLevel).toBe(60);
    expect(doll.shirt).toBeNull();
  });

  test("the average is over the equipped items only, rounded down; none is null", () => {
    expect(averageItemLevel([row("head", 60), row("chest", 57)])).toBe(58);
    expect(averageItemLevel([])).toBeNull();
  });
});

test("reputations group by standing, best first; an unknown standing after the known ones; renown last", () => {
  const groups = reputationGroups([
    { faction: "R", renown: true },
    { faction: "F", standing: "Friendly", value: 1, max: 2 },
    { faction: "X", standing: "Odd", value: 1, max: 2 },
    { faction: "E", standing: "Exalted", value: 1, max: 2 },
    { faction: "F2", standing: "Friendly", value: 1, max: 2 },
  ]);
  expect(groups.map((g) => [g.standing, g.rows.map((r) => r.faction)])).toEqual([
    ["Exalted", ["E"]], ["Friendly", ["F", "F2"]], ["Odd", ["X"]], ["Renown", ["R"]],
  ]);
});

describe("buildShowcase", () => {
  test("sections in page order, each dated when shown", () => {
    const s = buildShowcase(sampleShowcase(NOW), NOW);
    expect(s.sections.map((x) => x.key)).toEqual(Object.keys(SECTION_TITLES));
    expect(s.sections.map((x) => x.key)).toEqual(["gear", "stats", "talents", "raids", "collections", "reputations", "professions"]);
    expect(s.sections.every((x) => x.asOf !== null)).toBe(true);
  });

  test("headline numbers come only from shown sections", () => {
    const sample = sampleShowcase(NOW);
    expect(buildShowcase(sample, NOW).headlines).toEqual([{ label: "Item level", value: 57 }, { label: "Achievement points", value: 400 }]);
    expect(buildShowcase({ ...sample, gear: { state: "empty" }, collections: { state: "private" } }, NOW).headlines).toEqual([]);
    expect(buildShowcase({ ...sample, gear: { state: "shown", asOf: "2026-10-31", data: [] } }, NOW).headlines.map((h) => h.label)).toEqual(["Achievement points"]);
  });

  test("public sections are the shown and unsupported ones", () => {
    expect(isPublic({ state: "unsupported" })).toBe(true);
    expect(isPublic({ state: "empty" })).toBe(false);
    expect(isPublic({ state: "private" })).toBe(false);
  });
});
