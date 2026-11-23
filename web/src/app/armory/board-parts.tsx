import type { ReactNode } from "react";
import Link from "next/link";
import { Card, DataTable, type Column } from "@/components/ui";
import Tooltip from "@/components/ui/Tooltip";
import { CLASS_BG, classColour } from "@/components/ui/class-colour";
import { classText } from "@/app/players/player-view";
import { ARMORY_BOARDS, armoryCharacterPath, armoryGuildPath, metricValue, regionLabel, type ArmoryMetric, type ArmoryRegion } from "@/lib/armory";
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

/** The rank sits in the name cell: on a phone a dense table keeps its first column only. */
const rankMark = (rank: number) => <span className="w-6 shrink-0 font-mono tabular-nums text-muted">{rank}</span>;

/** A leaderboard row: the rank, the name in its class colour with the class and faction, the guild, the value. */
function regionColumns(metric: ArmoryMetric, top: number): Column<ArmoryBoardRow>[] {
  return [
    {
      key: "name", header: "Character",
      cell: (r) => (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          {rankMark(r.rank)}
          <Link href={armoryCharacterPath(r.region, r.slug)} className={`${classText(r.class.toUpperCase())} font-medium underline decoration-edge underline-offset-4 hover:decoration-current`}>{r.name} {r.surname}</Link>
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
export function RegionBoard({ metric, region, rows, footer }: { metric: ArmoryMetric; region: ArmoryRegion; rows: ArmoryBoardRow[] | null; footer: ReactNode }) {
  const title = ARMORY_BOARDS[metric].title;
  const heading = <h3 id={`board-${region}`} className="flex items-center gap-2 px-4 pt-3 text-h2-sm text-fg"><RegionChip region={region} />{title}</h3>;
  return (
    <Card as="section" aria-labelledby={`board-${region}`} padding="none">
      {rows === null ? <>{heading}<p className="px-4 py-4 text-cell text-fg-2" role="status">{STORAGE_UNREACHABLE}</p></> : (
        <DataTable
          dense
          caption={`${title}, ${regionLabel(region)}, top ${rows.length}`}
          columns={regionColumns(metric, rows[0]?.value ?? 0)}
          rows={rows}
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
