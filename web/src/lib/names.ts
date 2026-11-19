import { agreedCatalog } from "@kb/completion-rollup";
import type { EdgeKind } from "@kb/edges";
import { agreedObjectNames } from "@kb/object-spawns";
import { agreedItemNames, type ItemFacts } from "@kb/item-page";
import { agreedNpcNames, agreedQuestTitles, type WorldFacts } from "@kb/world-pages";
import type { FactNames } from "./character-facts";
import type { StoredFact } from "./private-sync-store";
import { RECHECK_SCOPES } from "./recheck-scopes";
import { loadItemFacts, loadWorldFacts } from "./rollup-compute";
import { uploadStore } from "./upload-store";

/*
 * What an id is called: the one policy for every module that names items, NPCs, objects, quests, spells and
 * completion entries (docs/DATA_POLICY.md has the rules this follows).
 *
 * AGREED names live here, in names.ts: the name 3 distinct installs report alike (the kb `agreed*` rules, with the
 * recheck cutoffs), and the completion catalog's agreed entries. Every surface may use them, and the API
 * (/api/suggest), the MCP server, the bulk export and the embeddable cards use only them. This file never imports
 * the private game-file store or the shown names.
 *
 * SHOWN names live in shown-item-names.ts: what a database page prints. The agreed name first; else, for items, the
 * game files where the Warcraft Wiki agrees (or the files alone, unconfirmed); for NPCs, one or two installs'
 * unanimous name where it matches a Warcraft Wiki NPC name; for quests, the game files' or wiki's title; spell
 * names from the game files. Objects have agreed names only. Item, NPC, quest and spell names beyond the agreed
 * ones come from the private store and are for pages only: server-rendered pages, the site's own /search and
 * /search/suggest, and the site's hover cards, never the API, MCP or bulk export (the asset test in the talents folder checks).
 *
 * The game assets module is the only reader of the private bucket (wiki-entity-names.ts parses its NPC file through
 * it). This file does not spell out its path: that test is a plain text search, and names.ts serves the API.
 * The old module paths (shown-search-names, wiki-names, item-icons, character-facts-names) keep their exports.
 */

/**
 * Names players agree on (3 installs, as on the pages themselves), by id, for lists that would
 * otherwise print "Item 1234". Built once per corpus version: the fact arrays are the memo keys, and
 * they are replaced whenever the corpus reloads.
 */
export interface Names {
  items: Map<number, string>;
  npcs: Map<number, string>;
  objects: Map<number, string>;
  quests: Map<number, string>;
}

const NO_OBJECTS: never[] = [];
const memo = new WeakMap<object, Map<number, string>>();
function once(key: object, build: () => Map<number, string>): Map<number, string> {
  let known = memo.get(key);
  if (!known) { known = build(); memo.set(key, known); }
  return known;
}

export const itemNames = (facts: Pick<ItemFacts, "names">) => once(facts.names, () => agreedItemNames(facts));
export const npcNames = (facts: Pick<WorldFacts, "npcs">) => once(facts.npcs, () => agreedNpcNames(facts));
export const objectNames = (facts: Pick<ItemFacts, "objects">) => once(facts.objects ?? NO_OBJECTS, () => agreedObjectNames(facts.objects ?? [], RECHECK_SCOPES));
export const questTitles = (facts: Pick<WorldFacts, "quests">) => once(facts.quests, () => agreedQuestTitles(facts));

/** All four name sets; empty when the store cannot be read (callers then print ids, never guesses). */
export async function loadNames(itemsRead: ReturnType<typeof loadItemFacts> = loadItemFacts(), worldRead: ReturnType<typeof loadWorldFacts> = loadWorldFacts()): Promise<Names> {
  const [items, world] = await Promise.all([itemsRead, worldRead]);
  return {
    items: items.unreachable ? new Map() : itemNames(items),
    npcs: world.unreachable ? new Map() : npcNames(world),
    objects: items.unreachable ? new Map() : objectNames(items),
    quests: world.unreachable ? new Map() : questTitles(world),
  };
}

/** The agreed name of a relation's target, for the item, NPC, object and quest kinds; other kinds have none yet. */
export function nameOf(names: Names): (kind: EdgeKind, id: number) => string | undefined {
  return (kind, id) => (kind === "item" ? names.items : kind === "npc" ? names.npcs : kind === "object" ? names.objects : kind === "quest" ? names.quests : undefined)?.get(id);
}

const byName =new WeakMap<Map<number, string>, Map<string, number[]>>();

/** Who holds an exact name (case-insensitive): nobody, exactly one entity, or two or more. */
export type NameMatch = { kind: "missing" } | { kind: "unique"; id: number } | { kind: "ambiguous" };

export function matchName(names: Map<number, string>, name: string): NameMatch {
  let index = byName.get(names);
  if (!index) {
    index = new Map();
    for (const [id, n] of names) {
      const key = n.trim().toLowerCase();
      index.set(key, [...(index.get(key) ?? []), id]);
    }
    byName.set(names, index);
  }
  const ids = index.get(name.trim().toLowerCase()) ?? [];
  return ids.length === 0 ? { kind: "missing" } : ids.length === 1 ? { kind: "unique", id: ids[0]! } : { kind: "ambiguous" };
}

/** The id of the one entity with this exact name (case-insensitive); null when none or when two share it. */
export function idForName(names: Map<number, string>, name: string): number | null {
  const match = matchName(names, name);
  return match.kind === "unique" ? match.id : null;
}

/**
 * The names a character's synced facts are shown with, read only when it has synced titles: the agreed completion
 * catalog. A read that fails leaves the titles out, so a slow store never takes the page down. Server only.
 */
export async function loadFactNames(facts: readonly StoredFact[]): Promise<FactNames> {
  const catalog = facts.some((f) => f.category === "achievements")
    ? await uploadStore.loadCompletion().then((read) => (read.state ? agreedCatalog(read.state) : null)).catch(() => null)
    : null;
  return { catalog };
}
