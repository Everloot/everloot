import Link from "next/link";
import Tooltip from "@/components/ui/Tooltip";
import { CLASS_BG, classColour } from "@/components/ui/class-colour";
import { classText } from "@/app/players/player-view";
import { ARMORY_BOARDS, armoryGuildPath, metricValue, type ArmoryMetric } from "@/lib/armory";
import type { ArmoryBoardRow } from "@/lib/armory-store";

export function BoardClass({ row }: { row: ArmoryBoardRow }) {
  return <span className="inline-flex items-center gap-1.5 text-cell-2"><span role="img" aria-label={row.faction} className={`h-2 w-2 rounded-full ${row.faction === "Alliance" ? "bg-region-us" : row.faction === "Horde" ? "bg-danger" : "bg-muted"}`} /><span className={classText(row.class.toUpperCase())}>{row.class}</span></span>;
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
