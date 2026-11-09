import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { dataAgeLabel } from "@/lib/data-age";
import { loadAddonLeaderboard } from "@/lib/rollup-compute";
import { loadEcosystem } from "@/lib/ecosystem";
import { addonGithubSummary, type AddonGithubSummaryResult } from "@/lib/addon-github";
import { initials } from "@/lib/addon-board";
import { leaderRows, liveRepos, rateLimited, sparkPoints, SPARK, type LeaderRow } from "@/lib/addon-leaderboard";
import { STORAGE_UNREACHABLE, STORAGE_UNREACHABLE_SHORT } from "@/lib/upload-store";
import { trailFor } from "@/lib/breadcrumbs";
import { LAUNCH, longDate } from "@/data/wow-forever";
import { Card, Container, DataTable, EmptyState, Explainer, PageHeader, type Column } from "@/components/ui";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Popular WoW Forever Addons", description: "Leaderboard of the addons WoW: Forever players run, from Everloot uploads, with GitHub stars and releases. An addon is listed once three installs report it.", path: "/addons/popular" }),
};
export const dynamic = "force-dynamic";

const EXT = "noopener noreferrer nofollow";
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const small = `inline-flex items-center min-h-11 text-xs ${link}`;
const dash = <span className="text-muted">—</span>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const percent = (share: number) => `${Number((share * 100).toFixed(1))}%`;
/** The UTC day, whatever offset the time was written with. */
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
/** 3:00 p.m. PST on launch day, as Blizzard's announcement puts it. */
const LAUNCH_AT = Date.parse(`${LAUNCH.date}T23:00:00Z`);

/** The top three get an accent ring, the rest a plain one, so the podium reads at a glance. */
function RankBadge({ rank }: { rank: number }) {
  const tone = rank <= 3 ? "border-accent text-accent font-semibold" : "border-line text-muted";
  return (
    <span data-rank={rank} className={`inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full border px-1.5 font-mono text-xs tabular-nums ${tone}`}>
      <span className="sr-only">Rank </span>{rank}
    </span>
  );
}

/** The repository owner's GitHub picture over an initials tile, as on /addons. */
function Logo({ row }: { row: LeaderRow }) {
  return (
    <span aria-hidden="true" className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-canvas font-mono text-[10px] font-medium text-fg-2">
      {initials(row.title)}
      {row.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.logo} alt="" width={24} height={24} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
}

function Movement({ row }: { row: LeaderRow }) {
  const m = row.movement;
  if (!m) return dash;
  if (m.kind === "new") return <span className="text-accent">New</span>;
  if (m.kind === "same") return <span className="text-muted">=<span className="sr-only"> same rank</span></span>;
  return (
    <span className={m.kind === "up" ? "text-accent" : "text-muted"}>
      <span aria-hidden="true">{m.kind === "up" ? "▲" : "▼"}</span>{m.by}
      <span className="sr-only"> {m.kind === "up" ? "places up" : "places down"}</span>
    </span>
  );
}

function Sparkline({ row }: { row: LeaderRow }) {
  const points = sparkPoints(row.shares);
  if (!points) return dash;
  return (
    <svg data-sparkline width={SPARK.width} height={SPARK.height} viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} aria-hidden="true" className="inline-block align-middle text-accent">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}

const columns = (reportingInstalls: number): Column<LeaderRow>[] => [
  {
    // The rank sits in the first cell, so on a phone (where only the first column shows) it stays in view.
    key: "addon",
    header: "Addon",
    cell: (a) => (
      <span className="flex min-w-0 items-center gap-2">
        <RankBadge rank={a.rank} />
        <Logo row={a} />
        <span className="min-w-0">
          {/* Usage is public for any addon three installs report; a page and the owner's title exist only for an approved one. */}
          {a.page ? (
            <Link href={a.page} className={`block font-medium ${link}`}>{a.title}</Link>
          ) : (
            <span className="block font-medium">{a.title}</span>
          )}
          {a.owner && <span className="text-cell-2 text-muted">{a.owner}</span>}
        </span>
      </span>
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
          <div className={`h-1 rounded-full ${a.rank <= 3 ? "bg-accent" : "bg-fg-2"}`} style={{ width: percent(a.share) }} />
        </div>
      </div>
    ),
  },
  { key: "week", header: "Week", numeric: true, nowrap: true, cell: (a) => <Movement row={a} /> },
  { key: "trend", header: "8 weeks", cell: (a) => <Sparkline row={a} /> },
  { key: "stars", header: "Stars", numeric: true, cell: (a) => a.stars ?? dash },
  {
    key: "release",
    header: "Latest release",
    nowrap: true,
    cell: (a) => (a.release ? <a href={a.release.url} rel={EXT} className={`font-mono ${link}`}>{a.release.tag}</a> : dash),
  },
  { key: "last", header: "Last seen", numeric: true, cell: (a) => day(a.lastSeen) },
  {
    key: "links",
    header: "Get it",
    cell: (a) => (
      <span className="flex flex-wrap gap-x-3">
        {a.github && <a href={a.github} rel={EXT} className={small}>GitHub<span className="sr-only"> for {a.title}</span></a>}
        <a href={a.curseforge.href} rel={EXT} className={small}>
          {a.curseforge.search ? "Search CurseForge" : "CurseForge"}<span className="sr-only"> for {a.title}</span>
        </a>
        {a.wago && <a href={a.wago} rel={EXT} className={small}>Wago<span className="sr-only"> for {a.title}</span></a>}
      </span>
    ),
  },
];

export default async function PopularAddonsPage() {
  const { addons, reportingInstalls, trends, unreachable, dataAsOf } = await loadAddonLeaderboard();
  const { projects } = await loadEcosystem();
  const repos = liveRepos(addons, projects);
  const results = await Promise.all(repos.map((repo) => addonGithubSummary(repo)));
  const live: Record<string, AddonGithubSummaryResult> = Object.fromEntries(repos.map((repo, i) => [repo, results[i]]));
  const rows = leaderRows(addons, trends, projects, live);
  const beforeLaunch = Date.now() < LAUNCH_AT;
  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={trailFor("/addons/popular")!}
          title="Addons Forever players run"
          lede="A leaderboard of the addons in players' Everloot uploads, ranked by how many reporting installs run each one."
          meta={
            <span className="font-mono text-xs">
              {unreachable
                ? STORAGE_UNREACHABLE_SHORT
                : `${plural(reportingInstalls, "reporting install", "reporting installs")} · ${plural(addons.length, "addon listed", "addons listed")} · ${dataAgeLabel(dataAsOf)}`}
            </span>
          }
        />

        {unreachable ? (
          <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
        ) : rows.length === 0 ? (
          <EmptyState
            message={beforeLaunch
              ? `WoW: Forever opens on ${longDate(LAUNCH.date)}, so nobody runs an addon in it yet. The board fills after launch, once three installs report the same addon.`
              : "No addon is listed yet. An addon appears here once three installs report it."}
            action={{ href: "/upload", label: "Upload your addon list" }}
          />
        ) : (
          <>
            {rateLimited(live) && (
              <p className="mb-3 text-sm text-muted">GitHub&apos;s hourly limit ran out, so some stars and releases are missing. They come back within the hour.</p>
            )}
            <DataTable
              caption="Addons by the share of reporting installs that run them"
              columns={columns(reportingInstalls)}
              rows={rows}
              rowKey={(a) => a.name}
            />
          </>
        )}

        <Explainer summary="How addons are ranked, and how to add yours">
          <p>
            An addon is listed once three installs report it, so a rare setup cannot be picked out. Everloot itself is left
            out. An install is one copy of the Everloot addon, not proof of one person.
          </p>
          <p>
            This board counts what players run; it is not a directory. Everloot gives an addon its own page, title and
            download links only after we have checked it by hand, so a listed addon with no link has not been checked yet.
          </p>
          <p>
            Share is the installs that had the addon loaded, out of every install that reported its addons. The counts are
            all-time. Week compares the rank with the board as it stood seven days earlier; New means the addon had no
            published point then. The 8-week line is the share at the end of each week. A past week is shown only when
            the change since then is three installs or more, both in installs reporting and in installs running the
            addon, so no week can be subtracted from another to single out one or two installs. Early on, most weeks
            stay blank.
          </p>
          <p>
            Stars and the latest release come from GitHub, for addons whose repository has been checked by hand. Everloot
            does not call CurseForge or Wago: their links open the author&apos;s page there, or a CurseForge search when we
            have not checked which page is the right one.
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
