import type { AuctionHouse } from "@everloot/protocol";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { QUALITIES } from "../../../../../kb/src/item-taxonomy";
import { MARKET_RULE, formatCopper } from "../../../../../kb/src/market";
import { uploadStore } from "@/lib/upload-store";
import {
  Card, Container, DataTable, DataTitle, Disclosure, EmptyState, FilterBar, LinkTabs, QUALITY_TEXT, ResultStrip, qualityOf as qualityToken,
  type Column, type FilterControl,
} from "@/components/ui";
import type { Crumb } from "@/lib/jsonld";
import { trailFor } from "@/lib/breadcrumbs";
import {
  AH_PATH, HOUSES, agreementSoFar, crossRealmHref, findBoard, houseCounts, itemHref, itemIdParam, money, percent, realmBoards, realmHref, slugWords,
} from "@/lib/auction-house";
import { auctionNames, itemArt, type ItemTip } from "./art";
import {
  AH_PER_PAGE, DEFAULT_SORT, activeFilters, ahHref, ahQuery, browseRows, categoryRow, categoryTree, inCategory,
  type AhQuery, type AhSort, type BrowseRow, type TreeNode,
} from "./browse";
import { Contribute, Facts, ItemLink, Sparkline, count } from "./parts";
import TimeAgo from "./TimeAgo";

type Search = Record<string, string | string[] | undefined>;

/** The required level menu's brackets; any other range still works typed into the URL. */
const LEVEL_BRACKETS = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60]].map(([min, max]) => ({ min, max }));
const bracket = (r: { min: number; max: number }) => (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`);

/** The sorts that read the tooltip facts or names of every row, not just the page's. */
const WIDE_SORTS: AhSort[] = ["name", "ilvl", "req"];

/** Only the plain view is indexed; a filter, a house, a sort or a later page points its canonical at it. */
export const isPlainView = (q: AhQuery) => activeFilters(q) === 0 && !q.house && !q.sort && q.page === 1;

/** A house tab's item count: read out everywhere, drawn from 640 px up so the four tabs fit a phone. */
function HouseCount({ n }: { n: number }) {
  return <span data-house-count className="sr-only tabular-nums text-muted sm:not-sr-only sm:ml-1">{` (${n.toLocaleString("en-US")})`}</span>;
}

/** One category in the left tree, its open children under it. */
function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <li>
      <Link
        href={node.href}
        aria-current={node.on ? "page" : undefined}
        className={`flex min-h-7 items-center gap-2 rounded-control pr-2 text-control hover:bg-panel hover:text-fg ${node.on ? "bg-panel font-medium text-fg" : node.count ? "text-fg-2" : "text-muted"}`}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
        {node.count > 0 && <span className="tabular-nums text-muted">{node.count.toLocaleString("en-US")}</span>}
      </Link>
      {node.children && <ul>{node.children.map((c) => <TreeItem key={c.key} node={c} depth={depth + 1} />)}</ul>}
    </li>
  );
}

/**
 * The Auction House browse page, for all realms (`slug` null) or one: the house switch, the category tree with
 * the search box above it, the filters and the sortable results. Called as a function by the pages, like the
 * item lists' CategoryPage.
 */
export async function browseView({ slug, search }: { slug: string | null; search: Search }) {
  const q = ahQuery(search);
  if (!q) notFound();
  // An item id typed in the search box goes to the item's own page.
  const typedId = q.q ? itemIdParam(q.q) : null;
  if (typedId) redirect(slug ? itemHref({ slug }, typedId) : crossRealmHref(typedId));

  const path = slug ? realmHref({ slug }) : AH_PATH;
  const now = new Date();
  const market = await uploadStore.loadMarket();
  const state = market.state;
  const realmWide = state ? realmBoards(state, now) : [];
  const boards = state ? realmBoards(state, now, q.house) : [];
  const mine = slug ? boards.filter((b) => b.realm.slug === slug) : boards;
  const realmName = slug ? (findBoard(realmWide, slug)?.realm.name ?? mine[0]?.realm.name ?? slugWords(slug)) : null;
  const rows = mine.flatMap((b) => b.rows);
  const allIds = [...new Set(rows.map((r) => r.value.itemId))];

  // Names and levels for every row only when a filter or sort reads them; otherwise just the page's.
  const wide = Boolean(q.q || q.lvl) || WIDE_SORTS.includes(q.sort?.key as AhSort);
  let tips = new Map<number, ItemTip>();
  let names = new Map<number, string>();
  if (wide) {
    tips = (await itemArt(allIds)).tips;
    names = await auctionNames(allIds, tips);
  }
  const results = browseRows(rows, q, { now, name: (id) => names.get(id), levels: (id) => tips.get(id) });
  const pages = Math.max(1, Math.ceil(results.length / AH_PER_PAGE));
  if (q.page > pages) notFound();
  const shown = results.slice((q.page - 1) * AH_PER_PAGE, q.page * AH_PER_PAGE);
  if (!wide) {
    const ids = shown.map((b) => b.row.value.itemId);
    tips = (await itemArt(ids)).tips;
    names = await auctionNames(ids, tips);
  }

  const here = (over: Partial<AhQuery>) => ahHref(path, { ...q, page: 1, ...over });
  const pageHref = (page: number) => ahHref(path, { ...q, page });
  const strip = <ResultStrip total={results.length} noun={results.length === 1 ? "item" : "items"} page={q.page} perPage={AH_PER_PAGE} href={pageHref} label="Result pages" />;
  const board = slug ? findBoard(realmWide, slug) : null;
  const updated = slug ? (mine[0]?.updatedAt ?? board?.updatedAt ?? null) : market.dataAsOf ? Date.parse(market.dataAsOf) : null;
  const title = realmName ?? "Auction House";
  const trail: Crumb[] = [...trailFor(AH_PATH)!, ...(slug ? [{ name: title, path }] : [])];
  const showRealm = !slug;

  const counts = state ? houseCounts(state, now, slug ?? undefined) : new Map<AuctionHouse | null, number>();
  const houseTabs = [
    { href: here({ house: null }), label: <>All<span className="sr-only sm:not-sr-only"> houses</span><HouseCount n={counts.get(null) ?? 0} /></>, current: !q.house },
    ...HOUSES.map((h) => ({ href: here({ house: h }), label: <>{h}<HouseCount n={counts.get(h) ?? 0} /></>, current: q.house === h })),
  ];

  const inCat = rows.filter((r) => inCategory(r.value.itemId, q));
  const qualityCount = new Map<number, number>();
  for (const r of inCat) {
    const x = categoryRow(r.value.itemId)?.[4];
    if (x !== undefined && x !== null) qualityCount.set(x, (qualityCount.get(x) ?? 0) + 1);
  }
  const controls: FilterControl[] = [
    {
      type: "menu", key: "realm", label: "Realm",
      options: [
        { label: "All realms", href: ahHref(AH_PATH, { ...q, page: 1 }), on: !slug, reset: true },
        ...realmWide.map((b) => ({ label: b.realm.name, href: ahHref(realmHref(b.realm), { ...q, page: 1 }), on: b.realm.slug === slug, count: b.rows.length })),
      ],
    },
    {
      type: "menu", key: "quality", label: "Quality",
      options: [
        { label: "Any quality", href: here({ quality: undefined }), on: !q.quality, reset: true },
        ...QUALITIES.filter((x) => qualityCount.has(x.id) || q.quality === x.slug).map((x) => ({
          label: x.name, className: x.id <= 5 ? QUALITY_TEXT[qualityToken(x.id)] : undefined,
          href: here({ quality: x.slug }), on: q.quality === x.slug, count: qualityCount.get(x.id) ?? 0,
        })),
      ],
    },
    {
      type: "menu", key: "lvl", label: "Req. level",
      options: [{ label: "Any level", href: here({ lvl: undefined }), on: !q.lvl, reset: true }, ...LEVEL_BRACKETS.map((b) => ({
        label: bracket(b), href: here({ lvl: b }), on: q.lvl?.min === b.min && q.lvl?.max === b.max,
      }))],
    },
    { type: "toggle", key: "moved", label: "Changed most", href: here({ moved: q.moved ? undefined : true }), on: Boolean(q.moved) },
  ];
  // The search box keeps every other filter (not the page) as hidden fields.
  const keep = Object.fromEntries(new URLSearchParams(ahHref("", { ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const clearHref = ahHref(path, { house: q.house });

  const listings = shown.some((b) => b.row.listings !== null);
  const columns: Column<BrowseRow>[] = [
    {
      key: "name", header: "Item", sortable: true,
      cell: ({ row }) => <ItemLink id={row.value.itemId} href={itemHref(row.realm, row.value.itemId)} tip={tips.get(row.value.itemId)} names={names} />,
    },
    ...(showRealm ? [{ key: "realm", header: "Realm", nowrap: true, cell: ({ row }: BrowseRow) => <Link href={ahHref(realmHref(row.realm), { house: q.house })} className="text-fg-2 hover:text-fg hover:underline underline-offset-4">{row.realm.name}</Link> }] : []),
    { key: "ilvl", header: "iLvl", numeric: true, sortable: true, cell: ({ row }) => tips.get(row.value.itemId)?.level || <span className="text-muted">—</span> },
    { key: "req", header: "Req.", numeric: true, sortable: true, cell: ({ row }) => tips.get(row.value.itemId)?.required || <span className="text-muted">—</span> },
    { key: "market", header: "Market value", numeric: true, sortable: true, cell: ({ row }) => <span className={row.value.market === null ? "text-muted" : undefined}>{money(row.value.market)}</span> },
    { key: "min", header: "Min buyout", numeric: true, sortable: true, cell: ({ row }) => formatCopper(row.value.min) },
    { key: "units", header: "Units", numeric: true, sortable: true, cell: ({ row }) => `${row.value.quantity.toLocaleString("en-US")}${row.value.thin ? " (thin)" : ""}` },
    ...(listings ? [{ key: "listings", header: "Listings", numeric: true, sortable: true, cell: ({ row }: BrowseRow) => row.listings?.toLocaleString("en-US") ?? <span className="text-muted">—</span> }] : []),
    { key: "change", header: "7 days", numeric: true, sortable: true, cell: ({ move }) => (move ? <span className={move.change > 0 ? "text-accent" : "text-fg"}>{percent(move.change)}</span> : <span className="text-muted">—</span>) },
    { key: "trend", header: <span className="sr-only">Trend</span>, cell: ({ row }) => <Sparkline points={row.points} now={now} /> },
  ];
  // What the URL means with no sort: the week's movers lead by change, everything else by units.
  const fallback = q.moved ? { key: "change" as AhSort, desc: true } : DEFAULT_SORT;
  const sort = q.sort ?? fallback;

  const tree = categoryTree(rows, q, path);
  const categoryLabel = [q.cls?.label, q.sub ? q.sub.name ?? `Subclass ${q.sub.id}` : null, q.slot ? tree.flatMap((n) => n.children ?? []).flatMap((n) => n.children ?? []).find((n) => n.on)?.label : null]
    .filter(Boolean).join(" › ") || "All";
  const categoryNav = (
    <nav aria-label="Categories">
      <ul>
        <li>
          <Link
            href={ahHref(path, { ...q, cls: undefined, sub: undefined, slot: undefined, page: 1 })}
            aria-current={!q.cls ? "page" : undefined}
            className={`flex min-h-7 items-center rounded-control px-2 text-control hover:bg-panel hover:text-fg ${!q.cls ? "bg-panel font-medium text-fg" : "text-fg-2"}`}
          >
            All categories
          </Link>
        </li>
        {tree.map((node) => <TreeItem key={node.key} node={node} depth={0} />)}
      </ul>
    </nav>
  );
  let body;
  if (!state) {
    body = <Card><p className="text-fg-2" role="status">Market values are unavailable right now. They are unrecorded, not zero.</p></Card>;
  } else if (rows.length === 0) {
    const where = `${q.house ? `the ${q.house} auction house on ` : ""}${realmName ?? (q.house ? "any realm" : "")}`;
    body = slug
      ? <EmptyState count={agreementSoFar(state, slug, undefined, q.house)} message={`No public prices in ${where} yet: a price shows once 3 players scan the same item there.`} />
      : <EmptyState message={q.house
        ? `No public prices in ${where} yet: a price shows once 3 players scan the same item in that house.`
        : "No realm has public prices yet: a realm shows here once 3 players scan the same item there."} />;
  } else {
    const empty = (
      <div className="flex flex-wrap items-center gap-2 py-4 text-cell text-fg-2">
        <span>No items match these filters.</span>
        <Link href={clearHref} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Clear filters</Link>
      </div>
    );
    body = (
      <DataTable
        dense
        caption={`${title}${q.house ? `, ${q.house}` : ""}: ${count(results.length, "item")}`}
        columns={columns}
        rows={shown}
        rowKey={({ row }) => `${row.realm.key}:${row.value.itemId}`}
        sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
        sortHref={(key, dir) => here({ sort: key === fallback.key && (dir === "desc") === fallback.desc ? undefined : { key: key as AhSort, desc: dir === "desc" } })}
        meta={({ row, move }) => [showRealm ? row.realm.name : null, money(row.value.market), `${row.value.quantity.toLocaleString("en-US")} units`, move ? percent(move.change) : null].filter(Boolean).join(" · ")}
        empty={empty}
      />
    );
  }

  return (
    <Container width="data">
      <article>
        <DataTitle
          title={title}
          trail={trail}
          meta={state && (
            <Facts items={[
              updated !== null ? <>Updated <TimeAgo at={updated} renderedAt={now.getTime()} /></> : "Update time unrecorded",
              ...(slug && board ? [`${count(board.reporters, "reporter")} this week`] : []),
              ...(!slug && realmWide.length ? [count(realmWide.length, "realm")] : []),
            ]} />
          )}
          aside={strip}
        />
        <LinkTabs label="Auction house" tabs={houseTabs} />
        <div className="mt-3 grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside aria-label="Browse" className="min-w-0 space-y-3">
            <form action={path} method="get" role="search" className="flex">
              {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <label htmlFor="ah-q" className="sr-only">Search items by name or id</label>
              <input
                id="ah-q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={60} placeholder="Name or id"
                className={`ctl w-full min-w-0 border bg-panel px-3 text-fg placeholder:text-muted focus:border-accent focus:outline-none ${q.q ? "border-accent" : "border-edge"}`}
              />
              <button type="submit" className="sr-only">Search</button>
            </form>
            {/* A phone gets the tree as one closed control that names the current category; a wide screen keeps it as the left rail. */}
            <details data-category-control className="lg:hidden">
              <summary className={`ctl flex cursor-pointer list-none items-center gap-1.5 border px-3 [&::-webkit-details-marker]:hidden ${q.cls ? "border-accent text-fg" : "border-edge text-fg-2"}`}>
                <span className="min-w-0 flex-1 truncate">Category: <span className="text-fg">{categoryLabel}</span></span>
                <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className="shrink-0 text-muted"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              </summary>
              <div className="mt-1 rounded-control border border-line bg-panel p-1">{categoryNav}</div>
            </details>
            <div className="hidden lg:block">{categoryNav}</div>
          </aside>
          <div className="min-w-0">
            <FilterBar label="Auction filters" controls={controls} active={activeFilters(q)} clearHref={clearHref} />
            <div className="mt-2">{body}</div>
            {pages > 1 && <div className="mt-2">{strip}</div>}
          </div>
        </div>
        <div className="mt-8 space-y-4">
          <Contribute />
          <div>
            <Disclosure summary="How are market values made?">
              <p>{MARKET_RULE}</p>
            </Disclosure>
            <Disclosure summary="Why is my realm or house missing?">
              <p>A realm or house shows up once 3 players have scanned the same item there. Players are counted by upload address, so several installs in one home count once. A scan carries prices and quantities only, never seller names.</p>
            </Disclosure>
          </div>
        </div>
      </article>
    </Container>
  );
}
