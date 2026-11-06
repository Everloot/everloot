import { agreedCatalog } from "../../../kb/src/completion-rollup";
import { agreedItemNames } from "../../../kb/src/item-page";
import type { FactNames } from "./character-facts";
import type { StoredFact } from "./private-sync-store";
import { loadItemFacts } from "./rollup-compute";
import { isTalentClass, loadCatalog } from "./talents/catalogs";
import { uploadStore } from "./upload-store";

/**
 * The names a character's synced facts are shown with, read only for the categories it has: item names 3 installs
 * agree on for gear, the agreed completion catalog for reputations and achievements, and the class's talent trees
 * for talents. A read that fails leaves its names out (items as "Item <id>", the other two sections left out), so a
 * slow store never takes the page down. Server only.
 */
export async function loadFactNames(facts: readonly StoredFact[], classToken: string): Promise<FactNames> {
  const has = (c: StoredFact["category"]) => facts.some((f) => f.category === c);
  const [items, catalog, talentTrees] = await Promise.all([
    has("gear")
      ? loadItemFacts().then((f) => (f.unreachable ? new Map<number, string>() : agreedItemNames(f))).catch(() => new Map<number, string>())
      : new Map<number, string>(),
    has("reputations") || has("achievements")
      ? uploadStore.loadCompletion().then((read) => (read.state ? agreedCatalog(read.state) : null)).catch(() => null)
      : null,
    has("talents") ? talentTreesOf(classToken).catch(() => null) : null,
  ]);
  return { item: (id) => items.get(id) ?? null, catalog, talentTrees };
}

async function talentTreesOf(classToken: string): Promise<FactNames["talentTrees"]> {
  const slug = classToken.toLowerCase();
  if (!isTalentClass(slug)) return null;
  const catalog = await loadCatalog(slug);
  return { trees: catalog.trees, nodeTree: new Map(catalog.nodes.map((n) => [n.id, n.treeId])) };
}
