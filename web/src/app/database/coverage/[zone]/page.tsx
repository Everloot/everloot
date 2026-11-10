import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { fieldLabel, type CoverageNeed, type FieldCell } from "../../../../../../kb/src/coverage";
import { Container, DataTable, DataTitle, agreementLabel, type SparseColumn } from "@/components/ui";
import { loadCoverage } from "@/lib/coverage-compute";
import { loadSightings } from "@/lib/instances";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { cellDetail, measuredLine, shareText, TYPE_LABEL, zoneCoverageHref } from "@/lib/coverage-view";
import { pageMetadata } from "@/lib/seo";
import { hasConfirmed, parseZoneSegment, zoneByMapId, zoneContents, zoneHref } from "@/lib/zones";
import { LINK } from "../../entity";
import { Unreadable } from "../../list-parts";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ zone: string }> };

async function zoneOf(props: Props) {
  const segment = (await props.params).zone;
  const id = parseZoneSegment(segment);
  const zone = id === null ? undefined : zoneByMapId(id);
  if (!zone) notFound();
  return { zone, segment };
}

/**
 * Indexed once players have confirmed something in the zone (`hasConfirmed`, the test the sitemap lists these pages
 * by): before that the page has no field to show. Read from the stored aggregates the zone page reads, not the corpus
 * the score is worked out from, so the sitemap asks the same question cheaply. Storage down: noindex.
 */
async function indexable(mapId: number): Promise<boolean> {
  const [facts, seen] = await Promise.all([loadWorldFacts(), loadSightings()]);
  return !facts.unreachable && !seen.unreachable && hasConfirmed(zoneContents(facts, undefined, seen).get(mapId));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { zone } = await zoneOf(props);
  return {
    ...pageMetadata({
      title: `${zone.name} Coverage`,
      description: `How much of ${zone.name} WoW: Forever players have confirmed and settled, field by field, and the facts that need one or two more installs.`,
      path: zoneCoverageHref(zone),
    }),
    robots: { index: await indexable(zone.mapId), follow: true },
  };
}

export default async function ZoneCoveragePage(props: Props) {
  const { zone, segment } = await zoneOf(props);
  const canonical = zoneCoverageHref(zone);
  if (canonical !== `/database/coverage/${segment}`) permanentRedirect(canonical);
  const report = await loadCoverage();
  const here = report?.zones.find((z) => z.mapId === zone.mapId) ?? null;

  const fieldColumns: SparseColumn<FieldCell>[] = [
    { key: "type", header: "Type", cell: (f) => TYPE_LABEL[f.type] },
    { key: "field", header: "Field", cell: (f) => fieldLabel(f.type, f.field) },
    { key: "share", header: "Settled / confirmed", numeric: true, cell: (f) => <span title={cellDetail(f)} className="tabular-nums">{shareText(f)}</span> },
    { key: "settled", header: "Settled", numeric: true, cell: (f) => f.settled },
    { key: "confirmed", header: "Confirmed", numeric: true, cell: (f) => f.confirmed },
    { key: "reported", header: "Reported", numeric: true, cell: (f) => f.reported },
    { key: "of", header: "Of", numeric: true, cell: (f) => f.denominator ?? f.observed },
  ];
  const needColumns: SparseColumn<CoverageNeed & { i: number }>[] = [
    { key: "fact", header: "Fact", cell: (n) => (n.href ? <Link href={n.href} className={LINK}>{n.label}</Link> : n.label) },
    { key: "type", header: "Type", cell: (n) => TYPE_LABEL[n.type] },
    { key: "field", header: "Field", cell: (n) => n.field },
    { key: "installs", header: "Installs", numeric: true, cell: (n) => `${n.voters} of 3` },
    { key: "need", header: "Needs", numeric: true, cell: (n) => `${n.need} more` },
  ];

  return (
    <Container width="data">
      <article>
        <DataTitle title={`${zone.name} coverage`} meta={here ? `${here.installs.toLocaleString("en-US")} installs` : undefined} />
        {!report || !here ? <Unreadable /> : (
          <>
            <p className="mb-3 max-w-reading text-meta text-muted">{measuredLine(report)} {report.method} What is known of the zone itself is on <Link href={zoneHref(zone.mapId, zone.name)} className={LINK}>its zone page</Link>.</p>
            <section aria-labelledby="fields" className="mb-6">
              <h2 id="fields" className="mb-2 text-h2-sm text-fg sm:text-h2">By field</h2>
              {here.fields.length === 0 ? <p className="py-4 text-cell text-fg-2">Nobody has reported anything in {zone.name} yet.</p> : (
                <DataTable dense caption={`Coverage of ${zone.name} by field`} columns={fieldColumns} rows={here.fields} rowKey={(f) => `${f.type}|${f.field}`} meta={(f) => `${TYPE_LABEL[f.type]} · ${cellDetail(f)}`} />
              )}
            </section>
            <section aria-labelledby="needs">
              <h2 id="needs" className="mb-2 flex items-baseline gap-3 text-h2-sm text-fg sm:text-h2">
                Needs one or two more installs<span className="text-meta font-normal text-muted">{here.needsTotal.toLocaleString("en-US")}</span>
              </h2>
              {here.needs.length === 0 ? <p className="py-4 text-cell text-fg-2">No reported fact here is one or two installs short.</p> : (
                <>
                  <DataTable dense caption={`Facts in ${zone.name} that need more installs`} columns={needColumns} rows={here.needs.map((n, i) => ({ ...n, i }))} rowKey={(n) => String(n.i)} meta={(n) => `${TYPE_LABEL[n.type]} ${n.field} · ${agreementLabel(n.voters)}`} />
                  {here.needsTotal > here.needs.length && <p className="mt-2 text-meta text-muted">The {here.needs.length} closest of {here.needsTotal.toLocaleString("en-US")}.</p>}
                </>
              )}
            </section>
          </>
        )}
      </article>
    </Container>
  );
}
