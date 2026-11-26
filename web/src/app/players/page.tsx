import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { CENSUS_CLASSES, CENSUS_RACES } from "@kb/census";
import {
  ARMORY_HIDE_PATH, ARMORY_SUBMIT_PATH, ARMORY_REGIONS, ARMORY_RULESETS, armoryBoardHref, armoryBoardPath, armoryCharacterPath, armoryGuildPath, armoryNameQuery, armoryOn,
  classTokenOfName, metricValue, regionLabel,
} from "@/lib/armory";
import { armoryStore, type ArmoryBoardRow, type ArmoryDirectoryRow, type ArmoryHit } from "@/lib/armory-store";
import {
  activeDirectoryFilters, levelBandOf, PLAYER_LEVEL_BANDS, PLAYER_SORTS, playerDirectoryQuery, playerDirectoryHref, type PlayerDirectoryQuery, type PlayerSearchParams,
} from "@/lib/armory-directory";
import { mergeLookup, SOURCE_LABEL, type LookupRow } from "@/lib/character-lookup";
import { absoluteUrl, pageMetadata } from "@/lib/seo";
import { trailFor } from "@/lib/breadcrumbs";
import { playerPagesOn, searchPrefix, type Player } from "@/lib/player-pages";
import { searchPlayers } from "@/lib/people-search";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import {
  Container, DataTable, EmptyState, FilterBar, Input, PageHeader, ResultStrip, SectionHeading, type Column, type FilterControl,
} from "@/components/ui";
import { className, classText, playerRobots, raceName } from "./player-view";
import { ArmoryCredit, newest } from "../armory/parts";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { searchParams: Promise<PlayerSearchParams> }): Promise<Metadata> {
  const params = await props.searchParams;
  return {
    ...pageMetadata({ title: "Find a player", description: "Find WoW: Forever characters by name, class, race, level and guild. Filter Blizzard profiles by region and ruleset, sort their gear, and see addon name matches.", path: "/players" }),
    robots: playerRobots(Object.keys(params).length > 0),
  };
}

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
/** The most rows the name lookup returns when the directory is not there: the players store's own cap, and the armory search's. */
const LIMIT = 25;
/** How many of the latest reads the page offers before a search. */
const RECENT = 10;

/** `guildPath` and `lastLogin` come with 20261126100000; before it the row has neither. */
type DirectoryRow = LookupRow & { gearScore?: number | null; itemLevel?: number | null; fetchedAt?: string; guildPath?: string; lastLogin?: string | null };

const muted = (text: string) => <span className="text-muted">{text}</span>;
const day = (iso: string | undefined | null) => <span className="font-mono tabular-nums">{iso?.slice(0, 10) ?? ""}</span>;

/** The name in its class colour, linking the character's one page (the armory's when it has one), and its hide link. */
function NameCell({ row }: { row: DirectoryRow }) {
  const joined = row.sources.length > 1;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <Link href={row.href} className={`${classText(row.classToken)} font-medium underline decoration-edge underline-offset-4 hover:decoration-current`}>{row.name}</Link>
      {joined && <span className="whitespace-nowrap rounded-control border border-edge px-1.5 text-meta text-fg-2">{SOURCE_LABEL.addon}</span>}
      <Link href={row.hideHref} className="text-xs text-muted hover:underline underline-offset-4">Hide</Link>
    </span>
  );
}

/** Columns keyed to the sorts the directory knows; the name sorts A to Z, the others highest first. */
const SORT_OF_COLUMN: Record<string, (typeof PLAYER_SORTS)[number]> = Object.fromEntries(
  [["name", "name"], ["level", "level"], ["item", "item-level"], ["gear", "gear-score"], ["seen", "last-read"]]
    .map(([column, slug]) => [column, PLAYER_SORTS.find((s) => s.slug === slug)!]),
);

/**
 * The table's columns. A guild links its own armory page when the row gives one, else `guildHref` makes it a link to
 * that guild's members in this list; addon sightings carry no gear and no Blizzard guild, so their table leaves those
 * out. `login` adds the last login, once the directory gives it.
 */
function columns(guildHref: ((guild: string) => string) | null, login = false): Column<DirectoryRow>[] {
  const all: (Column<DirectoryRow> & { armory?: true })[] = [
    { key: "name", header: "Name", sortable: true, cell: (r) => <NameCell row={r} /> },
    { key: "level", header: "Level", numeric: true, sortable: true, cell: (r) => r.level },
    { key: "who", header: "Race and class", nowrap: true, cell: (r) => `${raceName(r.race)} ${className(r.classToken)}` },
    {
      key: "guild", header: "Guild",
      cell: (r) => r.guild === null ? muted("None seen")
        : r.guildPath ? <Link href={r.guildPath} className={link}>{r.guild}</Link>
        : guildHref && r.sources.includes("armory") ? <Link href={guildHref(r.guild)} className={link}>{r.guild}</Link> : r.guild,
    },
    { key: "item", header: "Item level", numeric: true, sortable: true, armory: true, cell: (r) => r.itemLevel == null ? muted("Not read") : metricValue("item-level", r.itemLevel) },
    { key: "gear", header: "Gear score", numeric: true, sortable: true, armory: true, cell: (r) => r.gearScore == null ? muted("Not read") : metricValue("gear-score", r.gearScore) },
    { key: "realm", header: "Realm", nowrap: true, cell: (r) => r.where },
    ...(login ? [{ key: "login", header: "Last login", numeric: true, armory: true as const, cell: (r: DirectoryRow) => r.lastLogin ? day(r.lastLogin) : muted("Not given") }] : []),
    { key: "seen", header: guildHref ? "Last read" : "Last seen", numeric: true, sortable: true, cell: (r) => day(r.fetchedAt ?? r.lastSeen) },
  ];
  return guildHref ? all : all.filter((c) => !c.armory).map((c) => ({ ...c, sortable: false }));
}

/** The guild's page and last login a directory row carries once 20261126100000 is applied; nothing before it. */
function directoryExtras(h: ArmoryHit): Pick<DirectoryRow, "guildPath" | "lastLogin"> {
  const { guildSlug, lastLogin } = h as Partial<ArmoryDirectoryRow>;
  return { ...(guildSlug && { guildPath: armoryGuildPath(h.region, guildSlug) }), ...(lastLogin !== undefined && { lastLogin }) };
}

function rowMeta(r: DirectoryRow) {
  return `Level ${r.level} ${raceName(r.race)} ${className(r.classToken)} · ${r.where} · ${r.sources.map((s) => SOURCE_LABEL[s]).join(", ")}${r.gearScore == null ? "" : ` · GS ${metricValue("gear-score", r.gearScore)}`}${r.itemLevel == null ? "" : ` · ilvl ${metricValue("item-level", r.itemLevel)}`}${r.lastLogin ? ` · Login ${r.lastLogin.slice(0, 10)}` : ""}${r.lastSeen ? ` · Seen ${r.lastSeen}` : ""}`;
}

/** The menus above the list: every choice a link, so a filtered view is an address. */
function filterControls(d: PlayerDirectoryQuery): FilterControl[] {
  const href = (over: Partial<PlayerDirectoryQuery>) => playerDirectoryHref({ ...d, ...over }, 1);
  const band = levelBandOf(d);
  const custom = !band && (d.minLevel !== null || d.maxLevel !== null);
  const sort = PLAYER_SORTS.find((s) => s.value === d.sort)!;
  return [
    {
      type: "menu", key: "class", label: "Class",
      options: [
        { label: "All classes", href: href({ class: null }), on: d.class === null, reset: true },
        ...CENSUS_CLASSES.map((c) => ({ label: c.name, href: href({ class: c.name }), on: d.class === c.name, className: classText(c.token) })),
      ],
    },
    {
      type: "menu", key: "race", label: "Race",
      options: [
        { label: "All races", href: href({ race: null }), on: d.race === null, reset: true },
        ...[...new Set(CENSUS_RACES.map((r) => r.name))].map((name) => ({ label: name, href: href({ race: name }), on: d.race === name })),
      ],
    },
    {
      type: "menu", key: "faction", label: "Faction",
      options: [
        { label: "Both factions", href: href({ faction: null }), on: d.faction === null, reset: true },
        ...["Alliance", "Horde"].map((f) => ({ label: f, href: href({ faction: f }), on: d.faction === f })),
      ],
    },
    {
      type: "menu", key: "level", label: "Level",
      options: [
        { label: "Any level", href: href({ minLevel: null, maxLevel: null }), on: !band && !custom, reset: true },
        ...PLAYER_LEVEL_BANDS.map((b) => ({ label: b.label, href: href({ minLevel: b.min, maxLevel: b.max }), on: band === b })),
        ...(custom ? [{ label: `${d.minLevel ?? 1}–${d.maxLevel ?? 60}`, href: href({}), on: true }] : []),
      ],
    },
    {
      type: "menu", key: "region", label: "Region",
      options: [
        { label: "All regions", href: href({ region: null }), on: d.region === null, reset: true },
        ...ARMORY_REGIONS.map((r) => ({ label: regionLabel(r), href: href({ region: r }), on: d.region === r })),
      ],
    },
    {
      type: "menu", key: "ruleset", label: "Ruleset",
      options: [
        { label: "All rulesets", href: href({ rulesetId: null }), on: d.rulesetId === null, reset: true },
        ...ARMORY_RULESETS.map((r) => ({ label: r.label, href: href({ rulesetId: r.id }), on: d.rulesetId === r.id })),
      ],
    },
    {
      // The headers sort too; on a phone, where only the name column shows, this is the way.
      type: "menu", key: "sort", label: `Sort: ${sort.label}`,
      options: PLAYER_SORTS.map((s) => ({ label: s.label, href: href({ sort: s.value }), on: d.sort === s.value, reset: s.value === "gear_score" })),
    },
  ];
}

/** The fields a name or guild search keeps from the menus, so typing a name does not drop a filter. */
function keptFields(d: PlayerDirectoryQuery): [string, string][] {
  const params = new URL(playerDirectoryHref({ ...d, q: "", guildPrefix: null }, 1), "https://everloot.app").searchParams;
  return [...params.entries()];
}

/** A list of the latest reads, before any search: the crawler's newest rows, hidden characters already out. */
function Recent({ rows }: { rows: ArmoryDirectoryRow[] }) {
  return (
    <section aria-labelledby="players-recent" className="space-y-3">
      <SectionHeading id="players-recent" note="The characters the armory read from Blizzard's API most recently.">Just read</SectionHeading>
      <DataTable
        dense
        caption="Characters read most recently"
        columns={[
          { key: "name", header: "Name", cell: (r) => <Link href={armoryCharacterPath(r.region, r.slug)} className={`${classText(classTokenOfName(r.class))} font-medium underline decoration-edge underline-offset-4 hover:decoration-current`}>{r.name} {r.surname}</Link> },
          { key: "who", header: "Character", cell: (r) => `Level ${r.level} ${r.race} ${r.class}` },
          { key: "at", header: "Read", numeric: true, cell: (r) => day(r.fetchedAt) },
        ]}
        rows={rows}
        rowKey={(r) => `${r.region}/${r.slug}`}
        meta={(r) => `Level ${r.level} ${r.race} ${r.class} · ${r.fetchedAt.slice(0, 10)}`}
      />
    </section>
  );
}

/** The highest item level read in each class, each linking its character and that class's board. */
function BestOfClass({ rows }: { rows: ArmoryBoardRow[] }) {
  return (
    <section aria-labelledby="players-best" className="space-y-3">
      <SectionHeading id="players-best" note={<>The highest item level read for each class. <Link href={armoryBoardPath("item-level")} className={link}>All item level rankings</Link></>}>
        Best item level by class
      </SectionHeading>
      <DataTable
        dense
        caption="Highest item level of each class"
        columns={[
          { key: "class", header: "Class", nowrap: true, cell: (r) => <span className={classText(classTokenOfName(r.class))}>{r.class}</span> },
          { key: "name", header: "Character", cell: (r) => <Link href={armoryCharacterPath(r.region, r.slug)} className={link}>{r.name} {r.surname}</Link> },
          { key: "value", header: "Item level", numeric: true, cell: (r) => metricValue("item-level", r.value) },
          { key: "board", header: "Board", cell: (r) => <Link href={armoryBoardHref("item-level", { region: null, ruleset: null, class: r.class })} className={link}>{r.class} board</Link> },
        ]}
        rows={rows}
        rowKey={(r) => r.class}
        meta={(r) => `${r.name} ${r.surname} · ilvl ${metricValue("item-level", r.value)}`}
      />
    </section>
  );
}

/** A lookup's rows, or null when its storage could not be read. */
async function read<T>(run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch { return null; }
}

export default async function PlayersPage(props: { searchParams: Promise<PlayerSearchParams> }) {
  const seen = playerPagesOn();
  const armory = armoryOn();
  if (!seen && !armory) notFound();
  const params = await props.searchParams;
  const d = playerDirectoryQuery(params);
  const q = d.q;
  const prefix = seen && q ? searchPrefix(q) : null;
  const fullName = armory && q ? armoryNameQuery(q) : null;
  const active = activeDirectoryFilters(d);
  // Before a search or a filter the page also offers what is already public elsewhere: the latest reads and the boards' tops.
  const landing = armory && !q && active === 0 && d.page === 1;
  const [players, loaded, recent, best] = await Promise.all([
    prefix ? read(() => searchPlayers(prefix.toLowerCase())) : [] as Player[],
    armory ? read(async () => ({ page: await armoryStore().directory(d) })) : undefined,
    landing ? read(async () => (await armoryStore().directory({ ...playerDirectoryQuery({}), sort: "fetched_at", limit: RECENT, offset: 0 }))?.rows ?? []) : null,
    landing ? read(() => armoryStore().topPerClass("item_level", null, null)) : null,
  ]);
  const directory = loaded?.page;
  // Keep the old name lookup usable while the directory's database function awaits the owner's approval.
  const fallback = directory === null && fullName ? await read(() => armoryStore().search(fullName, LIMIT)) : [];
  const hits = directory?.rows ?? fallback ?? [];
  const searched = Boolean(prefix || fullName || (armory && /^\p{L}$/u.test(q)));
  const merged = mergeLookup(players ?? [], hits);
  const byKey = new Map(merged.map((r) => [r.key, r]));
  // mergeLookup sorts names; the directory keeps the database's order.
  const rows: DirectoryRow[] = armory ? hits.map((h) => ({ ...byKey.get(`armory/${h.region}/${h.slug}`)!,
    gearScore: "gearScore" in h ? (h as ArmoryDirectoryRow).gearScore : null,
    itemLevel: "itemLevel" in h ? (h as ArmoryDirectoryRow).itemLevel : null,
    fetchedAt: "fetchedAt" in h ? (h as ArmoryDirectoryRow).fetchedAt : undefined,
    ...directoryExtras(h) })) : merged;
  const sightings = armory ? merged.filter((r) => !r.sources.includes("armory")) : [];
  const unreachable = players === null || loaded === null || fallback === null;
  const count = rows.length + sightings.length;
  const capped = (players?.length ?? 0) >= LIMIT;
  // A full name the armory has not read yet: /search can ask Blizzard for it now (its lookup on a miss).
  const askBlizzard = fullName?.includes(" ") && directory?.total === 0;
  const blank = playerDirectoryQuery({});
  const guildHref = (guild: string) => playerDirectoryHref({ ...blank, guildPrefix: guild }, 1);
  const sorted = Object.entries(SORT_OF_COLUMN).find(([, s]) => s.value === d.sort)!;
  const emptyMessage = d.page > 1 && directory?.total ? "No profiles on this page."
    : q ? `No character matches “${q}”${active ? " with these filters" : ""}.`
    : active ? "No character matches these filters yet." : "No Blizzard profile has been read yet.";

  return (
    <Container width="data">
      <article className="space-y-6">
        <JsonLd data={{ "@context": "https://schema.org", "@type": "WebPage", name: "Find a player", url: absoluteUrl("/players") }} />
        <PageHeader
          trail={trailFor("/players") ?? undefined}
          title="Find a player"
          lede={[
            seen && "Characters the Everloot addon has seen: race, class, level, guild and the day it saw them. Not where they were, what they wear or what they did.",
            armory && "Characters read from Blizzard's API, with their gear, on the Blizzard profile pages.",
          ].filter(Boolean).join(" ")}
          meta={<span>To have a character removed, use the hide link next to it{seen && <>, the <Link href="/players/opt-out" className={link}>hide form</Link></>}{armory && <>{seen ? " or" : ", or"} the <Link href={ARMORY_HIDE_PATH} className={link}>Blizzard profile hide form</Link></>}.</span>}
        />

        <form action="/players" method="get" role="search" aria-label="Find a player" className="flex flex-wrap items-end gap-3">
          <label className="grid w-full min-w-0 gap-1 text-meta text-fg-2 sm:w-auto sm:max-w-xs sm:flex-1" htmlFor="player-q">Character name
            <Input id="player-q" name="q" type="search" defaultValue={q} maxLength={40} autoComplete="off" placeholder={armory ? "Name, surname or full name" : "Start of a name, 2 letters or more"} />
          </label>
          {armory && <>
            <label htmlFor="player-guild" className="grid w-full min-w-0 gap-1 text-meta text-fg-2 sm:w-auto sm:max-w-xs sm:flex-1">Guild
              <Input id="player-guild" name="guild" defaultValue={d.guildPrefix ?? ""} maxLength={80} autoComplete="off" placeholder="Start of a guild name" />
            </label>
            {keptFields(d).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          </>}
          <button type="submit" className="btn btn-primary min-h-11">Find</button>
        </form>

        {q && !searched && <p className="text-sm text-fg-2">{armory ? "Type 1 to 24 letters of a name or surname, or a full name, with no digits or hyphens." : "Type 2 to 12 letters. Names have no digits or spaces."}</p>}
        {unreachable && <p role="status" className="text-sm text-fg-2">{STORAGE_UNREACHABLE}</p>}
        {armory && directory === null && <p role="status" className="text-sm text-fg-2">Directory filters and gear sorting start once the database update is applied. Name search is still available.</p>}
        {askBlizzard && (
          <p className="text-sm text-fg-2">
            Not read from Blizzard yet? <Link href={`/search?q=${encodeURIComponent(q)}`} className={link}>Search the whole site for &ldquo;{q}&rdquo;</Link>, which
            asks Blizzard&apos;s API for a full name it has not read, or <Link href={ARMORY_SUBMIT_PATH} className={link}>add the character</Link>.
          </p>
        )}

        {(armory || count > 0 || (searched && !unreachable)) && (
          <section aria-labelledby="player-results" className="space-y-3">
            <SectionHeading id="player-results">
              {q ? <>{count} {count === 1 ? "character" : "characters"} matching &ldquo;{q}&rdquo; on this page</> : armory ? "Blizzard profiles" : "Players"}
            </SectionHeading>
            {directory && (
              <FilterBar
                label="Player filters"
                controls={filterControls(d)}
                active={active}
                clearHref={playerDirectoryHref({ ...blank, q }, 1)}
                nofollow
                aside={<ResultStrip total={directory.total} noun={directory.total === 1 ? "Blizzard profile" : "Blizzard profiles"} page={d.page} perPage={d.limit} nofollow
                  href={(page) => playerDirectoryHref(d, page)} sizeHref={(per) => playerDirectoryHref({ ...d, per }, 1)} />}
              />
            )}
            {rows.length > 0 && (
              <DataTable
                dense
                nofollow
                caption={q ? `Characters matching ${q}` : "Blizzard profiles"}
                columns={armory ? columns(guildHref, rows.some((r) => r.lastLogin !== undefined)) : columns(null)}
                rows={rows}
                rowKey={(r) => r.key}
                meta={rowMeta}
                sort={directory ? { key: sorted[0], direction: d.sort === "name" ? "asc" : "desc" } : undefined}
                sortHref={directory ? (key) => playerDirectoryHref({ ...d, sort: SORT_OF_COLUMN[key]!.value }, 1) : undefined}
              />
            )}
            {count === 0 && !unreachable && (armory ? directory : searched) && (
              <EmptyState
                message={emptyMessage}
                action={active ? { href: "/players", label: "Clear filters" } : q ? { href: "/players", label: "Clear the search" } : { href: ARMORY_SUBMIT_PATH, label: "Add a character" }}
              />
            )}
            {directory && directory.rows.length > 0 && <ArmoryCredit at={newest(directory.rows.map((r) => r.fetchedAt))} />}
            {sightings.length > 0 && <>
              <h3 className="text-h2-sm text-fg">Seen by the addon</h3>
              <p className="text-meta text-fg-2">Name matches from addon sightings. The filters apply to Blizzard profiles above; these sightings have no gear read. Dates here are the day last seen.</p>
              <DataTable dense caption="Addon name matches" columns={columns(null)} rows={sightings} rowKey={(r) => r.key} meta={rowMeta} />
            </>}
            {capped && <p className="text-sm text-muted">Type more of the name to narrow it down.</p>}
          </section>
        )}

        {((recent && recent.length > 0) || (best && best.length > 0)) && (
          <div className="grid gap-6 lg:grid-cols-2">
            {recent && recent.length > 0 && <Recent rows={recent} />}
            {best && best.length > 0 && <BestOfClass rows={best} />}
          </div>
        )}
      </article>
    </Container>
  );
}
