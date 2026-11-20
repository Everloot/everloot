import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArmoryCredit, link, newest } from "@/app/armory/parts";
import { readTimes } from "@/app/armory/profile";
import { Card, Container, DataTable, PageHeader } from "@/components/ui";
import type { Column } from "@/components/ui/DataTable";
import type { PlayHistoryRankedKey } from "@kb/armory/details";
import { ARMORY_BOARDS, armoryCharacterPath, armoryOn, metricValue, PLAY_HISTORY_METRICS } from "@/lib/armory";
import { signInPath } from "@/lib/auth/return-to";
import { trailFor } from "@/lib/breadcrumbs";
import { ownArmoryCharacters } from "@/lib/character-armory";
import { characterLinksOn } from "@/lib/character-links";
import { lifetimeSummary, type LifetimeRow } from "@/lib/lifetime-summary";
import { getUser } from "@/lib/supabase/server";

/**
 * /me/characters/lifetime: the lifetime totals of Blizzard's play history across the signed-in account's linked
 * characters (lifetime stats design, 2026-11-20). Only that account's own armory associations are read; nothing here is
 * public, cached or indexed, and the page is on the ad-free list because it shows Blizzard data.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lifetime totals", robots: { index: false, follow: false } };

const PATH = "/me/characters/lifetime";
/** Each column's board, for its title and number format; the order the boards use. */
const COUNT: Record<string, PlayHistoryRankedKey> = {
  "quests-completed": "quests", "creatures-killed": "creatures", "fish-caught": "fish", "flight-paths": "flights", "dungeons-entered": "dungeons", deaths: "deaths",
};
const NOT_READ = <span className="text-fg-2">Not read</span>;

export default async function LifetimePage() {
  if (!armoryOn() || !characterLinksOn()) notFound();
  const user = await getUser();
  if (!user) redirect(signInPath(PATH));
  const characters = await ownArmoryCharacters(user.id);
  const header = <PageHeader trail={[...trailFor("/settings")!, { name: "Lifetime totals", path: PATH }]} title="Lifetime totals"
    lede="Blizzard's play history for each of your linked characters, and the totals across them." />;
  if (characters === null) {
    return <Container width="data"><div className="space-y-4">{header}<Card><p role="status" className="text-fg-2">Your characters could not be read. Try again in a moment.</p></Card></div></Container>;
  }
  if (characters.length === 0) {
    return (
      <Container width="data">
        <div className="space-y-4">
          {header}
          <Card><p className="text-fg-2">None of your linked characters is connected to an armory character yet.</p></Card>
        </div>
      </Container>
    );
  }
  const s = lifetimeSummary(characters);
  const total: LifetimeRow = { name: "Total", surname: "", region: "", slug: "", values: s.totals };
  const columns: Column<LifetimeRow>[] = [
    {
      key: "name", header: "Character",
      cell: (r) => r.slug
        ? <Link href={armoryCharacterPath(r.region, r.slug)} className={link}>{r.name} {r.surname}</Link>
        : <span className="font-semibold text-fg">Total, {s.read} of {characters.length} characters read</span>,
    },
    ...PLAY_HISTORY_METRICS.map((m): Column<LifetimeRow> => ({
      key: m, header: ARMORY_BOARDS[m].title, numeric: true,
      cell: (r) => {
        const v = r.values[COUNT[m]];
        return v === undefined ? NOT_READ : metricValue(m, v);
      },
    })),
  ];
  return (
    <Container width="data">
      <div className="space-y-4">
        {header}
        <DataTable caption="Lifetime totals by character" columns={columns} rows={[...s.rows, total]} rowKey={(r) => r.slug || "total"} />
        <p className="text-sm text-fg-2">A total adds only the characters whose play history has been read; the armory reads each one at least every 20 days.</p>
        <ArmoryCredit at={newest(characters.flatMap(readTimes))} />
      </div>
    </Container>
  );
}
