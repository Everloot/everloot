import { loadCatalog, TALENT_CLASSES, type TalentClassSlug } from "./catalogs";
import type { NodeKind, TalentCatalog } from "./types";

/**
 * Where a spell sits in the talent trees, read from the committed talent catalog: the class, the tree, the row and
 * column, the ranks the talent takes and the points its row asks for. Only what the catalog holds; nothing about what
 * the talent does in play.
 */
export interface SpellTalent {
  classSlug: TalentClassSlug;
  className: string;
  tree: string;
  /** 1-based, top row first. */
  row: number;
  col: number;
  kind: NodeKind;
  /** Ranks the talent takes. */
  maxRanks: number;
  /** For a tiered node, which of its entries this spell is (1-based); otherwise null. */
  tier: number | null;
  /** Points the row asks for before the talent can take one, and where they count; null when the row has no gate. */
  gate: { points: number; scope: "tree" | "class" | "unconfirmed" } | null;
  build: string;
  label: string;
}

/** The talents of one catalog, by spell id. */
export function talentsBySpell(catalog: TalentCatalog, classSlug: TalentClassSlug): Map<number, SpellTalent[]> {
  const out = new Map<number, SpellTalent[]>();
  const trees = new Map(catalog.trees.map((t) => [t.id, t.name]));
  for (const node of catalog.nodes) {
    const points = node.unlock?.pointsInTree ?? node.unlock?.pointsTotal;
    node.entries.forEach((entry, i) => {
      if (entry.spellId === null) return;
      const talent: SpellTalent = {
        classSlug, className: catalog.className, tree: trees.get(node.treeId) ?? "", row: node.row, col: node.col, kind: node.kind,
        maxRanks: entry.maxRanks ?? node.maxRanks, tier: node.kind === "tiered" ? i + 1 : null,
        gate: points ? { points, scope: node.unlock?.scope ?? "tree" } : null,
        build: catalog.build, label: catalog.label,
      };
      out.set(entry.spellId, [...(out.get(entry.spellId) ?? []), talent]);
    });
  }
  return out;
}

let all: Promise<Map<number, SpellTalent[]>> | null = null;

/**
 * Every talent spell of the nine class catalogs, by spell id. The catalogs are committed files, so the index is built
 * once per instance and every later call is a map lookup.
 */
export function loadSpellTalents(): Promise<Map<number, SpellTalent[]>> {
  all ??= Promise.all(TALENT_CLASSES.map(async (slug) => talentsBySpell(await loadCatalog(slug), slug))).then((maps) => {
    const out = new Map<number, SpellTalent[]>();
    for (const map of maps) for (const [id, rows] of map) out.set(id, [...(out.get(id) ?? []), ...rows]);
    return out;
  }).catch((err: unknown) => { all = null; throw err; });
  return all;
}
