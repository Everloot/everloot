import { expect, test } from "vitest";
import { loadCatalog, TALENT_CLASSES } from "@/lib/talents/catalogs";
import { connectors } from "./TalentTreeView";

const name = (n: { entries: { name: string }[]; id: number }) => n.entries[0]?.name ?? String(n.id);

test("QA round 5: Beast Mastery's Intimidation and Bestial Wrath get one connector, pointing down", async () => {
  // The files list the pair both ways (Intimidation needs Bestial Wrath too), which drew a second arrow pointing up.
  const hunter = await loadCatalog("hunter");
  const tree = hunter.trees.find((t) => t.name === "Beast Mastery")!;
  const pair = connectors(hunter.nodes.filter((n) => n.treeId === tree.id))
    .filter(({ from, to }) => [name(from), name(to)].sort().join() === "Bestial Wrath,Intimidation");
  expect(pair.map(({ from, to }) => `${name(from)} -> ${name(to)}`)).toEqual(["Intimidation -> Bestial Wrath"]);
});

test("no connector in any class's trees points up, and none is drawn twice", async () => {
  for (const slug of TALENT_CLASSES) {
    const catalog = await loadCatalog(slug);
    for (const tree of catalog.trees) {
      const lines = connectors(catalog.nodes.filter((n) => n.treeId === tree.id));
      for (const { from, to } of lines) expect(from.row, `${slug} ${name(from)} -> ${name(to)}`).toBeLessThanOrEqual(to.row);
      const keys = lines.map(({ from, to }) => [from.id, to.id].sort().join());
      expect(new Set(keys).size).toBe(keys.length);
    }
  }
});
