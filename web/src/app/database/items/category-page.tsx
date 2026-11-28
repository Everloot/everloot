import type { Metadata } from "next";
import { cache } from "react";
import { trailFor } from "@/lib/breadcrumbs";
import { isDevelopmentItemName } from "@kb/dev-item-names";
import Link from "@/components/Link";
import { notFound, permanentRedirect } from "next/navigation";
import { describe, filterItems, QUALITIES, resolveClass, resolveLegacyClass, resolveSubclass, slotOf, type ItemClass, type ItemRow, type ItemSubclass } from "@kb/item-taxonomy";
import { matchItemNames,
  activeFilters, BINDINGS, CLIENT_TAXONOMY as T, categoryNamedEnough, categoryQuery, developmentLeftovers, itemFacetCounts, itemFacets, ITEM_LEVEL_BRACKETS, itemsHref,
  listItems, matchingItems, NAME_FROM, slotOrder, SOURCES, shownItemName, subclassLabel, toggled, UNRECORDED, type CategoryQuery, type ItemSort, type NameSource,
} from "@/lib/items";
import { itemListIndex, loadListNames, loadListSeen } from "@/lib/item-view";
import { pageMetadata } from "@/lib/seo";
import EdgeDegraded from "@/components/EdgeDegraded";
import { loadItemLevels, loadItemTips, loadSiteAssets, unknownItemIcon } from "@/lib/game-assets";
import { loadItemIcons } from "@/lib/item-icons";
import { classLabel, hasClassContext, parseClassContext, withClassContext, withoutClassContext } from "@/lib/class-context";
import ClassContextChip from "@/components/classes/ClassContextChip";
import { classUse } from "@/lib/class-gear";
import { CLIENT_CLASS_GEAR } from "@/data/game-data/client-class-gear";
import Badge, { UNCONFIRMED_TITLE } from "@/components/ui/Badge";
import { Container, DataTable, DataTitle, FilterBar, filledColumns, QUALITY_TEXT, ResultStrip, qualityOf, type FilterControl, type SparseColumn, stripBelow } from "@/components/ui";
import type { Crumb } from "@/lib/jsonld";
import { LAUNCH, LAUNCH_AT, longDate } from "@/data/wow-forever";
import { Respelled, LEVEL_BRACKETS, NameCell, paged } from "../list-parts";

type Search = Record<string, string | string[] | undefined>;

/**
 * The first category URLs used the client's singular names (/database/items/weapon); they move to the plural ones
 * for good, with their filters and a class context the page can read.
 */
function legacyHref(classSlug: string, subclassKey: string | undefined, search: Search): string | null {
  const cls = resolveLegacyClass(T, classSlug);
  if (!cls) return null;
  const sub = subclassKey === undefined ? null : resolveSubclass(T, cls.id, subclassKey);
  if (subclassKey !== undefined && !sub) return null;
  const q = categoryQuery(search);
  const read = parseClassContext(search);
  return q ? withClassContext(itemsHref(cls.slug, sub?.slug, q), read.ok ? read.context : null) : null;
}

/** The class and subclass a path names (none for /database/items), and the filters; null when any part is unknown. */
function resolve(classSlug: string | undefined, subclassKey: string | undefined, search: Search): { cls: ItemClass | null; sub: ItemSubclass | null; q: CategoryQuery } | null {
  const cls = classSlug === undefined ? null : resolveClass(T, classSlug);
  if (classSlug !== undefined && !cls) return null;
  const sub = subclassKey === undefined || !cls ? null : resolveSubclass(T, cls.id, subclassKey);
  if (subclassKey !== undefined && !sub) return null;
  const q = categoryQuery(search);
  return q ? { cls, sub, q } : null;
}

const subName = (s: ItemSubclass) => s.name ?? `Subclass ${s.id}`;

/** Where a shown name comes from (DATA_POLICY, item names): in the link's hover card, and in words for a screen reader. */
export const NAME_TITLE: Record<NameSource, string> = { ...NAME_FROM, files: UNCONFIRMED_TITLE };

/**
 * The plain list, on any page, is its own canonical; a filter, a sort, a name search or a class context is noindex
 * and points its canonical at page 1 of the plain list.
 */
const isPlain = (q: CategoryQuery, search: Search) => activeFilters(q) === 0 && !q.sort && !q.per && !q.dev && !q.unnamed && !q.unknown && !hasClassContext(search);

export const ALL_ITEMS = {
  title: "WoW Forever Items by Category",
  description: "Every WoW: Forever item by class and subclass: weapons, armor, recipes, trade goods and more, with filters for slot, quality, item level and source.",
};

const pageSuffix = (page: number) => (page > 1 ? ` – Page ${page}` : "");

/** The chosen slots in words, in the character window's order: "Feet", "Hands and Feet", "Head, Hands and Feet". */
function slotWords(slugs: readonly string[] | undefined): string {
  const names = [...(slugs ?? [])].sort(slotOrder).map((slug) => {
    const row = T.items.find((r) => slotOf(r[3])?.slug === slug);
    return (row && slotOf(row[3])?.name) ?? slug;
  });
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join("");
}

export async function categoryMetadata(classSlug: string | undefined, subclassKey: string | undefined, search: Search): Promise<Metadata> {
  const r = resolve(classSlug, subclassKey, search);
  if (!r) return { robots: { index: false, follow: true } };
  const plain = isPlain(r.q, search);
  const page = plain ? r.q.page : 1;
  // A later page of the plain list is indexed like page 1: once half the rows it shows have a name. The plain
  // list shows named rows first, so its first pages fill with them; until then a page is a list of "Item N".
  const shown = plain ? await loadListNames() : null;
  const named = shown?.named ?? null;
  // The plain list leaves the development leftovers out, so its pages, count and indexing do too.
  const hidden = shown ? developmentLeftovers(T.items, (id) => shown.agreed.get(id) ?? shown.matched?.names.get(id)?.name) : undefined;
  if (!r.cls) {
    const index = plain && (page === 1 || categoryNamedEnough(undefined, undefined, named!, page, hidden));
    return {
      ...pageMetadata({ title: `${ALL_ITEMS.title}${pageSuffix(page)}`, description: ALL_ITEMS.description, path: itemsHref(undefined, undefined, { page }) }),
      ...(index ? {} : { robots: { index: false, follow: true } }),
    };
  }
  // A slot filter names its slots, so a count of plate feet never reads as every plate item.
  const slots = slotWords(r.q.slot);
  const kind = slots ? `${r.sub ? subclassLabel(r.sub).label : r.cls.label} ${slots}` : r.sub ? subclassLabel(r.sub).label : r.cls.label;
  const name = r.sub ? `${kind} (${r.cls.label})` : kind;
  // What the list under it shows: the same filters, the same development leftovers and unnamed items left out.
  const total = (await listOf(classSlug, subclassKey, search))!.rows.length;
  const count = total.toLocaleString("en-US");
  const noun = total === 1 ? "Item" : "Items";
  return {
    ...pageMetadata({
      title: `${r.sub ? `WoW Forever ${name}: ${count} ${noun}` : `WoW Forever ${name}: All ${count} ${noun}`}${pageSuffix(page)}`,
      description: `All ${count} ${name} items in WoW: Forever, with filters for slot, quality, item level, required level, binding and where players found them.`,
      path: itemsHref(r.cls.slug, r.sub?.slug, { page }),
    }),
    robots: { index: named !== null && categoryNamedEnough(r.cls.id, r.sub?.id, named, page, hidden), follow: true },
  };
}

/** The Sort menu's orders, as the columns name them, and whether each starts high to low (the numbers but the id). */
const ITEM_SORT_MENU: [ItemSort, string, boolean][] = [
  ["name", "Name", false], ["type", "Type", false], ["slot", "Slot", false], ["ilvl", "Item level", true], ["req", "Req. level", true], ["seen", "Source", false], ["id", "ID", false],
];

/** Why a row has no name, and when that changes: names come from the addon once players see the items. */
const namesArrive = () => (Date.now() < Date.parse(LAUNCH_AT) ? `Their names arrive from the addon after launch on ${longDate(LAUNCH.date)}.` : "Their names arrive from the addon as players see them.");
/** A small bordered toggle, as the filter bar's yes-only filters draw. */
const TOGGLE = "inline-flex h-6 items-center rounded-full border border-edge px-2 text-cell-2 text-fg-2 hover:border-fg-2 hover:text-fg";
const plural = (n: number) => `${n.toLocaleString("en-US")} item${n === 1 ? "" : "s"}`;
/** A level range as a menu writes it: "11–20", "81+" for the open top bracket. */
const bracket = (r: { min: number; max: number }) => (r.max >= 999 ? `${r.min}+` : r.min === r.max ? String(r.min) : `${r.min}–${r.max}`);

/**
 * The rows a category URL lists, with what the page draws them from: worked out once per request (React cache), so
 * the page and its title count the same list, under the same filters and the same unnamed-item rule.
 */
const categoryList = cache(async (classSlug: string | undefined, subclassKey: string | undefined, searchKey: string) => {
  const search = JSON.parse(searchKey) as Search;
  const r = resolve(classSlug, subclassKey, search);
  if (!r) return null;
  const { cls, sub, q } = r;
  // With a quality chosen and no order, the list reads by item level, highest first: an epic list opens on its best gear,
  // not its level-1 quest items. The URL carries no sort, so this order is the Sort menu's reset choice there. A name
  // search keeps its best-match order.
  const qualityFirst = Boolean(q.quality?.length) && !q.sort && !q.q;
  const order: CategoryQuery["sort"] = qualityFirst ? { key: "ilvl", desc: true } : q.sort;
  // A class context from a class hub narrows the list to what the class can use by the game files (lib/class-gear.ts):
  // its proficiencies, at its level when the context gives one, and each item's class mask. An item the files say
  // nothing about stays, counted.
  const read = parseClassContext(search);
  const context = read.ok ? read.context : null;
  const usable = context ? classUse(CLIENT_CLASS_GEAR, context.classSlug, context.level) : null;
  const fits = (row: ItemRow) => !usable || usable(row) !== "no";
  const base = (cls ? filterItems(T, { classId: cls.id, subclassId: sub?.id }) : T.items).filter(fits);
  // One after the other: the seen items then come from the view the names just read, not from a second read of it.
  const listNames = await loadListNames();
  const seen = await loadListSeen();
  const { showsTip } = listNames;
  // The names, the default order, the leftovers and the unnamed items, worked out once per version of the files.
  const index = itemListIndex(listNames, seen);
  const nameOf = index.name;
  // The game file name, icon and tooltip facts only for items players reported (3 installs) or the item name rule
  // names, as on the item page: a list of every id in the files must not become a list of unreleased items.
  // A level or binding filter or sort reads the levels of every row that may show them; the tooltips are this page's only.
  const levelFilter = Boolean(q.ilvl || q.req || q.bind);
  const wide = levelFilter || order?.key === "ilvl" || order?.key === "req";
  // A level or binding filter narrows the Class menu's counts too, so on a class page it reads every class's levels.
  const wideIds = wide ? (levelFilter && cls ? T.items.filter(fits) : base).map((row) => row[0]).filter(showsTip) : [];
  const wideAssets = wideIds.length ? await loadSiteAssets() : null;
  const levels = wide ? await loadItemLevels(wideAssets, wideIds) : null;
  const ctx = { name: nameOf, seen: seen.seen, sources: (id: number) => seen.from.get(id), tip: (id: number) => levels?.get(id), order: index.order };
  const match = matchItemNames(base, q, ctx);
  const listed = listItems(base, { ...q, sort: order }, ctx, match);
  // The items no source names ("Item N") are one line above the table unless asked for, in the unrecorded quality
  // view (which lists them by design) or by id; not when nothing in the list has a name (names out of reach),
  // where the line would hide the whole list. They sort last either way.
  const isNamed = (id: number) => showsTip(id);
  const idLookup = Boolean(q.q && /^#?\d+$/.test(q.q));
  const folded = !q.unnamed && !q.quality?.includes(UNRECORDED) && !idLookup && listed.some((row) => isNamed(row[0]));
  const unnamed: ReadonlySet<number> = folded ? index.unnamed : new Set();
  const rows = listed.filter((row) => !unnamed.has(row[0]));
  const unnamedCount = folded ? listed.length - rows.length : rows.filter((row) => !isNamed(row[0])).length;
  return { qualityFirst, order, usable, fits, base, listNames, seen, index, wide, wideAssets, ctx, match, folded, unnamed, rows, unnamedCount };
});
const listOf = (classSlug: string | undefined, subclassKey: string | undefined, search: Search) => categoryList(classSlug, subclassKey, JSON.stringify(search));

export async function CategoryPage({ classSlug, subclassKey, search }: { classSlug?: string; subclassKey?: string; search: Search }) {
  const r = resolve(classSlug, subclassKey, search);
  if (!r) {
    const moved = classSlug === undefined ? null : legacyHref(classSlug, subclassKey, search);
    if (moved) permanentRedirect(moved);
    notFound();
  }
  const { cls, sub, q } = r;
  // A class context from a class hub rides on every link of the list, never on its breadcrumb or canonical. It narrows
  // the list to what the class can use by the game files (lib/class-gear.ts): its proficiencies, at its level when the
  // context gives one, and each item's class mask. An item the files say nothing about stays, counted.
  const read = parseClassContext(search);
  const context = read.ok ? read.context : null;
  const link = (classSlug?: string, subclassSlug?: string, query?: Partial<CategoryQuery>) => withClassContext(itemsHref(classSlug, subclassSlug, query), context);
  const { qualityFirst, order, usable, fits, base, listNames, seen, index, wide, wideAssets, ctx, match, folded, unnamed, rows, unnamedCount } = (await listOf(classSlug, subclassKey, search))!;
  const { agreed, matched, showsTip, degraded } = listNames;
  // The development leftovers (test, placeholder and retired items) are out of the list unless asked for; the
  // menus count what the list can show, and the line above the table says how many are held back.
  const leftovers = index.leftovers;
  const gone = (id: number) => unnamed.has(id) || (!q.dev && leftovers.has(id));
  const pool = base.filter((row) => !gone(row[0]));
  // Only counted, so the rows with the leftovers are not sorted.
  const held = q.dev ? rows.filter((row) => leftovers.has(row[0])).length : matchingItems(base, { ...q, dev: true }, ctx, match).filter((row) => !unnamed.has(row[0])).length - rows.length;
  // Every menu counts what the list would hold with all the other filters on, in one pass over the items any class
  // could list; the Class and Type menus read every class, the others this page's class and type.
  const candidates = cls ? T.items.filter((row) => fits(row) && !gone(row[0])) : pool;
  const counts = itemFacetCounts(candidates, (row) => !cls || (row[1] === cls.id && (!sub || row[2] === sub.id)), q, ctx, cls && q.q ? matchItemNames(candidates, q, ctx) : match);
  // The rows a class context keeps without the files deciding, for the line under the chip.
  const undecided = usable ? rows.reduce((n, row) => n + Number(usable(row) === "unknown"), 0) : 0;
  const { shown, pages, per } = paged(rows, q);
  const shownIds = shown.map((row) => row[0]).filter(showsTip);
  // With a wide read, the manifest as that read had it (so the icon column is drawn as before); else this page's own.
  const assets = wide ? wideAssets : shownIds.length ? await loadSiteAssets() : null;
  const tips = await loadItemTips(assets, shownIds);
  const names = new Map(shown.map((row) => [row[0], shownItemName(row[0], agreed, matched?.names, tips.get(row[0]))]));
  // A named row the files give only an icon for (no tooltip) draws that icon, as its page does, not the question mark.
  const bare = shownIds.filter((id) => !tips.get(id)?.icon && names.get(id));
  const iconOnly = assets && bare.length ? await loadItemIcons(assets, bare) : new Map<number, string>();
  // The icon column, with the game's question mark where a row has no icon, only with the asset files.
  const unknownIcon = assets && shown.some((row) => tips.get(row[0])?.icon || iconOnly.has(row[0]) || !names.get(row[0])) ? unknownItemIcon(assets.base) : null;
  const here = (over: Partial<CategoryQuery>) => link(cls?.slug, sub?.slug, { ...q, page: 1, ...over });
  const title = sub ? subclassLabel(sub).label : cls ? cls.label : "Items";

  const trail: Crumb[] = [
    ...trailFor("/database/items")!,
    ...(cls ? [{ name: cls.label, path: itemsHref(cls.slug) }] : []),
    ...(cls && sub ? [{ name: subName(sub), path: itemsHref(cls.slug, sub.slug) }] : []),
  ];

  /** Where players have seen the item come from, as compact labels ("Drop, Vendor"). */
  const sourceOf = (row: ItemRow) => seen.from.get(row[0])?.map((x) => SOURCES.find((s) => s.slug === x)!.label).join(", ") ?? null;
  const columns: SparseColumn<ItemRow>[] = [
    {
      key: "name", header: "Name", sortable: true, cell: (row) => {
        const c = describe(T, row);
        const tip = tips.get(row[0]);
        const name = names.get(row[0]);
        // A shown name carries its own quality colour; otherwise the game files' quality colours the row.
        const colour = name?.color ? "" : c.quality && c.quality.id <= 5 ? QUALITY_TEXT[qualityOf(c.quality.id)] : "text-fg";
        const unconfirmed = name?.source === "files";
        // Where the name comes from is in the link's hover card (and words for a screen reader, after the link so the
        // link's text is the name alone), never a printed label; a name only the game files give carries the quiet
        // unconfirmed marker.
        return (
          <NameCell
            href={`/database/items/${row[0]}`}
            icon={unknownIcon && (tip?.icon || iconOnly.get(row[0]) || unknownIcon)}
            quality={c.quality && c.quality.id <= 5 ? qualityOf(c.quality.id) : undefined}
            tone={colour}
            style={name?.color ? { color: name.color } : undefined}
            after={name?.source === "players" && <span className="sr-only"> ({NAME_TITLE.players.toLowerCase()})</span>}
            files={unconfirmed}
          >
            {name?.name ?? `Item ${row[0]}`}
          </NameCell>
        );
      },
    },
    // What it is (type, slot), its levels from the tooltip facts, where players found it, its id.
    ...(sub ? [] : [{ key: "type", header: "Type", sortable: true, cell: (row: ItemRow) => describe(T, row).subclass?.name ?? "None" }]),
    { key: "slot", header: "Slot", sortable: true, cell: (row) => slotOf(row[3])?.name ?? <span className="text-muted">—</span> },
    // Blank for an item that shows none, and for "no required level".
    { key: "ilvl", header: "Item level", numeric: true, sortable: true, cell: (row) => tips.get(row[0])?.level || <span className="text-muted">—</span> },
    { key: "req", header: "Req. level", numeric: true, sortable: true, cell: (row) => tips.get(row[0])?.required || <span className="text-muted">—</span> },
    { key: "seen", header: "Source", sortable: true, cell: (row) => sourceOf(row) ?? <span className="text-muted">—</span>, blank: (row) => !seen.from.has(row[0]) },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (row) => row[0] },
  ];

  // Choices with their counts (counts above); a choice that matches nothing drops out of its menu unless it is on.
  const slots = counts.slot;
  const qualities = counts.quality;
  const sourceOptions = SOURCES.map((x) => ({
    label: x.menu, href: link(cls?.slug, sub?.slug, toggled(q, "src", x.slug)), on: Boolean(q.src?.includes(x.slug)),
    count: counts.src.get(x.slug) ?? 0,
  }))
    .filter((o) => o.count > 0 || o.on);
  const facets = itemFacets();
  const inBase = (set: Set<number>) => pool.reduce((n, row) => n + Number(set.has(row[0])), 0);
  const skills = facets.professions.map((p) => ({ ...p, count: counts.skill.get(p.id) ?? 0 })).filter((p) => (p.count > 0 || q.skill === p.slug) && (q.dev || !isDevelopmentItemName(p.name)));
  const slotNames = new Map(pool.map((row) => slotOf(row[3])).filter((s) => s !== null).map((s) => [s!.slug, s!.name]));
  const toggle = (key: "crafted" | "reagent" | "set" | "seen", label: string, count: number): FilterControl[] =>
    count > 0 || q[key] ? [{ type: "toggle", key, label, href: here({ [key]: q[key] ? undefined : true }), on: Boolean(q[key]) }] : [];

  const controls: FilterControl[] = [
    {
      type: "menu", key: "class", label: "Class",
      options: [
        { label: "All classes", href: link(undefined, undefined, { ...q, page: 1 }), on: !cls, reset: true, count: counts.all },
        ...T.classes.filter((c) => c.items > 0).map((c) => ({ label: c.label, href: link(c.slug, undefined, { ...q, page: 1 }), on: c.id === cls?.id, count: counts.classes.get(c.id) ?? 0 })),
      ],
    },
    ...(cls ? [{
      type: "menu" as const, key: "type", label: "Type",
      options: [
        { label: `All ${cls.label.toLowerCase()}`, href: link(cls.slug, undefined, { ...q, page: 1 }), on: !sub, reset: true, count: counts.classes.get(cls.id) ?? 0 },
        ...T.subclasses.filter((s) => s.classId === cls.id && s.items > 0).map((s) => ({ label: subclassLabel(s).label, href: link(cls.slug, s.slug, { ...q, page: 1 }), on: s.id === sub?.id, count: counts.subclasses.get(`${cls.id}/${s.id}`) ?? 0 })),
      ],
    }] : []),
    {
      type: "menu", key: "slot", label: "Slot", multi: true,
      options: [...slotNames].sort(([a], [b]) => slotOrder(a, b)).map(([slug, name]) => ({ label: name, href: link(cls?.slug, sub?.slug, toggled(q, "slot", slug)), on: Boolean(q.slot?.includes(slug)), count: slots.get(slug) ?? 0 })),
    },
    {
      type: "menu", key: "quality", label: "Quality", multi: true,
      options: [...QUALITIES.filter((x) => qualities.has(x.slug) || q.quality?.includes(x.slug)).map((x) => ({
        label: x.name, className: x.id <= 5 ? QUALITY_TEXT[qualityOf(x.id)] : undefined,
        href: link(cls?.slug, sub?.slug, toggled(q, "quality", x.slug)), on: Boolean(q.quality?.includes(x.slug)), count: qualities.get(x.slug) ?? 0,
      })), ...(qualities.has(UNRECORDED) || q.quality?.includes(UNRECORDED) ? [{
        label: "Unrecorded", href: link(cls?.slug, sub?.slug, toggled(q, "quality", UNRECORDED)), on: Boolean(q.quality?.includes(UNRECORDED)), count: qualities.get(UNRECORDED) ?? 0,
      }] : [])],
    },
    ...(sourceOptions.length ? [{ type: "menu" as const, key: "src", label: "Source", multi: true, options: sourceOptions }] : []),
    {
      type: "menu", key: "ilvl", label: "Item level",
      options: [{ label: "Any item level", href: here({ ilvl: undefined }), on: !q.ilvl, reset: true }, ...ITEM_LEVEL_BRACKETS.map((b) => ({
        label: bracket(b), href: here({ ilvl: b }), on: q.ilvl?.min === b.min && q.ilvl?.max === b.max,
      }))],
    },
    {
      type: "menu", key: "req", label: "Req. level",
      options: [{ label: "Any required level", href: here({ req: undefined }), on: !q.req, reset: true }, ...LEVEL_BRACKETS.map((b) => ({
        label: bracket(b), href: here({ req: b }), on: q.req?.min === b.min && q.req?.max === b.max,
      })),
      // A range no bracket covers (a class context's "required level 25 or lower", or one typed in) is its own choice.
      ...(q.req && !LEVEL_BRACKETS.some((b) => b.min === q.req!.min && b.max === q.req!.max) ? [{ label: bracket(q.req), href: here({}), on: true }] : [])],
    },
    {
      type: "menu", key: "bind", label: "Binding",
      options: [
        { label: "Any binding", href: here({ bind: undefined }), on: !q.bind, reset: true },
        ...BINDINGS.map((b) => ({ label: b.label, href: here({ bind: b.slug }), on: q.bind === b.slug })),
      ],
    },
    ...(skills.length ? [{
      type: "menu" as const, key: "skill", label: "Profession",
      options: [
        { label: "Any profession", href: here({ skill: undefined }), on: !q.skill, reset: true },
        ...skills.map((p) => ({ label: p.name, href: here({ skill: p.slug }), on: q.skill === p.slug, count: p.count })),
      ],
    }] : []),
    ...toggle("crafted", "Crafted", inBase(facets.crafted)),
    ...toggle("reagent", "Reagent", inBase(facets.reagent)),
    ...toggle("set", "Set piece", inBase(facets.set)),
    ...toggle("seen", "Seen by players", seen.seen.size),
    {
      // The headers sort too; on a phone, where only the name column shows, this is the way. Each order starts as its
      // header's first click does (levels high to low); the default, named items first, is the reset choice.
      type: "menu", key: "sort", label: "Sort",
      options: [
        { label: q.quality?.length && !q.q ? "Item level, highest first" : "Named first", href: here({ sort: undefined }), on: !q.sort, reset: true },
        ...ITEM_SORT_MENU.filter(([key]) => (key !== "type" || !sub) && !(q.quality?.length && !q.q && key === "ilvl")).map(([key, label, desc]) => ({ label, href: here({ sort: { key, desc } }), on: q.sort?.key === key })),
      ],
    },
  ];
  // The name box keeps every other filter (not the page) as hidden fields.
  const keep = Object.fromEntries(new URLSearchParams(link(undefined, undefined, { ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const pageHref = (page: number) => link(cls?.slug, sub?.slug, { ...q, page });
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "item" : "items"} page={q.page} perPage={per} href={pageHref} sizeHref={(n) => link(cls?.slug, sub?.slug, { ...q, per: n, page: 1 })} label="Item pages" />;
  const active = activeFilters(q);

  const chips = [
    ...(q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : []),
    ...(q.slot ?? []).map((s) => ({ label: slotNames.get(s) ?? s, href: link(cls?.slug, sub?.slug, toggled(q, "slot", s)) })),
    ...(q.quality ?? []).map((s) => ({ label: QUALITIES.find((x) => x.slug === s)?.name ?? "Unrecorded", href: link(cls?.slug, sub?.slug, toggled(q, "quality", s)) })),
    ...(q.src ?? []).map((s) => ({ label: SOURCES.find((x) => x.slug === s)!.menu, href: link(cls?.slug, sub?.slug, toggled(q, "src", s)) })),
    ...(q.ilvl ? [{ label: `Item level ${bracket(q.ilvl)}`, href: here({ ilvl: undefined }) }] : []),
    ...(q.req ? [{ label: `Req. level ${bracket(q.req)}`, href: here({ req: undefined }) }] : []),
    ...(q.bind ? [{ label: BINDINGS.find((b) => b.slug === q.bind)?.label ?? q.bind, href: here({ bind: undefined }) }] : []),
    ...(q.skill ? [{ label: facets.professions.find((p) => p.slug === q.skill)?.name ?? q.skill, href: here({ skill: undefined }) }] : []),
    ...(q.crafted ? [{ label: "Crafted", href: here({ crafted: undefined }) }] : []),
    ...(q.reagent ? [{ label: "Reagent", href: here({ reagent: undefined }) }] : []),
    ...(q.set ? [{ label: "Set piece", href: here({ set: undefined }) }] : []),
    ...(q.seen ? [{ label: "Seen by players", href: here({ seen: undefined }) }] : []),
  ];
  // Each chip is a link to the list without that one filter.
  const chipLinks = chips.map((c) => (
    <Link key={c.href} href={c.href} className="inline-flex h-6 items-center gap-1 rounded-full border border-edge px-2 text-cell-2 text-fg-2 hover:border-fg-2 hover:text-fg">
      {c.label}<span aria-hidden="true">×</span><span className="sr-only">(remove)</span>
    </Link>
  ));
  const empty = active > 0 ? (
    <div className="flex flex-wrap items-center gap-2 py-4 text-cell text-fg-2">
      <span>No items match these filters.</span>
      {chipLinks}
      <Link href={link(cls?.slug, sub?.slug)} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Clear filters</Link>
    </div>
  ) : <p className="py-4 text-cell text-fg-2">{context ? `No items in this category a ${classLabel(context.classSlug)} can use${context.level !== undefined ? ` by level ${context.level}` : ""}.` : "No items in this category."}</p>;

  // The development leftovers and the unnamed items are held back on one line, with a toggle for each.
  const showUnnamed = unnamedCount > 0 && (folded || q.unnamed);
  const hidden = [
    held > 0 && !q.dev && "test, placeholder and retired items the game files still list",
    showUnnamed && folded && `${plural(unnamedCount)} the game files do not name yet`,
  ].filter(Boolean);
  const hiddenLine = `${hidden.length ? `Not listed: ${hidden.join(", and ")}.` : ""}${showUnnamed ? `${hidden.length ? " " : ""}${namesArrive()}` : ""}`;

  return (
    <Container width="data">
      <EdgeDegraded when={degraded || seen.unreachable} />
      <article>
        <DataTitle title={title} trail={trail} aside={strip} />
        <FilterBar
          label="Item filters"
          search={{ action: itemsHref(cls?.slug, sub?.slug), value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={controls}
          active={active}
          clearHref={link(cls?.slug, sub?.slug)}
        />
        {/* On a phone the menus fold into one "Filters (n)" button, so the filters that are on show here, each removable. */}
        {rows.length > 0 && chips.length > 0 && <p data-filter-chips className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">{chipLinks}</p>}
        <ClassContextChip read={read} here={withoutClassContext(itemsHref(cls?.slug, sub?.slug), search)}>
          {context && (
            <span>
              <Badge tone="files" />{" "}
              {`Only items a ${classLabel(context.classSlug)} can use${context.level !== undefined ? ` by level ${context.level}` : ""}: weapon and armor types from the class's proficiencies and each item's class restriction, found in game files, unconfirmed.`}
              {undecided > 0 && ` ${plural(undecided)} the files do not decide for a class (rings, relics, items with no class data) ${undecided === 1 ? "is" : "are"} kept.`}
              {context.role && " The role does not change the list."}
              {context.level !== undefined && !q.req && (
                <>
                  {" "}
                  <Link href={here({ req: { min: 1, max: context.level } })} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">
                    {`Filter to required level ${context.level} or lower`}
                  </Link>
                </>
              )}
            </span>
          )}
        </ClassContextChip>
        {q.unknown && (
          <p data-unknown-filter className="mt-2 text-cell-2 text-fg-2">
            {q.unknown.map((u) => `No such ${u.filter}: “${u.value}”.`).join(" ")} The list shows without {q.unknown.length === 1 ? "it" : "them"}.
          </p>
        )}
        {(held > 0 || showUnnamed) && (
          <p data-hidden-items className="mt-2 flex flex-wrap items-center gap-2 text-cell-2 text-muted">
            <span>{hiddenLine}</span>
            {held > 0 && (
              <Link href={here({ dev: q.dev ? undefined : true })} className={TOGGLE}>
                {q.dev ? "Hide" : "Show"} {held.toLocaleString("en-US")} development {held === 1 ? "leftover" : "leftovers"}
              </Link>
            )}
            {showUnnamed && (
              <Link href={here({ unnamed: q.unnamed ? undefined : true })} className={TOGGLE}>
                {`${q.unnamed ? "Hide the" : "Show"} ${unnamedCount.toLocaleString("en-US")} unnamed ${unnamedCount === 1 ? "item" : "items"}`}
              </Link>
            )}
          </p>
        )}
        {match.respelled && rows.length > 0 && <Respelled q={match.respelled} />}
        {/* The order a quality filter brings is named, since a phone shows only the name column and no header arrow. */}
        {qualityFirst && rows.length > 1 && <p data-sort-note className="mt-2 text-cell-2 text-muted">Sorted by item level, highest first.</p>}
        {/* Where wiki names come from, once for the page rather than under every row it names. */}
        {shown.some((row) => names.get(row[0])?.source === "wiki") && (
          <p data-name-note className="mt-2 text-cell-2 text-muted">
            {`Names players have not confirmed yet are from the Warcraft Wiki${shown.some((row) => names.get(row[0])?.source === "files") ? "; a name marked unconfirmed is from the game files alone" : ""}.`}
          </p>
        )}
        <div className="mt-2">
          <DataTable
            dense
            caption={`${title}: ${plural(rows.length)}`}
            // A column nothing in the category has (Source, until an item the list can show has one) is left out. It is
            // read over the category, not the filtered result, so it does not come and go from page to page or under a filter.
            columns={filledColumns(columns, pool)}
            rows={shown}
            rowKey={(row) => String(row[0])}
            // The default order (named items first) is no one column, so no header shows an arrow for it.
            sort={order ? { key: order.key, direction: order.desc ? "desc" : "asc" } : undefined}
            sortHref={(key, dir) => here({ sort: { key: key as NonNullable<CategoryQuery["sort"]>["key"], desc: dir === "desc" } })}
            meta={(row) => [sub ? null : describe(T, row).subclass?.name, slotOf(row[3])?.name, tips.get(row[0])?.level ? `Item level ${tips.get(row[0])!.level}` : null, sourceOf(row)].filter(Boolean).join(" · ")}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{stripBelow(strip)}</div>}
      </article>
    </Container>
  );
}
