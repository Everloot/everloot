import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Container, DataTable, EmptyState, FilterBar, Input, PageHeader, ResultStrip, SectionHeading, type Column, type FilterControl } from "@/components/ui";
import { FAMILIES } from "@/data/families";
import { armoryOn } from "@/lib/armory";
import { dataAgeLabel } from "@/lib/data-age";
import {
  factionLabel, guildPath, guildSearchPrefix, guildsOn, ladderHref, loadGuildData, loadGuildRealms, loadGuildSearch, loadLadder, parseLadderQuery, raidsOpen, realmPath,
  type BossFirst, type LadderQuery, type RankedRow,
} from "@/lib/guilds";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import type { GuildSummary } from "../../../../kb/src/guilds";
import { LADDER_PAGE } from "../../../../kb/src/guilds";
import { BossStrip, day, FactionMark, guildRobots, link, number, Progress, rulesetLabel } from "./parts";

export const dynamic = "force-dynamic";

const DESCRIPTION = "WoW: Forever guilds by progression: a ladder per raid from the kills two members' uploads agree on, each guild's bosses, roster sightings and activity.";
const START_LINE = "The ladder starts with the first kill two members report.";
/** Before raids open, said in place of a raid ranking. Nothing is estimated in its place. */
const RAIDS_LINE = "Ranking starts when raids open on December 9.";

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

export default async function GuildsPage(props: { searchParams: Promise<Search> }) {
  if (!guildsOn()) notFound();
  const params = await props.searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, 40);
  const prefix = q ? guildSearchPrefix(q) : null;
  const query = parseLadderQuery(params);
  const open = raidsOpen();
  const data = await loadGuildData();
  const [ladder, found, realms] = await Promise.all([
    data.unreachable ? null : loadLadder(data, query),
    prefix ? loadGuildSearch(prefix) : null,
    // Without a readable hide list no guild is counted, as no guild is listed.
    data.unreachable ? null : loadGuildRealms(),
  ]);
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
          trail={[{ name: "Home", path: "/" }, { name: "Guilds", path: "/guilds" }]}
          title="Guilds"
          lede="WoW: Forever guilds by progression, from their members' uploads."
          meta={!data.unreachable && <span>{dataAgeLabel(data.dataAsOf)}</span>}
        />
        <div className="space-y-6">
          {armoryOn() && <p className="text-sm text-fg-2">Guild rosters as Blizzard&apos;s API lists them are in the <Link href="/armory" className={link}>armory</Link>.</p>}
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

          {data.unreachable || !ladder ? (
            <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
          ) : !ladder.instance ? (
            <StartState line={open ? START_LINE : RAIDS_LINE} />
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

/** Before the first agreed kill: the start line, then what the ladder will hold. */
function StartState({ line }: { line: string }) {
  return (
    <div className="space-y-4">
      <EmptyState message={line} />
      <Card as="section" aria-labelledby="what-will-be-here">
        <h2 id="what-will-be-here" className="text-h2-sm text-fg sm:text-h2">What will be here</h2>
        <ol className="mt-3 grid gap-3 text-cell text-fg-2 sm:grid-cols-3">
          <li className="flex gap-3"><span className="w-5 shrink-0 font-mono text-muted">1</span><span>A ladder per raid: bosses killed, then who got there first.</span></li>
          <li className="flex gap-3"><span className="w-5 shrink-0 font-mono text-muted">2</span><span>A page per guild with each boss and the day it fell.</span></li>
          <li className="flex gap-3"><span className="w-5 shrink-0 font-mono text-muted">3</span><span>Filters by ruleset, realm and faction.</span></li>
        </ol>
      </Card>
    </div>
  );
}
