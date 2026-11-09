import { KNOWLEDGE_KINDS } from "@everloot/protocol";

/**
 * The "Record kinds" table of /docs/mcp. Rows come from KNOWLEDGE_KINDS, so a kind added to the protocol fails the
 * page test until it has a row here. The catalog kinds and the id scheme mirror kb/src/catalog-index.ts, and the page
 * test checks them against that file.
 */
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** Where a kind's records come from, in the words of the kind filter of search_knowledge and get_by_name. */
export const KIND_ORIGINS = {
  release: "Knowledge release",
  catalog: "Game-file catalog (found in game files, unconfirmed)",
  starter: "Everloot team starter builds (not observed)",
} as const;

/** The game-file catalog kinds, in the order the kb index numbers them: the order sets each kind's id range. */
export const CATALOG_KINDS = ["achievement", "faction", "title", "quest_chain", "mount", "legacy_perk", "race", "instance"] as const;

/** Catalog ids start here, far above any release rowid, and each kind owns a span of this many ids. */
export const CATALOG_ID_BASE = 1_000_000_000;
export const CATALOG_KIND_SPAN = 10_000_000;

/** The tools that read one kind on their own, beside the knowledge tools every kind answers to. */
const DEDICATED_TOOLS: Partial<Record<KnowledgeKind, readonly string[]>> = {
  item: ["item_page"],
  npc: ["npc_page", "vendor_page"],
  object: ["object_page"],
  quest: ["quest_page"],
  race: ["class_races"],
  build: ["talent_tree"],
};

/** The tools every kind can be found and read with. */
export const KNOWLEDGE_TOOLS = ["search_knowledge", "get_by_name", "get_entity", "fetch"] as const;

export interface KindRow {
  kind: KnowledgeKind;
  origin: keyof typeof KIND_ORIGINS;
  tools: readonly string[];
}

export function kindRows(): KindRow[] {
  const catalog = new Set<string>(CATALOG_KINDS);
  return KNOWLEDGE_KINDS.map((kind) => ({
    kind,
    origin: kind === "build" ? "starter" : catalog.has(kind) ? "catalog" : "release",
    tools: DEDICATED_TOOLS[kind] ?? [],
  }));
}
