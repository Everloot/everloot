import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { CLIENT_FACTIONS } from "@/data/game-data/client-factions";
import { CLIENT_TITLES } from "@/data/game-data/client-titles";
import { achievementHref, factionHref, titleDisplayName, titleHref } from "./completion-lists";
import { instanceHref, instanceRows } from "./instances";
import { loreForEntity, UNAVAILABLE, type LoreMatch, type LoreType, type Unavailable } from "./lore";
import { foreverMatch, WIKI_SOURCE, type ForeverKind } from "./lore-forever";
import { idForName, loadNames, objectNames, type Names } from "./names";
import { loadItemFacts } from "./rollup-compute";
import { publicZones, zoneHref } from "./zones";

/**
 * The links between a database page and its lore page, in both directions, under one rule: a Warcraft Wiki copy
 * and a database page stand for each other when the copy's name is exactly the one name the database knows for
 * exactly one page of that kind, and the copy's archive type is the one that kind uses. The database page asks the
 * archive for the copy and links it only if the copy, read the other way (`databaseLink`), points back at the
 * same page, so the two directions cannot disagree. A name two database pages share, or one that fits two kinds
 * under the same archive type, is no link: a wrong link is worse than none.
 *
 * NPCs, items and quests use `foreverMatch` (lib/lore-forever.ts), the rule that also decides which copies are
 * indexed. The other kinds use the same exact-name test over their own names: objects over the names players agreed
 * on (3 installs), zones and instances over the names the game files give them, factions, titles and achievements
 * over the names of the game files' lists. No id is guessed and nothing is matched by words.
 */

/** The archive type each database kind's lore pages carry (the wiki files an object, faction, title or achievement under none of its own). */
export const LORE_TYPE = {
  npc: "npc", item: "item", quest: "quest", object: "other", zone: "zone", instance: "zone",
  faction: "other", title: "other", achievement: "other",
} as const satisfies Record<string, LoreType>;
export type DatabaseKind = keyof typeof LORE_TYPE;

/** How a lore page names the database page it links: "See the NPC page". */
export const KIND_LABEL: Record<DatabaseKind, string> = {
  npc: "NPC", item: "item", quest: "quest", object: "object", zone: "zone", instance: "instance",
  faction: "faction", title: "title", achievement: "achievement",
};

/** The database kinds a lore page of a type could stand for. */
const KINDS_OF_TYPE: Partial<Record<LoreType, DatabaseKind[]>> = {
  npc: ["npc"], item: ["item"], quest: ["quest"], zone: ["zone", "instance"], other: ["object", "faction", "title", "achievement"],
};
const FOREVER: readonly DatabaseKind[] = ["npc", "item", "quest"];
/** Whether the page's name is one players agreed on (the kinds `foreverMatch` covers), so it may say players recorded it. */
export const agreedKind = (kind: DatabaseKind): kind is ForeverKind => FOREVER.includes(kind);

/** The names of every kind a lore page can be matched to, by id; a kind the caller did not need is empty. */
export interface LinkNames extends Names {
  zones: Map<number, string>;
  instances: Map<number, string>;
  factions: Map<number, string>;
  titles: Map<number, string>;
  achievements: Map<number, string>;
}
const SET_OF = {
  npc: "npcs", item: "items", quest: "quests", object: "objects", zone: "zones", instance: "instances",
  faction: "factions", title: "titles", achievement: "achievements",
} as const satisfies Record<DatabaseKind, keyof LinkNames>;

type StaticNames = Pick<LinkNames, "zones" | "instances" | "factions" | "titles" | "achievements">;
let fixed: StaticNames | null = null;

/** A game-file list that cannot be read adds no names (no link) rather than failing the page. */
function fromFiles(read: () => [number, string][]): Map<number, string> {
  try { return new Map(read()); } catch { return new Map(); }
}

/** The names the game files give zones, instances, factions, titles and achievements; static, so built once. */
function staticNames(): StaticNames {
  fixed ??= {
    zones: fromFiles(() => publicZones().map((z) => [z.mapId, z.name])),
    instances: fromFiles(() => [...instanceRows()].flatMap(([id, row]) => (row.name ? [[id, row.name] as [number, string]] : []))),
    factions: fromFiles(() => CLIENT_FACTIONS.factions.filter((f) => f.shown).map((f) => [f.id, f.name])),
    titles: fromFiles(() => CLIENT_TITLES.titles.map((t) => [t.id, titleDisplayName(t.name)])),
    achievements: fromFiles(() => Object.entries(CLIENT_ACHIEVEMENTS.achievements).filter(([, a]) => !a.statistic).map(([id, a]) => [Number(id), a.title])),
  };
  return fixed;
}

/**
 * The names a lore page of this type is matched against. Only what the type needs is read: the agreed NPC, item and
 * quest names for those types, the agreed object names for `other`, nothing from storage for a zone.
 */
export async function loadLinkNames(type: LoreType | null): Promise<LinkNames> {
  const none = new Map<number, string>();
  const base: LinkNames = { items: none, npcs: none, quests: none, objects: none, ...staticNames() };
  if (type === "npc" || type === "item" || type === "quest") return { ...base, ...(await loadNames()) };
  if (type === "other") {
    const items = await loadItemFacts();
    return { ...base, objects: items.unreachable ? none : objectNames(items) };
  }
  return base;
}

export interface DatabaseLink { kind: DatabaseKind; id: number; name: string }

/**
 * The one database page a lore page stands for, or null. A Warcraft Wiki copy only (the archive's own entries
 * have no type), and only when exactly one kind of the page's type has exactly one page with that name.
 */
export function databaseLink(page: { sourceId: string; type: LoreType | null; name: string }, sets: LinkNames): DatabaseLink | null {
  if (page.sourceId !== WIKI_SOURCE || !page.type) return null;
  const found: DatabaseLink[] = [];
  for (const kind of KINDS_OF_TYPE[page.type] ?? []) {
    const names = sets[SET_OF[kind]];
    const id = agreedKind(kind) ? foreverMatch(page, sets)?.id ?? null : idForName(names, page.name);
    if (id !== null) found.push({ kind, id, name: names.get(id) ?? page.name });
  }
  return found.length === 1 ? found[0]! : null;
}

/**
 * The database page a lore page links, for the page itself. `databaseLink` plus the archive's half of the rule the
 * database pages apply: the archive has exactly one page of this name and type (`loreForEntity`, the same indexed
 * lookup), and it is this one. Two copies of one name stand for no database page, from either side.
 */
export async function loreLinkFor(page: { extId: string; sourceId: string; type: LoreType | null; name: string }): Promise<DatabaseLink | null> {
  const link = databaseLink(page, await loadLinkNames(page.type));
  if (!link || !page.type) return null;
  const only = await loreForEntity(page.type, page.name);
  return only !== null && only !== UNAVAILABLE && only.extId === page.extId ? link : null;
}

/** Where a database page is. Zones, instances, factions, titles and achievements carry their name in the path. */
export function databaseHref(link: DatabaseLink): string {
  switch (link.kind) {
    case "npc": return `/database/npcs/${link.id}`;
    case "item": return `/database/items/${link.id}`;
    case "quest": return `/database/quests/${link.id}`;
    case "object": return `/database/objects/${link.id}`;
    case "zone": return zoneHref(link.id, link.name);
    case "instance": return instanceHref(link.id, link.name);
    case "faction": return factionHref(link.id, link.name);
    case "title": return titleHref(link.id, link.name);
    case "achievement": return achievementHref(link.id, link.name);
  }
}

/**
 * The lore page a database page may link, or null. The name must be this page's alone (no other page of its kind
 * shares it) before the archive is asked, the archive must have exactly one page of that name and type, and that
 * page must lead back here. `sets` is for callers that already hold the names.
 */
export async function loreFor(kind: DatabaseKind, id: number, name: string | null | undefined, sets?: LinkNames): Promise<LoreMatch | null | Unavailable> {
  const clean = name?.trim();
  if (!clean) return null;
  const type = LORE_TYPE[kind];
  const names = sets ?? await loadLinkNames(type);
  if (idForName(names[SET_OF[kind]], clean) !== id) return null;
  const match = await loreForEntity(type, clean);
  if (match === null || match === UNAVAILABLE) return match;
  const back = databaseLink({ sourceId: match.sourceId, type, name: match.name }, names);
  return back?.kind === kind && back.id === id ? match : null;
}

type WikiNames = ReadonlyMap<number, { name: string; source?: "wiki" | "files" }>;
const wikiNamed = new WeakMap<object, Map<number, string>>();

/** The names the Warcraft Wiki supplies for items, by id (not the game files' own), built once per names file. */
function wikiItemNames(matched: WikiNames): Map<number, string> {
  let known = wikiNamed.get(matched);
  if (!known) {
    known = new Map([...matched].filter(([, n]) => n.source === "wiki").map(([id, n]) => [id, n.name]));
    wikiNamed.set(matched, known);
  }
  return known;
}

/**
 * The lore page for an item by the name its page shows. A name players agreed on follows `loreFor`. A name from the
 * Warcraft Wiki (nobody has reported the item yet) links the page of exactly that name when no item has it as an
 * agreed name and no other item carries it from the wiki; the lore page does not link back until players agree on
 * the name, since it would say players recorded an item nobody has reported. A name from the game files links nothing.
 */
export async function loreForShownItem(
  id: number,
  shown: { name: string; source: "players" | "wiki" | "files" } | null,
  matched: WikiNames | null | undefined,
  sets?: LinkNames,
): Promise<LoreMatch | null | Unavailable> {
  if (!shown || shown.source === "files") return null;
  if (shown.source === "players") return loreFor("item", id, shown.name, sets);
  if (!matched) return null;
  const names = sets ?? await loadLinkNames("item");
  if (idForName(names.items, shown.name) !== null || idForName(wikiItemNames(matched), shown.name) !== id) return null;
  const match = await loreForEntity("item", shown.name);
  return match !== null && match !== UNAVAILABLE && match.sourceId !== WIKI_SOURCE ? null : match;
}
