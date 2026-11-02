import {
  ALT_PROFESSIONS, hiddenFrom, update,
  type DeviceStorage, type Faction, type Failure, type LocalAlt, type LocalPlan, type Owner, type WriteResult,
} from "./player-workspace";
import { add, pointsAtLevel, pointsSpent } from "./talents/rules";
import { encodeBuild } from "./talents/share";
import type { TalentClassSlug } from "./talents/catalogs";
import type { Ranks, TalentCatalog } from "./talents/types";

// The examples Plans on this device and Alts on this device show while a visitor has nothing saved: what the pages
// look like filled in. They are made up and say so, and are never written to storage unless the visitor presses
// Copy to my device, which saves them in one of the workspace's own checked writes. Hiding them is remembered in this
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

/** Why a copy was refused: another tab saved plans or alts here after the examples were shown. */
const ALREADY = (what: "plans" | "alts"): Failure => ({
  ok: false, error: "changed",
  message: `This device has ${what} now, saved in another tab, so the examples were not copied. Nothing was changed.`,
});

const newPlan = (plan: ExamplePlan, now: Date): LocalPlan => ({
  id: crypto.randomUUID(), name: plan.name, classSlug: plan.classSlug, code: plan.code, code2: null, order: null, order2: null,
  notes: plan.notes, updatedAt: now.toISOString(), boundTo: null,
});

/** Saves the example plans, as new plans, in one checked write (update): all of them or, on any failure, none. Run it
 *  holding the workspace lock. A device that shows a plan by then (one saved in another tab while this one waited for
 *  the lock) gets none, so two requests never copy them twice. */
export function copyExamplePlans(storage: DeviceStorage | null, owner: Owner, plans: ExamplePlan[], now = new Date()): WriteResult {
  return update(storage, owner, (workspace) => {
    const hidden = hiddenFrom(storage, owner, workspace);
    if (workspace.plans.some((p) => !hidden.has(p.id))) return ALREADY("plans");
    return { ...workspace, plans: [...workspace.plans, ...plans.map((p) => newPlan(p, now))] };
  });
}

/** Saves the example alts and the example plans they use, in one checked write (update): all of them or, on any
 *  failure (the plan limit, a full storage), none. Run it holding the workspace lock. A device that has an alt by
 *  then gets none, so two requests never copy them twice. */
export function copyExampleAlts(storage: DeviceStorage | null, owner: Owner, alts: ExampleAlt[], plans: ExamplePlan[], now = new Date()): WriteResult {
  return update(storage, owner, (workspace) => {
    if (workspace.alts.length > 0) return ALREADY("alts");
    const saved = new Map(plans.filter((p) => alts.some((a) => a.plans.includes(p.key))).map((p) => [p.key, newPlan(p, now)]));
    const newAlts = alts.map(({ plans: keys, ...alt }): LocalAlt => ({
      id: crypto.randomUUID(), ...alt, professions: ALT_PROFESSIONS.filter((p) => alt.professions.includes(p)),
      planIds: keys.flatMap((key) => saved.get(key)?.id ?? []),
      provenance: { source: "manual", fileRecordAt: null, fileDetails: [] }, updatedAt: now.toISOString(),
    }));
    return { ...workspace, plans: [...workspace.plans, ...saved.values()], alts: newAlts };
  });
}

/** Where hiding a page's examples is remembered in this browser. */
export const examplesKey = (page: "builds" | "alts") => `everloot.examples.${page}`;

export function examplesHidden(storage: DeviceStorage | null, page: "builds" | "alts"): boolean {
  try { return storage?.getItem(examplesKey(page)) === "hidden"; } catch { return false; }
}

export function hideExamples(storage: DeviceStorage | null, page: "builds" | "alts"): void {
  try { storage?.setItem(examplesKey(page), "hidden"); } catch { /* storage off: hidden for this visit only */ }
}
