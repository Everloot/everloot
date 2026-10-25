import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import JsonLd from "@/components/JsonLd";
import { Badge, Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column, type FilterControl } from "@/components/ui";
import { CHANGE_FILTERS, GAME_LABEL, TYPE_LABEL, filterTimeline, forumRegions, loadTimeline, parseFilter, postPath, type ChangeEntry, type ChangeFilter } from "@/lib/changes";
import { latestBuildLine } from "@/lib/changes-facts";
import { loadSiteAssets } from "@/lib/game-assets";
import { changesJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { mentionIndex, siteSpellNames } from "@/lib/spell-mentions";
import { listHref, listQuery, nextSort, NoMatches, PER_PAGE, sortParam, type ListQuery, type Search } from "../database/list-parts";
import WithSpells from "./with-spells";

export const metadata: Metadata = {
  ...pageMetadata({ title: "WoW Forever Patch Notes and Blizzard Posts", description: "New WoW: Forever builds, hotfixes and Blizzard blue posts, newest first. Each post has a page linking the original; builds are dated as Everloot first saw them.", path: "/changes", image: "/changes/opengraph-image" }),
};

const TITLE = "Changes";
const LEAD = "Blue posts, hotfixes and new game builds, newest first.";
const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
/** Blizzard's posts and hotfixes, never builds, in the blue of a blue post. */
const BLUE = "text-blue-post hover:underline underline-offset-4";

/** UTC to the minute, whatever offset the time was written with. */
const stamp = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const SORTS = ["date", "type", "title", "author", "source"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "date" as Sort, desc: true };

const TYPE_FILTER_LABEL: Record<ChangeFilter, string> = { all: "Any type", posts: "Blue posts", hotfixes: "Hotfixes", builds: "Builds" };
const GAMES = { forever: "WoW: Forever", classic: "WoW Classic", retail: "WoW (retail)", all: "All games" } as const;
type Game = keyof typeof GAMES;
const REGIONS = { us: "US forum", eu: "EU forum" } as const;
type Region = keyof typeof REGIONS;
const DAYS = { 7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days", 365: "Last year" } as const;
type Days = keyof typeof DAYS;

interface ChangesQuery extends ListQuery<Sort> { show: ChangeFilter; game: Game; region?: Region; author?: string; days?: Days }

const one = (search: Search, k: string) => (typeof search[k] === "string" ? (search[k] as string) : undefined);

/**
 * The filters from the URL: `q`, `show=posts|hotfixes|builds`, `game=classic|retail|all` (Forever when absent),
 * `region=us|eu`, `author=`, `days=7|30|90|365`, `sort`, `page`. An unknown filter value is ignored, as the old
 * links did; a malformed sort or page is a 404, as on the database lists.
 */
function changesQuery(search: Search): ChangesQuery | null {
  const base = listQuery(search, SORTS);
  if (!base) return null;
  const game = one(search, "game"), region = one(search, "region"), days = Number(one(search, "days"));
  const author = one(search, "author")?.trim().slice(0, 100);
  return {
    ...base,
    show: parseFilter(one(search, "show")),
    game: game === "classic" || game === "retail" || game === "all" ? game : "forever",
    ...(region === "us" || region === "eu" ? { region } : {}),
    ...(author ? { author } : {}),
    ...(days in DAYS ? { days: days as Days } : {}),
  };
}

const href = (q: Partial<ChangesQuery>) => listHref("/changes", [
  ["q", q.q], ["show", q.show && q.show !== "all" ? q.show : undefined], ["game", q.game && q.game !== "forever" ? q.game : undefined],
  ["region", q.region], ["author", q.author], ["days", q.days ? String(q.days) : undefined], ["sort", sortParam(q.sort)],
  ["page", q.page && q.page > 1 ? String(q.page) : undefined],
]);
const active = (q: ChangesQuery) => [q.q, q.show !== "all", q.game !== "forever", q.region, q.author, q.days].filter(Boolean).length;

/** Every forum an announcement was posted on: "US forum", or "US · EU forum" for one posted on both. */
const SOURCE_LABEL = (e: ChangeEntry) => e.type === "build" ? "" : e.source === "bluesky" ? "Bluesky" : e.source === "manual" ? e.category || "Everloot"
  : `${forumRegions(e).map((r) => r.toUpperCase()).join(" · ")} forum`;
/** The announcement and its regional copies, for the filters that look inside them. */
const copiesOf = (e: ChangeEntry) => [e, ...(e.copies ?? [])];

export default async function ChangesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = changesQuery((await searchParams) ?? {});
  if (!q) notFound();
  const all = await loadTimeline();
  const scope = filterTimeline(all, "all", q.game === "all" ? undefined : q.game);
  const text = q.q?.toLowerCase();
  const since = q.days ? new Date(Date.now() - q.days * 86_400_000).toISOString() : undefined;
  const matched = filterTimeline(scope, q.show).filter((e) =>
    (!text || copiesOf(e).some((c) => [c.title, c.excerpt, c.summary, c.author, c.category, c.version].some((s) => s?.toLowerCase().includes(text))))
    && (!q.region || (e.source === "forum" && forumRegions(e).includes(q.region)))
    && (!q.author || copiesOf(e).some((c) => c.author === q.author))
    && (!since || e.at >= since));
  const sort = q.sort ?? DEFAULT_SORT;
  const key = (e: ChangeEntry) => sort.key === "type" ? TYPE_LABEL[e.type] : sort.key === "title" ? e.title.toLowerCase()
    : sort.key === "author" ? e.author?.toLowerCase() ?? null : sort.key === "source" ? SOURCE_LABEL(e) || null : e.at;
  const dir = sort.desc ? -1 : 1;
  // Empty keys last either way; ties newest first.
  const rows = [...matched].sort((a, b) => {
    const ka = key(a), kb = key(b);
    const c = ka === kb ? 0 : ka === null ? 1 : kb === null ? -1 : ka.localeCompare(kb) * dir;
    return c || b.at.localeCompare(a.at) || a.id.localeCompare(b.id);
  });
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<ChangesQuery>) => href({ ...q, page: 1, ...over });

  // The game's icon and tooltip on spells the posts name, only when the asset URL is set and the upload has them.
  const assets = await loadSiteAssets();
  const index = mentionIndex(assets, assets ? await siteSpellNames() : []);

  const dash = <span className="text-muted">—</span>;
  const titleLink = (e: ChangeEntry) => {
    const page = postPath(e);
    return page
      ? <Link href={page} className={`${BLUE} font-medium`}>{e.title}</Link>
      : <span className="font-medium">{e.title}</span>;
  };
  const columns: Column<ChangeEntry>[] = [
    {
      // On a phone this is the only column shown, so it carries the title and the muted line holds the date.
      key: "date", header: "Date", sortable: true, nowrap: true, cell: (e) => (
        <>
          <time dateTime={e.at} title={e.type === "build" ? `${stamp(e.at)}, when Everloot first saw it` : stamp(e.at)} className="hidden font-mono tabular-nums text-fg-2 sm:inline">{e.at.slice(0, 10)}</time>
          <div data-phone-title className="whitespace-normal py-1 sm:hidden">{titleLink(e)}</div>
        </>
      ),
    },
    { key: "type", header: "Type", sortable: true, nowrap: true, cell: (e) => <Badge tone="neutral">{TYPE_LABEL[e.type]}</Badge> },
    {
      key: "title", header: "Title", sortable: true, cell: (e) => {
        const line = e.type === "build"
          ? <>First seen by Everloot.{e.diffUrl && <> <a href={e.diffUrl} className={LINK}>See what changed</a></>}</>
          : (e.summary ?? e.excerpt) && <WithSpells text={(e.summary ?? e.excerpt)!} index={index} />;
        return (
          <div data-change-row data-blue-post={postPath(e) ? "" : undefined} className="min-w-0 py-1">
            {titleLink(e)}
            {q.game === "all" && <span className="ml-2 text-cell-2 text-muted">{GAME_LABEL[e.game]}</span>}
            {line && <p className="line-clamp-2 text-cell-2 text-muted">{line}</p>}
          </div>
        );
      },
    },
    {
      key: "author", header: "Author", sortable: true, nowrap: true, cell: (e) => e.author
        ? <Link href={here({ author: e.author })} title={e.role || undefined} className={BLUE}>{e.author}</Link>
        : dash,
    },
    { key: "source", header: "Where", sortable: true, nowrap: true, cell: (e) => SOURCE_LABEL(e) ? <span title={e.category || undefined} className="text-fg-2">{SOURCE_LABEL(e)}</span> : dash },
  ];

  const count = (f: (e: ChangeEntry) => boolean) => scope.filter(f).length;
  // An announcement counts once for each person who posted a copy of it.
  const authors = [...scope.reduce((m, e) => {
    for (const a of new Set(copiesOf(e).map((c) => c.author))) if (a) m.set(a, (m.get(a) ?? 0) + 1);
    return m;
  }, new Map<string, number>())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const controls: FilterControl[] = [
    {
      type: "menu", key: "show", label: "Type",
      options: CHANGE_FILTERS.map((f) => ({
        label: TYPE_FILTER_LABEL[f], href: here({ show: f }), on: q.show === f, ...(f === "all" ? { reset: true } : { count: filterTimeline(scope, f).length }),
      })),
    },
    {
      type: "menu", key: "game", label: "Game",
      options: (Object.keys(GAMES) as Game[]).map((g) => ({ label: GAMES[g], href: here({ game: g }), on: q.game === g, reset: g === "forever" })),
    },
    {
      type: "menu", key: "region", label: "Region",
      options: [{ label: "Any region", href: here({ region: undefined }), on: !q.region, reset: true }, ...(Object.keys(REGIONS) as Region[]).map((r) => ({
        label: REGIONS[r], href: here({ region: r }), on: q.region === r, count: count((e) => e.source === "forum" && forumRegions(e).includes(r)),
      }))],
    },
    {
      type: "menu", key: "days", label: "Date",
      options: [{ label: "Any date", href: here({ days: undefined }), on: !q.days, reset: true }, ...(Object.keys(DAYS).map(Number) as Days[]).map((d) => ({
        label: DAYS[d], href: here({ days: d }), on: q.days === d,
      }))],
    },
    {
      type: "menu", key: "author", label: "Author",
      options: [{ label: "Any author", href: here({ author: undefined }), on: !q.author, reset: true }, ...authors.map(([a, n]) => ({
        label: a, href: here({ author: a }), on: q.author === a, count: n,
      }))],
    },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "entry" : "entries"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Change pages" />;
  const chips = [
    ...(q.q ? [{ label: `Search: ${q.q}`, href: here({ q: undefined }) }] : []),
    ...(q.show !== "all" ? [{ label: TYPE_FILTER_LABEL[q.show], href: here({ show: "all" }) }] : []),
    ...(q.game !== "forever" ? [{ label: GAMES[q.game], href: here({ game: "forever" }) }] : []),
    ...(q.region ? [{ label: REGIONS[q.region], href: here({ region: undefined }) }] : []),
    ...(q.days ? [{ label: DAYS[q.days], href: here({ days: undefined }) }] : []),
    ...(q.author ? [{ label: `Author: ${q.author}`, href: here({ author: undefined }) }] : []),
  ];
  const empty = active(q) > 0
    ? <NoMatches noun="entries" chips={chips} clearHref="/changes" />
    : <p data-empty-state className="py-4 text-cell text-fg-2">Nothing recorded yet. New entries appear after the next check.</p>;

  return (
    <Container width="data">
      <article>
        <JsonLd data={changesJsonLd({ name: TITLE, description: LEAD, path: "/changes", entries: shown })} />
        <DataTitle
          title={TITLE}
          meta={<>{LEAD} {latestBuildLine(all)} <a href="/changes/feed.xml" className={LINK}>RSS</a></>}
          aside={strip}
        />
        <FilterBar
          label="Change filters"
          search={{ action: "/changes", value: q.q, placeholder: "Title, text or author", label: "Search changes", keep }}
          controls={controls}
          active={active(q)}
          clearHref="/changes"
        />
        <div className="mt-2">
          <DataTable
            dense
            caption={`Changes, ${GAMES[q.game]}: ${rows.length}`}
            columns={columns}
            rows={shown}
            rowKey={(e) => e.id}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, d) => here({ sort: nextSort(k, d, DEFAULT_SORT) })}
            meta={(e) => [e.at.slice(0, 10), TYPE_LABEL[e.type], e.author, SOURCE_LABEL(e)].filter(Boolean).join(" · ")}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
        <AdSlot slot="inContent" />
      </article>
    </Container>
  );
}
