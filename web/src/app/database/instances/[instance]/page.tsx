import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { AgreementMeter, Badge, Card, Container, DataTable, DataTitle, EmptyState, SectionHeading, type Column } from "@/components/ui";
import type { InstanceBoss } from "../../../../../../kb/src/instances";
import {
  difficultyLabel, instanceDescription, instanceHref, instanceRows, instanceTitle, loadSightings, parseInstanceSegment,
  type InstancePlace, type InstanceRow,
} from "@/lib/instances";
import { dayLabel } from "@/lib/report-labels";
import { PLACEHOLDER } from "@/lib/item-names";
import { mapHref } from "@/lib/map-view";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { zoneHref } from "@/lib/zones";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ instance: string }> };

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** The instance's row, with what players reported when storage answers; null for an id the site does not show. */
async function find(segment: string): Promise<{ row: InstanceRow; unreachable: boolean } | null> {
  const id = parseInstanceSegment(segment);
  if (id === null) return null;
  const seen = await loadSightings();
  const row = instanceRows(seen.unreachable ? {} : seen).get(id);
  return row ? { row, unreachable: seen.unreachable } : null;
}

const kindLabel = (raid: boolean | null) => (raid === null ? PLACEHOLDER : raid ? "Raid" : "Dungeon");

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { instance: segment } = await props.params;
  const found = await find(segment);
  if (!found) return { robots: { index: false, follow: true } };
  const { row, unreachable } = found;
  const title = instanceTitle(row);
  return {
    ...pageMetadata({
      title: `${title} – WoW Forever ${row.raid === null ? "Instance" : row.raid ? "Raid" : "Dungeon"}: Entrance and Bosses`,
      description: instanceDescription(row),
      path: instanceHref(row.instanceMapId, row.name),
    }),
    // Storage down: noindex rather than cache a page without its player reports.
    robots: { index: !unreachable, follow: true },
  };
}

const placeCell = (p: InstancePlace) => (
  <span className="inline-flex flex-wrap items-baseline gap-x-2">
    <Link href={zoneHref(p.mapId, p.zoneName)} className={link}>{p.zoneName}</Link>
    <Link href={mapHref({ mapId: p.mapId, x: p.x, y: p.y })} className="font-mono text-xs text-muted hover:underline underline-offset-4">{p.x}, {p.y}</Link>
  </span>
);

export default async function InstancePage(props: Props) {
  const { instance: segment } = await props.params;
  const found = await find(segment);
  if (!found) notFound();
  const { row, unreachable } = found;
  const canonical = instanceHref(row.instanceMapId, row.name);
  if (`/database/instances/${segment}` !== canonical) permanentRedirect(canonical);
  const title = instanceTitle(row);
  const empty = (message: string) => <EmptyState message={message} framed={false} />;

  const confirmedColumns: Column<InstanceRow["confirmed"][number]>[] = [
    { key: "at", header: "Outdoor map and position", cell: placeCell },
    { key: "installs", header: "Installs", cell: (p) => <AgreementMeter count={p.installs} /> },
    { key: "seen", header: "Last seen", numeric: true, cell: (p) => dayLabel(p.lastSeen) },
  ];
  const bossColumns: Column<InstanceBoss>[] = [
    { key: "name", header: "Boss", cell: (b) => b.name ?? `Encounter ${b.encounterId}` },
    { key: "kills", header: "Kills", numeric: true, cell: (b) => b.kills.toLocaleString("en-US") },
    { key: "installs", header: "Installs", cell: (b) => <AgreementMeter count={b.reporters} /> },
    { key: "seen", header: "Last seen", numeric: true, cell: (b) => dayLabel(b.lastSeen) },
    { key: "npcs", header: "Creatures", cell: (b) => (b.npcIds.length
      ? b.npcIds.map((id, i) => <span key={id}>{i > 0 && ", "}<Link href={`/database/npcs/${id}`} className={link}>NPC {id}</Link></span>)
      : PLACEHOLDER) },
  ];

  const unconfirmed = row.reported > 0
    ? `No entrance is confirmed yet. ${row.reported} ${row.reported === 1 ? "install has" : "installs have"} zoned in, and 3 must agree on the place.`
    : "No entrance is confirmed yet: no install has reported zoning in. An entrance is confirmed once 3 installs zone in from the same place.";

  return (
    <Container width="data">
      <article>
        <DataTitle
          title={title}
          meta={<span className="inline-flex items-center gap-2">{kindLabel(row.raid)}<span className="text-muted">Instance {row.instanceMapId}</span></span>}
          trail={[
            { name: "Home", path: "/" },
            { name: "Database", path: "/database" },
            { name: "Instances", path: "/database/instances" },
            { name: title, path: canonical },
          ]}
        />

        {unreachable && <p className="mb-3 text-meta text-warning">{STORAGE_UNREACHABLE} Players&apos; reports cannot be shown until it is back; the entrance below is from the game files.</p>}

        <div className="space-y-6">
          <section aria-labelledby="facts">
            <SectionHeading id="facts" note="The type is from the game files where they place the entrance, else as 3 installs agree. The difficulty is the id 3 installs agree on.">
              Facts
            </SectionHeading>
            <Card as="div">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                <dt className="text-muted">Type</dt><dd className="text-fg">{kindLabel(row.raid)}</dd>
                <dt className="text-muted">Difficulty</dt><dd className="text-fg">{row.difficulty === null ? PLACEHOLDER : difficultyLabel(row.difficulty)}</dd>
                <dt className="text-muted">Bosses reported</dt><dd className="text-fg">{unreachable ? PLACEHOLDER : row.bosses.length}</dd>
              </dl>
            </Card>
          </section>

          <section aria-labelledby="entrance">
            <SectionHeading id="entrance" note="Confirmed by the instance id: the last place outside where 3 installs stood before zoning in, at the median of their positions.">
              Entrance
            </SectionHeading>
            {row.files.length > 0 && (
              <ul className="mb-3 space-y-1 text-sm">
                {row.files.map((p) => (
                  <li key={`${p.mapId}-${p.x}-${p.y}`} className="flex flex-wrap items-center gap-2">{placeCell(p)}<Badge tone="files" /></li>
                ))}
              </ul>
            )}
            {!unreachable && (
              <DataTable
                dense caption={`Entrances to ${title} players confirmed`} columns={confirmedColumns} rows={row.confirmed}
                rowKey={(p) => `${p.mapId}-${p.x}-${p.y}`} empty={empty(unconfirmed)}
              />
            )}
          </section>

          <section aria-labelledby="bosses">
            <SectionHeading id="bosses" note="A boss is listed once 3 installs report its encounter ending here. Kills count every install's kills together; wipes are not kills.">
              Bosses
            </SectionHeading>
            {!unreachable && (
              <DataTable
                dense caption={`Bosses players reported in ${title}`} columns={bossColumns} rows={row.bosses} rowKey={(b) => String(b.encounterId)}
                empty={empty("No boss has 3 installs reporting it here yet.")}
              />
            )}
          </section>
        </div>
      </article>
    </Container>
  );
}
