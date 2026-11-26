import GuildProgressionBoard from "@/components/progression/GuildProgressionBoard";
import type { GuildProgressionRank } from "@/lib/progression";
import Link from "next/link";
import { Card, DataTable, LinkTabs, SectionHeading, Tooltip, type Column } from "@/components/ui";
import { ARMORY_BOARDS, ARMORY_REGIONS, armoryBoardHref, armoryGuildPath, boardRanks, metricValue, regionLabel, type ArmoryRegion, type BoardRank } from "@/lib/armory";
import { guildDirectoryHref } from "@/lib/armory-guilds";
import type { ArmoryBoardRow, ArmoryGuildRow } from "@/lib/armory-store";
import { guildPath, LADDER_LINE, START_LINE, type RankedRow } from "@/lib/guilds";
import { BOARD_TOP, type BoardTop, type GuildGear, type RaidProgress } from "@/lib/leaderboards";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { ArmoryCredit, newest, RegionChip, RegionRuleset } from "../armory/parts";
import { BoardClass, BoardGuild, BoardMetric, BoardName, BoardValue, RankMark } from "../armory/board-parts";
import { day, Progress } from "../guilds/parts";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const number = (n: number) => n.toLocaleString("en-US");
const muted = (text: string) => <span className="text-muted">{text}</span>;
const unreachable = <p className="py-4 text-cell text-fg-2" role="status">{STORAGE_UNREACHABLE}</p>;

/** The hub's address for a region; both regions are the bare address. */
export const hubHref = (region: ArmoryRegion | null) => (region ? `/rankings?region=${region}` : "/rankings");

/** US and EU, US, or EU, in the URL: every board on the hub narrows to the region. */
export function RegionTabs({ region }: { region: ArmoryRegion | null }) {
  return (
    <LinkTabs
      label="Region"
      tabs={[
        { label: "US and EU", href: hubHref(null), current: region === null },
        ...ARMORY_REGIONS.map((r) => ({ label: regionLabel(r), href: hubHref(r), current: region === r })),
      ]}
    />
  );
}

/** Ranks that hold ties: a row on the same value as the one above shares its rank. */
const ranksBy = <T,>(rows: readonly T[], valueOf: (row: T) => number | null, rankOf?: (row: T, i: number) => number) => {
  const ranks = boardRanks(rows, valueOf, rankOf);
  return new Map(rows.map((r, i) => [r, ranks[i]!]));
};

/** One board's card: what it ranks, its top three (rank badge, the name in its class colour, the region chip, the value) and View all. */
function BoardCard({ board: { metric, rows }, region }: { board: BoardTop; region: ArmoryRegion | null }) {
  const title = ARMORY_BOARDS[metric].title;
  const ranks = rows ? boardRanks(rows, (r) => r.value, (r) => r.rank) : [];
  return (
    <Card as="section" aria-labelledby={`board-card-${metric}`} padding="none">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
        <h3 id={`board-card-${metric}`} className="text-h2-sm text-fg"><BoardMetric metric={metric} /></h3>
        <Link href={armoryBoardHref(metric, { region, ruleset: null })} className={`${link} shrink-0 text-control`}>View all<span className="sr-only">: {title}</span></Link>
      </div>
      {rows === null ? <div className="px-4">{unreachable}</div>
        : rows.length === 0 ? <p className="px-4 py-3 text-cell text-fg-2">No character with this number here yet.</p>
        : (
          <ol aria-label={`${title}: top ${rows.length}`} className="mt-2 border-t border-line">
            {rows.map((r, i) => (
              <li key={`${r.region}/${r.slug}`} className="flex min-h-row items-center gap-3 border-b border-line px-4 text-cell last:border-b-0">
                <RankMark rank={ranks[i]!} />
                <span className="min-w-0 flex-1 truncate"><BoardName row={r} /></span>
                <RegionChip region={r.region} />
                <span className="shrink-0 text-right font-mono tabular-nums text-fg">{metricValue(metric, r.value)}</span>
              </li>
            ))}
          </ol>
        )}
    </Card>
  );
}

/** Every character board as a card with its top three; each card's View all opens the full board in the region shown. */
export function BoardCards({ boards, region }: { boards: BoardTop[]; region: ArmoryRegion | null }) {
  const at = newest(boards.flatMap((b) => b.rows?.map((r) => r.fetchedAt) ?? []));
  const where = region ? `in ${regionLabel(region)}` : "with US and EU ranked together";
  return (
    <section aria-labelledby="characters" className="space-y-3">
      <SectionHeading id="characters" note={`The top ${BOARD_TOP} of each board ${where}, among the characters Everloot has read from Blizzard's armory. Equal numbers share a rank. A character's own page shows its rank within its region and ruleset.`} action={<ArmoryCredit at={at} />}>
        Character boards
      </SectionHeading>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {boards.map((b) => <BoardCard key={b.metric} board={b} region={region} />)}
      </div>
    </section>
  );
}

function GuildItemLevel({ guild: g }: { guild: ArmoryGuildRow }) {
  return g.averageItemLevel === null ? muted("Not read") : <Tooltip label={`Average item level: ${metricValue("item-level", g.averageItemLevel)}. Average of the guild members read. Read ${new Date(g.fetchedAt).toUTCString()}.`}>{metricValue("item-level", g.averageItemLevel)}</Tooltip>;
}

/** A guild's faction as a dot, as a character's is on the boards; the name beside it carries identity. */
const FactionDot = ({ faction }: { faction: string }) =>
  <span role="img" aria-label={faction} className={`h-2 w-2 shrink-0 rounded-full ${faction === "Alliance" ? "bg-faction-alliance" : faction === "Horde" ? "bg-faction-horde" : "bg-muted"}`} />;

const gearColumns = (ranks: Map<ArmoryGuildRow, BoardRank>): Column<ArmoryGuildRow>[] => [
  {
    key: "name", header: "Guild",
    cell: (g) => (
      <span className="flex min-w-0 items-center gap-2">
        <RankMark rank={ranks.get(g)!} />
        <FactionDot faction={g.faction} />
        <Link href={armoryGuildPath(g.region, g.slug)} className={`${link} font-medium`}>{g.name}</Link>
      </span>
    ),
  },
  { key: "where", header: "Region", nowrap: true, cell: (g) => <RegionRuleset region={g.region} ruleset={g.ruleset} /> },
  { key: "read", header: "Members read", numeric: true, cell: (g) => number(g.membersRead) },
  { key: "il", header: <Tooltip label="Average item level of the guild members the armory has read. Item level averages the gear a character wears.">Avg item level</Tooltip>, numeric: true, cell: (g) => <GuildItemLevel guild={g} /> },
];

const raidColumns = (ranks: Map<RankedRow, BoardRank>): Column<RankedRow>[] => [
  { key: "guild", header: "Guild", cell: (r) => <span className="flex min-w-0 items-center gap-x-2"><RankMark rank={ranks.get(r)!} /><Link href={guildPath(r.realm, r.guildName)} className={`${link} font-medium`}>{r.guildName}</Link></span> },
  { key: "realm", header: "Realm", cell: (r) => r.realm },
  { key: "progress", header: "Progress", numeric: true, cell: (r) => <Progress killed={r.killed} bosses={r.bosses} className="justify-end" /> },
  { key: "latest", header: "Latest kill", numeric: true, cell: (r) => (r.latestKillAt ? day(r.latestKillAt) : muted("Officers, no date")) },
];

/** Guilds by gear (the armory) and by raid progress (members' uploads), side by side; either may be off. */
export function GuildBoards({ gear, raids, region, progression }: { gear: GuildGear | null; raids: RaidProgress | null; region: ArmoryRegion | null; progression?: GuildProgressionRank[] }) {
  const note = [
    gear && (gear.state === "ready" && gear.minRead !== undefined
      ? `Gear is the average item level of the members the armory has read, for guilds with at least ${gear.minRead} members read.`
      : "Gear is the average item level of the members the armory has read."),
    raids && "Raid progress counts the bosses two members' installs report killed, in the newest raid; the ladder is by realm, so every region is in it.",
  ].filter(Boolean).join(" ");
  return (
    <section aria-labelledby="guilds" className="space-y-3">
      <SectionHeading id="guilds" note={note}>Guilds</SectionHeading>
      <div className="grid gap-4 lg:grid-cols-2">
        {gear && (
          <Card as="section" aria-labelledby="board-guild-gear" padding="none">
            <h3 id="board-guild-gear" className="sr-only">Guilds by gear</h3>
            {gear.state === "unreachable" ? <div className="px-4">{unreachable}</div>
              : gear.state === "not-ready" ? <p className="px-4 py-3 text-cell text-fg-2">Counts start once the directory&apos;s database update is applied.</p>
              : (
                <DataTable
                  dense
                  caption={`Guilds by average item level, top ${gear.rows.length}`}
                  columns={gearColumns(ranksBy(gear.rows, (g) => g.averageItemLevel))}
                  rows={gear.rows}
                  rowKey={(g) => `${g.region}/${g.slug}`}
                  meta={(g) => <span className="flex flex-wrap items-center gap-2"><span>{regionLabel(g.region)} · {number(g.membersRead)} read</span><GuildItemLevel guild={g} /></span>}
                  empty={<p className="px-4 py-3 text-cell text-fg-2">{gear.minRead === undefined ? "No guild with a member read here yet." : `No guild with ${gear.minRead} members read here yet.`}</p>}
                  toolbar={<h4 aria-hidden="true" className="px-4 pt-3 text-h2-sm text-fg">Gear</h4>}
                  footer={<Link href={guildDirectoryHref({ region, sort: "item-level" })} className={link}>Every guild by average item level</Link>}
                />
              )}
          </Card>
        )}
        <GuildProgressionBoard rows={progression} />
        {raids && (
          <Card as="section" aria-labelledby="board-raids" padding="none">
            <h3 id="board-raids" className="sr-only">Guilds by raid progress</h3>
            {raids.unreachable ? <div className="px-4">{unreachable}</div>
              : raids.rows.length === 0 ? <p className="px-4 py-3 text-cell text-fg-2">{raids.open ? START_LINE : LADDER_LINE}</p>
              : (
                <DataTable
                  dense
                  caption={`${raids.instance ?? "Raid"} progress, top ${raids.rows.length}`}
                  columns={raidColumns(ranksBy(raids.rows, (r) => r.ranks.world, (r) => r.ranks.world))}
                  rows={raids.rows}
                  rowKey={(r) => r.key}
                  meta={(r) => [r.realm, `${r.killed}/${r.bosses}`, r.latestKillAt && day(r.latestKillAt)].filter(Boolean).join(" · ")}
                  toolbar={<h4 aria-hidden="true" className="px-4 pt-3 text-h2-sm text-fg">Raid progress{raids.instance ? `: ${raids.instance}` : ""}</h4>}
                  footer={<Link href="/guilds" className={link}>The whole ladder, every raid</Link>}
                />
              )}
          </Card>
        )}
      </div>
    </section>
  );
}

/** Every class gets a place, even when its best character is outside the overall top 100. */
export function BestOfClass({ rows }: { rows: ArmoryBoardRow[] | null }) {
  return <section aria-labelledby="best-of-class" className="space-y-3">
    <SectionHeading id="best-of-class" note="The highest Gear Score read for each class, in the selected region.">Best of each class</SectionHeading>
    {rows === null ? unreachable : <Card padding="none"><DataTable dense caption="Best of each class by Gear Score"
      columns={[
        { key: "class", header: "Class", cell: (r) => <span className="flex flex-wrap items-center gap-2"><BoardClass row={r} /><BoardName row={r} /></span> },
        { key: "guild", header: "Guild", cell: (r) => <BoardGuild row={r} /> },
        { key: "region", header: "Region", cell: (r) => <RegionRuleset region={r.region} ruleset={r.ruleset} /> },
        { key: "value", header: <BoardMetric metric="gear-score" />, numeric: true, cell: (r) => <BoardValue row={r} metric="gear-score" top={Math.max(0, ...rows.map((r) => r.value))} /> },
      ]} rows={rows} rowKey={(r) => r.class}
      meta={(r) => <span className="flex flex-wrap items-center gap-2"><BoardGuild row={r} /><span>{regionLabel(r.region)}</span><BoardValue row={r} metric="gear-score" top={Math.max(0, ...rows.map((r) => r.value))} /></span>}
      empty={<p className="p-4 text-fg-2">No Gear Score read yet.</p>} /></Card>}
  </section>;
}
