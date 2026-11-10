import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { CLIENT_FACTIONS } from "@/data/game-data/client-factions";
import { CLIENT_TITLES } from "@/data/game-data/client-titles";
import { achievementHref, factionHref, titleDisplayName, titleHref } from "./completion-lists";
import { instanceHref, instanceRows } from "./instances";
import { isIndexable, loreForEntity, UNAVAILABLE, type LoreMatch, type LorePage, type LoreType, type Unavailable } from "./lore";
import { itemNames, matchName, npcNames, objectNames, questTitles } from "./names";
import { loadItemFacts, loadWorldFacts } from "./rollup-compute";
import { publicZones, zoneHref } from "./zones";

/**
 * The links between a database page and its lore page, in both directions, under one rule: a Warcraft Wiki copy
 * and a database page stand for each other when the copy's name is exactly the one name the database knows for
 * exactly one page of that kind, and the copy's archive type is the one that kind uses. The database page asks the
 * archive for the copy and links it only if the copy, read the other way (`databaseLink`), points back at the
 * same page, so the two directions cannot disagree. A name two database pages share, or one that fits two kinds
 * under the same archive type, is no link: a wrong link is worse than none. Nor is any name while one of the kinds
 * that could claim it cannot be read: the kind left out might hold it too.
 *
 * Every kind uses the same exact-name test over its own names: NPCs, items, quests and objects over the names players
 * agreed on (3 installs), zones and instances over the names the game files give them, factions, titles and
 * achievements over the names of the game files' lists. No id is guessed and nothing is matched by words. The same
 * rule decides which wiki copies ask to be indexed and are listed in /lore-sitemap.xml (`loreStanding`).
 */

/** The archive source whose copies link database pages, and are indexed only when they do. */
export const WIKI_SOURCE = "warcraft-wiki-2023";

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
/** The lore types a database page can stand for. */
export const LINKED_TYPES = Object.keys(KINDS_OF_TYPE) as LoreType[];
/** Whether the page's name is one players agreed on, so the lore page may say players recorded it (objects say less). */
export const agreedKind = (kind: DatabaseKind): boolean => kind === "npc" || kind === "item" || kind === "quest";

/**
 * The names of every kind a lore page can be matched to, by id. A kind the caller did not need is empty; a kind
 * that could not be read is null, and no lore page of its type links anything until it can.
 */
export type NameSet = Map<number, string> | null;
export interface LinkNames {
  npcs: NameSet;
  items: NameSet;
  quests: NameSet;
  objects: NameSet;
  zones: NameSet;
  instances: NameSet;
  factions: NameSet;
  titles: NameSet;
  achievements: NameSet;
}
const SET_OF = {
  npc: "npcs", item: "items", quest: "quests", object: "objects", zone: "zones", instance: "instances",
  faction: "factions", title: "titles", achievement: "achievements",
} as const satisfies Record<DatabaseKind, keyof LinkNames>;

/** Every name the kinds of a lore type hold (the names its pages could link by); null while any of them cannot be read. */
export function namesOfType(type: LoreType, sets: LinkNames): string[] | null {
  const out: string[] = [];
  for (const kind of KINDS_OF_TYPE[type] ?? []) {
    const names = sets[SET_OF[kind]];
    if (!names) return null;
    out.push(...names.values());
  }
  return out;
}

type StaticNames = Pick<LinkNames, "zones" | "instances" | "factions" | "titles" | "achievements">;
let fixed: StaticNames | null = null;

/** A game-file list that cannot be read is unreadable (no link for its type) rather than failing the page. */
function fromFiles(read: () => [number, string][]): NameSet {
  try { return new Map(read()); } catch { return null; }
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
 * The names a lore page of this type is matched against; `"all"` for every type at once (the lore sitemap). Only
 * what the type needs is read: the agreed NPC and quest names from the world facts, the agreed item and object names
 * from the item facts, nothing from storage for a zone. Facts that cannot be read leave their names null.
 */
export async function loadLinkNames(type: LoreType | null | "all"): Promise<LinkNames> {
  const none = new Map<number, string>();
  const [world, items] = await Promise.all([
    type === "npc" || type === "quest" || type === "all" ? loadWorldFacts() : null,
    type === "item" || type === "other" || type === "all" ? loadItemFacts() : null,
  ]);
  const read = <F extends { unreachable?: boolean }>(facts: F | null, names: (f: F) => Map<number, string>): NameSet =>
    !facts ? none : facts.unreachable ? null : names(facts);
  return {
    npcs: read(world, npcNames), quests: read(world, questTitles),
    items: read(items, itemNames), objects: read(items, objectNames),
    ...staticNames(),
  };
}

export interface DatabaseLink { kind: DatabaseKind; id: number; name: string }

/** The database kinds a lore page could stand for: none unless it is a typed Warcraft Wiki copy. */
const kindsOf = (page: { sourceId: string; type: LoreType | null }): DatabaseKind[] =>
  page.sourceId === WIKI_SOURCE && page.type ? KINDS_OF_TYPE[page.type] ?? [] : [];

/**
 * The one database page a lore page stands for, or null. A Warcraft Wiki copy only (the archive's own entries
 * have no type), and only when exactly one kind of the page's type has exactly one page with that name, no kind of
 * that type has the name twice, and every kind of that type could be read.
 */
export function databaseLink(page: { sourceId: string; type: LoreType | null; name: string }, sets: LinkNames): DatabaseLink | null {
  const found: DatabaseLink[] = [];
  for (const kind of kindsOf(page)) {
    const names = sets[SET_OF[kind]];
    if (!names) return null;
    const match = matchName(names, page.name);
    if (match.kind === "ambiguous") return null;
    if (match.kind === "unique") found.push({ kind, id: match.id, name: names.get(match.id) ?? page.name });
  }
  return found.length === 1 ? found[0]! : null;
}

/**
 * Whether a lore page asks to be indexed: long enough and not a redirect, and, for a Warcraft Wiki copy, linked to a
 * database page. Everloot's own entries keep the length rule alone.
 */
export const loreIndexable = (page: Pick<LorePage, "sourceId" | "body">, linked: boolean): boolean =>
  isIndexable(page.body) && (page.sourceId !== WIKI_SOURCE || linked);

export interface LoreStanding { link: DatabaseLink | null; index: boolean }
type StandingPage = Pick<LorePage, "extId" | "sourceId" | "type" | "name" | "body">;

/**
 * The one rule for a lore page, behind its "In the Forever database" link, its robots and /lore-sitemap.xml: it links
 * the database page it stands for (`databaseLink`) when it is also the archive's one usable page of its name and type
 * (`only`: the extId `loreForEntity` answers, the lookup the database pages make), and a wiki copy asks to be indexed
 * exactly when it links. `body` may be the first `LORE_HEAD` characters only (what the sitemap reads). `sets` is null
 * when the page could stand for nothing, so no names were read.
 */
export function loreStanding(page: StandingPage, only: string | null, sets: LinkNames | null): LoreStanding {
  const link = sets && only === page.extId ? databaseLink(page, sets) : null;
  return { link, index: loreIndexable(page, link !== null) };
}

/** `loreStanding` for a lore page being served: names and the archive are read only when it could link. */
export async function loreStandingFor(page: StandingPage): Promise<LoreStanding> {
  const sets = kindsOf(page).length > 0 ? await loadLinkNames(page.type) : null;
  const only = sets && page.type && databaseLink(page, sets) ? await loreForEntity(page.type, page.name) : null;
  return loreStanding(page, only && only !== UNAVAILABLE ? only.extId : null, sets);
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
  // The archive is asked only for a name that stands for this page, read from the wiki's side (`databaseLink`).
  const own = databaseLink({ sourceId: WIKI_SOURCE, type, name: clean }, names);
  if (own?.kind !== kind || own.id !== id) return null;
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
  const wiki = matchName(wikiItemNames(matched), shown.name);
  if (!names.items || matchName(names.items, shown.name).kind !== "missing" || wiki.kind !== "unique" || wiki.id !== id) return null;
  const match = await loreForEntity("item", shown.name);
  return match !== null && match !== UNAVAILABLE && match.sourceId !== WIKI_SOURCE ? null : match;
}
