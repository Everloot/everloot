import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { COVERAGE_TYPES, type CoverageType, type ZoneCoverage } from "../../../../../kb/src/coverage";
import { Container, DataTable, DataTitle, FilterBar, type SparseColumn } from "@/components/ui";
import { loadCoverage } from "@/lib/coverage-compute";
import { cellDetail, cellRank, COVERAGE_SORTS, measuredLine, shareText, TYPE_LABEL, zoneCoverageHref, type CoverageSort } from "@/lib/coverage-view";
import { pageMetadata } from "@/lib/seo";
import { PLATEAU_TYPES, type TypePlateau } from "../../../../../kb/src/plateau";
import { LINK } from "../entity";
import { listHref, listQuery, NoMatches, nextSort, sortParam, sortRows, Unreadable, type Search } from "../list-parts";
import { loadPlateau, plateauDetail, plateauMeasured, plateauShare, plateauVerdict } from "./plateau";

const META = {
  title: "WoW Forever Database Coverage",
  description: "How much of each WoW: Forever zone players have confirmed and settled: quests, NPCs, pins, vendors, drops, rares, entrances, bosses and treasures.",
  path: "/database/coverage",
};
export const dynamic = "force-dynamic";

/** Lowest first: the zone that most needs players heads the list. */
const DEFAULT_SORT = { key: "quests" as CoverageSort, desc: false };

/** The lists' own query; the zones fit one page, so any later page is malformed. */
function coverageQuery(search: Search) {
  const q = listQuery(search, COVERAGE_SORTS);
  return q && q.page === 1 ? q : null;
}

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = coverageQuery((await props.searchParams) ?? {});
  return { ...pageMetadata(META), ...(q && !q.q && !q.sort ? {} : { robots: { index: false, follow: true } }) };
}

export default async function CoveragePage(props: { searchParams?: Promise<Search> }) {
  const q = coverageQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const report = await loadCoverage();
  const plateau = report && (await loadPlateau(report));
  const deciding = plateau ? PLATEAU_TYPES.map((t) => plateau.types.find((p) => p.type === t)!) : [];
  const href = (over: Partial<typeof q>) => listHref(META.path, [["q", "q" in over ? over.q : q.q], ["sort", sortParam("sort" in over ? over.sort : q.sort)]]);

  // The search: a zone's name, or a quest or NPC id, which finds the zone the score counts it in.
  const text = q.q?.toLowerCase().replace(/^#/, "");
  const id = text && /^\d{1,9}$/.test(text) ? Number(text) : null;
  const found = id === null || !report ? [] : [
    ...report.locate.quests.filter(([x]) => x === id).map(([, zone]) => ({ what: `Quest ${id}`, zone })),
    ...report.locate.npcs.filter(([x]) => x === id).map(([, zone]) => ({ what: `NPC ${id}`, zone })),
  ];
  const zoneName = (mapId: number | null) => report?.zones.find((z) => z.mapId === mapId);
  const zones = (report?.zones ?? []).filter((z) => !text || (id !== null ? found.some((f) => f.zone === z.mapId) : z.name.toLowerCase().includes(text)));

  const sort = q.sort ?? DEFAULT_SORT;
  const rows = sortRows(zones, (z) => (sort.key === "zone" ? z.name : cellRank(z.types[sort.key as CoverageType])), sort.desc, (z) => z.mapId);
  const columns: SparseColumn<ZoneCoverage>[] = [
    { key: "zone", header: "Zone", sortable: true, cell: (z) => <Link href={zoneCoverageHref(z)} className={LINK}>{z.name}</Link> },
    ...COVERAGE_TYPES.map((t): SparseColumn<ZoneCoverage> => ({
      key: t, header: TYPE_LABEL[t], numeric: true, sortable: true,
      cell: (z) => <span title={cellDetail(z.types[t])} className="tabular-nums">{shareText(z.types[t])}<span className="sr-only">: {cellDetail(z.types[t])}</span></span>,
    })),
  ];
  const plateauColumns: SparseColumn<TypePlateau>[] = [
    { key: "type", header: "Type", cell: (t) => TYPE_LABEL[t.type] },
    { key: "confirmed", header: "Confirmed", numeric: true, cell: (t) => <span className="tabular-nums">{plateauShare(t.shares.confirmed)}</span> },
    { key: "settled", header: "Settled", numeric: true, cell: (t) => <span className="tabular-nums">{plateauShare(t.shares.settled)}</span> },
    { key: "new", header: "Newly confirmed", numeric: true, cell: (t) => <span className="tabular-nums">{plateauShare(t.shares.newlyConfirmed)}</span> },
    { key: "plateau", header: "At plateau", cell: (t) => <span title={plateauDetail(t)}>{plateauVerdict(t.atPlateau)}<span className="sr-only">: {plateauDetail(t)}</span></span> },
  ];

  return (
    <Container width="data">
      <article>
        <DataTitle title="Coverage" meta={report ? `${report.zones.length} zones` : undefined} />
        <FilterBar
          label="Coverage search"
          search={{ action: META.path, value: q.q, placeholder: "Zone, quest id or NPC id", label: "Find a zone, quest or NPC", keep: q.sort ? { sort: sortParam(q.sort)! } : {} }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref={href({ q: undefined })}
        />
        {!report ? <Unreadable /> : (
          <>
            <p className="mt-2 mb-3 max-w-reading text-meta text-fg-2">
              Each cell is settled / confirmed: the share of the zone&apos;s facts players have settled, then the share they have confirmed.
              Lowest first, so the zones that need players most are on top. {report.method}
            </p>
            <p className="mb-3 max-w-reading text-meta text-muted">{measuredLine(report)}</p>
            {plateau && (
              <p className="mb-3 max-w-reading text-cell text-fg-2">
                Plateau: {plateau.site === true ? "reached" : plateau.site === false ? "not yet" : "[?]"}.{" "}
                {deciding.map((t, i) => <span key={t.type}>{i ? ", " : ""}{TYPE_LABEL[t.type]} {plateauVerdict(t.atPlateau)}</span>)}.{" "}
                <a href="#plateau" className={LINK}>The numbers</a>
              </p>
            )}
            {id !== null && (
              <p className="mb-3 text-cell text-fg-2">
                {found.length === 0 ? `No quest or NPC ${id} has been reported yet.` : found.map((f, i) => {
                  const z = zoneName(f.zone);
                  return <span key={i} className="mr-3">{f.what}: {z ? <>counted in <Link href={zoneCoverageHref(z)} className={LINK}>{z.name}</Link></> : "in no released zone yet"}.</span>;
                })}
              </p>
            )}
            <DataTable
              dense
              caption={`Coverage by zone: ${rows.length} zones`}
              columns={columns}
              rows={rows}
              rowKey={(z) => String(z.mapId)}
              sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
              sortHref={(k, dir) => href({ sort: nextSort(k, dir, DEFAULT_SORT) })}
              meta={(z) => `${z.installs.toLocaleString("en-US")} installs · ${z.needsTotal.toLocaleString("en-US")} facts need 1 or 2 more`}
              empty={<NoMatches noun="zones" chips={q.q ? [{ label: `Search: ${q.q}`, href: href({ q: undefined }) }] : []} clearHref={META.path} />}
            />
            {report.unplaced.types.quests.observed + report.unplaced.types.npcs.observed > 0 && (
              <p className="mt-3 max-w-reading text-meta text-muted">
                Not in any zone yet, so in no share: {report.unplaced.types.quests.observed.toLocaleString("en-US")} quests whose giver has no agreed place
                and {report.unplaced.types.npcs.observed.toLocaleString("en-US")} NPCs seen only inside a dungeon or on no released map.
              </p>
            )}
            {plateau && (
              <section aria-labelledby="plateau" className="mt-6">
                <h2 id="plateau" className="mb-2 text-h2-sm text-fg sm:text-h2">Plateau</h2>
                <DataTable dense caption="Plateau by type: the types the site's plateau is measured on" columns={plateauColumns} rows={deciding} rowKey={(t) => t.type} meta={(t) => plateauDetail(t)} />
                <p className="mt-2 max-w-reading text-meta text-muted">{plateauMeasured(plateau)} {plateau.method}</p>
              </section>
            )}
          </>
        )}
      </article>
    </Container>
  );
}
