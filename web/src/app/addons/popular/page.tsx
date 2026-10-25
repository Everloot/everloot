import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { dataAgeLabel } from "@/lib/data-age";
import { loadPopularAddons } from "@/lib/rollup-compute";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, DataTable, EmptyState, Explainer, PageHeader, type Column } from "@/components/ui";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Popular WoW Forever Addons", description: "Which addons WoW: Forever players run, counted from Everloot uploads by players who share their addon list. An addon is listed once three installs report it.", path: "/addons/popular" }),
};
export const dynamic = "force-dynamic";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const percent = (share: number) => `${Number((share * 100).toFixed(1))}%`;
/** The UTC day, whatever offset the time was written with. */
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** A search for the title on CurseForge. A link only: Everloot neither calls nor copies CurseForge. */
const curseforgeSearch = (title: string) => `https://www.curseforge.com/wow/search?search=${encodeURIComponent(title)}`;

type Usage = Awaited<ReturnType<typeof loadPopularAddons>>;
type Row = Usage["addons"][number] & { rank: number };

const columns = (reportingInstalls: number): Column<Row>[] => [
  { key: "rank", header: "#", numeric: true, cell: (a) => a.rank },
  {
    key: "addon",
    header: "Addon",
    cell: (a) => (
      <>
        <Link href={`/addons/${encodeURIComponent(a.name)}`} className={`block font-medium ${link}`}>{a.title}</Link>
        <a href={curseforgeSearch(a.title)} rel="noopener" className={`inline-flex items-center min-h-11 text-xs ${link}`}>
          Search CurseForge<span className="sr-only"> for {a.title}</span>
        </a>
      </>
    ),
  },
  {
    key: "share",
    header: "Share",
    cell: (a) => (
      <div className="min-w-32">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono tabular-nums">
          <span>{percent(a.share)}</span>
          <span className="whitespace-nowrap text-xs text-muted">{a.loadedInstalls} of {reportingInstalls}</span>
        </div>
        <div aria-hidden="true" className="mt-1.5 h-1 rounded-full bg-line">
          <div className="h-1 rounded-full bg-fg-2" style={{ width: percent(a.share) }} />
        </div>
      </div>
    ),
  },
  { key: "installs", header: "Installs", numeric: true, cell: (a) => a.installs },
  { key: "first", header: "First seen", numeric: true, cell: (a) => day(a.firstSeen) },
  { key: "last", header: "Last seen", numeric: true, cell: (a) => day(a.lastSeen) },
];

export default async function PopularAddonsPage() {
  const { addons, reportingInstalls, unreachable, dataAsOf } = await loadPopularAddons();
  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={trailFor("/addons/popular")!}
          title="Addons Forever players run"
          lede="Counted from Everloot uploads by players who turned the addon list on."
          meta={
            <span className="font-mono text-xs">
              {unreachable
                ? "Storage unreachable"
                : `${plural(reportingInstalls, "reporting install", "reporting installs")} · ${plural(addons.length, "addon listed", "addons listed")} · ${dataAgeLabel(dataAsOf)}`}
            </span>
          }
        />

        {unreachable ? (
          <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
        ) : addons.length === 0 ? (
          <EmptyState
            message="No addon is listed yet. An addon appears here once three installs report it."
            action={{ href: "/upload", label: "Upload your addon list" }}
          />
        ) : (
          <DataTable
            caption="Addons by the share of reporting installs that run them"
            columns={columns(reportingInstalls)}
            rows={addons.map((a, i) => ({ ...a, rank: i + 1 }))}
            rowKey={(a) => a.name}
          />
        )}

        <Explainer summary="How addons are counted, and how to add yours">
          <p>
            An addon is listed once three installs report it, so a rare setup cannot be picked out. Everloot itself is left
            out. An install is one copy of the Everloot addon, not proof of one person.
          </p>
          <p>
            Share is the installs that had the addon loaded, out of every install that reported its addons. The CurseForge
            link opens a search there; Everloot does not use CurseForge&apos;s data.
          </p>
          <p>
            To add yours, type <code className="font-mono text-fg">/everloot addons on</code> in the game, play, log out, then
            send your save file from the <Link href="/upload" className={link}>upload page</Link>. The preview names every
            addon before anything is sent.
          </p>
          <p>Addon lists are never published row by row, only these counts.</p>
        </Explainer>
      </article>
    </Container>
  );
}
