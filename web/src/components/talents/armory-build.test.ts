import { describe, expect, test } from "vitest";
import { importCode } from "@/lib/talents/import";
import { pointsByTree } from "@/lib/talents/rules";
import { readPathCodes, summarizeBuild } from "@/lib/talents/summary";
import { armoryBuild, armoryCatalog } from "./armory-build";
import armory from "./armory-talents.fixture.json";

type Tree = { name: string; points: number; talents: { name: string; rank: number }[] };
const kaz = armory.kazSneaks as Tree[];
const rogue = armoryCatalog("rogue")!;
const codeOf = (href: string) => href.split("/b/")[1];

describe("an armory build on the calculator's trees", () => {
  test("Kaz Sneaks reads as 31/20/0, and the link opens that build in the calculator", () => {
    const build = armoryBuild(rogue, kaz);
    if (!build.ok) throw new Error(build.reason);
    expect(catalogTreePoints(build.ranks)).toEqual([31, 20, 0]);
    expect(build.href).toMatch(/^\/tools\/talents\/rogue\/b\/EL1-rogue-/);
    const read = readPathCodes(rogue, [codeOf(build.href)]);
    expect(read && summarizeBuild(rogue, read.sets[0]).split).toBe("31/20/0");
    const imported = importCode(rogue, codeOf(build.href));
    expect(imported.ok && imported.report.problems).toEqual([]);
    expect(imported.ok && imported.ranks).toEqual(build.ranks);
  });

  test("every armory character of every class loads in the calculator with nothing left out", () => {
    for (const [slug, characters] of Object.entries(armory.byClass as Record<string, Tree[][]>)) {
      const catalog = armoryCatalog(slug)!;
      for (const trees of characters) {
        const build = armoryBuild(catalog, trees);
        expect(build.ok, `${slug}: ${build.ok ? "" : build.reason}`).toBe(true);
        if (!build.ok) continue;
        const imported = importCode(catalog, codeOf(build.href));
        expect(imported.ok && imported.report.problems, slug).toEqual([]);
      }
    }
  });

  test("a talent name the calculator does not know keeps the list, and names it", () => {
    const trees = [{ ...kaz[0], talents: [...kaz[0].talents, { name: "Made-up Talent", rank: 1 }], points: kaz[0].points + 1 }, kaz[1]];
    expect(armoryBuild(rogue, trees)).toEqual({ ok: false, reason: "Assassination: Made-up Talent is not in the calculator's tree." });
  });

  test("a tree the calculator does not know keeps the list, and names it", () => {
    expect(armoryBuild(rogue, [{ name: "Swordplay", points: 1, talents: [{ name: "Malice", rank: 1 }] }])).toEqual({ ok: false, reason: "The calculator has no Swordplay tree for this class." });
  });

  test("a rank above the talent's most, or points that do not add up, keep the list", () => {
    const high = [{ ...kaz[0], talents: kaz[0].talents.map((t) => (t.name === "Malice" ? { ...t, rank: 6 } : t)), points: kaz[0].points + 1 }];
    expect(armoryBuild(rogue, high)).toEqual({ ok: false, reason: "Assassination: Malice rank 6 is above its most, 5." });
    expect(armoryBuild(rogue, [{ ...kaz[0], points: 30 }])).toEqual({ ok: false, reason: "Assassination: the armory says 30 points, its talents add up to 31." });
  });

  test("talents that break the tree's rules keep the list", () => {
    expect(armoryBuild(rogue, [{ name: "Assassination", points: 1, talents: [{ name: "Mutilate", rank: 1 }] }])).toEqual({ ok: false, reason: "These talents do not fit the calculator's tree rules." });
  });

  test("a class without a calculator has no catalog", () => {
    expect(armoryCatalog("deathknight")).toBeNull();
    expect(armoryCatalog("")).toBeNull();
  });
});

function catalogTreePoints(ranks: Parameters<typeof pointsByTree>[1]) {
  const by = pointsByTree(rogue, ranks);
  return rogue.trees.map((t) => by.get(t.id) ?? 0);
}
