import type { Metadata } from "next";
import { isDevelopmentItemName } from "../../../../../kb/src/dev-item-names";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { describe, filterItems, QUALITIES, resolveClass, resolveLegacyClass, resolveSubclass, slotOf, type ItemClass, type ItemRow, type ItemSubclass } from "../../../../../kb/src/item-taxonomy";
import {
  activeFilters, BINDINGS, CLIENT_TAXONOMY as T, categoryNamedEnough, categoryQuery, developmentLeftovers, itemFacets, ITEM_LEVEL_BRACKETS, ITEMS_PER_PAGE, itemsHref,
  listItems, NAME_FROM, SOURCES, shownItemName, subclassLabel, toggled, UNRECORDED, type CategoryQuery, type NameSource,
} from "@/lib/items";
import { loadItemSeen } from "@/lib/item-seen";
import { pageMetadata } from "@/lib/seo";
import { loadShownNames } from "@/lib/shown-item-names";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import GameIcon from "@/components/game/GameIcon";
import Badge, { UNCONFIRMED_TITLE } from "@/components/ui/Badge";
import { Container, DataTable, DataTitle, FilterBar, filledColumns, QUALITY_TEXT, ResultStrip, qualityOf, type FilterControl, type SparseColumn } from "@/components/ui";
import type { Crumb } from "@/lib/jsonld";
import { LAUNCH, LAUNCH_AT, longDate } from "@/data/wow-forever";
import { LEVEL_BRACKETS } from "../list-parts";

type Search = Record<string, string | string[] | undefined>;

/** The first category URLs used the client's singular names (/database/items/weapon); they move to the plural ones for good. */
function legacyHref(classSlug: string, subclassKey: string | undefined, search: Search): string | null {
  const cls = resolveLegacyClass(T, classSlug);
  if (!cls) return null;
  const sub = subclassKey === undefined ? null : resolveSubclass(T, cls.id, subclassKey);
  if (subclassKey !== undefined && !sub) return null;
  const q = categoryQuery(search);
  return q ? itemsHref(cls.slug, sub?.slug, q) : null;
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
 * The plain list, on any page, is its own canonical; a filter, a sort or a name search is noindex and points
 * its canonical at page 1 of the plain list.
 */
const isPlain = (q: CategoryQuery) => activeFilters(q) === 0 && !q.sort && !q.dev && !q.unnamed;

export const ALL_ITEMS = {
  title: "WoW Forever Items by Category",
  description: "Every WoW: Forever item by class and subclass: weapons, armor, recipes, trade goods and more, with filters for slot, quality, item level and source.",
};

const pageSuffix = (page: number) => (page > 1 ? ` – Page ${page}` : "");

export async function categoryMetadata(classSlug: string | undefined, subclassKey: string | undefined, search: Search): Promise<Metadata> {
  const r = resolve(classSlug, subclassKey, search);
  if (!r) return { robots: { index: false, follow: true } };
  const plain = isPlain(r.q);
  const page = plain ? r.q.page : 1;
  // A later page of the plain list is indexed like page 1: once half the rows it shows have a name. The plain
  // list shows named rows first, so its first pages fill with them; until then a page is a list of "Item N".
  const shown = plain ? await loadShownNames() : null;
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
  const name = r.sub ? `${subclassLabel(r.sub).label} (${r.cls.label})` : r.cls.label;
  const count = ((r.sub ? r.sub.items : r.cls.items) - (hidden ? filterItems(T, { classId: r.cls.id, subclassId: r.sub?.id }).filter((row) => hidden.has(row[0])).length : 0)).toLocaleString("en-US");
  return {
    ...pageMetadata({
      title: `${r.sub ? `WoW Forever ${name}: ${count} Items` : `WoW Forever ${name}: All ${count} Items`}${pageSuffix(page)}`,
      description: `All ${count} ${name} items in WoW: Forever, with filters for slot, quality, item level, required level, binding and where players found them.`,
      path: itemsHref(r.cls.slug, r.sub?.slug, { page }),
    }),
    robots: { index: named !== null && categoryNamedEnough(r.cls.id, r.sub?.id, named, page, hidden), follow: true },
  };
}

/** Why a row has no name, and when that changes: names come from the addon once players see the items. */
const namesArrive = () => (Date.now() < Date.parse(LAUNCH_AT) ? `Their names arrive from the addon after launch on ${longDate(LAUNCH.date)}.` : "Their names arrive from the addon as players see them.");
const plural = (n: number) => `${n.toLocaleString("en-US")} item${n === 1 ? "" : "s"}`;
/** A level range as a menu writes it: "11–20", "81+" for the open top bracket. */
const bracket = (r: { min: number; max: number }) => (r.max >= 999 ? `${r.min}+` : r.min === r.max ? String(r.min) : `${r.min}–${r.max}`);

export async function CategoryPage({ classSlug, subclassKey, search }: { classSlug?: string; subclassKey?: string; search: Search }) {
  const r = resolve(classSlug, subclassKey, search);
  if (!r) {
    const moved = classSlug === undefined ? null : legacyHref(classSlug, subclassKey, search);
    if (moved) permanentRedirect(moved);
    notFound();
  }
  const { cls, sub, q } = r;
  const base = cls ? filterItems(T, { classId: cls.id, subclassId: sub?.id }) : T.items;
  const [{ agreed, matched, showsTip }, seen] = await Promise.all([loadShownNames(), loadItemSeen()]);
  const nameOf = (id: number) => agreed.get(id) ?? matched?.names.get(id)?.name;
  // The game file name, icon and tooltip facts only for items players reported (3 installs) or the item name rule
  // names, as on the item page: a list of every id in the files must not become a list of unreleased items.
  const tipsFor = async (ids: number[]) => loadItemTips(ids.length ? await loadSiteAssets() : null, ids);
  // A level or binding filter or sort reads the facts of every row that may show them; otherwise only this page's.
  const wide = Boolean(q.ilvl || q.req || q.bind) || q.sort?.key === "ilvl" || q.sort?.key === "req";
  const every = wide ? await tipsFor(base.map((row) => row[0]).filter(showsTip)) : null;
  const ctx = { name: nameOf, seen: seen.seen, sources: (id: number) => seen.from.get(id), tip: (id: number) => every?.get(id) };
  const listed = listItems(base, q, ctx);
  // The items no source names ("Item N") are one line above the table unless asked for, in the unrecorded quality
  // view (which lists them by design) or by id; not when nothing in the list has a name (names out of reach),
  // where the line would hide the whole list. They sort last either way.
  const isNamed = (id: number) => showsTip(id);
  const idLookup = Boolean(q.q && /^#?\d+$/.test(q.q));
  const folded = !q.unnamed && !q.quality?.includes(UNRECORDED) && !idLookup && listed.some((row) => isNamed(row[0]));
  const unnamed = new Set(folded ? T.items.filter((row) => !isNamed(row[0])).map((row) => row[0]) : []);
  const rows = listed.filter((row) => !unnamed.has(row[0]));
  const unnamedCount = folded ? listed.length - rows.length : rows.filter((row) => !isNamed(row[0])).length;
  // The development leftovers (test, placeholder and retired items) are out of the list unless asked for; the
  // menus count what the list can show, and the line above the table says how many are held back.
  const leftovers = developmentLeftovers(T.items, nameOf);
  const gone = (id: number) => unnamed.has(id) || (!q.dev && leftovers.has(id));
  const pool = base.filter((row) => !gone(row[0]));
  const held = q.dev ? rows.filter((row) => leftovers.has(row[0])).length : listItems(base, { ...q, dev: true }, ctx).filter((row) => !unnamed.has(row[0])).length - rows.length;
  const hiddenIn = (classId?: number, subclassId?: number) => T.items.reduce((n, row) => n + Number((classId === undefined || (row[1] === classId && (subclassId === undefined || row[2] === subclassId))) && gone(row[0])), 0);
  const pages = Math.max(1, Math.ceil(rows.length / ITEMS_PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * ITEMS_PER_PAGE, q.page * ITEMS_PER_PAGE);
  const tips = every ?? await tipsFor(shown.map((row) => row[0]).filter(showsTip));
  const names = new Map(shown.map((row) => [row[0], shownItemName(row[0], agreed, matched?.names, tips.get(row[0]))]));
  const icons = shown.some((row) => tips.get(row[0])?.icon || !names.get(row[0]));
  const here = (over: Partial<CategoryQuery>) => itemsHref(cls?.slug, sub?.slug, { ...q, page: 1, ...over });
  const title = sub ? subclassLabel(sub).label : cls ? cls.label : "Items";

  const trail: Crumb[] = [
    { name: "Home", path: "/" },
    { name: "Database", path: "/database" },
    { name: "Items", path: "/database/items" },
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
        return (
          <span className="flex min-w-0 items-center gap-2">
            {icons && (tip?.icon
              ? <GameIcon src={tip.icon} size={24} />
              : name
                ? <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-sm border border-line" />
                // No name from any source: the same empty tile with a question mark, so a run of ids reads as unknown, not broken.
                : <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-line bg-panel text-cell-2 text-muted">?</span>)}
            {/* Where the name comes from is in the link's hover card (and words for a screen reader, after the link so the
                link's text is the name alone), never a printed label; a name only the game files give carries the
                quiet unconfirmed marker. */}
            <Link href={`/database/items/${row[0]}`} className={`min-w-0 ${colour} hover:underline underline-offset-4`} style={name?.color ? { color: name.color } : undefined}>
              {name?.name ?? `Item ${row[0]}`}
            </Link>
            {name && name.source !== "files" && <span className="sr-only"> ({NAME_TITLE[name.source].toLowerCase()})</span>}
            {unconfirmed && <Badge tone="files" />}
          </span>
        );
      },
    },
    // Levels from the tooltip facts: blank for an item that shows none, and for "no required level".
    { key: "ilvl", header: "Item level", numeric: true, sortable: true, cell: (row) => tips.get(row[0])?.level || <span className="text-muted">—</span> },
    { key: "req", header: "Req. level", numeric: true, sortable: true, cell: (row) => tips.get(row[0])?.required || <span className="text-muted">—</span> },
    ...(sub ? [] : [{ key: "type", header: "Type", sortable: true, cell: (row: ItemRow) => describe(T, row).subclass?.name ?? "None" }]),
    { key: "slot", header: "Slot", sortable: true, cell: (row) => slotOf(row[3])?.name ?? <span className="text-muted">—</span> },
    { key: "seen", header: "Source", sortable: true, cell: (row) => sourceOf(row) ?? <span className="text-muted">—</span>, blank: (row) => !seen.from.has(row[0]) },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (row) => row[0] },
  ];

  // Choices with their counts in this category, so a menu never offers an empty list.
  const counted = <K,>(key: (row: ItemRow) => K) => { const m = new Map<K, number>(); for (const row of pool) m.set(key(row), (m.get(key(row)) ?? 0) + 1); return m; };
  const slots = counted((row) => slotOf(row[3])?.slug ?? null);
  const qualities = counted((row) => (row[4] === null ? UNRECORDED : QUALITIES[row[4]]?.slug ?? UNRECORDED));
  const sourceOptions = SOURCES.map((x) => ({
    label: x.menu, href: itemsHref(cls?.slug, sub?.slug, toggled(q, "src", x.slug)), on: Boolean(q.src?.includes(x.slug)),
    count: pool.reduce((n, row) => n + Number(seen.from.get(row[0])?.includes(x.slug) ?? false), 0),
  }))
    .filter((o) => o.count > 0 || o.on);
  const facets = itemFacets();
  const inBase = (set: Set<number>) => pool.reduce((n, row) => n + Number(set.has(row[0])), 0);
  const skills = facets.professions.map((p) => ({ ...p, count: inBase(facets.bySkill.get(p.id)!) })).filter((p) => p.count > 0 && (q.dev || !isDevelopmentItemName(p.name)));
  const slotNames = new Map(pool.map((row) => slotOf(row[3])).filter((s) => s !== null).map((s) => [s!.slug, s!.name]));
  const toggle = (key: "crafted" | "reagent" | "set" | "seen", label: string, count: number): FilterControl[] =>
    count > 0 || q[key] ? [{ type: "toggle", key, label, href: here({ [key]: q[key] ? undefined : true }), on: Boolean(q[key]) }] : [];

  const controls: FilterControl[] = [
    {
      type: "menu", key: "class", label: "Class",
      options: [
        { label: "All classes", href: itemsHref(undefined, undefined, { ...q, page: 1 }), on: !cls, reset: true, count: T.items.length - hiddenIn() },
        ...T.classes.filter((c) => c.items > 0).map((c) => ({ label: c.label, href: itemsHref(c.slug, undefined, { ...q, page: 1 }), on: c.id === cls?.id, count: c.items - hiddenIn(c.id) })),
      ],
    },
    ...(cls ? [{
      type: "menu" as const, key: "type", label: "Type",
      options: [
        { label: `All ${cls.label.toLowerCase()}`, href: itemsHref(cls.slug, undefined, { ...q, page: 1 }), on: !sub, reset: true, count: cls.items - hiddenIn(cls.id) },
        ...T.subclasses.filter((s) => s.classId === cls.id && s.items > 0).map((s) => ({ label: subclassLabel(s).label, href: itemsHref(cls.slug, s.slug, { ...q, page: 1 }), on: s.id === sub?.id, count: s.items - hiddenIn(cls.id, s.id) })),
      ],
    }] : []),
    {
      type: "menu", key: "slot", label: "Slot", multi: true,
      options: [...slotNames].map(([slug, name]) => ({ label: name, href: itemsHref(cls?.slug, sub?.slug, toggled(q, "slot", slug)), on: Boolean(q.slot?.includes(slug)), count: slots.get(slug) ?? 0 })),
    },
    {
      type: "menu", key: "quality", label: "Quality", multi: true,
      options: [...QUALITIES.filter((x) => qualities.has(x.slug)).map((x) => ({
        label: x.name, className: x.id <= 5 ? QUALITY_TEXT[qualityOf(x.id)] : undefined,
        href: itemsHref(cls?.slug, sub?.slug, toggled(q, "quality", x.slug)), on: Boolean(q.quality?.includes(x.slug)), count: qualities.get(x.slug) ?? 0,
      })), ...(qualities.has(UNRECORDED) ? [{
        label: "Unrecorded", href: itemsHref(cls?.slug, sub?.slug, toggled(q, "quality", UNRECORDED)), on: Boolean(q.quality?.includes(UNRECORDED)), count: qualities.get(UNRECORDED) ?? 0,
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
      }))],
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
  ];
  // The name box keeps every other filter (not the page) as hidden fields.
  const keep = Object.fromEntries(new URLSearchParams(itemsHref(undefined, undefined, { ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const pageHref = (page: number) => itemsHref(cls?.slug, sub?.slug, { ...q, page });
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "item" : "items"} page={q.page} perPage={ITEMS_PER_PAGE} href={pageHref} label="Item pages" />;
  const active = activeFilters(q);

  const chips = [
    ...(q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : []),
    ...(q.slot ?? []).map((s) => ({ label: slotNames.get(s) ?? s, href: itemsHref(cls?.slug, sub?.slug, toggled(q, "slot", s)) })),
    ...(q.quality ?? []).map((s) => ({ label: QUALITIES.find((x) => x.slug === s)?.name ?? "Unrecorded", href: itemsHref(cls?.slug, sub?.slug, toggled(q, "quality", s)) })),
    ...(q.src ?? []).map((s) => ({ label: SOURCES.find((x) => x.slug === s)!.menu, href: itemsHref(cls?.slug, sub?.slug, toggled(q, "src", s)) })),
    ...(q.ilvl ? [{ label: `Item level ${bracket(q.ilvl)}`, href: here({ ilvl: undefined }) }] : []),
    ...(q.req ? [{ label: `Req. level ${bracket(q.req)}`, href: here({ req: undefined }) }] : []),
    ...(q.bind ? [{ label: BINDINGS.find((b) => b.slug === q.bind)?.label ?? q.bind, href: here({ bind: undefined }) }] : []),
    ...(q.skill ? [{ label: facets.professions.find((p) => p.slug === q.skill)?.name ?? q.skill, href: here({ skill: undefined }) }] : []),
    ...(q.crafted ? [{ label: "Crafted", href: here({ crafted: undefined }) }] : []),
    ...(q.reagent ? [{ label: "Reagent", href: here({ reagent: undefined }) }] : []),
    ...(q.set ? [{ label: "Set piece", href: here({ set: undefined }) }] : []),
    ...(q.seen ? [{ label: "Seen by players", href: here({ seen: undefined }) }] : []),
  ];
  const empty = active > 0 ? (
    <div className="flex flex-wrap items-center gap-2 py-4 text-cell text-fg-2">
      <span>No items match these filters.</span>
      {chips.map((c) => (
        <Link key={c.href} href={c.href} className="inline-flex h-6 items-center gap-1 rounded-full border border-edge px-2 text-cell-2 text-fg-2 hover:border-fg-2 hover:text-fg">
          {c.label}<span aria-hidden="true">×</span><span className="sr-only">(remove)</span>
        </Link>
      ))}
      <Link href={itemsHref(cls?.slug, sub?.slug)} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Clear filters</Link>
    </div>
  ) : <p className="py-4 text-cell text-fg-2">No items in this category.</p>;

  return (
    <Container width="data">
      <article>
        <DataTitle title={title} trail={trail} aside={strip} />
        <FilterBar
          label="Item filters"
          search={{ action: itemsHref(cls?.slug, sub?.slug), value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={controls}
          active={active}
          clearHref={itemsHref(cls?.slug, sub?.slug)}
        />
        {held > 0 && (
          <p className="mt-2 text-cell-2 text-muted">
            <Link href={here({ dev: q.dev ? undefined : true })} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">
              {q.dev ? "Hide" : "Show"} {held.toLocaleString("en-US")} development {held === 1 ? "leftover" : "leftovers"}
            </Link>
            {" "}
            {q.dev ? "Test, placeholder and retired items the game files still list are in the list." : "Test, placeholder and retired items the game files still list stay out of it."}
          </p>
        )}
        {unnamedCount > 0 && (folded || q.unnamed) && (
          <p className="mt-2 text-cell-2 text-muted">
            {folded ? `${unnamedCount.toLocaleString("en-US")} ${unnamedCount === 1 ? "item" : "items"} the game files do not name yet. ` : ""}
            {namesArrive()}{" "}
            <Link href={here({ unnamed: q.unnamed ? undefined : true })} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">
              {q.unnamed ? `Hide the ${unnamedCount.toLocaleString("en-US")} unnamed ${unnamedCount === 1 ? "item" : "items"}` : "Show them"}
            </Link>
          </p>
        )}
        <div className="mt-2">
          <DataTable
            dense
            caption={`${title}: ${plural(rows.length)}`}
            // A column with nothing in the whole result (Source, before anyone reports one) is left out.
            columns={filledColumns(columns, rows)}
            rows={shown}
            rowKey={(row) => String(row[0])}
            // The default order (named items first) is no one column, so no header shows an arrow for it.
            sort={q.sort ? { key: q.sort.key, direction: q.sort.desc ? "desc" : "asc" } : undefined}
            sortHref={(key, dir) => here({ sort: { key: key as NonNullable<CategoryQuery["sort"]>["key"], desc: dir === "desc" } })}
            meta={(row) => [tips.get(row[0])?.level ? `Item level ${tips.get(row[0])!.level}` : null, slotOf(row[3])?.name, sub ? null : describe(T, row).subclass?.name, sourceOf(row)].filter(Boolean).join(" · ")}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
