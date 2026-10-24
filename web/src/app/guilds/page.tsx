import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Container, DataTable, EmptyState, FilterBar, Input, PageHeader, ResultStrip, SectionHeading, type Column, type FilterControl } from "@/components/ui";
import { FAMILIES } from "@/data/families";
import { dataAgeLabel } from "@/lib/data-age";
import {
  guildPath, guildSearchPrefix, guildsOn, ladderHref, loadGuildData, loadGuildSearch, loadLadder, parseLadderQuery, type LadderQuery,
} from "@/lib/guilds";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import type { GuildSummary, LadderRow } from "../../../../kb/src/guilds";
import { LADDER_PAGE } from "../../../../kb/src/guilds";
import { day, FactionMark, guildRobots, link, number, Progress } from "./parts";

export const dynamic = "force-dynamic";

const DESCRIPTION = "WoW: Forever guilds by progression: a ladder per raid from the kills two members' uploads agree on, each guild's bosses, roster sightings and activity.";
const START_LINE = "The ladder starts with the first kill two members report.";

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata(props: { searchParams: Promise<Search> }): Promise<Metadata> {
  if (!guildsOn()) return {};
  const params = await props.searchParams;
  return {
    ...pageMetadata({ title: "WoW Forever Guilds by Progression", description: DESCRIPTION, path: "/guilds" }),
    robots: guildRobots(Object.keys(params).length > 0),
  };
}

const ladderColumns: Column<LadderRow>[] = [
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
  { key: "latest", header: "Latest kill", numeric: true, cell: (r) => (r.latestKillAt ? day(r.latestKillAt) : <span className="text-muted">Officers, no date</span>) },
  { key: "seen", header: "Members seen", numeric: true, cell: (r) => (r.membersSeen === null ? <span className="text-muted">Not counted</span> : number(r.membersSeen)) },
];

const searchColumns: Column<GuildSummary>[] = [
  { key: "guild", header: "Guild", cell: (g) => <Link href={guildPath(g.realm, g.guildName)} className={`${link} font-medium`}>{g.guildName}</Link> },
  { key: "realm", header: "Realm", cell: (g) => g.realm },
  { key: "faction", header: "Faction", nowrap: true, cell: (g) => <FactionMark faction={g.faction} /> },
  { key: "kills", header: "Agreed kills", numeric: true, cell: (g) => number(g.kills) },
  { key: "latest", header: "Latest kill", numeric: true, cell: (g) => (g.latestKillAt ? day(g.latestKillAt) : "") },
  { key: "seen", header: "Members seen", numeric: true, cell: (g) => (g.membersSeen === null ? <span className="text-muted">Not counted</span> : number(g.membersSeen)) },
];

export default async function GuildsPage(props: { searchParams: Promise<Search> }) {
  if (!guildsOn()) notFound();
  const params = await props.searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, 40);
  const prefix = q ? guildSearchPrefix(q) : null;
  const query = parseLadderQuery(params);
  const data = await loadGuildData();
  const [ladder, found] = await Promise.all([
    data.unreachable ? null : loadLadder(data, query),
    prefix ? loadGuildSearch(prefix) : null,
  ]);
  const href = (change: Partial<LadderQuery>) => ladderHref({ ...query, page: undefined, ...change });
  const controls: FilterControl[] = ladder?.instance ? [
    {
      type: "menu", key: "instance", label: ladder.instance.name,
      options: ladder.instances.map((i) => ({ label: i.name, href: href({ instance: i.instanceMapId, realm: undefined }), on: i.instanceMapId === ladder.instance!.instanceMapId })),
    },
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
          trail={[{ name: "Home", path: "/" }, { name: "Guilds", path: "/guilds" }]}
          title="Guilds"
          lede="WoW: Forever guilds by progression, from their members' uploads."
          meta={!data.unreachable && <span>{dataAgeLabel(data.dataAsOf)}</span>}
        />
        <div className="space-y-6">
          <form action="/guilds" method="get" role="search" className="flex max-w-xl flex-col gap-2 sm:flex-row">
            <label htmlFor="guild-q" className="sr-only">Guild name</label>
            <Input id="guild-q" name="q" type="search" defaultValue={q} maxLength={40} autoComplete="off" placeholder="Start of a guild name, 2 letters or more" className="flex-1" />
            <button type="submit" className="btn btn-primary min-h-11">Find a guild</button>
          </form>
          {q && !prefix && <p className="text-sm text-fg-2">Type 2 to 24 letters of the guild&apos;s name.</p>}
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

          {data.unreachable || !ladder ? (
            <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
          ) : !ladder.instance ? (
            <StartState />
          ) : (
            <section aria-labelledby="ladder" className="space-y-3">
              <SectionHeading id="ladder" note="Bosses killed, then who reached the latest kill first. Equal rows share a rank. No score.">
                {ladder.instance.name}
              </SectionHeading>
              <FilterBar
                label="Ladder filters"
                controls={controls}
                active={(query.realm ? 1 : 0) + (query.faction ? 1 : 0)}
                clearHref={href({ realm: undefined, faction: undefined })}
                aside={ladder.total > 0 && <ResultStrip total={ladder.total} noun="guilds" page={ladder.page} perPage={LADDER_PAGE} href={(page) => ladderHref({ ...query, page })} />}
              />
              {ladder.rows.length === 0
                ? <p className="text-sm text-fg-2">No guild matches these filters yet.</p>
                : <DataTable dense caption={`${ladder.instance.name} ladder`} columns={ladderColumns} rows={ladder.rows} rowKey={(r) => r.key} meta={(r) => `${r.realm} · ${r.killed}/${r.bosses}`} />}
            </section>
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

/** Before the first agreed kill: the start line, then what the ladder will hold. */
function StartState() {
  return (
    <div className="space-y-4">
      <EmptyState message={START_LINE} />
      <Card as="section" aria-labelledby="what-will-be-here">
        <h2 id="what-will-be-here" className="text-h2-sm text-fg sm:text-h2">What will be here</h2>
        <ol className="mt-3 grid gap-3 text-cell text-fg-2 sm:grid-cols-3">
          <li className="flex gap-3"><span className="w-5 shrink-0 font-mono text-muted">1</span><span>A ladder per raid: bosses killed, then who got there first.</span></li>
          <li className="flex gap-3"><span className="w-5 shrink-0 font-mono text-muted">2</span><span>A page per guild with each boss and the day it fell.</span></li>
          <li className="flex gap-3"><span className="w-5 shrink-0 font-mono text-muted">3</span><span>Filters by realm and faction.</span></li>
        </ol>
      </Card>
    </div>
  );
}
