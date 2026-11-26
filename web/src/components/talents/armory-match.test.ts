import { describe, expect, test } from "vitest";
import { loadCatalog, TALENT_CLASSES } from "@/lib/talents/catalogs";
import armory from "./armory-talents.fixture.json";

// The armory stores talents as Blizzard names them (tree name, talent name, rank); the calculator knows nodes by the
// game files' ids. Drawing a character's trees needs every armory name to find its node. This measures that match
// over every character the live armory held on 2026-11-26, class by class: a tree by its name, a talent by its name
// inside that tree, and a rank no higher than the node takes.

type Tree = { name: string; points: number; talents: { name: string; rank: number }[] };
const byClass = armory.byClass as Record<string, Tree[][]>;

describe("armory talent names against the calculator's catalogs", () => {
  test("every class has armory characters to measure", () => {
    expect(Object.keys(byClass).sort()).toEqual([...TALENT_CLASSES].sort());
  });

  test.each(TALENT_CLASSES)("%s: every tree and talent name matches one node", async (slug) => {
    const catalog = await loadCatalog(slug);
    let talents = 0;
    const misses: string[] = [];
    for (const character of byClass[slug]) {
      for (const tree of character) {
        const t = catalog.trees.find((x) => x.name === tree.name);
        if (!t) { misses.push(`tree ${tree.name}`); continue; }
        for (const talent of tree.talents) {
          talents += 1;
          const nodes = catalog.nodes.filter((n) => n.treeId === t.id && n.entries.some((e) => e.name === talent.name));
          if (nodes.length !== 1 || talent.rank > nodes[0].maxRanks) misses.push(`${tree.name}: ${talent.name} ${talent.rank}`);
        }
      }
    }
    const rate = talents ? (talents - misses.length) / talents : 0;
    console.info(`${slug}: ${talents - misses.length}/${talents} armory talents match (${(rate * 100).toFixed(1)}%)`);
    expect(talents).toBeGreaterThan(0);
    expect(misses).toEqual([]);
  });
});
