import { CLIENT_EDGES, CLIENT_LAYER, CLIENT_SKILLS, CLIENT_TAXONOMY } from "../../../kb/src/client-layer-file";
import { isDevelopmentItemName } from "../../../kb/src/dev-item-names";
import { describe, filterItems, QUALITIES, slotOf, slugify, type ItemRow } from "../../../kb/src/item-taxonomy";

export { CLIENT_LAYER, CLIENT_TAXONOMY };

/** Rows on one page of an item list (density spec, 2026-10-20: 50, as on Wowhead and WarcraftDB). */
export const ITEMS_PER_PAGE = 50;

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
 * order (sortItems with no sort: named rows first, each part by id), so page `page` holds the named rows left
 * after the earlier pages, then unnamed ones. No row gets a name it does not have. `hidden` rows (the
 * development leftovers) are not in the plain list, so they are not counted.
 */
export function categoryNamedEnough(classId: number | undefined, subclassId: number | undefined, named: { has(id: number): boolean }, page = 1, hidden?: { has(id: number): boolean }): boolean {
  const rows = sortItems(filterItems(CLIENT_TAXONOMY, { classId, subclassId }).filter((row) => !hidden?.has(row[0])), undefined, { name: (id) => (named.has(id) ? "" : undefined) });
  const shown = rows.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
  return shown.length > 0 && shown.filter((row) => named.has(row[0])).length / shown.length >= MIN_NAMED_SHARE;
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
/** Read once from the committed client layer: items a spell creates, items a spell uses, set pieces, and the profession of those spells. */
export function itemFacets(): Facets {
  if (facets) return facets;
  const skillOfSpell = new Map<number, number>();
  for (const e of CLIENT_EDGES) if (e.rel === "in_skill_line") skillOfSpell.set(e.fromId, e.toId);
  const crafted = new Set<number>(), reagent = new Set<number>(), set = new Set<number>();
  const bySkill = new Map<number, Set<number>>();
  for (const e of CLIENT_EDGES) {
    if (e.fromKind !== "item") continue;
    if (e.rel === "part_of_set") set.add(e.fromId);
    if (e.rel !== "created_by" && e.rel !== "reagent_for") continue;
    (e.rel === "created_by" ? crafted : reagent).add(e.fromId);
    const skill = skillOfSpell.get(e.toId);
    if (skill !== undefined) bySkill.set(skill, (bySkill.get(skill) ?? new Set()).add(e.fromId));
  }
  const professions = [...CLIENT_SKILLS].filter(([id]) => bySkill.has(id)).map(([id, name]) => ({ id, name, slug: slugify(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  facets = { crafted, reagent, set, bySkill, professions };
  return facets;
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
  /** Absent: named items first, each part by id (sortItems). */
  sort?: { key: ItemSort; desc: boolean };
  page: number;
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

/** A comma list where every value is known, in the known values' order; null when one is not. */
function list(raw: string | undefined, known: readonly string[]): string[] | undefined | null {
  if (raw === undefined) return undefined;
  const values = raw.split(",").filter(Boolean);
  if (!values.length || values.some((v) => !known.includes(v))) return null;
  return known.filter((k) => values.includes(k));
}

/** The list filters from the query string; an unknown value is null (the page answers 404 rather than guess). */
export function categoryQuery(search: Record<string, string | string[] | undefined>): CategoryQuery | null {
  const one = (k: string) => (typeof search[k] === "string" ? (search[k] as string) : undefined);
  const flag = (k: string): boolean | undefined | null => { const v = one(k); return v === undefined ? undefined : v === "1" ? true : null; };
  const slot = list(one("slot"), SLOT_SLUGS);
  const quality = list(one("quality"), [...QUALITY_SLUGS, UNRECORDED]);
  const src = list(one("src"), SOURCE_SLUGS) as SourceSlug[] | undefined | null;
  const crafted = flag("crafted"), reagent = flag("reagent"), set = flag("set"), seen = flag("seen"), dev = flag("dev"), unnamed = flag("unnamed");
  const skill = one("skill"), sort = one("sort"), page = one("page");
  const ilvl = levels(one("ilvl")), req = levels(one("req")), bind = one("bind");
  if (slot === null || quality === null || src === null || crafted === null || reagent === null || set === null || seen === null || dev === null || unnamed === null || ilvl === null || req === null) return null;
  if (skill !== undefined && !itemFacets().professions.some((p) => p.slug === skill)) return null;
  if (bind !== undefined && !BINDING_SLUGS.includes(bind)) return null;
  const sorted = sort === undefined ? undefined : /^(-?)([a-z]+)$/.exec(sort);
  if (sort !== undefined && (!sorted || !(ITEM_SORTS as readonly string[]).includes(sorted[2]))) return null;
  if (page !== undefined && !/^[1-9]\d{0,4}$/.test(page)) return null;
  const text = one("q")?.trim().slice(0, 60);
  return {
    ...(text ? { q: text } : {}),
    ...(slot ? { slot } : {}), ...(quality ? { quality } : {}), ...(src ? { src } : {}),
    ...(crafted ? { crafted } : {}), ...(reagent ? { reagent } : {}), ...(set ? { set } : {}), ...(seen ? { seen } : {}), ...(dev ? { dev } : {}), ...(unnamed ? { unnamed } : {}),
    ...(skill ? { skill } : {}),
    ...(ilvl ? { ilvl } : {}), ...(req ? { req } : {}), ...(bind ? { bind } : {}),
    ...(sorted ? { sort: { key: sorted[2] as ItemSort, desc: sorted[1] === "-" } } : {}),
    page: page === undefined ? 1 : Number(page),
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

/** Rows of a category (`base`) that pass every filter, in the query's order. */
export function listItems(base: readonly ItemRow[], q: CategoryQuery, ctx: ItemListContext = {}): ItemRow[] {
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const rows = base.filter(([itemId, , , inv, quality]) => {
    if (text && !(id !== null ? itemId === id : ctx.name?.(itemId)?.toLowerCase().includes(text))) return false;
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
  return sortItems(rows, q.sort, ctx);
}

/**
 * Text keys sort A to Z and levels low to high, with the rows that have none last, whichever way; ties go by id.
 * With no sort, items with a name the page shows come first, each part by id, so a list opens on real items
 * rather than "Item N"; `sort=id` is the plain id order. categoryNamedEnough reads this order.
 */
export function sortItems(rows: ItemRow[], sort: CategoryQuery["sort"], ctx: ItemListContext = {}): ItemRow[] {
  if (!sort && ctx.name) return [...rows.filter((row) => ctx.name!(row[0]) !== undefined), ...rows.filter((row) => ctx.name!(row[0]) === undefined)];
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
