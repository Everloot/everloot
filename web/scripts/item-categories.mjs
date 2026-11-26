// The item categories the armory's equipped-item cards need (src/lib/item-categories.ts), and the item facets the item
// lists filter by (src/lib/items.ts), cut from the client layer so those pages do not load the whole 2.9 MB layer into
// their Worker. Regenerated before each site build, like build-version.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

function stampOf(layer) {
  const { product, version } = layer.build;
  if (typeof product !== "string" || !product || typeof version !== "string" || !version) throw new Error("Missing game build stamp");
  return { product, version };
}

/**
 * The layer's class and subclass names, and its items grouped by [classId, subclassId, inventoryType, quality], each
 * group's item ids in the layer's order. One group per line, so a new build's change reads as a diff.
 */
export function itemCategories(layer) {
  const build = stampOf(layer);
  const { categories: { classes, subclasses }, items } = layer;
  const groups = new Map();
  for (const [id, classId, subclassId, inventoryType, quality] of items) {
    const key = `${classId}:${subclassId}:${inventoryType}:${quality}`;
    if (!groups.has(key)) groups.set(key, [classId, subclassId, inventoryType, quality, []]);
    groups.get(key)[4].push(id);
  }
  const head = JSON.stringify({ build, classes, subclasses }).slice(0, -1);
  return `${head},"groups":[\n${[...groups.values()].map((g) => JSON.stringify(g)).join(",\n")}\n]}\n`;
}

/**
 * What the layer's relations say about items, for the item lists' filters: the items a spell creates, the items a spell
 * uses, the set pieces, and for each profession (SkillLine) the items its spells create or use. Ids in the layer's order;
 * one list per line.
 */
export function itemFacets(layer) {
  const build = stampOf(layer);
  const skillOfSpell = new Map();
  for (const [, fromId, rel, , toId] of layer.edges) if (rel === "in_skill_line") skillOfSpell.set(fromId, toId);
  const crafted = new Set(), reagent = new Set(), set = new Set(), bySkill = new Map();
  for (const [fromKind, fromId, rel, , toId] of layer.edges) {
    if (fromKind !== "item") continue;
    if (rel === "part_of_set") set.add(fromId);
    if (rel !== "created_by" && rel !== "reagent_for") continue;
    (rel === "created_by" ? crafted : reagent).add(fromId);
    const skill = skillOfSpell.get(toId);
    if (skill !== undefined) bySkill.set(skill, (bySkill.get(skill) ?? new Set()).add(fromId));
  }
  const skills = layer.categories.skills.filter((s) => bySkill.has(s.id)).map((s) => [s.id, s.name, [...bySkill.get(s.id)]]);
  const line = (key, value) => `${JSON.stringify(key)}:${JSON.stringify(value)}`;
  return `{${line("build", build)},\n${line("crafted", [...crafted])},\n${line("reagent", [...reagent])},\n${line("set", [...set])},\n"skills":[\n${skills.map((s) => JSON.stringify(s)).join(",\n")}\n]}\n`;
}

export function writeItemCategories(source, output, facetsOutput) {
  const layer = JSON.parse(readFileSync(source, "utf8"));
  writeFileSync(output, itemCategories(layer));
  if (facetsOutput) writeFileSync(facetsOutput, itemFacets(layer));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeItemCategories(
    process.argv[2] ?? fileURLToPath(new URL("../src/data/game-data/client-layer.json", import.meta.url)),
    process.argv[3] ?? fileURLToPath(new URL("../src/data/game-data/item-categories.json", import.meta.url)),
    process.argv[4] ?? fileURLToPath(new URL("../src/data/game-data/item-facets.json", import.meta.url)),
  );
}
