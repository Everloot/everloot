import { describe, expect, it } from "vitest";
import { pathFactsFromRecords } from "@kb/recipe-thresholds";
import { planProfessionGuide } from "@kb/profession-guide";
import { buildProfessionGuideData } from "./profession-guide-data";
import { professionBySlug } from "./professions";

describe("profession guide data", () => {
  it("uses the starter recipe at skill 1 and labels the progressively less likely part modeled", () => {
    const guide = buildProfessionGuideData(professionBySlug("tailoring")!, pathFactsFromRecords([]), () => undefined);
    const bolts = guide.recipes.find(({ id }) => id === 2963);
    expect(bolts?.source.kind).toBe("starter");
    expect(bolts?.windows[0]).toEqual({ fromSkill: 1, toSkill: 25, points: 1, chance: 1, evidence: "verified" });
    expect(bolts?.windows[1]).toMatchObject({ fromSkill: 25, toSkill: 50, chance: 1, chanceAtEnd: 0, evidence: "modeled" });
    const estimate = planProfessionGuide([bolts!], { fromSkill: 40, toSkill: 41, mode: "materials" });
    expect(estimate.steps[0]?.expectedCrafts).toBeCloseTo(2.5);
  });

  it("uses a trainer recipe by spell ID and keeps its source build and reports", () => {
    const guide = buildProfessionGuideData(professionBySlug("leatherworking")!, pathFactsFromRecords([]), () => undefined);
    const pants = guide.recipes.find(({ id }) => id === 2153);
    expect(pants?.source).toMatchObject({ kind: "trainer", provider: "efficient-games", build: "1.60.1.71139" });
    expect(pants?.source.kind === "trainer" && pants.source.npcIds).toContain(4212);
    expect(pants?.windows[0]?.fromSkill).toBe(15);
  });

  it("keeps agreed vendor purchase prices in the reagent's numeric namespace", () => {
    const records = ["a", "b", "c"].map(installId => ({
      kind: "vendor", vendorNpcId: 1, installId, items: [{ itemId: 2320, priceCopper: 2 }],
    }));
    const guide = buildProfessionGuideData(professionBySlug("tailoring")!, pathFactsFromRecords(records), () => undefined);
    expect(guide.vendorBuyCopper[2320]).toBe(2);
  });

  it("shows the actual book and quest that raise the First Aid cap", () => {
    const data = buildProfessionGuideData(professionBySlug("first-aid")!, pathFactsFromRecords([]), () => undefined);
    expect(data.rankStops.map(x => x.cap)).toEqual([75, 150, 225]);
    expect(data.rankStops[1]).toMatchObject({
      nextSpellId: 7924, nextCap: 225, source: { kind: "book", itemId: 16084, minimumSkill: 125 },
    });
    expect(data.rankStops[2]).toMatchObject({
      nextSpellId: 10846, nextCap: 300, source: { kind: "quest", questIds: [6622, 6624], minimumLevel: 35 },
    });
  });

  it("carries the quest's required items separately from the recipe reagents", () => {
    const data = buildProfessionGuideData(professionBySlug("blacksmithing")!, pathFactsFromRecords([]), () => undefined);
    const leggings = data.recipes.find(r => r.id === 16730);
    expect(leggings?.source).toMatchObject({ kind: "quest", questIds: [7658], teachingItemIds: [12715], minimumLevel: 50 });
    expect(leggings?.unlockReagents).toEqual([{ itemId: 12359, count: 60 }]);
    expect(leggings?.reagents).toContainEqual({ itemId: 12359, count: 44 });
  });

  it.each(["alchemy", "blacksmithing", "cooking", "enchanting", "engineering", "first-aid", "leatherworking", "tailoring"])(
    "plans 1–300 for %s with labeled estimates and meaningful alternatives before any uploads",
    (slug) => {
      const data = buildProfessionGuideData(professionBySlug(slug)!, pathFactsFromRecords([]), () => undefined);
      const estimate = planProfessionGuide(data.recipes, { fromSkill: 1, toSkill: 300, mode: "materials" });
      expect(estimate.gaps).toEqual([]);
      expect(estimate.steps.at(-1)?.toSkill).toBe(300);
      expect(estimate.steps.some(step => step.alternatives.length > 0)).toBe(true);

      const known = data.recipes.map(recipe => ({
        ...recipe, windows: recipe.windows.filter(window => window.evidence !== "modeled"),
      }));
      const verified = planProfessionGuide(known, { fromSkill: 1, toSkill: 300, mode: "materials" });
      expect(verified.steps[0]?.fromSkill).toBe(1);
      expect(verified.steps.every(step => step.evidence !== "modeled")).toBe(true);
      expect(verified.gaps.reduce((total, gap) => total + gap.toSkill - gap.fromSkill, 0)).toBe(299 - data.coverage.knownSkills);
    },
  );
});
