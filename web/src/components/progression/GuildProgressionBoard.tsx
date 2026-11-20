import Link from "next/link";
import { Card, DataTable } from "@/components/ui";
import { armoryGuildPath } from "@/lib/armory";
import type { GuildProgressionRank } from "@/lib/progression";

export default function GuildProgressionBoard({ rows }: { rows?: readonly GuildProgressionRank[] }) {
  if (!rows?.length) return null;
  return <Card as="section" aria-labelledby="board-guild-progression" padding="none">
    <h3 id="board-guild-progression" className="px-4 pt-3 text-h2-sm text-fg">Guild progression</h3>
    <p className="px-4 py-3 text-cell text-fg-2">Public guild progression: every roster member&apos;s synced kills count. Dungeon bosses need five members, raids need the raid size, and world bosses need forty. Hidden characters and guilds are excluded.</p>
    <DataTable dense caption="Public guild progression by score" rows={[...rows]} rowKey={(r) => `${r.region}/${r.slug}`} columns={[
      { key: "guild", header: "Guild", cell: (r) => <Link href={armoryGuildPath(r.region, r.slug)} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{r.name}</Link> },
      { key: "region", header: "Region", cell: (r) => r.region.toUpperCase() },
      { key: "score", header: "Score", numeric: true, cell: (r) => r.score.toLocaleString("en-US") },
    ]} />
  </Card>;
}
