import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, DataTable, EmptyState, FilterBar, Input, PageHeader, ResultStrip, SectionHeading, type Column, type FilterControl } from "@/components/ui";
import { FAMILIES } from "@/data/families";
import { ARMORY_REGIONS, ARMORY_RULESETS, armoryGuildPath, armoryOn, metricValue, regionLabel } from "@/lib/armory";
import type { ArmoryGuildRow } from "@/lib/armory-store";
import {
  GUILD_DIRECTORY_PAGE, GUILD_SORTS, guildDirectoryHref, guildDirectoryQuery, loadGuildDirectory, rulesetSlug, type GuildDirectoryQuery,
} from "@/lib/armory-guilds";
import { dataAgeLabel } from "@/lib/data-age";
import {
  factionLabel, guildPath, guildSearchPrefix, guildsOn, LADDER_LINE, ladderHref, loadGuildData, loadGuildRealms, loadGuildSearch, loadLadder, parseLadderQuery, RAIDS_LINE, raidsOpen, realmPath, START_LINE,
  type BossFirst, type LadderQuery, type RankedRow,
} from "@/lib/guilds";
import { playerStore } from "@/lib/player-store";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import type { GuildSummary } from "@kb/guilds";
import { LADDER_PAGE } from "@kb/guilds";
import { ArmoryCredit, newest, NOINDEX, RegionRuleset, Unreachable } from "../armory/parts";
import { BossStrip, day, FactionMark, guildRobots, link, number, Progress, rulesetLabel } from "./parts";

export const dynamic = "force-dynamic";

const DESCRIPTION = "WoW: Forever guilds: find one by name, filter by region and ruleset, see how many members were read, and follow progression from members' uploads.";

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata(props: { searchParams: Promise<Search> }): Promise<Metadata> {
  if (!guildsOn() && !armoryOn()) return {};
  const params = await props.searchParams;
  return {
    ...pageMetadata({ title: "WoW Forever Guilds", description: DESCRIPTION, path: "/guilds" }),
    // The directory is Blizzard's API data, which stays out of search engines as every armory page does.
    robots: armoryOn() ? NOINDEX : guildRobots(Object.keys(params).length > 0),
  };
}

/** "World 3 · Forever 2 · Horde 1": the guild's standing outside the current filters. */
const ranksText = (r: RankedRow) =>
  [`World ${r.ranks.world}`, `${rulesetLabel(r.ruleset)} ${r.ranks.ruleset}`, r.ranks.faction && r.faction ? `${factionLabel(r.faction)} ${r.ranks.faction}` : ""].filter(Boolean).join(" · ");

const ladderColumns: Column<RankedRow>[] = [
  {
    key: "guild", header: "Guild",
    cell: (r) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="w-6 shrink-0 text-right font-mono tabular-nums text-muted">{r.rank}</span>
        <Link href={guildPath(r.realm, r.guildName)} className={`${link} font-medium`}>{r.guildName}</Link>
      </span>
    ),
  },
  { key: "realm", header: "Realm", cell: (r) => r.realm },
  { key: "faction", header: "Faction", nowrap: true, cell: (r) => <FactionMark faction={r.faction} /> },
  { key: "progress", header: "Progress", numeric: true, cell: (r) => <Progress killed={r.killed} bosses={r.bosses} className="justify-end" /> },
  { key: "bosses", header: "Bosses", nowrap: true, cell: (r) => <BossStrip list={r.list} /> },
  { key: "ranks", header: "Ranks", nowrap: true, cell: (r) => <span className="text-cell-2 text-fg-2">{ranksText(r)}</span> },
  { key: "latest", header: "Latest kill", numeric: true, cell: (r) => (r.latestKillAt ? day(r.latestKillAt) : <span className="text-muted">Officers, no date</span>) },
  { key: "seen", header: "Members seen", numeric: true, cell: (r) => (r.membersSeen === null ? <span className="text-muted">Not counted</span> : number(r.membersSeen)) },
];

const firstNames = (b: BossFirst) => b.guilds.map((g) => g.guildName).join(", ") + (b.guilds.length > 1 ? " (joint)" : "");

const firstColumns: Column<BossFirst>[] = [
  { key: "boss", header: "Boss", cell: (b) => <span className="font-medium">{b.name}</span> },
  {
    key: "guild", header: "First kill",
    cell: (b) => (b.guilds.length === 0 ? <span className="text-muted">Not yet</span> : (
      <span className="flex flex-wrap items-baseline gap-x-2">
        {b.guilds.map((g) => <Link key={g.key} href={guildPath(g.realm, g.guildName)} className={link}>{g.guildName}</Link>)}
        {b.guilds.length > 1 && <span className="text-cell-2 text-muted">Joint</span>}
      </span>
    )),
  },
  { key: "realm", header: "Realm", cell: (b) => [...new Set(b.guilds.map((g) => g.realm))].join(", ") },
  { key: "day", header: "Day", numeric: true, cell: (b) => <span className="font-mono tabular-nums">{day(b.killedAt)}</span> },
];

const searchColumns: Column<GuildSummary>[] = [
  { key: "guild", header: "Guild", cell: (g) => <Link href={guildPath(g.realm, g.guildName)} className={`${link} font-medium`}>{g.guildName}</Link> },
  { key: "realm", header: "Realm", cell: (g) => g.realm },
  { key: "faction", header: "Faction", nowrap: true, cell: (g) => <FactionMark faction={g.faction} /> },
  { key: "kills", header: "Agreed kills", numeric: true, cell: (g) => number(g.kills) },
  { key: "latest", header: "Latest kill", numeric: true, cell: (g) => (g.latestKillAt ? day(g.latestKillAt) : "") },
  { key: "seen", header: "Members seen", numeric: true, cell: (g) => (g.membersSeen === null ? <span className="text-muted">Not counted</span> : number(g.membersSeen)) },
];

const muted = (text: string) => <span className="text-muted">{text}</span>;

function directoryColumns(counted: boolean): Column<ArmoryGuildRow>[] {
  const all: Column<ArmoryGuildRow>[] = [
    { key: "name", header: "Guild", cell: (g) => <span className="inline-flex flex-wrap items-center gap-2"><Link href={armoryGuildPath(g.region, g.slug)} className={`${link} font-medium`}>{g.name}</Link>{g.recruiting && <span className="rounded-control border border-edge px-2 py-1 text-meta text-fg-2">Recruiting</span>}</span> },
    { key: "where", header: "Region", nowrap: true, cell: (g) => <RegionRuleset region={g.region} ruleset={g.ruleset} /> },
    { key: "faction", header: "Faction", nowrap: true, cell: (g) => g.faction },
    { key: "roster", header: "Roster", numeric: true, cell: (g) => number(g.memberCount) },
    { key: "read", header: "Members read", numeric: true, cell: (g) => number(g.membersRead) },
    { key: "il", header: "Avg item level", numeric: true, cell: (g) => (g.averageItemLevel === null ? muted("Not read") : metricValue("item-level", g.averageItemLevel)) },
    { key: "l60", header: "Level 60", numeric: true, cell: (g) => number(g.level60) },
    { key: "at", header: "Last read", numeric: true, cell: (g) => <span className="font-mono tabular-nums">{day(g.fetchedAt)}</span> },
  ];
  // Before the directory's migration only the name, region, faction and roster size are known.
  return counted ? all : all.filter((c) => ["name", "where", "faction", "roster"].includes(c.key));
}

function directoryControls(d: GuildDirectoryQuery): FilterControl[] {
  const href = (over: Partial<GuildDirectoryQuery>) => guildDirectoryHref({ ...d, page: 1, ...over });
  return [
    {
      type: "menu", key: "sort", label: `Sort: ${GUILD_SORTS.find((s) => s.slug === d.sort)!.label}`,
      options: GUILD_SORTS.map((s) => ({ label: s.label, href: href({ sort: s.slug }), on: d.sort === s.slug, reset: s.slug === "members" })),
    },
    {
      type: "menu", key: "region", label: d.region ? regionLabel(d.region) : "Region",
      options: [
        { label: "All regions", href: href({ region: null }), on: d.region === null, reset: true },
        ...ARMORY_REGIONS.map((r) => ({ label: regionLabel(r), href: href({ region: r }), on: d.region === r })),
      ],
    },
    {
      type: "menu", key: "rules", label: ARMORY_RULESETS.find((r) => r.id === d.ruleset)?.label ?? "Ruleset",
      options: [
        { label: "All rulesets", href: href({ ruleset: null }), on: d.ruleset === null, reset: true },
        ...ARMORY_RULESETS.map((r) => ({ label: r.label, href: href({ ruleset: r.id }), on: d.ruleset === r.id })),
      ],
    },
  ];
}

/** The guild hide list, or null when it could not be read (then the directory lists no guild). */
async function hiddenGuilds(): Promise<Set<string> | null> {
  try { return await playerStore().hiddenGuilds(); } catch { return null; }
}

export default async function GuildsPage(props: { searchParams: Promise<Search> }) {
  const progression = guildsOn();
  const armory = armoryOn();
  if (!progression && !armory) notFound();
  const params = await props.searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, 40);
  const prefix = progression && q ? guildSearchPrefix(q) : null;
  const query = parseLadderQuery(params);
  const open = raidsOpen();
  // The directory matches one word from the start of the name, so a name of several words searches it by the first.
  const d = guildDirectoryQuery({ ...params, q: q.split(/\s+/)[0] });
  const data = progression ? await loadGuildData() : null;
  const [ladder, found, realms, dir] = await Promise.all([
    !data || data.unreachable ? null : loadLadder(data, query),
    prefix ? loadGuildSearch(prefix) : null,
    // Without a readable hide list no guild is counted, as no guild is listed.
    !data || data.unreachable ? null : loadGuildRealms(),
    armory ? hiddenGuilds().then((hidden) => loadGuildDirectory(d, hidden)) : null,
  ]);
  // The one box feeds both searches; it says the rule only when neither could take the text.
  const refused = Boolean(q) && !prefix && (!armory || d.prefix === null);
  const ruleset = ARMORY_RULESETS.find((r) => r.id === d.ruleset);
  const href = (change: Partial<LadderQuery>) => ladderHref({ ...query, page: undefined, ...change });
  const controls: FilterControl[] = ladder?.instance ? [
    {
      type: "menu", key: "instance", label: ladder.instance.name,
      options: ladder.instances.map((i) => ({ label: i.name, href: href({ instance: i.instanceMapId, realm: undefined }), on: i.instanceMapId === ladder.instance!.instanceMapId })),
    },
    // While every guild is on one ruleset (player rows are all "forever" for now) the menu would only repeat it; it
    // shows once there are two, or when the address picks one, so the choice can be cleared.
    ...(ladder.rulesets.length > 1 || query.ruleset ? [{
      type: "menu" as const, key: "ruleset", label: query.ruleset ? rulesetLabel(query.ruleset) : "Ruleset",
      options: [
        { label: "Every ruleset", href: href({ ruleset: undefined }), on: !query.ruleset, reset: true },
        ...ladder.rulesets.map((r) => ({ label: rulesetLabel(r), href: href({ ruleset: r, realm: undefined }), on: query.ruleset === r })),
      ],
    }] : []),
    {
      type: "menu", key: "realm", label: query.realm ?? "Realm",
      options: [
        { label: "Every realm", href: href({ realm: undefined }), on: !query.realm, reset: true },
        ...ladder.realms.map((r) => ({ label: r, href: href({ realm: r }), on: query.realm?.toLowerCase() === r.toLowerCase() })),
      ],
    },
    {
      type: "menu", key: "faction", label: query.faction === "alliance" ? "Alliance" : query.faction === "horde" ? "Horde" : "Faction",
      options: [
        { label: "Both factions", href: href({ faction: undefined }), on: !query.faction, reset: true },
        { label: "Alliance", href: href({ faction: "alliance" }), on: query.faction === "alliance" },
        { label: "Horde", href: href({ faction: "horde" }), on: query.faction === "horde" },
      ],
    },
  ] : [];

  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={trailFor("/guilds")!}
          title="Guilds"
          lede={armory
            ? "WoW: Forever guilds read from Blizzard's API, with the characters read in each, and progression from members' uploads."
            : "WoW: Forever guilds by progression, from their members' uploads."}
          meta={armory
            ? <ArmoryCredit at={!dir || dir.state === "unreachable" ? null : newest(dir.rows.map((r) => r.fetchedAt))} />
            : data && !data.unreachable && <span>{dataAgeLabel(data.dataAsOf)}</span>}
        />
        <div className="space-y-6">
          <form action="/guilds" method="get" role="search" className="flex max-w-xl flex-col gap-2 sm:flex-row">
            <label htmlFor="guild-q" className="sr-only">Guild name</label>
            <Input id="guild-q" name="q" type="search" defaultValue={q} maxLength={40} autoComplete="off" placeholder="Start of a guild name, 2 letters or more" className="flex-1" />
            {armory && d.region && <input type="hidden" name="region" value={d.region} />}
            {armory && ruleset && <input type="hidden" name="rules" value={rulesetSlug(ruleset.label)} />}
            {armory && d.sort !== "members" && <input type="hidden" name="sort" value={d.sort} />}
            <button type="submit" className="btn btn-primary min-h-11">Find a guild</button>
          </form>
          {refused && <p className="text-sm text-fg-2">Type 2 to 24 letters of the guild&apos;s name.</p>}
          {dir && (dir.state === "unreachable" ? <Unreachable /> : (
            <section aria-labelledby="directory" className="space-y-3">
              <SectionHeading id="directory" note="Members read counts the characters the armory has read whose guild this is; the roster is Blizzard's own count. A character who asked to be hidden is not counted.">
                Read from Blizzard&apos;s API
              </SectionHeading>
              <FilterBar
                label="Directory filters"
                controls={directoryControls(d)}
                active={[d.region, d.ruleset, d.prefix].filter((v) => v !== null).length + (d.sort === "members" ? 0 : 1)}
                clearHref={guildDirectoryHref({})}
                aside={dir.state === "ready" && dir.total > 0 && (
                  <ResultStrip total={dir.total} noun="guilds" page={d.page} perPage={GUILD_DIRECTORY_PAGE} href={(page) => guildDirectoryHref({ ...d, page })} />
                )}
              />
              {dir.state === "not-ready" && (
                <p role="status" className="text-sm text-fg-2">
                  Counts and sorting start once the directory&apos;s database update is applied.
                  {d.prefix ? " Until then a search finds guilds by name." : " Until then, search a guild by name."}
                </p>
              )}
              {dir.rows.length === 0
                ? <EmptyState message={
                    dir.state === "ready" && d.page > 1 && dir.total > 0 ? "No guilds on this page."
                    : d.prefix ? `No guild read yet starts with “${d.prefix}”.`
                    : dir.state === "ready" ? "No guild matches these filters yet." : "No guild to list yet."
                  } action={{ href: "/armory/guilds/submit", label: "Add a guild" }} />
                : <DataTable
                    dense
                    caption={d.prefix ? `Guilds whose name starts with ${d.prefix}` : "Guilds read from Blizzard's API"}
                    columns={directoryColumns(dir.state === "ready")}
                    rows={dir.rows}
                    rowKey={(g) => `${g.region}/${g.slug}`}
                    meta={(g) => `${regionLabel(g.region)} ${g.ruleset} · ${number(g.memberCount)} on the roster`}
                  />}
              <p className="text-meta text-muted" data-disbanded-note>Disbanded guilds are left out of this list and its counts.</p>
            </section>
          ))}
          {found && (
            <section aria-labelledby="guild-results" className="space-y-3">
              <SectionHeading id="guild-results">
                {found.results.length === 0 ? <>No guild starts with &ldquo;{prefix}&rdquo;</> : <>{found.results.length} {found.results.length === 1 ? "guild" : "guilds"} starting with &ldquo;{prefix}&rdquo;</>}
              </SectionHeading>
              {found.results.length === 0
                ? <p className="text-sm text-fg-2">{found.unreachable ? STORAGE_UNREACHABLE : "A guild is listed once two members report a kill, its officers publish a board, or the addon sees a character in it."}</p>
                : <DataTable dense caption={`Guilds whose name starts with ${prefix}`} columns={searchColumns} rows={found.results} rowKey={(g) => g.key} meta={(g) => `${g.realm} · ${number(g.kills)} agreed kills`} />}
            </section>
          )}
          {realms && realms.length > 0 && (
            <section aria-labelledby="realms">
              <h2 id="realms" className="text-cell font-medium text-fg">Realms</h2>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-cell">
                {realms.map((r) => (
                  <li key={r.realm}>
                    <Link href={realmPath(r.realm)} className={link}>{r.realm}</Link> <span className="tabular-nums text-muted">{number(r.guilds)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!data ? null : data.unreachable || !ladder ? (
            <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
          ) : !ladder.instance ? (
            <p className="text-cell text-fg-2">{open ? START_LINE : LADDER_LINE}</p>
          ) : (
            <>
              {!ladder.instances.some((i) => i.instanceType === "raid") && <p className="text-cell text-fg-2">{open ? START_LINE : RAIDS_LINE}</p>}
              <section aria-labelledby="ladder" className="space-y-3">
                <SectionHeading
                  id="ladder"
                  note={ladder.instance.instanceType === "raid"
                    ? "Bosses killed, then who reached the latest kill first. Equal rows share a rank. No score."
                    : "A dungeon: bosses cleared, then who got there first. Equal rows share a rank. No score."}
                >
                  {ladder.instance.name}
                </SectionHeading>
                <FilterBar
                  label="Ladder filters"
                  controls={controls}
                  active={(query.ruleset ? 1 : 0) + (query.realm ? 1 : 0) + (query.faction ? 1 : 0)}
                  clearHref={href({ ruleset: undefined, realm: undefined, faction: undefined })}
                  aside={ladder.total > 0 && <ResultStrip total={ladder.total} noun="guilds" page={ladder.page} perPage={LADDER_PAGE} href={(page) => ladderHref({ ...query, page })} />}
                />
                {ladder.rows.length === 0
                  ? <p className="text-sm text-fg-2">No guild matches these filters yet.</p>
                  : <DataTable dense caption={`${ladder.instance.name} ladder`} columns={ladderColumns} rows={ladder.rows} rowKey={(r) => r.key} meta={(r) => `${r.realm} · ${r.killed}/${r.bosses} · ${ranksText(r)}`} />}
              </section>
              {ladder.total > 0 && (
                <section aria-labelledby="firsts" className="space-y-3">
                  <SectionHeading id="firsts" note="The first guild in this view to kill each boss: two members' uploads have to report the same kill within an hour of each other. Guilds with the same time share it. Officers' kills carry no day.">
                    First kills
                  </SectionHeading>
                  <DataTable dense caption={`First kills in ${ladder.instance.name}`} columns={firstColumns} rows={ladder.firsts} rowKey={(b) => String(b.encounterId)} meta={(b) => (b.guilds.length ? `${firstNames(b)} · ${day(b.killedAt)}` : "Not yet")} />
                </section>
              )}
            </>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:gap-6">
            <Card as="section" aria-labelledby="publish">
              <h2 id="publish" className="text-h2-sm text-fg sm:text-h2">Publish your guild</h2>
              <p className="mt-2 text-cell text-fg-2">
                Officers can publish the roster, lockouts, attendance and loot from their own uploads. Two officer uploads
                have to agree before anything shows.
              </p>
              <p className="mt-3"><Link href="/tools/guild-board" className={link}>Open the guild board</Link></p>
            </Card>
            <Card as="section" aria-labelledby="families">
              <h2 id="families" className="text-h2-sm text-fg sm:text-h2">Guild families</h2>
              <ul className="mt-2 space-y-1 text-cell">
                {FAMILIES.map((f) => <li key={f.slug}><Link href={`/guilds/${f.slug}`} className={link}>{f.name}</Link></li>)}
              </ul>
            </Card>
          </div>
          <p className="text-sm text-muted">
            <Link href="/methodology#guilds" className={link}>How guilds are counted</Link> · <Link href="/guilds/hide" className={link}>Hide a guild</Link>
          </p>
        </div>
      </article>
    </Container>
  );
}
