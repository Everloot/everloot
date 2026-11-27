import { isDevelopmentItemName } from "@kb/dev-item-names";
import { describe, filterItems, QUALITIES, slotOf, slugify, type ItemRow, type Taxonomy } from "@kb/item-taxonomy";
import facetsFile from "@/data/game-data/item-facets.json";
import { byRank, nameMatches, PER_PAGE } from "@/app/database/list-parts";
import { itemTaxonomy } from "@/lib/item-categories";
import { parsePer, perParam } from "@/lib/page-size";

/**
 * The client layer's item taxonomy, equal to `CLIENT_TAXONOMY` from `@kb/client-layer-file` but read from the 0.2 MB
 * item-categories cut: the item lists and search load this module, and the whole layer is 2.9 MB of JSON and about
 * 20 MB of a Worker isolate's 128 MB. Pages that need the layer's relations import `@kb/client-layer-file` themselves.
 */
export const CLIENT_TAXONOMY: Taxonomy = itemTaxonomy();

/**
 * A page of a category stays out of search (noindex, and out of the sitemap) until at least this share of the
 * rows it shows has a name. A page of "Item 1234" rows is thin, and search engines judge the whole site by it.
 */
export const MIN_NAMED_SHARE = 0.5;

/** Where a shown item name comes from, in the words each page writes beside it. */
export const NAME_SOURCE = {
  players: "Confirmed by players",
  wiki: "Game files + Warcraft Wiki",
  files: "Game files, unconfirmed",
} as const;
export type NameSource = keyof typeof NAME_SOURCE;
/** Where a shown name comes from, as its tooltip says it (docs/DATA_POLICY.md); on a link, the hover card says it. */
export const NAME_FROM = { players: "Name confirmed by players", wiki: "Name from the Warcraft Wiki" } as const;
export interface ShownItemName { name: string; source: NameSource; color: string | null; wikiPage: string | null }

/**
 * The name a page shows for an item, best source first: the name 3 installs agree on; then the names file (the
 * game file name, with the wiki page where the Warcraft Wiki agrees, or the wiki's name where only it names the
 * item); then, for an item players reported, its game file name from the tooltip facts. Null when there is none:
 * the page writes "Item N".
 */
export function shownItemName(
  id: number,
  agreed: { get(id: number): string | undefined },
  matched?: { get(id: number): { name: string; color: string; wikiPage: string | null; source?: "wiki" | "files" } | undefined } | null,
  tip?: { name: string; color: string } | null,
): ShownItemName | null {
  const players = agreed.get(id), wiki = matched?.get(id);
  if (players) return { name: players, source: "players", color: tip?.color ?? wiki?.color ?? null, wikiPage: null };
  if (wiki) return { name: wiki.name, source: wiki.source ?? "wiki", color: wiki.color, wikiPage: wiki.wikiPage };
  if (tip) return { name: tip.name, source: "files", color: tip.color, wikiPage: null };
  return null;
}

/**
 * A subclass as a page labels it: the client's "(OBSOLETE)" suffix dropped, and "Other" for one the files leave
 * unnamed, never "Subclass 0". `retired` marks the buckets the hub leaves out (the class page still lists them).
 */
export function subclassLabel(s: { name: string | null }): { label: string; retired: boolean } {
  if (s.name === null) return { label: "Other", retired: true };
  const label = s.name.replace(/\s*\(OBSOLETE\)\s*$/i, "");
  return { label, retired: label !== s.name };
}

/** The ids among `rows` whose shown name is a development leftover: the rows a list hides by default. */
export function developmentLeftovers(rows: readonly ItemRow[], name: (id: number) => string | undefined): Set<number> {
  return new Set(rows.filter((row) => isDevelopmentItemName(name(row[0]))).map((row) => row[0]));
}

/**
 * Whether a page of a category's plain list has enough names to be indexed. It reads the plain list's own
 * order (sortItems with no sort: named rows first), so page `page` holds the named rows left
 * after the earlier pages, then unnamed ones. No row gets a name it does not have. `hidden` rows (the
 * development leftovers) are not in the plain list, so they are not counted.
 */
export function categoryNamedEnough(classId: number | undefined, subclassId: number | undefined, named: { has(id: number): boolean }, page = 1, hidden?: { has(id: number): boolean }): boolean {
  // Named rows come first, so only the counts matter: no sort is needed to know how many named rows a page holds.
  let rows = 0, namedRows = 0;
  for (const row of filterItems(CLIENT_TAXONOMY, { classId, subclassId })) {
    if (hidden?.has(row[0])) continue;
    rows++;
    if (named.has(row[0])) namedRows++;
  }
  const start = (page - 1) * PER_PAGE;
  const shown = Math.min(PER_PAGE, rows - start);
  return shown > 0 && Math.min(shown, Math.max(0, namedRows - start)) / shown >= MIN_NAMED_SHARE;
}

/** Slot slugs any item in the build uses, in inventory type order (robes and chest pieces share "chest"). */
export const SLOT_SLUGS: string[] = [...new Set(CLIENT_TAXONOMY.items.map((r) => slotOf(r[3])?.slug).filter((s): s is string => Boolean(s)))];
export const QUALITY_SLUGS: string[] = QUALITIES.map((q) => q.slug);
/** The quality filter also takes items whose quality the files leave unrecorded. */
export const UNRECORDED = "unrecorded";

/** The binding filter's choices, by the client's bonding enum (item-names.ts writes the same words in tooltips). */
export const BINDINGS = [
  { slug: "pickup", label: "Binds when picked up", value: 1 },
  { slug: "equip", label: "Binds when equipped", value: 2 },
  { slug: "use", label: "Binds when used", value: 3 },
  { slug: "quest", label: "Quest item", value: 4 },
  { slug: "none", label: "Not bound", value: 0 },
] as const;
const BINDING_SLUGS: string[] = BINDINGS.map((b) => b.slug);

/** Where players have seen an item come from, in the order a cell and the menu list them (the `src` filter's values). */
export const SOURCES = [
  { slug: "drop", label: "Drop", menu: "Drop" },
  { slug: "vendor", label: "Vendor", menu: "Vendor" },
  { slug: "crafted", label: "Crafted", menu: "Crafted" },
  { slug: "quest", label: "Quest", menu: "Quest reward" },
  { slug: "object", label: "Object", menu: "Container or object" },
] as const;
export type SourceSlug = (typeof SOURCES)[number]["slug"];
const SOURCE_SLUGS: string[] = SOURCES.map((x) => x.slug);

/** The item level menu's brackets; any other range still works typed into the URL. */
export const ITEM_LEVEL_BRACKETS = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 70], [71, 80], [81, 999]].map(([min, max]) => ({ min, max }));

/* ---------- What the game files say about each item: crafted, reagent, set piece, profession ---------- */

export interface Profession { id: number; name: string; slug: string }
interface Facets { crafted: Set<number>; reagent: Set<number>; set: Set<number>; bySkill: Map<number, Set<number>>; professions: Profession[] }

let facets: Facets | null = null;
/**
 * Read once from data/game-data/item-facets.json, the cut of the committed client layer's relations that
 * scripts/item-categories.mjs makes: items a spell creates, items a spell uses, set pieces, and the profession of those spells.
 */
export function itemFacets(): Facets {
  if (facets) return facets;
  const file = facetsFile as unknown as { crafted: number[]; reagent: number[]; set: number[]; skills: [number, string, number[]][] };
  const bySkill = new Map(file.skills.map(([id, , ids]) => [id, new Set(ids)]));
  const professions = file.skills.map(([id, name]) => ({ id, name, slug: slugify(name) })).sort((a, b) => a.name.localeCompare(b.name));
  facets = { crafted: new Set(file.crafted), reagent: new Set(file.reagent), set: new Set(file.set), bySkill, professions };
  return facets;
}

let skillsOf: Map<number, number[]> | null = null;
/** The other way round from `itemFacets().bySkill`, made once: each item's professions, so a list counts them in one pass. */
export function itemSkills(): Map<number, number[]> {
  if (skillsOf) return skillsOf;
  skillsOf = new Map();
  for (const [skill, ids] of itemFacets().bySkill) for (const id of ids) skillsOf.set(id, [...(skillsOf.get(id) ?? []), skill]);
  return skillsOf;
}

/* ---------- The list's query string ---------- */

export const ITEM_SORTS = ["name", "ilvl", "req", "type", "slot", "seen", "id"] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

/** Filters, sort and page of an item list; the class and subclass are in the path. */
export interface CategoryQuery {
  /** Name contains (the names a page may show), or an exact id. */
  q?: string;
  slot?: string[];
  quality?: string[];
  /** Where players have seen it come from: any of these (a public fact, so unreported items match none). */
  src?: SourceSlug[];
  crafted?: boolean;
  reagent?: boolean;
  set?: boolean;
  /** Profession slug: items its spells make or use. */
  skill?: string;
  /** Items players have reported (a public fact: name, drop, vendor or quest). */
  seen?: boolean;
  /** Item level and required level ranges, and a binding slug: from the tooltip facts, so only items that show them match. */
  ilvl?: { min: number; max: number };
  req?: { min: number; max: number };
  bind?: string;
  /** Include the development leftovers (isDevelopmentItemName), which a list hides unless asked. A view, not a filter: no count, no chip. */
  dev?: boolean;
  /** List the items no source names ("Item N") too; a list folds them into one line unless asked. Also a view, not a filter. */
  unnamed?: boolean;
  /** Absent: named items first, those players have seen leading, A to Z by name (sortItems). */
  sort?: { key: ItemSort; desc: boolean };
  /** Rows on a page when not the default (?per=, lib/page-size.ts). */
  per?: number;
  page: number;
  /**
   * Filter values the list does not know (a hand-typed or old link: ?quality=4), left out of the list and of every link
   * it writes; the page names them in a note rather than answering 404.
   */
  unknown?: { filter: string; value: string }[];
}

/** How many filters are on (the page and the sort are not filters). */
export function activeFilters(q: CategoryQuery): number {
  return Number(Boolean(q.q)) + (q.slot?.length ? 1 : 0) + (q.quality?.length ? 1 : 0) + (q.src?.length ? 1 : 0) + Number(Boolean(q.crafted)) + Number(Boolean(q.reagent))
    + Number(Boolean(q.set)) + Number(Boolean(q.skill)) + Number(Boolean(q.seen)) + Number(Boolean(q.ilvl)) + Number(Boolean(q.req)) + Number(Boolean(q.bind));
}

/** `10-20` or `12`, as the other database lists write a level range (list-parts.tsx); null when malformed. */
function levels(raw: string | undefined): { min: number; max: number } | undefined | null {
  if (raw === undefined) return undefined;
  const m = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(raw);
  const min = Number(m?.[1]), max = Number(m?.[2] ?? m?.[1]);
  return m && min >= 1 && min <= max ? { min, max } : null;
}
const levelsParam = (r?: { min: number; max: number }) => (r ? (r.min === r.max ? String(r.min) : `${r.min}-${r.max}`) : undefined);

/** The filter names a note about an unknown value uses ("No such quality: ..."). */
const FILTER_NAMES: Record<string, string> = {
  slot: "slot", quality: "quality", src: "source", skill: "profession", bind: "binding", ilvl: "item level", req: "required level",
  crafted: "crafted setting", reagent: "reagent setting", set: "set piece setting", seen: "seen by players setting",
};

/**
 * The list filters from the query string. A filter value the list does not know is left out and kept in `unknown`
 * (old or hand-typed links still show the list); a bad sort, page or page size, or a bad view flag, is null (404).
 */
export function categoryQuery(search: Record<string, string | string[] | undefined>): CategoryQuery | null {
  const one = (k: string) => (typeof search[k] === "string" ? (search[k] as string) : undefined);
  const unknown: { filter: string; value: string }[] = [];
  const miss = (k: string, value: string) => { unknown.push({ filter: FILTER_NAMES[k], value: value.slice(0, 40) }); return undefined; };
  /** A comma list's known values, in the known values' order; the rest are unknown. */
  const list = (k: string, known: readonly string[]): string[] | undefined => {
    const values = one(k)?.split(",").filter(Boolean);
    if (!values?.length) return undefined;
    for (const v of values) if (!known.includes(v)) miss(k, v);
    const kept = known.filter((v) => values.includes(v));
    return kept.length ? kept : undefined;
  };
  const view = (k: string): boolean | undefined | null => { const v = one(k); return v === undefined ? undefined : v === "1" ? true : null; };
  const flag = (k: string): boolean | undefined => { const v = one(k); return v === undefined ? undefined : v === "1" ? true : miss(k, v); };
  const range = (k: string) => { const v = one(k), r = levels(v); return r === null ? miss(k, v!) : r; };
  const slot = list("slot", SLOT_SLUGS);
  const quality = list("quality", [...QUALITY_SLUGS, UNRECORDED]);
  const src = list("src", SOURCE_SLUGS) as SourceSlug[] | undefined;
  const crafted = flag("crafted"), reagent = flag("reagent"), set = flag("set"), seen = flag("seen"), dev = view("dev"), unnamed = view("unnamed");
  const sort = one("sort"), page = one("page"), per = parsePer(one("per"));
  const ilvl = range("ilvl"), req = range("req");
  const rawSkill = one("skill"), rawBind = one("bind");
  const skill = rawSkill === undefined || itemFacets().professions.some((p) => p.slug === rawSkill) ? rawSkill : miss("skill", rawSkill);
  const bind = rawBind === undefined || BINDING_SLUGS.includes(rawBind) ? rawBind : miss("bind", rawBind);
  if (dev === null || unnamed === null) return null;
  const sorted = sort === undefined ? undefined : /^(-?)([a-z]+)$/.exec(sort);
  if (sort !== undefined && (!sorted || !(ITEM_SORTS as readonly string[]).includes(sorted[2]))) return null;
  if (page !== undefined && !/^[1-9]\d{0,4}$/.test(page)) return null;
  if (per === null) return null;
  const text = one("q")?.trim().slice(0, 60);
  return {
    ...(text ? { q: text } : {}),
    ...(slot ? { slot } : {}), ...(quality ? { quality } : {}), ...(src ? { src } : {}),
    ...(crafted ? { crafted } : {}), ...(reagent ? { reagent } : {}), ...(set ? { set } : {}), ...(seen ? { seen } : {}), ...(dev ? { dev } : {}), ...(unnamed ? { unnamed } : {}),
    ...(skill ? { skill } : {}),
    ...(ilvl ? { ilvl } : {}), ...(req ? { req } : {}), ...(bind ? { bind } : {}),
    ...(sorted ? { sort: { key: sorted[2] as ItemSort, desc: sorted[1] === "-" } } : {}),
    ...(per ? { per } : {}),
    page: page === undefined ? 1 : Number(page),
    ...(unknown.length ? { unknown } : {}),
  };
}

/** The query string of a list, in one fixed order so a view has one URL. */
export function itemsHref(classSlug?: string, subclassSlug?: string, q: Partial<CategoryQuery> = {}): string {
  const path = ["/database/items", classSlug, classSlug ? subclassSlug : undefined].filter(Boolean).join("/");
  const params = new URLSearchParams();
  if (q.q) params.set("q", q.q);
  if (q.slot?.length) params.set("slot", q.slot.join(","));
  if (q.quality?.length) params.set("quality", q.quality.join(","));
  if (q.src?.length) params.set("src", q.src.join(","));
  if (q.skill) params.set("skill", q.skill);
  if (q.crafted) params.set("crafted", "1");
  if (q.reagent) params.set("reagent", "1");
  if (q.set) params.set("set", "1");
  if (q.seen) params.set("seen", "1");
  if (q.ilvl) params.set("ilvl", levelsParam(q.ilvl)!);
  if (q.req) params.set("req", levelsParam(q.req)!);
  if (q.bind) params.set("bind", q.bind);
  if (q.dev) params.set("dev", "1");
  if (q.unnamed) params.set("unnamed", "1");
  if (q.sort) params.set("sort", `${q.sort.desc ? "-" : ""}${q.sort.key}`);
  if (perParam(q.per)) params.set("per", perParam(q.per)!);
  if (q.page && q.page > 1) params.set("page", String(q.page));
  // Commas read better in a shared link than %2C, and are safe in a query string.
  const s = params.toString().replace(/%2C/g, ",");
  return s ? `${path}?${s}` : path;
}

/** The query with one value of a multi filter switched on or off, back on page 1. */
export function toggled(q: CategoryQuery, key: "slot" | "quality" | "src", value: string): CategoryQuery {
  const now = q[key] ?? [];
  const order = key === "slot" ? SLOT_SLUGS : key === "src" ? SOURCE_SLUGS : [...QUALITY_SLUGS, UNRECORDED];
  const next = order.filter((v) => (v === value ? !now.includes(v) : now.includes(v)));
  return { ...q, [key]: next.length ? next : undefined, page: 1 };
}

/* ---------- Filtering and sorting ---------- */

/** What the list needs from the uploads and the names file; the API passes none of it. */
export interface ItemListContext {
  /** The name a page may show (players' agreed name, or the game files and wiki match). */
  name?: (id: number) => string | undefined;
  /** Items with a public fact from players. */
  seen?: { has(id: number): boolean };
  /** Where players have seen an item come from, in SOURCES order; undefined when nobody has reported one. */
  sources?: (id: number) => readonly SourceSlug[] | undefined;
  /** The tooltip facts a page may show for an item (item level, required level, binding); undefined when it shows none. */
  tip?: (id: number) => ItemLevels | undefined;
  /**
   * Each item's place in the default order, worked out once from the same `name` and `seen` (itemListIndex in
   * item-view.ts): with it, the default order places the rows instead of comparing their names.
   */
  order?: { get(id: number): number | undefined; size: number };
}

/** What the item level, required level and binding filters read: 0 is "none" for both levels. */
export interface ItemLevels { level: number; required: number; binding: number }

const within = (value: number | undefined, r: { min: number; max: number }) => value !== undefined && value >= r.min && value <= r.max;

/** The game-file filters, which the page and the API share. */
export function matchesFacets(id: number, f: Pick<CategoryQuery, "crafted" | "reagent" | "set" | "skill">): boolean {
  const x = itemFacets();
  if (f.crafted && !x.crafted.has(id)) return false;
  if (f.reagent && !x.reagent.has(id)) return false;
  if (f.set && !x.set.has(id)) return false;
  if (f.skill) {
    const p = x.professions.find((s) => s.slug === f.skill);
    if (!p || !x.bySkill.get(p.id)?.has(id)) return false;
  }
  return true;
}

/** The text of `q` as an id, or null. */
const idOf = (text: string | undefined) => (text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null);

/** The rows of `base` the query's text names (list-parts nameMatches), computed once for the list and its counts. */
export function matchItemNames(base: readonly ItemRow[], q: CategoryQuery, ctx: ItemListContext = {}): ReturnType<typeof nameMatches<ItemRow>> {
  const text = q.q?.toLowerCase();
  return nameMatches(base, text, idOf(text), (row) => ctx.name?.(row[0]));
}

/** Rows of a category (`base`) that pass every filter, in the query's order: a text's best matches first unless a sort was asked for. */
export function listItems(base: readonly ItemRow[], q: CategoryQuery, ctx: ItemListContext = {}, match = matchItemNames(base, q, ctx)): ItemRow[] {
  return byRank(sortItems(matchingItems(base, q, ctx, match), q.sort, ctx), match.ranked, Boolean(q.sort));
}

/** The rows of `base` that pass every filter, in `base`'s order: listItems before it sorts, for a page that only counts them. */
export function matchingItems(base: readonly ItemRow[], q: CategoryQuery, ctx: ItemListContext = {}, match = matchItemNames(base, q, ctx)): ItemRow[] {
  const text = q.q?.toLowerCase();
  const id = idOf(text);
  return base.filter((row) => {
    const [itemId, , , inv, quality] = row;
    if (text && !(id !== null ? itemId === id : match.ranked!.has(row))) return false;
    // A development leftover stays out unless asked for, or looked up by its id.
    if (!q.dev && id === null && isDevelopmentItemName(ctx.name?.(itemId))) return false;
    if (q.slot?.length && !q.slot.includes(slotOf(inv)?.slug ?? "")) return false;
    if (q.quality?.length && !q.quality.includes(quality === null ? UNRECORDED : QUALITIES[quality]?.slug ?? UNRECORDED)) return false;
    if (q.seen && !ctx.seen?.has(itemId)) return false;
    if (q.src?.length && !ctx.sources?.(itemId)?.some((x) => q.src!.includes(x))) return false;
    // Only an item whose facts the page shows can match these; the rest have no known value.
    const tip = q.ilvl || q.req || q.bind ? ctx.tip?.(itemId) : undefined;
    if (q.ilvl && !within(tip?.level, q.ilvl)) return false;
    if (q.req && !within(tip?.required, q.req)) return false;
    if (q.bind && (!tip || BINDINGS.find((b) => b.slug === q.bind)?.value !== tip.binding)) return false;
    return matchesFacets(itemId, q);
  });
}

/**
 * Text keys sort A to Z and levels low to high, with the rows that have none last, whichever way; ties go by id.
 * With no sort, items with a name the page shows come first, so a list opens on real items rather than "Item N":
 * the named items players have seen, then the other named items, each A to Z by name; then the unnamed ones, seen
 * first, by id. `sort=id` is the plain id order. categoryNamedEnough reads this order (only whether a row is named).
 */
export function sortItems(rows: ItemRow[], sort: CategoryQuery["sort"], ctx: ItemListContext = {}): ItemRow[] {
  if (!sort && ctx.name) {
    const placed = ctx.order ? inOrder(rows, ctx.order) : null;
    if (placed) return placed;
    const keyed = rows.map((row) => {
      const name = ctx.name!(row[0]);
      const seen = ctx.seen?.has(row[0]) ?? false;
      return { row, name: name?.toLowerCase(), tier: (name === undefined ? 2 : 0) + (seen ? 0 : 1) };
    });
    keyed.sort((a, b) => a.tier - b.tier || (a.name !== undefined && b.name !== undefined ? a.name.localeCompare(b.name) : 0) || a.row[0] - b.row[0]);
    return keyed.map((x) => x.row);
  }
  if (!sort || sort.key === "id") return sort?.desc ? [...rows].sort((a, b) => b[0] - a[0]) : rows;
  const dir = sort.desc ? -1 : 1;
  const key = (row: ItemRow): string | number | null => {
    if (sort.key === "name") return ctx.name?.(row[0])?.toLowerCase() ?? null;
    if (sort.key === "type") return describe(CLIENT_TAXONOMY, row).subclass?.name?.toLowerCase() ?? null;
    if (sort.key === "slot") return slotOf(row[3])?.name.toLowerCase() ?? null;
    if (sort.key === "ilvl") return ctx.tip?.(row[0])?.level || null;
    if (sort.key === "req") return ctx.tip?.(row[0])?.required || null;
    const from = ctx.sources?.(row[0]);
    return from?.length ? from.map((x) => SOURCES.find((s) => s.slug === x)!.label).join(", ").toLowerCase() : null;
  };
  const keyed = rows.map((row) => ({ row, k: key(row) }));
  keyed.sort((a, b) => {
    if (a.k === null || b.k === null) return a.k === b.k ? a.row[0] - b.row[0] : a.k === null ? 1 : -1;
    const c = typeof a.k === "number" && typeof b.k === "number" ? a.k - b.k : String(a.k).localeCompare(String(b.k));
    return c * dir || a.row[0] - b.row[0];
  });
  return keyed.map((x) => x.row);
}

/**
 * `rows` placed by their positions in `order`, in one pass; null when a row has no position or two share one (the
 * caller then sorts). The default order is total (ties go by id), so a subset keeps the order the whole list has.
 */
function inOrder(rows: readonly ItemRow[], order: NonNullable<ItemListContext["order"]>): ItemRow[] | null {
  const slots: (ItemRow | undefined)[] = new Array(order.size);
  for (const row of rows) {
    const at = order.get(row[0]);
    if (at === undefined || slots[at] !== undefined) return null;
    slots[at] = row;
  }
  return slots.filter((row) => row !== undefined);
}
