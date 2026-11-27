import type { ReactNode } from "react";
import Link from "next/link";
import { Card, DataTable, type Column } from "@/components/ui";
import Tooltip from "@/components/ui/Tooltip";
import { CLASS_BG, classColour } from "@/components/ui/class-colour";
import { classText } from "@/app/players/player-view";
import { ARMORY_BOARDS, armoryCharacterPath, armoryGuildPath, boardRanks, boardRankText, metricValue, regionLabel, type ArmoryMetric, type ArmoryRegion, type BoardRank } from "@/lib/armory";
import type { ArmoryBoardRow } from "@/lib/armory-store";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { RegionChip } from "./parts";

export function BoardClass({ row }: { row: ArmoryBoardRow }) {
  return <span className="inline-flex items-center gap-1.5 text-cell-2"><span role="img" aria-label={row.faction} className={`h-2 w-2 rounded-full ${row.faction === "Alliance" ? "bg-faction-alliance" : row.faction === "Horde" ? "bg-faction-horde" : "bg-muted"}`} /><span className={classText(row.class.toUpperCase())}>{row.class}</span></span>;
}

export function BoardGuild({ row }: { row: ArmoryBoardRow }) {
  return row.guildName && row.guildSlug
    ? <Link href={armoryGuildPath(row.region, row.guildSlug)} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{row.guildName}</Link>
    : <span className="text-muted">{row.guildName ?? "None"}</span>;
}

export function BoardMetric({ metric }: { metric: ArmoryMetric }) {
  return <Tooltip label={`${ARMORY_BOARDS[metric].column}: ${ARMORY_BOARDS[metric].lede}`}>{ARMORY_BOARDS[metric].column}</Tooltip>;
}

export function BoardValue({ row, metric, top }: { row: ArmoryBoardRow; metric: ArmoryMetric; top: number }) {
  const value = metricValue(metric, row.value);
  const read = new Date(row.fetchedAt).toLocaleString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <span className="inline-flex min-w-16 flex-col items-stretch text-right font-medium text-fg">
      <Tooltip label={`${ARMORY_BOARDS[metric].column}: ${value}. ${ARMORY_BOARDS[metric].lede} Read ${read} UTC.`}>{value}</Tooltip>
      <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-edge"><span className={`block h-1 rounded-full ${classColour(CLASS_BG, row.class) ?? "bg-muted"}`} style={{ width: `${top > 0 ? Math.min(100, Math.max(0, row.value / top * 100)) : 0}%` }} /></span>
    </span>
  );
}

/**
 * The rank before a name. The top three sit in a round badge, the first filled with the accent and the next two ringed
 * by it, so the head of a board reads at a glance without medal colours; the rest are plain muted numbers. A tie says
 * so in words, for a screen reader and on hover.
 */
export function RankMark({ rank }: { rank: BoardRank }) {
  const text = boardRankText(rank);
  const top = rank.rank <= 3;
  const look = !top ? "text-muted" : rank.rank === 1 ? "rounded-full bg-accent font-semibold text-canvas" : "rounded-full border border-accent text-fg";
  return (
    <span data-rank={rank.rank} data-rank-top={top ? "" : undefined} title={rank.tied ? text : undefined}
      className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center self-center px-1 font-mono text-cell-2 tabular-nums ${look}`}>
      <span aria-hidden="true">{rank.rank.toLocaleString("en-US")}</span><span className="sr-only">{text}</span>
    </span>
  );
}

/** A board's rows' ranks, the board's own count seeding each run of equal values. `rows` are highest first. */
export function sharedRanks(rows: readonly ArmoryBoardRow[]): Map<ArmoryBoardRow, BoardRank> {
  const ranks = boardRanks(rows, (r) => r.value, (r) => r.rank);
  return new Map(rows.map((r, i) => [r, ranks[i]!]));
}

/** A character's name in its class colour, linking its one page. */
export function BoardName({ row }: { row: ArmoryBoardRow }) {
  return <Link href={armoryCharacterPath(row.region, row.slug)} className={`${classText(row.class.toUpperCase())} font-medium underline decoration-edge underline-offset-4 hover:decoration-current`}>{row.name} {row.surname}</Link>;
}

/** A leaderboard row: the rank, the name in its class colour with the class and faction, the guild, the value. */
function regionColumns(metric: ArmoryMetric, top: number, ranks: Map<ArmoryBoardRow, BoardRank>): Column<ArmoryBoardRow>[] {
  return [
    {
      key: "name", header: "Character",
      cell: (r) => (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
          <RankMark rank={ranks.get(r) ?? { rank: r.rank, tied: false }} />
          <BoardName row={r} />
          <BoardClass row={r} />
        </span>
      ),
    },
    { key: "guild", header: "Guild", cell: (r) => <BoardGuild row={r} /> },
    { key: "value", header: <BoardMetric metric={metric} />, numeric: true, cell: (r) => <BoardValue row={r} metric={metric} top={top} /> },
  ];
}

/**
 * One region's column of a board, ranked within that region alone: US and EU stand side by side, so a region with
 * more characters read never pushes the other off the list. Null rows when the store could not answer.
 */
export function RegionBoard({ metric, region, rows, footer, shown }: {
  metric: ArmoryMetric; region: ArmoryRegion; rows: ArmoryBoardRow[] | null; footer: ReactNode;
  /** The page of rows to print, as slice bounds; ranks still come from the whole list, so a tie across pages holds. */
  shown?: readonly [number, number];
}) {
  const title = ARMORY_BOARDS[metric].title;
  const heading = <h3 id={`board-${region}`} className="flex items-center gap-2 px-4 pt-3 text-h2-sm text-fg"><RegionChip region={region} />{title}</h3>;
  return (
    <Card as="section" aria-labelledby={`board-${region}`} padding="none">
      {rows === null ? <>{heading}<p className="px-4 py-4 text-cell text-fg-2" role="status">{STORAGE_UNREACHABLE}</p></> : (
        <DataTable
          dense
          caption={`${title}, ${regionLabel(region)}, top ${rows.length}`}
          columns={regionColumns(metric, rows[0]?.value ?? 0, sharedRanks(rows))}
          rows={shown ? rows.slice(shown[0], shown[1]) : rows}
          rowKey={(r) => `${r.region}/${r.slug}`}
          meta={(r) => <span className="flex flex-wrap items-center gap-2"><BoardGuild row={r} /><BoardValue row={r} metric={metric} top={rows[0]?.value ?? 0} /></span>}
          empty={<p className="px-4 py-3 text-cell text-fg-2">No character with this number here yet.</p>}
          toolbar={heading}
          footer={footer}
        />
      )}
    </Card>
  );
}
