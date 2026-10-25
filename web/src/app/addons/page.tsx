import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { trailFor } from "@/lib/breadcrumbs";
import { curatedAddon } from "@/data/addon-repos";
import { loadEcosystem, starHistory } from "@/lib/ecosystem";
import {
  boardHref, boardQuery, boardRows, changeSince, initials, sortBoard, TAG_LABEL,
  type BoardQuery, type BoardRow, type BoardSort, type Search,
} from "@/lib/addon-board";
import { Badge, Container, DataTable, EmptyState, Explainer, FilterBar, LinkTabs, PageHeader, type Column } from "@/components/ui";

export const metadata: Metadata = {
  ...pageMetadata({ title: "WoW Forever Addons", description: "Addons and tools made for WoW: Forever, ranked by GitHub stars, with weekly change, recent commits, releases and installs, as a leaderboard or as cards.", path: "/addons" }),
};
export const dynamic = "force-dynamic";

const EXT = "noopener noreferrer nofollow";
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const dash = <span className="text-muted">—</span>;
const day = (iso: string) => iso.slice(0, 10);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Pages on this site for a project; the rest get the install profile when one exists. */
const OWN_PAGE: Record<string, string> = { everloot: "/addon", polestar: "/addons/polestar" };

function sitePage(row: BoardRow): string | null {
  const own = OWN_PAGE[row.project.id];
  if (own) return own;
  const name = row.project.addonNames[0];
  return name && (row.installs !== null || curatedAddon(name)) ? `/addons/${encodeURIComponent(name)}` : null;
}

/** The ranking views, as OpenRouter lists its rankings: each one a sort of the same board. */
const RANKINGS: { sort: BoardSort; desc: boolean; label: string }[] = [
  { sort: "stars", desc: true, label: "GitHub stars" },
  { sort: "change", desc: true, label: "Stars gained" },
  { sort: "commits", desc: true, label: "Commits, 4 weeks" },
  { sort: "release", desc: true, label: "Newest release" },
  { sort: "updated", desc: true, label: "Recently updated" },
  { sort: "installs", desc: true, label: "Everloot installs" },
  { sort: "name", desc: false, label: "A to Z" },
];

/** The owner's GitHub picture over an initials tile: with no picture, or one that fails to load, the letters show. */
function Logo({ row, size }: { row: BoardRow; size: 24 | 40 }) {
  const box = size === 24 ? "h-6 w-6 text-[10px]" : "h-10 w-10 text-xs";
  return (
    <span aria-hidden="true" data-logo className={`relative inline-flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-canvas font-mono font-medium text-fg-2`}>
      {initials(row.project.name)}
      {row.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.logo} alt="" width={size} height={size} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
}

function columns(q: BoardQuery, showChange: boolean, showInstalls: boolean): Column<BoardRow>[] {
  const cards = (row: BoardRow) => `${boardHref({ ...q, view: "cards" })}#addon-${row.project.id}`;
  return [
    {
      // The rank sits in the first cell, so on a phone (where only the first column shows) it stays in view.
      key: "name", header: "Addon", sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-5 shrink-0 text-right font-mono tabular-nums text-muted">{r.rank}</span>
          <Logo row={r} size={24} />
          <span className="min-w-0">
            <Link href={cards(r)} className={`font-medium ${link}`}>{r.project.name}</Link>
            {r.owner && <span className="ml-2 text-cell-2 text-muted">{r.owner}</span>}
          </span>
        </span>
      ),
    },
    { key: "kind", header: "Type", nowrap: true, cell: (r) => (r.project.kind === "addon" ? "Addon" : "Tool") },
    { key: "stars", header: "Stars", numeric: true, sortable: true, cell: (r) => r.stars ?? dash },
    ...(showChange ? [{ key: "change", header: "Change", numeric: true, sortable: true, cell: (r: BoardRow) => (r.change === null ? dash : <span className={r.change > 0 ? "text-accent" : "text-muted"}>{signed(r.change)}</span>) }] : []),
    { key: "commits", header: "Commits, 4 wk", numeric: true, sortable: true, cell: (r) => r.commits4w ?? dash },
    { key: "release", header: "Latest release", numeric: true, sortable: true, cell: (r) => (r.release ? <span title={r.release.tag}>{day(r.release.date)}</span> : dash) },
    { key: "updated", header: "Updated", numeric: true, sortable: true, cell: (r) => (r.updated ? day(r.updated) : dash) },
    ...(showInstalls ? [{ key: "installs", header: "Installs", numeric: true, sortable: true, cell: (r: BoardRow) => r.installs ?? dash }] : []),
  ];
}

function AddonCard({ row, showChange, showInstalls }: { row: BoardRow; showChange: boolean; showInstalls: boolean }) {
  const p = row.project;
  const source = p.addonNames[0] ? curatedAddon(p.addonNames[0])?.source : undefined;
  const page = sitePage(row);
  const tags = [p.kind === "addon" ? "Addon" : "Tool", ...p.badges.map((b) => TAG_LABEL[b]).filter((t): t is string => Boolean(t))];
  const facts: [string, React.ReactNode][] = [
    ["Stars", row.stars === null ? dash : <>{row.stars}{showChange && row.change !== null && <span className={`ml-1 ${row.change > 0 ? "text-accent" : "text-muted"}`}>{signed(row.change)}</span>}</>],
    ["Commits, 4 wk", row.commits4w ?? dash],
    ["Latest release", row.release ? <>{row.release.tag} <span className="text-muted">{day(row.release.date)}</span></> : dash],
    ["Updated", row.updated ? day(row.updated) : dash],
    ...(showInstalls ? [["Installs", row.installs ?? dash] as [string, React.ReactNode]] : []),
  ];
  return (
    <li id={`addon-${p.id}`} data-card className="flex min-w-0 scroll-mt-24 flex-col gap-3 rounded-card border border-line bg-panel p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Logo row={row} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-cell font-medium text-fg">{p.name}</h2>
          {row.owner && <p className="truncate text-cell-2 text-muted">{row.owner}</p>}
        </div>
        <span className="font-mono text-cell-2 tabular-nums text-muted">#{row.rank}</span>
      </div>
      {row.description ? <p className="text-cell text-fg-2">{row.description}</p> : <p className="text-cell text-muted">No description yet.</p>}
      <div className="flex flex-wrap gap-1.5">{tags.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-cell-2 text-muted">{label}</dt>
            <dd className="font-mono text-cell tabular-nums text-fg [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto flex flex-wrap gap-x-4 text-cell">
        <a href={p.url} rel={EXT} className={`inline-flex min-h-8 items-center ${link}`}>GitHub<span className="sr-only"> repository of {p.name}</span></a>
        {source?.curseforge && <a href={source.curseforge} rel={EXT} className={`inline-flex min-h-8 items-center ${link}`}>CurseForge<span className="sr-only"> page of {p.name}</span></a>}
        {source?.wago && <a href={source.wago} rel={EXT} className={`inline-flex min-h-8 items-center ${link}`}>Wago<span className="sr-only"> page of {p.name}</span></a>}
        {page && <Link href={page} className={`inline-flex min-h-8 items-center ${link}`}>On Everloot<span className="sr-only">: {p.name}</span></Link>}
      </div>
    </li>
  );
}

export default async function AddonsPage(props: { searchParams?: Promise<Search> }) {
  const q = boardQuery((await props?.searchParams) ?? {});
  const view = await loadEcosystem();
  const all = boardRows(view, starHistory);
  const since = changeSince(all);
  const showChange = since !== null;
  const showInstalls = view.installsAvailable;
  // A sort on a column this page is not showing falls back to the default ranking.
  const sort = (q.sort === "change" && !showChange) || (q.sort === "installs" && !showInstalls) ? { ...q, sort: "stars" as const, desc: true } : q;
  const rows = sortBoard(all.filter((r) => !sort.kind || r.project.kind === sort.kind), sort.sort, sort.desc);
  const here = (over: Partial<BoardQuery>) => boardHref({ ...sort, ...over });
  const count = (kind: "addon" | "tool") => all.filter((r) => r.project.kind === kind).length;
  const rankings = RANKINGS.filter((r) => (r.sort !== "change" || showChange) && (r.sort !== "installs" || showInstalls));
  const ranking = rankings.find((r) => r.sort === sort.sort)?.label ?? "GitHub stars";

  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={trailFor("/addons")!}
          title="Addons"
          lede="Addons and tools made for WoW: Forever, ranked by GitHub stars."
          meta={<span className="font-mono text-xs">{plural(all.length, "project", "projects")}{view.refreshedAt && ` · updated ${day(view.refreshedAt)} ${view.refreshedAt.slice(11, 16)} UTC`}</span>}
        />

        <div className="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-6">
          <nav aria-label="Rankings" className="min-w-0">
            <h2 className="mb-1 text-th text-muted">Rank by</h2>
            <ul className="flex flex-wrap gap-x-1 lg:flex-col">
              {rankings.map((r) => {
                const on = r.sort === sort.sort;
                return (
                  <li key={r.sort}>
                    <Link
                      href={here({ sort: r.sort, desc: r.desc })}
                      aria-current={on ? "page" : undefined}
                      className={`flex min-h-8 items-center rounded-control px-2 text-control ${on ? "bg-panel text-fg" : "text-fg-2 hover:text-fg"}`}
                    >
                      {r.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0">
            <LinkTabs
              label="View"
              tabs={[
                { href: here({ view: "leaderboard" }), label: "Leaderboard", current: sort.view === "leaderboard" },
                { href: here({ view: "cards" }), label: "Cards", current: sort.view === "cards" },
              ]}
              aside={<span className="text-meta text-muted">{showChange ? `Change: stars since ${day(since!)}` : "No star history yet, so no change column"}</span>}
            />
            <div className="mt-2">
              <FilterBar
                label="Addon filters"
                controls={[{
                  type: "menu", key: "kind", label: "Type",
                  options: [
                    { label: "All", href: here({ kind: undefined }), on: !sort.kind, reset: true, count: all.length },
                    { label: "Addons", href: here({ kind: "addon" }), on: sort.kind === "addon", count: count("addon") },
                    { label: "Tools", href: here({ kind: "tool" }), on: sort.kind === "tool", count: count("tool") },
                  ],
                }]}
                active={sort.kind ? 1 : 0}
                clearHref={here({ kind: undefined })}
                aside={<span className="text-meta text-muted">{plural(rows.length, "project", "projects")} · {ranking}{sort.desc ? "" : ", low first"}</span>}
              />
            </div>

            <div className="mt-2">
              {sort.view === "cards" ? (
                rows.length === 0 ? (
                  <EmptyState framed={false} message="No projects match this filter." />
                ) : (
                  <ul aria-label={`Projects by ${ranking}`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {rows.map((row) => <AddonCard key={row.project.id} row={row} showChange={showChange} showInstalls={showInstalls} />)}
                  </ul>
                )
              ) : (
                <DataTable
                  dense
                  caption={`Addons and tools by ${ranking}`}
                  columns={columns(sort, showChange, showInstalls)}
                  rows={rows}
                  rowKey={(r) => r.project.id}
                  sort={{ key: sort.sort, direction: sort.desc ? "desc" : "asc" }}
                  sortHref={(key, dir) => here({ sort: key as BoardSort, desc: dir === "desc" })}
                  meta={(r) => [
                    r.owner,
                    r.stars !== null ? plural(r.stars, "star", "stars") : null,
                    showChange && r.change !== null ? `${signed(r.change)} since ${day(since!)}` : null,
                    r.updated ? `updated ${day(r.updated)}` : null,
                  ].filter(Boolean).join(" · ")}
                  empty={<EmptyState framed={false} message="No projects match this filter." />}
                />
              )}
            </div>

            <p className="mt-4 text-cell text-fg-2">
              Everloot&apos;s own addon is listed like any other; the rest are made by their own authors.{" "}
              <Link href="/addons/popular" className={link}>Addons players run</Link>
              {" · "}
              <Link href="/addons/ecosystem" className={link}>Addon tracker</Link>
              {" · "}
              <Link href="/addons/polestar/packs" className={link}>Polestar guide packs</Link>
            </p>

            <Explainer summary="How the ranking works">
              <p>
                Projects are ranked by GitHub stars; ties go to more commits in the last 4 weeks, then to the name. Change
                compares current stars with the oldest daily count from the last 7 days.
              </p>
              <p>Installs are copies of the Everloot addon that reported the addon, shown from 3. A dash means we do not have the number.</p>
            </Explainer>
          </div>
        </div>
      </article>
    </Container>
  );
}
