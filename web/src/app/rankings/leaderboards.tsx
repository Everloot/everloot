import Link from "next/link";
import { Card, DataTable, LinkTabs, SectionHeading, type Column } from "@/components/ui";
import { ARMORY_BOARDS, ARMORY_REGIONS, armoryBoardHref, armoryCharacterPath, armoryGuildPath, metricValue, regionLabel, type ArmoryRegion } from "@/lib/armory";
import { guildDirectoryHref } from "@/lib/armory-guilds";
import type { ArmoryBoardRow, ArmoryGuildRow } from "@/lib/armory-store";
import { guildPath, LADDER_LINE, START_LINE, type RankedRow } from "@/lib/guilds";
import { BOARD_PREVIEW, type CharacterBoard, type GuildGear, type RaidProgress } from "@/lib/leaderboards";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { ArmoryCredit, newest, RegionRuleset } from "../armory/parts";
import { day, Progress } from "../guilds/parts";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const number = (n: number) => n.toLocaleString("en-US");
const muted = (text: string) => <span className="text-muted">{text}</span>;
const unreachable = <p className="py-4 text-cell text-fg-2" role="status">{STORAGE_UNREACHABLE}</p>;

/** All, US and EU, in the URL: every board on the hub narrows to the region. */
export function RegionTabs({ region }: { region: ArmoryRegion | null }) {
  return (
    <LinkTabs
      label="Region"
      tabs={[
        { label: "All regions", href: "/rankings", current: region === null },
        ...ARMORY_REGIONS.map((r) => ({ label: regionLabel(r), href: `/rankings?region=${r}`, current: region === r })),
      ]}
    />
  );
}

/** The rank sits in the name cell: on a phone a dense table keeps its first column only. */
const rankMark = (rank: number) => <span className="w-6 shrink-0 font-mono tabular-nums text-fg-2">{rank}</span>;

const characterColumns = (board: CharacterBoard): Column<ArmoryBoardRow>[] => [
  {
    key: "name", header: "Character",
    cell: (r) => (
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {rankMark(r.rank)}
        <Link href={armoryCharacterPath(r.region, r.slug)} className={`${link} font-medium`}>{r.name} {r.surname}</Link>
        <span className="text-cell-2 text-fg-2">{r.class}</span>
      </span>
    ),
  },
  { key: "guild", header: "Guild", cell: (r) => r.guildName ?? muted("—") },
  { key: "where", header: "Region", nowrap: true, cell: (r) => <RegionRuleset region={r.region} ruleset={r.ruleset} /> },
  { key: "value", header: ARMORY_BOARDS[board.metric].column, numeric: true, cell: (r) => <span className="font-medium text-fg">{metricValue(board.metric, r.value)}</span> },
];

/** The armory's three character boards side by side, each the top of its full list. */
export function CharacterBoards({ boards, region }: { boards: CharacterBoard[]; region: ArmoryRegion | null }) {
  const at = newest(boards.flatMap((b) => b.rows?.map((r) => r.fetchedAt) ?? []));
  return (
    <section aria-labelledby="characters" className="space-y-3">
      <SectionHeading id="characters" note={`Top ${BOARD_PREVIEW} among the characters Everloot has read from Blizzard's armory. A character's own page shows its rank within its region and ruleset.`} action={<ArmoryCredit at={at} />}>
        Characters
      </SectionHeading>
      <div className="grid gap-4 lg:grid-cols-3">
        {boards.map((board) => {
          const def = ARMORY_BOARDS[board.metric];
          const all = armoryBoardHref(board.metric, { region, ruleset: null });
          return (
            <Card key={board.metric} as="section" aria-labelledby={`board-${board.metric}`} padding="none">
              <h3 id={`board-${board.metric}`} className="sr-only">{def.title}</h3>
              {board.rows === null ? <div className="px-4">{unreachable}</div> : (
                <DataTable
                  dense
                  caption={`${def.title}, top ${board.rows.length}`}
                  columns={characterColumns(board)}
                  rows={board.rows}
                  rowKey={(r) => `${r.region}/${r.slug}`}
                  meta={(r) => [r.class, r.guildName, regionLabel(r.region), metricValue(board.metric, r.value)].filter(Boolean).join(" · ")}
                  empty={<p className="px-4 py-3 text-cell text-fg-2">No character with this number here yet.</p>}
                  toolbar={<h4 aria-hidden="true" className="px-4 pt-3 text-h2-sm text-fg">{def.title}</h4>}
                  footer={<Link href={all} className={link}>Top 100 by {def.title.toLowerCase()}</Link>}
                />
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

const gearColumns: Column<ArmoryGuildRow>[] = [
  { key: "name", header: "Guild", cell: (g) => <Link href={armoryGuildPath(g.region, g.slug)} className={`${link} font-medium`}>{g.name}</Link> },
  { key: "where", header: "Region", nowrap: true, cell: (g) => <RegionRuleset region={g.region} ruleset={g.ruleset} /> },
  { key: "read", header: "Members read", numeric: true, cell: (g) => number(g.membersRead) },
  { key: "il", header: "Avg item level", numeric: true, cell: (g) => <span className="font-medium text-fg">{g.averageItemLevel === null ? muted("Not read") : metricValue("item-level", g.averageItemLevel)}</span> },
];

const raidColumns: Column<RankedRow>[] = [
  { key: "guild", header: "Guild", cell: (r) => <span className="flex min-w-0 items-baseline gap-x-2">{rankMark(r.ranks.world)}<Link href={guildPath(r.realm, r.guildName)} className={`${link} font-medium`}>{r.guildName}</Link></span> },
  { key: "realm", header: "Realm", cell: (r) => r.realm },
  { key: "progress", header: "Progress", numeric: true, cell: (r) => <Progress killed={r.killed} bosses={r.bosses} className="justify-end" /> },
  { key: "latest", header: "Latest kill", numeric: true, cell: (r) => (r.latestKillAt ? day(r.latestKillAt) : muted("Officers, no date")) },
];

/** Guilds by gear (the armory) and by raid progress (members' uploads), side by side; either may be off. */
export function GuildBoards({ gear, raids, region }: { gear: GuildGear | null; raids: RaidProgress | null; region: ArmoryRegion | null }) {
  const note = [
    gear && "Gear is the average item level of the members the armory has read.",
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
                  columns={gearColumns}
                  rows={gear.rows}
                  rowKey={(g) => `${g.region}/${g.slug}`}
                  meta={(g) => [regionLabel(g.region), `${number(g.membersRead)} read`, g.averageItemLevel === null ? "Not read" : metricValue("item-level", g.averageItemLevel)].join(" · ")}
                  empty={<p className="px-4 py-3 text-cell text-fg-2">No guild with a member read here yet.</p>}
                  toolbar={<h4 aria-hidden="true" className="px-4 pt-3 text-h2-sm text-fg">Gear</h4>}
                  footer={<Link href={guildDirectoryHref({ region, sort: "item-level" })} className={link}>Every guild by average item level</Link>}
                />
              )}
          </Card>
        )}
        {raids && (
          <Card as="section" aria-labelledby="board-raids" padding="none">
            <h3 id="board-raids" className="sr-only">Guilds by raid progress</h3>
            {raids.unreachable ? <div className="px-4">{unreachable}</div>
              : raids.rows.length === 0 ? <p className="px-4 py-3 text-cell text-fg-2">{raids.open ? START_LINE : LADDER_LINE}</p>
              : (
                <DataTable
                  dense
                  caption={`${raids.instance ?? "Raid"} progress, top ${raids.rows.length}`}
                  columns={raidColumns}
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
