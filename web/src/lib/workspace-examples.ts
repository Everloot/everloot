import { saveAlt } from "./alt-workspace";
import { savePlan, type DeviceStorage, type Faction, type Failure, type Owner } from "./player-workspace";
import { add, pointsAtLevel, pointsSpent } from "./talents/rules";
import { encodeBuild } from "./talents/share";
import type { TalentClassSlug } from "./talents/catalogs";
import type { Ranks, TalentCatalog } from "./talents/types";

// The examples Plans on this device and Alts on this device show while a visitor has nothing saved: what the pages
// look like filled in. They are made up and say so, and are never written to storage unless the visitor presses
// Copy to my device, which saves them through the workspace's own checked writes. Hiding them is remembered in this
// browser, as the map's sidebar is.

/** A sample talent plan: a real share code, built here from the class's catalog with the calculator's own rules. */
export interface ExamplePlan {
  key: string;
  name: string;
  classSlug: TalentClassSlug;
  code: string;
  notes: string;
}

/** A sample alt. `plans` names example plans by key. */
export interface ExampleAlt {
  name: string;
  realm: string;
  classSlug: TalentClassSlug;
  faction: Faction;
  level: number;
  professions: string[];
  notes: string;
  plans: string[];
}

/** Which plans the examples show: a class, the tree (by place) the points go into, and how many points. */
export const EXAMPLE_PLAN_SPECS: { key: string; classSlug: TalentClassSlug; tree: number; points: number }[] = [
  { key: "warrior", classSlug: "warrior", tree: 0, points: 21 },
  { key: "mage", classSlug: "mage", tree: 2, points: 16 },
  { key: "priest", classSlug: "priest", tree: 1, points: 11 },
];

/** Points spent into one tree, top row first, one rank at a time, each one the calculator would allow. */
export function fillTree(catalog: TalentCatalog, treeIndex: number, points: number): Ranks {
  const tree = catalog.trees[treeIndex];
  const available = pointsAtLevel(catalog, catalog.rules.maxLevel);
  const target = Math.min(points, available);
  const nodes = catalog.nodes.filter((n) => n.treeId === tree?.id).sort((a, b) => a.row - b.row || a.col - b.col);
  let ranks: Ranks = {};
  for (let moved = true; moved && pointsSpent(ranks) < target;) {
    moved = false;
    for (const node of nodes) {
      if (pointsSpent(ranks) >= target) break;
      const next = add(catalog, ranks, node.id, target);
      if (next !== ranks) { ranks = next; moved = true; }
    }
  }
  return ranks;
}

/** The example plans, each from its class's catalog; a class whose tree takes no points is left out. */
export function examplePlans(catalogs: Partial<Record<TalentClassSlug, TalentCatalog>>): ExamplePlan[] {
  return EXAMPLE_PLAN_SPECS.flatMap(({ key, classSlug, tree, points }) => {
    const catalog = catalogs[classSlug];
    const treeName = catalog?.trees[tree]?.name;
    if (!catalog || !treeName) return [];
    const ranks = fillTree(catalog, tree, points);
    if (pointsSpent(ranks) === 0) return [];
    const code = encodeBuild({ classSlug: catalog.classSlug, specId: catalog.specId, build: catalog.build, ranks });
    return [{ key, name: `Example: ${treeName} ${catalog.className}`, classSlug, code, notes: `An example plan with ${pointsSpent(ranks)} points in ${treeName}.` }];
  });
}

export const EXAMPLE_ALTS: ExampleAlt[] = [
  { name: "Example Warrior", realm: "Example Realm", classSlug: "warrior", faction: "alliance", level: 60, professions: ["Blacksmithing", "Mining"], notes: "An example alt.", plans: ["warrior"] },
  { name: "Example Mage", realm: "Example Realm", classSlug: "mage", faction: "horde", level: 42, professions: ["Enchanting", "Tailoring"], notes: "An example alt.", plans: ["mage"] },
  { name: "Example Priest", realm: "Example Realm", classSlug: "priest", faction: "alliance", level: 25, professions: ["Alchemy", "Herbalism"], notes: "An example alt.", plans: ["priest"] },
];

/** Saves the example plans, as new plans, through the workspace's checked write. Run it holding the workspace lock.
 *  Returns each example's key with the id it was saved under, or the first failure (plans saved before it stay). */
export function copyExamplePlans(storage: DeviceStorage | null, owner: Owner, plans: ExamplePlan[]): { ok: true; ids: Map<string, string> } | Failure {
  const ids = new Map<string, string>();
  for (const plan of plans) {
    const result = savePlan(storage, owner, { name: plan.name, notes: plan.notes, classSlug: plan.classSlug, codes: [plan.code, null], orders: [null, null] });
    if (!result.ok) return result;
    ids.set(plan.key, result.plan.id);
  }
  return { ok: true, ids };
}

/** Saves the example alts and the example plans they use. Run it holding the workspace lock. */
export function copyExampleAlts(storage: DeviceStorage | null, owner: Owner, alts: ExampleAlt[], plans: ExamplePlan[]): { ok: true } | Failure {
  const used = plans.filter((p) => alts.some((a) => a.plans.includes(p.key)));
  const copied = copyExamplePlans(storage, owner, used);
  if (!copied.ok) return copied;
  for (const alt of alts) {
    const planIds = alt.plans.flatMap((key) => copied.ids.get(key) ?? []);
    const result = saveAlt(storage, owner, { ...alt, planIds });
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** Where hiding a page's examples is remembered in this browser. */
export const examplesKey = (page: "builds" | "alts") => `everloot.examples.${page}`;

export function examplesHidden(storage: DeviceStorage | null, page: "builds" | "alts"): boolean {
  try { return storage?.getItem(examplesKey(page)) === "hidden"; } catch { return false; }
}

export function hideExamples(storage: DeviceStorage | null, page: "builds" | "alts"): void {
  try { storage?.setItem(examplesKey(page), "hidden"); } catch { /* storage off: hidden for this visit only */ }
}
