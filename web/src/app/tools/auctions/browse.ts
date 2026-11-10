import type { AuctionHouse } from "@everloot/protocol";
import { QUALITIES, resolveClass, resolveSubclass, slotOf, type ItemClass, type ItemRow, type ItemSubclass } from "../../../../../kb/src/item-taxonomy";
import { CLIENT_TAXONOMY as T } from "@/lib/items";
import { HOUSES, houseParam, houseSlug, priceMove, type MarketRow, type Move } from "@/lib/auction-house";
import { rulesetParam, type RulesetSlug } from "@/lib/realms";

/**
 * The Auction House's browse view: the category tree (the game's own: class, then subclass, then slot for
 * armour), the filters in the URL, and the sorted, paged results. Pure, so the pages and the tests share it.
 */

export const AH_PER_PAGE = 50;

/** The browse tab's categories in the game's order; another class with prices follows them. */
export const AH_CLASS_ORDER = [2, 4, 1, 0, 7, 6, 11, 9, 5, 15];
/** Only armour splits by slot under its subclass, as the game's tree does. */
const SLOTTED_CLASS = 4;

export const AH_SORTS = ["name", "ilvl", "req", "market", "min", "units", "listings", "change"] as const;
export type AhSort = (typeof AH_SORTS)[number];
/** Most units listed first, as the boards always were. */
export const DEFAULT_SORT = { key: "units" as AhSort, desc: true };

export interface AhQuery {
  /** Name contains, or an item id. */
  q?: string;
  house: AuctionHouse | null;
  /** The ruleset tab on the all-realms page; absent is every realm. */
  ruleset?: RulesetSlug;
  cls?: ItemClass;
  sub?: ItemSubclass;
  slot?: string;
  quality?: string;
  /** Required level range, as the game's level boxes filter. */
  lvl?: { min: number; max: number };
  /** Only items with a week's move, the biggest first unless another sort is asked. */
  moved?: boolean;
  sort?: { key: AhSort; desc: boolean };
  page: number;
}

type Search = Record<string, string | string[] | undefined>;
const one = (search: Search, k: string) => (typeof search[k] === "string" ? (search[k] as string) : undefined);

/** `10-20` or `12`, levels 1 to 999; null when malformed. */
function levels(raw: string | undefined): { min: number; max: number } | undefined | null {
  if (raw === undefined) return undefined;
  const m = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(raw);
  const min = Number(m?.[1]), max = Number(m?.[2] ?? m?.[1]);
  return m && min >= 1 && min <= max ? { min, max } : null;
}
const levelsParam = (r?: { min: number; max: number }) => (r ? (r.min === r.max ? String(r.min) : `${r.min}-${r.max}`) : undefined);

/** The browse filters from the query string; null when a value is not one (the page answers 404 rather than guess). */
export function ahQuery(search: Search): AhQuery | null {
  const house = houseParam(one(search, "house"));
  if (house === undefined) return null;
  const ruleset = rulesetParam(one(search, "ruleset"));
  if (ruleset === undefined) return null;
  const clsSlug = one(search, "class"), subSlug = one(search, "sub"), slot = one(search, "slot"), quality = one(search, "quality");
  const cls = clsSlug === undefined ? undefined : resolveClass(T, clsSlug);
  if (cls === null || (subSlug !== undefined && !cls)) return null;
  const sub = subSlug === undefined || !cls ? undefined : resolveSubclass(T, cls.id, subSlug);
  if (sub === null || (sub && sub.slug !== subSlug)) return null;
  if (slot !== undefined && (!sub || cls!.id !== SLOTTED_CLASS || !T.items.some((r) => r[1] === cls!.id && r[2] === sub.id && slotOf(r[3])?.slug === slot))) return null;
  if (quality !== undefined && !QUALITIES.some((x) => x.slug === quality)) return null;
  const lvl = levels(one(search, "lvl"));
  if (lvl === null) return null;
  const moved = one(search, "moved");
  if (moved !== undefined && moved !== "1") return null;
  const sort = one(search, "sort"), page = one(search, "page");
  const sorted = sort === undefined ? undefined : /^(-?)([a-z]+)$/.exec(sort);
  if (sort !== undefined && (!sorted || !(AH_SORTS as readonly string[]).includes(sorted[2]))) return null;
  if (page !== undefined && !/^[1-9]\d{0,4}$/.test(page)) return null;
  const q = one(search, "q")?.trim().slice(0, 60);
  return {
    ...(q ? { q } : {}), house, ...(ruleset ? { ruleset } : {}),
    ...(cls ? { cls } : {}), ...(sub ? { sub } : {}), ...(slot ? { slot } : {}), ...(quality ? { quality } : {}),
    ...(lvl ? { lvl } : {}), ...(moved ? { moved: true } : {}),
    ...(sorted ? { sort: { key: sorted[2] as AhSort, desc: sorted[1] === "-" } } : {}),
    page: page === undefined ? 1 : Number(page),
  };
}

/** A browse URL with its parameters in one fixed order, so a view has one URL. */
export function ahHref(path: string, q: Partial<AhQuery>): string {
  const params = new URLSearchParams();
  if (q.q) params.set("q", q.q);
  if (q.house) params.set("house", houseSlug(q.house));
  if (q.ruleset) params.set("ruleset", q.ruleset);
  if (q.cls) params.set("class", q.cls.slug);
  if (q.cls && q.sub) params.set("sub", q.sub.slug);
  if (q.cls && q.sub && q.slot) params.set("slot", q.slot);
  if (q.quality) params.set("quality", q.quality);
  if (q.lvl) params.set("lvl", levelsParam(q.lvl)!);
  if (q.moved) params.set("moved", "1");
  if (q.sort) params.set("sort", `${q.sort.desc ? "-" : ""}${q.sort.key}`);
  if (q.page && q.page > 1) params.set("page", String(q.page));
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

/** How many filters are on (the house, the ruleset tab, the sort and the page are not filters). */
export const activeFilters = (q: AhQuery) =>
  Number(Boolean(q.q)) + Number(Boolean(q.cls)) + Number(Boolean(q.quality)) + Number(Boolean(q.lvl)) + Number(Boolean(q.moved));

/* ---------- The category join ---------- */

let byId: Map<number, ItemRow> | null = null;
/** An item's class, subclass, slot and quality from the game files; undefined for an id the build does not have. */
export function categoryRow(itemId: number): ItemRow | undefined {
  byId ??= new Map(T.items.map((r) => [r[0], r]));
  return byId.get(itemId);
}

/** Whether an item sits in the query's category (class, then subclass, then slot). */
export function inCategory(itemId: number, q: Pick<AhQuery, "cls" | "sub" | "slot">): boolean {
  if (!q.cls) return true;
  const row = categoryRow(itemId);
  if (!row || row[1] !== q.cls.id) return false;
  if (q.sub && row[2] !== q.sub.id) return false;
  return !q.slot || slotOf(row[3])?.slug === q.slot;
}

export interface TreeNode { key: string; label: string; href: string; count: number; on: boolean; children?: TreeNode[] }

/**
 * The left-hand tree: the game's classes (always, with their counts), the open class's subclasses that have
 * prices, and for armour the open subclass's slots. Each link keeps the other filters and goes back to page 1.
 */
export function categoryTree(rows: readonly MarketRow[], q: AhQuery, path: string): TreeNode[] {
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const id of new Set(rows.map((r) => r.value.itemId))) {
    const row = categoryRow(id);
    if (!row) continue;
    bump(`${row[1]}`);
    bump(`${row[1]}:${row[2]}`);
    const slot = slotOf(row[3]);
    if (slot) bump(`${row[1]}:${row[2]}:${slot.slug}`);
  }
  const keep = { ...q, cls: undefined, sub: undefined, slot: undefined, page: 1 };
  const classIds = [...AH_CLASS_ORDER, ...T.classes.map((c) => c.id).filter((id) => !AH_CLASS_ORDER.includes(id) && counts.has(`${id}`))];
  return classIds
    .map((id) => T.classes.find((c) => c.id === id))
    .filter((c): c is ItemClass => Boolean(c))
    .map((c) => {
      const open = q.cls?.id === c.id;
      const children = open
        ? T.subclasses.filter((s) => s.classId === c.id && (counts.has(`${c.id}:${s.id}`) || q.sub?.id === s.id)).map((s): TreeNode => {
          const subOpen = q.sub?.id === s.id;
          // The subclass's slots in the game's slot order (robes sit with chest pieces).
          const slotNames = new Map<string, { name: string; order: number }>();
          if (subOpen && c.id === SLOTTED_CLASS) {
            for (const r of T.items) {
              const x = r[1] === c.id && r[2] === s.id ? slotOf(r[3]) : null;
              if (x) slotNames.set(x.slug, { name: x.name, order: Math.min(slotNames.get(x.slug)?.order ?? Infinity, x.inventoryType) });
            }
          }
          const slots = [...slotNames]
            .sort((a, b) => a[1].order - b[1].order)
            .filter(([slug]) => counts.has(`${c.id}:${s.id}:${slug}`) || q.slot === slug)
            .map(([slug, { name }]): TreeNode => ({
              key: `${c.id}:${s.id}:${slug}`, label: name, href: ahHref(path, { ...keep, cls: c, sub: s, slot: slug }),
              count: counts.get(`${c.id}:${s.id}:${slug}`) ?? 0, on: q.slot === slug,
            }));
          return {
            key: `${c.id}:${s.id}`, label: s.name ?? `Subclass ${s.id}`, href: ahHref(path, { ...keep, cls: c, sub: s }),
            count: counts.get(`${c.id}:${s.id}`) ?? 0, on: subOpen && !q.slot, ...(slots.length ? { children: slots } : {}),
          };
        })
        : undefined;
      return {
        key: `${c.id}`, label: c.label, href: ahHref(path, { ...keep, cls: c }), count: counts.get(`${c.id}`) ?? 0,
        on: open && !q.sub, ...(children?.length ? { children } : {}),
      };
    });
}

/* ---------- Filtering and sorting ---------- */

export interface BrowseRow { row: MarketRow; move: Move | null }

export interface BrowseContext {
  now: Date;
  /** The name the page shows for an item, if any. */
  name: (id: number) => string | undefined;
  /** Item level and required level from the tooltip facts the page may show (0: none). */
  levels: (id: number) => { level: number; required: number } | undefined;
}

const within = (value: number | undefined, r: { min: number; max: number }) => value !== undefined && value >= r.min && value <= r.max;

/** The rows that pass every filter, in the query's order. Rows with no value for the sort key go last either way. */
export function browseRows(rows: readonly MarketRow[], q: AhQuery, ctx: BrowseContext): BrowseRow[] {
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const kept: BrowseRow[] = [];
  for (const row of rows) {
    const itemId = row.value.itemId;
    if (text && !(id !== null ? itemId === id : ctx.name(itemId)?.toLowerCase().includes(text))) continue;
    if (!inCategory(itemId, q)) continue;
    if (q.quality) {
      const quality = categoryRow(itemId)?.[4];
      if (quality === undefined || quality === null || QUALITIES[quality]?.slug !== q.quality) continue;
    }
    if (q.lvl && !within(ctx.levels(itemId)?.required, q.lvl)) continue;
    const move = priceMove(row, 7, ctx.now);
    if (q.moved && !move) continue;
    kept.push({ row, move });
  }
  const sort = q.sort ?? (q.moved ? { key: "change" as AhSort, desc: true } : DEFAULT_SORT);
  const key = (b: BrowseRow): string | number | null => {
    const v = b.row.value;
    switch (sort.key) {
      case "name": return ctx.name(v.itemId)?.toLowerCase() ?? null;
      case "ilvl": return ctx.levels(v.itemId)?.level || null;
      case "req": return ctx.levels(v.itemId)?.required || null;
      case "market": return v.market;
      case "min": return v.min;
      case "units": return v.quantity;
      case "listings": return b.row.listings;
      // How far the price moved either way: "changed most" first when descending.
      case "change": return b.move ? Math.abs(b.move.change) : null;
    }
  };
  const dir = sort.desc ? -1 : 1;
  const tie = (a: BrowseRow, b: BrowseRow) => a.row.value.itemId - b.row.value.itemId || a.row.realm.name.localeCompare(b.row.realm.name)
    || HOUSES.indexOf(a.row.house) - HOUSES.indexOf(b.row.house);
  return kept.map((b) => ({ b, k: key(b) })).sort((x, y) => {
    if (x.k === null || y.k === null) return x.k === y.k ? tie(x.b, y.b) : x.k === null ? 1 : -1;
    const c = typeof x.k === "number" && typeof y.k === "number" ? x.k - y.k : String(x.k).localeCompare(String(y.k));
    return c * dir || tie(x.b, y.b);
  }).map((x) => x.b);
}
