import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Container, DataTable, DataTitle, type Column } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { compareInstances, instanceHref, instanceRows, instanceTitle, levelLabel, loadSightings, type InstanceRow } from "@/lib/instances";
import { PLACEHOLDER } from "@/lib/item-names";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { zoneHref } from "@/lib/zones";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "WoW Forever Dungeons and Raids",
  description: "Every dungeon and raid of WoW: Forever, one row each, lowest level first: its level from the game files, where it is entered, whether players have confirmed the entrance, and the bosses they report.",
  path: "/database/instances",
});

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** One row per instance: the entrance's zone, its confirmation, and the bosses players report. */
export default async function InstancesPage() {
  const seen = await loadSightings();
  const rows = [...instanceRows(seen.unreachable ? {} : seen).values()].sort(compareInstances);
  const dash = <span className="text-muted">–</span>;
  const columns: Column<InstanceRow>[] = [
    { key: "name", header: "Name", cell: (r) => <Link href={instanceHref(r.instanceMapId, r.name)} className={link}>{instanceTitle(r)}</Link> },
    { key: "kind", header: "Type", cell: (r) => (r.raid === null ? PLACEHOLDER : r.raid ? "Raid" : "Dungeon") },
    { key: "level", header: "Level", numeric: true, cell: (r) => levelLabel(r.level) ?? dash },
    { key: "zone", header: "Entered from", cell: (r) => {
      const at = r.files[0] ?? r.confirmed[0];
      return at ? <Link href={zoneHref(at.mapId, at.zoneName)} className={link}>{at.zoneName}</Link> : dash;
    } },
    { key: "confirmed", header: "Entrance confirmed", numeric: true, cell: (r) => (seen.unreachable ? PLACEHOLDER : r.confirmed.length ? `${Math.max(...r.confirmed.map((p) => p.installs))} installs` : dash) },
    // Player-first: the reported count, else the files' count marked unconfirmed, else a dash.
    { key: "bosses", header: "Bosses", numeric: true, cell: (r) => (!seen.unreachable && r.bosses.length
      ? r.bosses.length
      : r.encounters.length ? <span className="inline-flex items-baseline gap-1.5"><Badge tone="files" />{r.encounters.length}</span> : dash) },
  ];

  return (
    <Container width="data">
      <article>
        <DataTitle title="Dungeons and raids" meta={`${rows.length} instances`} trail={trailFor("/database/instances") ?? undefined} />
        {seen.unreachable && <p className="mb-3 text-meta text-warning">{STORAGE_UNREACHABLE} The entrances below are from the game files.</p>}
        {!seen.unreachable && (
          <p className="mb-3 max-w-reading text-meta text-fg-2">
            Sorted by level, lowest first. The level is read from the game files, which give one level for most instances rather than a range; a dash there means the files give none. Entrances are read from the game files and confirmed once 3 installs zone in from the same place. A boss is counted once 3 installs report it; until then the count is the game files' own list, marked unconfirmed. A dash in the other columns means nobody has yet, not that there is none.
          </p>
        )}
        <DataTable dense caption="Dungeons and raids" columns={columns} rows={rows} rowKey={(r) => String(r.instanceMapId)} />
      </article>
    </Container>
  );
}
