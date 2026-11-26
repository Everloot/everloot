// The item categories the armory's equipped-item cards need (src/lib/item-categories.ts), cut from the client layer so
// the character page does not load the whole 2.5 MB layer into its Worker. Regenerated before each site build, like
// build-version.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The layer's class and subclass names, and its items grouped by [classId, subclassId, inventoryType, quality], each
 * group's item ids in the layer's order. One group per line, so a new build's change reads as a diff.
 */
export function itemCategories(layer) {
  const { build: { product, version }, categories: { classes, subclasses }, items } = layer;
  if (typeof product !== "string" || !product || typeof version !== "string" || !version) throw new Error("Missing game build stamp");
  const groups = new Map();
  for (const [id, classId, subclassId, inventoryType, quality] of items) {
    const key = `${classId}:${subclassId}:${inventoryType}:${quality}`;
    if (!groups.has(key)) groups.set(key, [classId, subclassId, inventoryType, quality, []]);
    groups.get(key)[4].push(id);
  }
  const head = JSON.stringify({ build: { product, version }, classes, subclasses }).slice(0, -1);
  return `${head},"groups":[\n${[...groups.values()].map((g) => JSON.stringify(g)).join(",\n")}\n]}\n`;
}

export function writeItemCategories(source, output) {
  writeFileSync(output, itemCategories(JSON.parse(readFileSync(source, "utf8"))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeItemCategories(
    process.argv[2] ?? fileURLToPath(new URL("../src/data/game-data/client-layer.json", import.meta.url)),
    process.argv[3] ?? fileURLToPath(new URL("../src/data/game-data/item-categories.json", import.meta.url)),
  );
}
