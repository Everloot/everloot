import type { Metadata } from "next";
import Link from "next/link";
import ArtThumb from "@/components/game/ArtThumb";
import { Container, DataTable, DataTitle, filledColumns, type SparseColumn } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { loadSiteAssets } from "@/lib/game-assets";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { WORLD_MAP } from "@/lib/world-map";
import { hasConfirmed, publicZones, zoneContents, zoneHref, type ZoneContents, type ZoneSummary } from "@/lib/zones";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "WoW Forever Zones",
  description: "Every zone of WoW: Forever by continent, with the dungeons and raids entered there and the NPCs, vendors and quests players have confirmed in each.",
  path: "/database/zones",
});

type Row = ZoneSummary & { contents: ZoneContents | null };

export default async function ZonesPage() {
  const facts = await loadWorldFacts();
  const contents = zoneContents(facts.unreachable ? { npcs: [], quests: [], vendors: [] } : facts);
  const zones = publicZones();
  // Each zone's own map picture, small, before its name: the same picture the zone page shows, never a held-back one.
  const assets = await loadSiteAssets();
  const pictures = new Map((assets?.maps ?? []).filter((m) => m.kind === "zone" && !m.heldBack).map((m) => [m.uiMapId, m.smallUrl ?? m.url]));
  const noneConfirmed = !zones.some((z) => hasConfirmed(contents.get(z.mapId)));
  const continents = WORLD_MAP.continents.map((c) => ({
    ...c,
    rows: zones.filter((z) => z.continentId === c.id).map((z): Row => ({ ...z, contents: contents.get(z.mapId) ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((c) => c.rows.length);

  // A count nobody has reported reads "—", never a wall of zeros; a column with none in any zone is left out.
  // Player counts are blank too while storage is down.
  const dash = <span className="text-muted">—</span>;
  const count = (pick: (c: ZoneContents) => number) => ({
    cell: (row: Row) => (row.contents === null || facts.unreachable ? 0 : pick(row.contents)) || dash,
    blank: (row: Row) => row.contents === null || facts.unreachable || pick(row.contents) === 0,
  });
  const columns: SparseColumn<Row>[] = filledColumns([
    { key: "zone", header: "Zone", cell: (z) => {
      const src = pictures.get(z.mapId);
      const name = <Link href={zoneHref(z.mapId, z.name)} className="text-fg hover:underline underline-offset-4">{z.name}</Link>;
      return src ? <span className="flex min-w-0 items-center gap-2"><ArtThumb src={src} width={42} height={28} />{name}</span> : name;
    } },
    { key: "npcs", header: "NPCs", numeric: true, ...count((c) => c.npcs.filter((n) => !n.vendor).length) },
    { key: "vendors", header: "Vendors", numeric: true, ...count((c) => c.npcs.filter((n) => n.vendor).length) },
    { key: "quests", header: "Quests", numeric: true, ...count((c) => c.quests.length) },
    { key: "instances", header: "Dungeons and raids", numeric: true, cell: (z) => z.contents?.entrances.length || dash, blank: (z) => !z.contents?.entrances.length },
  ], continents.flatMap((c) => c.rows));

  return (
    <Container width="data">
      <article>
        <DataTitle title="Zones" meta={`${zones.length} zones`} trail={trailFor("/database/zones") ?? undefined} />
        {facts.unreachable && <p className="mb-3 text-meta text-warning">{STORAGE_UNREACHABLE}</p>}
        {!facts.unreachable && (
          <p className="mb-3 max-w-reading text-meta text-fg-2">
            {noneConfirmed
              ? "Players have not confirmed anything in any zone yet, so there are no counts to show. "
              : "A dash means nobody has confirmed anything of that kind in the zone yet. It does not mean there is none. "}
            A fact appears when 3 installs agree on it.
          </p>
        )}
        <div className="space-y-6">
          {continents.map((c) => (
            <section key={c.id} aria-labelledby={`continent-${c.id}`}>
              <h2 id={`continent-${c.id}`} className="mb-2 flex items-baseline gap-3 text-h2-sm text-fg sm:text-h2">
                {c.name}<span className="text-meta font-normal text-muted">{c.rows.length} zones</span>
              </h2>
              <DataTable
                dense
                caption={`Zones of ${c.name}`}
                columns={columns}
                rows={c.rows}
                rowKey={(z) => String(z.mapId)}
                meta={(z) => (z.contents?.entrances.length ? `${z.contents.entrances.length} dungeons and raids` : "")}
              />
            </section>
          ))}
        </div>
      </article>
    </Container>
  );
}