import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import LoreSearchForm from "@/components/LoreSearchForm";
import GameIcon from "@/components/game/GameIcon";
import { Container, DataTable, DataTitle, Entry, EntryList, filledColumns, LinkTabs, Pager, QUALITY_LABEL, QUALITY_TEXT, SearchBar, qualityOf, type SparseColumn } from "@/components/ui";
import { CLASS_TEXT, classNameOf } from "@/components/ui/class-colour";
import { CC_BY_SA } from "@/lib/jsonld";
import { BROWSE_HEADINGS, BROWSE_TYPES, hasTypes, loreSlug, MAX_QUERY, searchLore, UNAVAILABLE, UNAVAILABLE_COPY, type BrowseSlug, type LoreType } from "@/lib/lore";
import { HEADINGS, isResultScope, SEARCH_EXAMPLES, siteSearch, type ResultScope, type SearchGroup, type SearchResult, type SearchType } from "@/lib/site-search";
import { loadSearchShown } from "@/lib/shown-search-names";
import { shownItemIcons } from "@/lib/item-icons";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { npcRows, publicQuests, SIDE_LABEL, type NpcRow, type QuestRow } from "@/lib/world-lists";
import { guildSearchPrefix, guildsOn } from "@/lib/guilds";
import { playerPagesOn, searchPrefix } from "@/lib/player-pages";
import PeopleResults from "./PeopleResults";

/** A `type=` value is one of the stored types; anything else means All. */
function typeOf(raw: string | undefined): LoreType | undefined {
  return raw && (Object.values(BROWSE_TYPES) as string[]).includes(raw) ? (raw as LoreType) : undefined;
}

export const dynamic = "force-dynamic";

/** The tab and history name what was searched; a results page is never indexed. */
export async function generateMetadata(props: { searchParams: Promise<Params> }): Promise<Metadata> {
  const q = (first((await props.searchParams).q) ?? "").trim().slice(0, MAX_QUERY);
  return {
    ...pageMetadata({ title: q ? `Search: ${q}` : "Search", description: "Search WoW: Forever items, NPCs, quests, zones, lore archive pages and Everloot tools by name or id. An exact match comes first.", path: "/search" }),
    robots: { index: false, follow: true },
  };
}

function pageNumber(raw: string | undefined): number {
  return raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : 1;
}

function sourceHost(url: string): string {
  try { return new URL(url).hostname; } catch { return "source"; }
}

/** Next hands a repeated parameter over as an array; the first value is the one we answer. */
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

type Params = { q?: string | string[]; page?: string | string[]; type?: string | string[]; in?: string | string[]; p?: string | string[] };

/** Rows the overview lists per type; the type's tab opens its list with every match. */
const OVERVIEW_LIMIT = 5;

/**
 * The database list each result type opens, with the query applied: the full table, its sorts and its filters.
 * Wiki, tools, docs and classes have no list that takes a query; the lore archive has its own list under `in=lore`.
 */
const LIST_OF: Record<ResultScope, string> = {
  item: "/database/items", npc: "/database/npcs", quest: "/database/quests", object: "/database/objects", zone: "/database/zones", instance: "/database/instances", boss: "/database/bosses",
  vendor: "/database/vendors", spell: "/database/spells", "item-set": "/database/item-sets",
  achievement: "/database/achievements", faction: "/database/factions", title: "/database/titles", chain: "/database/quest-chains",
  mount: "/database/mounts", pet: "/database/pets", currency: "/database/currencies",
  holiday: "/database/holidays", family: "/database/pet-families",
};
const listHrefFor = (type: SearchType, q: string): string | undefined => {
  if (!isResultScope(type)) return undefined;
  return q ? `${LIST_OF[type]}?q=${encodeURIComponent(q)}` : LIST_OF[type];
};

/**
 * Everything the search covers, each with the page it opens, in the order the results come; shown before a query,
 * under the field. No count: a count would read a store on every request.
 */
const KINDS: { type: SearchType; href: string }[] = [
  ...(Object.keys(LIST_OF) as ResultScope[]).map((type) => ({ type, href: LIST_OF[type] })),
  { type: "class", href: "/classes" }, { type: "guide", href: "/wiki" }, { type: "lore", href: "/lore" }, { type: "tool", href: "/tools" }, { type: "doc", href: "/docs" },
];
/** Four queries to try, each finding a page from the game files alone; the field's placeholder from the second. */
const EXAMPLES = SEARCH_EXAMPLES;

/** The empty page's hint: the kinds a search finds and four queries to try. */
function SearchStart({ heading = "What you can search" }: { heading?: string }) {
  return (
    <section aria-labelledby="search-start" className="max-w-reading space-y-3 py-4 text-cell">
      <h2 id="search-start" className="font-semibold text-fg">{heading}</h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {KINDS.map((k) => <li key={k.type}><Link href={k.href} className={link}>{HEADINGS[k.type]}</Link></li>)}
      </ul>
      <p className="text-fg-2">
        A name or an id, and an exact match comes first. Try{" "}
        {EXAMPLES.map((q, i) => (
          <span key={q}>
            {i > 0 && (i === EXAMPLES.length - 1 ? " or " : ", ")}
            <Link href={`/search?q=${encodeURIComponent(q)}`} className={link}>{q}</Link>
          </span>
        ))}
        .
      </p>
    </section>
  );
}

/** The quest and NPC rows behind the overview's hits, as the lists draw them. */
interface OverviewFacts { quests: Map<number, QuestRow>; npcs: Map<number, NpcRow> }
const NO_FACTS: OverviewFacts = { quests: new Map(), npcs: new Map() };

/**
 * The level, side and category of the quests the overview lists, and the level, type, zone and public drop count of
 * its NPCs: the same rows /database/quests and /database/npcs build, from the same aggregate (the one the object
 * group of the search already read this request), narrowed to these ids so a row never says more than its page.
 * Read only when a quest or an NPC was found; nothing when the aggregate is out of reach.
 */
async function overviewFacts(groups: SearchGroup[]): Promise<OverviewFacts> {
  const ids = (type: SearchType) => new Set(groups.find((g) => g.type === type)?.results.flatMap((r) => (r.id === undefined ? [] : [r.id])) ?? []);
  const questIds = ids("quest"), npcIds = ids("npc");
  if (questIds.size === 0 && npcIds.size === 0) return NO_FACTS;
  const got = await Promise.all([loadWorldFacts(), computeRollups()]).catch(() => null);
  if (!got || got[0].unreachable) return NO_FACTS;
  const [facts, rollup] = got;
  const quests = questIds.size ? publicQuests({ ...facts, quests: facts.quests.filter((r) => questIds.has(r.questId)) }) : [];
  const npcs = npcIds.size ? npcRows(facts, rollup.rates.filter((r) => r.sourceNpcId !== undefined && npcIds.has(r.sourceNpcId)), npcIds) : [];
  return { quests: new Map(quests.map((x) => [x.questId, x])), npcs: new Map(npcs.map((n) => [n.npcId, n])) };
}

export default async function SearchPage(props: { searchParams: Promise<Params> }) {
  const params = await props.searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, MAX_QUERY);
  // `in=lore` is the full lore list (with its type chips and pages) behind the lore group of the overview. The links
  // this page gave out before it searched the whole site (`page=`, `type=` with no `in=`) go to that list's own address,
  // so the address says what the page shows.
  if (first(params.in) !== "lore" && (params.page !== undefined || params.type !== undefined)) {
    const legacy = new URLSearchParams({ q, in: "lore" });
    if (first(params.page) !== undefined) legacy.set("page", first(params.page)!);
    if (first(params.type) !== undefined) legacy.set("type", first(params.type)!);
    redirect(`/search?${legacy}`);
  }
  if (first(params.in) === "lore") return LoreResults({ q, params });
  // A search scoped to one type (the box's scope chips, the links this page gave out before) is that type's own
  // database list with the query applied: the full table, its sorts and its filters.
  const scope = first(params.in);
  if (isResultScope(scope)) redirect(listHrefFor(scope, q)!);

  // The names the database pages show (the stored names file, else the aggregates within this render), and from the
  // same read which item rows show an icon; the next request rechecks publication.
  const shown = q ? loadSearchShown() : undefined;
  // Matched on the names the database pages show, so a name a list prints is found here too.
  const groups = q ? await siteSearch(q, {
    limit: OVERVIEW_LIMIT, names: shown!.then((s) => s.names), objects: shown!.then((s) => s.objects),
    spells: shown!.then((s) => s.spells), itemSets: shown!.then((s) => s.itemSets), vendors: shown!.then((s) => s.vendors),
  }) : null;
  // The game icon beside each item hit, where its page shows one, and the facts beside each quest and NPC hit.
  const [{ icons, unknown }, facts] = await Promise.all([
    shownItemIcons(groups?.find((g) => g.type === "item")?.results.flatMap((r) => (r.id === undefined ? [] : [r.id])) ?? [], shown),
    overviewFacts(groups ?? []),
  ]);
  const base = `/search?q=${encodeURIComponent(q)}`;
  // The overview also lists characters and guilds when their pages are on and the text could start a name. The
  // browser asks for them (see PeopleResults), so this page's cached HTML never holds a name a hide removed. Text with
  // no letter is an id, as in the type-ahead.
  const named = Boolean(q && /\p{L}/u.test(q));
  const characters = named && playerPagesOn() && Boolean(searchPrefix(q));
  const guilds = named && guildsOn() && Boolean(guildSearchPrefix(q));
  const people = characters || guilds;
  // One tab per type with results, each opening that type's list (or the lore list, or its section here), then a
  // Characters or Guilds tab where the text could start such a name: their counts arrive in the browser, so the tabs carry none.
  const tabs = groups && groups.length > 0 ? [
    { label: "All", href: base, current: true },
    ...groups.map((g) => ({
      label: g.heading,
      count: g.total,
      href: listHrefFor(g.type, q) ?? (g.type === "lore" ? `${base}&in=lore` : `${base}#results-${g.type}`),
      current: false,
    })),
    ...(characters ? [{ label: "Characters", href: `/players?q=${encodeURIComponent(q)}`, current: false }] : []),
    ...(guilds ? [{ label: "Guilds", href: `/guilds?q=${encodeURIComponent(q)}`, current: false }] : []),
  ] : null;
  const archive = (g: SearchGroup) => g.type === "lore" || g.type === "tool" || g.type === "doc";
  let split = groups?.length ?? 0;
  while (split > 0 && archive(groups![split - 1])) split--;
  // No match: the query said back, then the lists a search covers and queries that find something.
  const nothing = (
    <div className="py-4">
      <p className="text-h2-sm font-semibold text-fg sm:text-h2">No results for “{q}”</p>
      <p className="mt-1 text-cell text-fg-2">Check the spelling, try fewer words, or type an id: an id always opens its page.</p>
      <SearchStart heading="Browse instead" />
    </div>
  );
  const best = groups ? bestMatch(groups) : undefined;
  const table = (group: SearchGroup) => <ResultTable key={group.type} group={group} q={q} icons={icons} unknown={unknown} facts={facts} />;
  return (
    <Container width="data">
      <article>
        {/* The title, then the query in the page's large field; the result tabs take the next row. */}
        <div className="[&>header]:mb-3"><DataTitle title="Search" /></div>
        <div className="mb-4 max-w-3xl">
          <SearchBar action="/search" id="search-page" label="Search Everloot" placeholder={`A name or an id: ${EXAMPLES.slice(1).join(", ")}`} defaultValue={q} surface="search-page" />
        </div>
        {tabs && <div className="mb-4"><LinkTabs label="Result types" tabs={tabs} /></div>}

        {groups === null ? <SearchStart /> : groups.length === 0 ? (
          people ? <PeopleResults q={q} empty={nothing} /> : nothing
        ) : (
          // Characters and guilds sit after the database groups, above the lore archive, tools and docs.
          <>
            {groups[0]?.respelled && <p className="mb-2 text-cell text-fg-2">Showing results for {groups[0].respelled}</p>}
            {best && <BestMatch hit={best.hit} type={best.type} icons={icons} unknown={unknown} facts={facts} />}
            {groups.slice(0, split).map(table)}
            {people && <PeopleResults q={q} />}
            {groups.slice(split).map(table)}
          </>
        )}
      </article>
    </Container>
  );
}

/** One of a type, for the best-match card: "Item", "Dungeon or raid". */
const ONE: Record<SearchType, string> = {
  class: "Class", item: "Item", npc: "NPC", vendor: "Vendor", quest: "Quest", object: "Object", spell: "Spell", achievement: "Achievement", faction: "Faction", title: "Title",
  chain: "Quest chain", "item-set": "Item set", mount: "Mount", pet: "Companion pet", currency: "Currency", holiday: "Holiday or world event", family: "Hunter pet family",
  zone: "Zone", instance: "Dungeon or raid", boss: "Boss", guide: "Wiki page", lore: "Lore page", tool: "Tool", doc: "Docs page",
};

/** The hit that leads the page: the first exact name or id in the first group, unless that group is the lore archive. */
function bestMatch(groups: SearchGroup[]): { hit: SearchResult; type: SearchType } | undefined {
  const g = groups[0];
  const hit = g && g.type !== "lore" ? g.results.find((r) => r.exact) : undefined;
  return hit && { hit, type: g.type };
}

const itemQuality = (r: SearchResult) => (typeof r.quality === "number" && r.quality <= 5 ? qualityOf(r.quality) : undefined);

/** A hit's name colour: an item's quality, a class's own colour; any other name is plain. */
function nameColour(type: SearchType, r: SearchResult): string | undefined {
  const quality = type === "item" ? itemQuality(r) : undefined;
  if (quality) return QUALITY_TEXT[quality];
  const cls = type === "class" ? classNameOf(r.href.split("/").pop()) : undefined;
  return cls && CLASS_TEXT[cls];
}

/** A hit's note when it says something its id does not ("Boss in The Deadmines", a lore snippet): never "id 12" or "zone". */
const noteOf = (r: SearchResult) => (r.note && !/^id \d+$/.test(r.note) && r.note !== "zone" ? r.note : undefined);

/** The side of a quest, Alliance and Horde in their faction's colour. */
function Side({ side }: { side: NonNullable<QuestRow["side"]> }) {
  const colour = side === "alliance" ? "text-faction-alliance" : side === "horde" ? "text-faction-horde" : undefined;
  return <span className={colour}>{SIDE_LABEL[side]}</span>;
}

/**
 * The best match, above the groups: the hit's icon (items), its type, its name as the link (which the hover card on
 * every database link answers), and the facts its row already carries. Nothing is read for it.
 */
function BestMatch({ hit, type, icons, unknown, facts }: { hit: SearchResult; type: SearchType; icons: Map<number, string>; unknown: string | null; facts: OverviewFacts }) {
  const quality = type === "item" ? itemQuality(hit) : undefined;
  const icon = type === "item" && unknown ? (hit.id === undefined ? undefined : icons.get(hit.id)) || unknown : undefined;
  const quest = type === "quest" && hit.id !== undefined ? facts.quests.get(hit.id) : undefined;
  const npc = type === "npc" && hit.id !== undefined ? facts.npcs.get(hit.id) : undefined;
  const items: ReactNode[] = [
    quality && QUALITY_LABEL[quality], type === "item" && hit.meta,
    quest?.level != null && `Level ${quest.level}`, quest?.category, quest?.side && <Side side={quest.side} />,
    npc?.level != null && `Level ${npc.level}`, npc?.creatureType, npc?.zone?.name, npc?.drops ? `${npc.drops} drop${npc.drops === 1 ? "" : "s"}` : false,
    type !== "item" && noteOf(hit),
    hit.id !== undefined && <>ID <span className="font-mono tabular-nums">{hit.id}</span></>,
  ].filter(Boolean);
  return (
    <section data-best-match aria-labelledby="best-match" className="mb-6 flex min-w-0 items-start gap-4 rounded-card border border-line bg-panel p-4">
      {icon && <GameIcon src={icon} size={48} quality={quality} />}
      <div className="min-w-0">
        <h2 id="best-match" className="text-meta text-muted">Best match · <span>{ONE[type]}</span></h2>
        <p className="mt-1 text-h2-sm font-semibold sm:text-h2">
          <Link href={hit.href} className={`${nameColour(type, hit) ?? "text-fg"} underline decoration-edge underline-offset-4 hover:decoration-fg`}>{hit.label}</Link>
        </p>
        {items.length > 0 && (
          <p className="mt-1 text-cell text-fg-2">
            {items.map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * One type's results under its heading and count, as a dense table, with a link to every match where there are more.
 * Quest and NPC rows carry the facts their lists show, so two of a name tell apart; a column no row here has a value
 * for is left out.
 */
function ResultTable({ group, q, icons, unknown, facts }: { group: SearchGroup; q: string; icons: Map<number, string>; unknown: string | null; facts: OverviewFacts }) {
  const more = group.total > group.results.length;
  const all = listHrefFor(group.type, q) ?? (group.type === "lore" ? `/search?q=${encodeURIComponent(q)}&in=lore` : null);
  const dash = <span className="text-muted">—</span>;
  const quest = (r: SearchResult) => (r.id === undefined ? undefined : facts.quests.get(r.id));
  const npc = (r: SearchResult) => (r.id === undefined ? undefined : facts.npcs.get(r.id));
  const name = (r: SearchResult) => {
    // An item takes its quality colour and a class its own; any other hit is a plain link, never the accent an uncommon item resembles.
    const colour = nameColour(group.type, r);
    const style = colour ? `${colour} hover:underline underline-offset-4` : "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
    const link = <Link href={r.href} className={style}>{r.label}</Link>;
    // Item hits carry the game icon as the item lists do, and the game's fallback where one is missing.
    if (group.type !== "item" || !unknown) return link;
    const icon = r.id === undefined ? undefined : icons.get(r.id);
    return (
      <span className="flex min-w-0 items-center gap-2">
        <GameIcon src={icon || unknown} size={20} quality={itemQuality(r)} />
        {link}
      </span>
    );
  };
  const about: SparseColumn<SearchResult>[] = group.type === "quest" ? [
    { key: "level", header: "Level", numeric: true, cell: (r) => quest(r)?.level ?? dash, blank: (r) => quest(r)?.level == null },
    { key: "side", header: "Side", cell: (r) => { const s = quest(r)?.side; return s ? <Side side={s} /> : dash; }, blank: (r) => !quest(r)?.side },
    { key: "category", header: "Category", cell: (r) => quest(r)?.category ?? dash, blank: (r) => !quest(r)?.category },
  ] : group.type === "npc" ? [
    { key: "level", header: "Level", numeric: true, cell: (r) => npc(r)?.level ?? dash, blank: (r) => npc(r)?.level == null },
    { key: "type", header: "Type", cell: (r) => npc(r)?.creatureType ?? dash, blank: (r) => !npc(r)?.creatureType },
    { key: "zone", header: "Zone", cell: (r) => npc(r)?.zone?.name ?? dash, blank: (r) => !npc(r)?.zone },
    { key: "drops", header: "Drops", numeric: true, cell: (r) => npc(r)?.drops || dash, blank: (r) => !npc(r)?.drops },
  ] : [
    { key: "about", header: group.type === "item" ? "Type" : "About", cell: (r) => <span className="line-clamp-1 text-fg-2">{(group.type === "item" ? r.meta : noteOf(r)) ?? ""}</span>, blank: (r) => !(group.type === "item" ? r.meta : noteOf(r)) },
  ];
  const columns: SparseColumn<SearchResult>[] = [
    { key: "name", header: "Name", cell: name },
    ...about,
    // Lore, zones, tools and docs have no id: the column is left out for them.
    { key: "id", header: "ID", numeric: true, cell: (r) => r.id ?? "", blank: (r) => r.id === undefined },
  ];
  // The phone's one line under the name: the same facts the columns show.
  const meta = (r: SearchResult): string => {
    const id = r.id !== undefined && `ID ${r.id}`;
    if (group.type === "quest") { const x = quest(r); return [x?.level != null && `Level ${x.level}`, x?.category, x?.side && SIDE_LABEL[x.side], id].filter(Boolean).join(" · "); }
    if (group.type === "npc") { const n = npc(r); return [n?.level != null && `Level ${n.level}`, n?.creatureType, n?.zone?.name, n?.drops ? `${n.drops} drop${n.drops === 1 ? "" : "s"}` : false, id].filter(Boolean).join(" · "); }
    return (group.type === "item" ? [r.meta, id] : [noteOf(r), id]).filter(Boolean).join(" · ");
  };
  return (
    <section id={`results-${group.type}`} aria-labelledby={`results-${group.type}-heading`} className="mb-6 scroll-mt-20">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={`results-${group.type}-heading`} className="text-h2-sm font-semibold text-fg sm:text-h2">{group.heading} <span className="font-normal text-muted tabular-nums">({group.total})</span></h2>
        {more && all && <Link href={all} className={`${link} text-meta`}>See all {group.total} {group.type === "lore" ? "lore results" : group.heading.toLowerCase()}</Link>}
      </div>
      <DataTable
        dense
        caption={`${group.heading} matching ${q}`}
        columns={filledColumns(columns, group.results)}
        rows={group.results}
        rowKey={(r) => r.href}
        meta={meta}
      />
    </section>
  );
}

async function LoreResults({ q, params }: { q: string; params: Params }) {
  const page = pageNumber(first(params.page));
  const typed = (await hasTypes()) === true;
  const type = typed ? typeOf(first(params.type)) : undefined;
  const result = q ? await searchLore(q, page, type) : null;
  const base = `/search?q=${encodeURIComponent(q)}&in=lore`;
  const typeQuery = type ? `&type=${type}` : "";
  const chips = typed && q
    ? [
        { label: "All", href: base, current: !type },
        ...(Object.keys(BROWSE_TYPES) as BrowseSlug[]).map((slug) => ({
          label: BROWSE_HEADINGS[slug], href: `${base}&type=${BROWSE_TYPES[slug]}`, current: type === BROWSE_TYPES[slug],
        })),
      ]
    : [];

  return (
    <Container width="data">
      <article className="max-w-reading">
        <DataTitle title="Search the lore archive" />
        <LoreSearchForm query={q} />

        {result !== null && (
          <section aria-labelledby="lore-results" className="mt-6">
            <h2 id="lore-results" className="sr-only">Lore archive</h2>
            {chips.length > 0 && (
              <div className="mb-4">
                <LinkTabs label="Page type" tabs={chips} />
              </div>
            )}
            {result === UNAVAILABLE ? (
              <div className="py-4">
                <p className="font-semibold text-fg">Lore archive unavailable</p>
                <p className="mt-2 text-sm text-fg-2">{UNAVAILABLE_COPY}</p>
              </div>
            ) : result.hits.length === 0 && page > 1 ? (
              <p className="py-4 text-fg-2">No more results. <Link href={base} className={link}>Back to the first page</Link></p>
            ) : result.hits.length === 0 ? (
              <p className="py-4 text-fg-2">
                No lore page matches that. Try the wiki&apos;s own search:{" "}
                <a href={`https://warcraft.wiki.gg/index.php?search=${encodeURIComponent(q)}`} rel="noopener" className={link}>
                  warcraft.wiki.gg
                </a>
              </p>
            ) : (
              <>
                <EntryList ordered label="Lore pages, best match first">
                  {result.hits.map((hit) => (
                    <Entry
                      key={hit.id}
                      as="h3"
                      href={`/lore/${loreSlug(hit)}`}
                      title={hit.name}
                      meta={<>{hit.gameVersion === "lore" ? "lore · 2023" : `${hit.gameVersion} · ${hit.sourceId}`} · {sourceHost(hit.sourceUrl)}</>}
                    >
                      <p>{hit.snippet}</p>
                    </Entry>
                  ))}
                </EntryList>
                <Pager
                  label="Search pages"
                  page={page}
                  prevHref={page > 1 ? `${base}${typeQuery}&page=${page - 1}` : null}
                  nextHref={result.hasNext ? `${base}${typeQuery}&page=${page + 1}` : null}
                />
              </>
            )}
          </section>
        )}

        {/* The one line a lore page keeps (density spec, section 6): the source and the licence it requires. */}
        <p className="mt-6 text-xs text-muted">
          Source: <a href="https://warcraft.wiki.gg" rel="noopener" className={link}>Warcraft Wiki</a>, 13 November 2023,{" "}
          <a href={CC_BY_SA.url} rel="noopener" className={link}>CC BY-SA 4.0</a>
          {" · "}<Link href="/lore" className={link}>About the lore archive</Link>
          {q && <>{" · "}<Link href={`/search?q=${encodeURIComponent(q)}`} className={link}>Search all of Everloot</Link></>}
        </p>
      </article>
    </Container>
  );
}
