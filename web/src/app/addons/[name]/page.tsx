import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { approvedAddon, type ApprovedAddon } from "@/data/addon-repos";
import { addonGithub, type AddonGithubResult } from "@/lib/addon-github";
import { dataAgeLabel } from "@/lib/data-age";
import { loadPopularAddons } from "@/lib/rollup-compute";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, EmptyState, Explainer, Facts, PageHeader, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Every link that leaves Everloot. */
const EXT = "noopener noreferrer nofollow";
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const button = "btn min-h-11";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const percent = (share: number) => `${Number((share * 100).toFixed(1))}%`;
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

type Props = { params: Promise<{ name: string }> };

type Found = {
  /** The owner-approved entry: its folder name, title and source are what the page shows. */
  approved: ApprovedAddon;
  /** The install counts for it, joined by folder name. They are usage only: they never name, title or source the page. */
  stats: Awaited<ReturnType<typeof loadPopularAddons>>["addons"][number] | null;
  usage: Awaited<ReturnType<typeof loadPopularAddons>>;
} | null;

/**
 * A page exists only for an owner-approved addon (src/data/addon-repos.ts: the curated source map and the ecosystem
 * registry). Anything else is not found, however many installs report it: a made-up name and a widely run addon the
 * owner has not approved answer alike, with no read of the upload store. The counts on /addons/popular stay public
 * aggregate usage; they never publish a page, a title or a source link. When storage is down an approved page still
 * renders, with its outage sentence in place of the counts.
 * Names match without regard to case; `null` also covers a name that is not valid percent-encoding.
 */
async function find(params: Props["params"]): Promise<Found> {
  let typed: string;
  try {
    typed = decodeURIComponent((await params).name);
  } catch {
    return null;
  }
  const approved = approvedAddon(typed);
  if (!approved) return null;
  const usage = await loadPopularAddons();
  const lower = approved.name.toLowerCase();
  const stats = usage.unreachable ? null : usage.addons.find((a) => a.name === approved.name) ?? usage.addons.find((a) => a.name.toLowerCase() === lower) ?? null;
  return { approved, stats, usage };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await find(params);
  if (!found) return { title: "Addon not found" };
  const { approved } = found;
  // The owner's title, never the one uploads report.
  const title = approved.title;
  return pageMetadata({
    title: `${title}: addon for WoW: Forever`,
    description: `How many Everloot installs run ${title}, where its author publishes it and what its repository shows. Counts appear once three installs report the addon.`,
    // Polestar has a dedicated guide page at the lowercase address.
    path: approved.name.toLowerCase() === "polestar" ? "/addons/polestar" : `/addons/${encodeURIComponent(approved.name)}`,
  });
}

function GithubFacts({ result, repo }: { result: AddonGithubResult; repo: string }) {
  const repoUrl = `https://github.com/${repo}`;
  if (result.status === "missing") {
    return (
      <p className="text-sm text-fg-2">
        The repository Everloot has on file, <span className="font-mono">{repo}</span>, was not found on GitHub. It may
        have moved or been made private. Check the author&apos;s download page for the newest version.
      </p>
    );
  }
  if (result.status === "unavailable") {
    return (
      <p className="text-sm text-fg-2">
        {result.rateLimited
          ? "GitHub is limiting how often Everloot can ask it, so the repository facts are missing for now. They return within the hour."
          : "GitHub did not answer, so the repository facts are missing for now."}{" "}
        The <a className={link} href={`${repoUrl}/releases`} rel={EXT}>releases page</a> has the newest version.
      </p>
    );
  }
  const g = result.data;
  return (
    <div className="space-y-4">
      <Facts
        label="Repository facts"
        items={[
          { label: "Licence", value: g.license ?? "Not stated" },
          { label: "Last commit", value: g.lastCommit ?? "Unknown", numeric: true },
          { label: "Open issues", value: g.openIssues ?? "Unknown", numeric: true },
          { label: "Contributors", value: g.contributors ? `${g.contributors.count}${g.contributors.capped ? "+" : ""}` : "Unknown", numeric: true },
        ]}
      />
      {g.archived && <p className="text-sm text-fg-2">The author has archived this repository, so it no longer takes changes.</p>}
      {g.release ? (
        <>
          <p className="text-sm text-fg-2">
            Latest release{" "}
            <a className={link} href={g.release.url} rel={EXT}>{g.release.name ?? g.release.tag}</a>
            {g.release.name && g.release.name !== g.release.tag ? ` (${g.release.tag})` : ""}, published {g.release.date}.
          </p>
          {g.release.notes && (
            <Card>
              <figure className="space-y-2">
                <figcaption className="font-mono text-xs text-muted">Release notes, in the author&apos;s words</figcaption>
                <p className="whitespace-pre-wrap break-words text-sm text-fg-2">{g.release.notes}</p>
              </figure>
            </Card>
          )}
        </>
      ) : (
        <p className="text-sm text-fg-2">This repository has no published release yet.</p>
      )}
      {g.tree.length > 0 && (
        <p className="text-sm text-fg-2">
          Top level of the repository:{" "}
          <span className="font-mono text-xs text-fg [overflow-wrap:anywhere]">
            {g.tree.map((entry) => `${entry.name}${entry.kind === "dir" ? "/" : ""}`).join("  ")}
          </span>
        </p>
      )}
      <p className="text-sm text-muted">
        From GitHub&apos;s public API, refreshed hourly. <a className={link} href={g.url} rel={EXT}>View on GitHub</a>
      </p>
    </div>
  );
}

export default async function AddonProfilePage({ params }: Props) {
  const found = await find(params);
  if (!found) notFound();
  const { approved, stats, usage } = found;
  const { name, source, title } = approved;
  const { reportingInstalls, unreachable, dataAsOf } = usage;
  if (name !== decodeURIComponent((await params).name)) redirect(`/addons/${encodeURIComponent(name)}`);
  const github = await addonGithub(source.repo);
  const repoUrl = `https://github.com/${source.repo}`;
  const path = `/addons/${encodeURIComponent(name)}`;

  return (
    <Container width="reading">
      <article>
        <PageHeader
          trail={[...trailFor("/addons/popular")!, { name: title, path }]}
          title={title}
          lede="An addon for WoW: Forever, made by its own author. Everloot has not tested it, and neither Everloot nor the author of another addon vouches for it."
          meta={<span className="font-mono text-xs">{unreachable ? "Storage unreachable" : dataAgeLabel(dataAsOf)}</span>}
        />

        <div className="space-y-12">
          <section aria-labelledby="usage">
            <SectionHeading id="usage">Who runs it</SectionHeading>
            {unreachable ? (
              <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
            ) : stats ? (
              <div className="space-y-4">
                <Facts
                  label="Installs"
                  items={[
                    { label: "Installs reporting", value: stats.installs, numeric: true },
                    {
                      label: "Share",
                      numeric: true,
                      value: <>{percent(stats.share)}<span className="block text-xs text-muted">{stats.loadedInstalls} of {reportingInstalls} loaded it</span></>,
                    },
                    { label: "First seen", value: day(stats.firstSeen), numeric: true },
                    { label: "Last seen", value: day(stats.lastSeen), numeric: true },
                  ]}
                />
                <p className="text-sm text-fg-2">
                  {stats.versions.length > 0 ? (
                    <>
                      Versions at least three installs report:{" "}
                      {stats.versions.map((v, i) => (
                        <span key={v.version}>
                          {i > 0 && ", "}
                          <span className="font-mono text-fg">{v.version}</span> ({plural(v.installs, "install", "installs")})
                        </span>
                      ))}
                      .
                    </>
                  ) : (
                    "No single version is reported by three installs yet."
                  )}
                </p>
              </div>
            ) : (
              <EmptyState
                message="Everloot shows numbers for an addon once three installs report it. This one has not reached three yet."
                action={{ href: "/upload", label: "Upload your addon list" }}
              />
            )}
          </section>

          <section aria-labelledby="repo">
            <SectionHeading id="repo">The repository</SectionHeading>
            <GithubFacts result={github} repo={source.repo} />
          </section>

          <section aria-labelledby="download">
            <SectionHeading id="download" note="These links leave Everloot. Everloot hosts no addon files.">
              Download from the author
            </SectionHeading>
            <div className="flex flex-wrap gap-3">
              <a className={button} href={`${repoUrl}/releases`} rel={EXT}>GitHub releases</a>
              {source.curseforge && <a className={button} href={source.curseforge} rel={EXT}>CurseForge</a>}
              {source.wago && <a className={button} href={source.wago} rel={EXT}>Wago</a>}
              {source.wowinterface && <a className={button} href={source.wowinterface} rel={EXT}>WoWInterface</a>}
            </div>
          </section>

          <section aria-labelledby="use-data">
            <SectionHeading id="use-data">Use Everloot data in your addon</SectionHeading>
            <div className="space-y-3 text-fg-2">
              <p>
                Everloot publishes what players see in the game under CC BY-SA 4.0: credit Everloot and share what you build
                from it under the same licence. Your addon&apos;s own code can keep its licence.
              </p>
              <ul className="list-disc space-y-1 pl-6">
                <li><Link href="/docs" className={link}>Docs</Link>: how to use the data from your own project.</li>
                <li><a href="/api/corpus/public" className={link}>The public API</a>: the published records as JSON.</li>
                <li>The MCP server, <code className="font-mono text-fg">/mcp/public</code>: the same data for AI tools. It speaks MCP, not a web page, so <Link href="/docs/mcp/clients" className={link}>the docs</Link> explain how to point a tool at it.</li>
              </ul>
            </div>
          </section>
        </div>

        <Explainer summary="How installs are counted, and how to add yours">
          <p>
            Counted from Everloot uploads by players who turned the addon list on. An install is one copy of the Everloot
            addon, not proof of one person. Share is out of every install that reported its addons.
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
