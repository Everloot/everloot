import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { progressionCatalogue } from "@kb/progression";
import { Container, DataTable, EmptyState, PageHeader, type Column } from "@/components/ui";
import { armoryCharacterPath, armoryOn, regionLabel } from "@/lib/armory";
import { instanceClearsOn } from "@/lib/boss-kill-sync";
import { trailFor } from "@/lib/breadcrumbs";
import type { InstanceClears } from "@/lib/dungeon-clears";
import { instanceHref } from "@/lib/instances";
import { loadInstanceClears } from "@/lib/progression";
import { armoryMetadata, link, NOT_FOUND_METADATA, Unreachable } from "../../parts";

/**
 * Recent clears of one instance by linked characters. Their names come from the armory (Blizzard's API), so the list
 * lives here, with the armory's rules: read on every request so a hide applies at once, ad-free and out of search
 * engines. The instance's database page shows only the counts.
 */
export const dynamic = "force-dynamic";

type Params = { instance: string };

/** The instance the files list bosses for, or null for any other address. */
function instanceOf(segment: string) {
  if (!/^[1-9]\d{0,9}$/.test(segment)) return null;
  const row = progressionCatalogue(null).find((r) => r.id === Number(segment));
  return row && row.bosses.length > 0 ? row : null;
}

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  const row = armoryOn() && instanceClearsOn() ? instanceOf((await props.params).instance) : null;
  if (!row) return NOT_FOUND_METADATA;
  return armoryMetadata({
    title: `Recent clears: ${row.name}`,
    description: `Linked characters who have killed every boss in ${row.name} on WoW: Forever, from their synced boss kills.`,
    path: `/armory/clears/${row.id}`,
  });
}

type Clear = InstanceClears["clears"][number];
const columns: Column<Clear>[] = [
  { key: "character", header: "Character", cell: (c) => <Link href={armoryCharacterPath(c.region, c.slug)} className={link}>{c.name}</Link> },
  { key: "region", header: "Region", cell: (c) => regionLabel(c.region) },
  { key: "first", header: "First cleared", numeric: true, cell: (c) => c.firstClearDay ?? "–" },
  { key: "last", header: "Last boss kill", numeric: true, cell: (c) => c.lastKillDay ?? "–" },
];

export default async function ClearsPage(props: { params: Promise<Params> }) {
  if (!armoryOn() || !instanceClearsOn()) notFound();
  const row = instanceOf((await props.params).instance);
  if (!row) notFound();
  const clears = await loadInstanceClears(row.id);
  const path = `/armory/clears/${row.id}`;
  return (
    <Container width="data">
      <article className="space-y-6">
        <PageHeader
          trail={[...trailFor("/armory")!, { name: `Recent clears: ${row.name}`, path }]}
          title={`Recent clears: ${row.name}`}
          lede={<>Linked characters who have killed every boss the game files list for <Link href={instanceHref(row.id, row.name)} className={link}>{row.name}</Link>, newest kill first.</>}
        />
        {clears === null ? <Unreachable />
          : <DataTable dense caption={`Linked characters who cleared ${row.name}`} columns={columns} rows={clears.clears.slice(0, 100)}
            rowKey={(c) => `${c.region}/${c.slug}`} empty={<EmptyState message="No linked character has killed every boss here yet." framed={false} />} />}
        <p className="text-sm text-fg-2">
          From the boss kills owners sync through the Everloot Desktop App for their linked characters, public on their armory
          pages: up to the 500 characters with the newest kills here, the 100 newest clears shown. First cleared is the day the
          last boss fell for the first time; kills are lifetime, so a later full clear has no date of its own. Dates are UTC.
          A hidden character is left out at once.
        </p>
      </article>
    </Container>
  );
}
