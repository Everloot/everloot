import type { Metadata } from "next";
import Link from "next/link";
import { curatedAddon } from "@/data/addon-repos";
import { BADGES, buildBoards, loadEcosystem, type BadgeId, type ProjectView } from "@/lib/ecosystem";
import { pageMetadata } from "@/lib/seo";
import { REPO_URL } from "@/lib/source";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, EmptyState, Entry, EntryList, Explainer, PageHeader, SectionHeading } from "@/components/ui";

export const metadata: Metadata = pageMetadata({
  title: "WoW Forever Addons and Open-Source Projects",
  description: "A community tracker of WoW: Forever addons and tools: five boards, a Forever-ready check against each .toc, GitHub repo facts and Everloot install counts.",
  path: "/addons/ecosystem",
});
export const dynamic = "force-dynamic";

const EXT = "noopener noreferrer nofollow";
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const day = (iso: string) => iso.slice(0, 10);
const refreshed = (iso: string | null) =>
  iso ? `GitHub facts refreshed ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "GitHub facts not refreshed yet";

const BADGE_LABEL: Record<BadgeId, string> = {
  "forever-ready": "Forever-ready",
  active: "Active",
  "fresh-release": "Fresh release",
  responsive: "Responsive",
  "open-license": "Licensed",
  archived: "Archived",
};

function profileHref(project: ProjectView): string | null {
  const name = project.addonNames[0];
  if (!name) return null;
  return project.installs !== null || curatedAddon(name) ? `/addons/${encodeURIComponent(name)}` : null;
}

/** One project's repository facts, label beside value, as a line that wraps. */
function ProjectFacts({ project }: { project: ProjectView }) {
  const m = project.metrics?.status === "ok" ? project.metrics : null;
  const facts: [string, React.ReactNode][] = [
    ["Everloot installs", project.installs !== null ? project.installs : "not counted"],
    ["Stars", m?.stars ?? "unknown"],
    ["Latest release", m?.release ? <><a href={m.release.url} rel={EXT} className={link}>{m.release.tag}</a> {day(m.release.date)}</> : "none on GitHub"],
    ["Last commit", m?.lastCommit ? day(m.lastCommit) : "unknown"],
    ["Commits, 4 weeks", m?.commits4w ?? "unknown"],
    ["Contributors", m?.contributors ?? "unknown"],
    ["Issues, open / closed", m?.openIssues != null && m.closedIssues != null ? `${m.openIssues} / ${m.closedIssues}` : "unknown"],
    ["Median first reply", m?.medianFirstResponseHours != null ? `${m.medianFirstResponseHours} h` : "not measured"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {facts.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="font-mono text-xs text-muted">{label}</dt>
          <dd className="font-mono tabular-nums text-fg [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Project({ project }: { project: ProjectView }) {
  const profile = profileHref(project);
  const ready =
    project.foreverReady === "yes" ? "Forever-ready" : project.foreverReady === "no" ? "Not declared for Forever" : "Forever-ready not checked";
  // The other badges read as one plain line; what each means is in the explainer at the foot.
  const badges = project.badges.filter((b) => b !== "forever-ready").map((b) => BADGE_LABEL[b]);
  return (
    <Entry
      as="h3"
      title={project.name}
      meta={[project.kind === "addon" ? "Addon" : "Tool", ready, ...badges].join(" · ")}
      actions={
        <>
          <a href={project.url} rel={EXT} className={`inline-flex items-center min-h-11 ${link}`}>GitHub<span className="sr-only"> repository of {project.name}</span></a>
          {profile && <Link href={profile} className={`inline-flex items-center min-h-11 ${link}`}>Everloot page<span className="sr-only"> for {project.name}</span></Link>}
        </>
      }
    >
      <p>{project.summary}</p>
      <ProjectFacts project={project} />
      {project.metrics?.status === "missing" && <p>Its repository was not found. It may be private or renamed.</p>}
    </Entry>
  );
}

export default async function EcosystemPage() {
  const view = await loadEcosystem();
  const boards = buildBoards(view, new Date());
  const issueUrl = `${REPO_URL}/issues/new?template=ecosystem-project.yml`;
  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={trailFor("/addons/ecosystem")!}
          title="Forever addons and projects"
          lede="A community list of addons and tools made for WoW: Forever, each checked by a maintainer."
          meta={<span className="font-mono text-xs">{plural(view.projects.length, "project", "projects")} · {refreshed(view.refreshedAt)}</span>}
        />

        <div className="space-y-12">
          <section aria-labelledby="boards">
            <SectionHeading id="boards" note="The boards rank projects, not people.">Boards</SectionHeading>
            <div className="grid gap-4 md:grid-cols-2">
              {boards.map((board) => (
                <Card key={board.id} as="section" aria-labelledby={`board-${board.id}`}>
                  <SectionHeading id={`board-${board.id}`} as="h3" note={board.rule}>{board.title}</SectionHeading>
                  {board.rows.length > 0 ? (
                    <ol className="space-y-2">
                      {board.rows.map((row, i) => (
                        <li key={row.project.id} className="flex items-baseline justify-between gap-3 text-sm">
                          <span><span className="mr-2 font-mono tabular-nums text-fg-2">{i + 1}</span><span className="text-fg">{row.project.name}</span></span>
                          <span className="text-right font-mono text-xs tabular-nums text-muted">{row.display}</span>
                        </li>
                      ))}
                    </ol>
                  ) : board.id === "installed" && view.installsAvailable ? (
                    <EmptyState framed={false} message="No project has three installs reporting it yet." />
                  ) : (
                    <p className="text-sm text-fg-2">
                      {board.id === "installed" ? "Install counts are unavailable right now." : "No project qualifies yet."}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </section>

          <section aria-labelledby="projects">
            <SectionHeading id="projects">Projects</SectionHeading>
            <EntryList label="Projects, by name">
              {[...view.projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <Project key={p.id} project={p} />)}
            </EntryList>
          </section>

          <section aria-labelledby="add">
            <SectionHeading id="add">Add a project, or ask to be removed</SectionHeading>
            <p className="text-sm text-fg-2">
              Open an issue with the repository link and where it says the project is for Forever. A maintainer checks it
              and adds it by hand. Authors can also ask to be taken off.
            </p>
            <a href={issueUrl} rel={EXT} className={`inline-flex items-center min-h-11 ${link}`}>Suggest a project</a>
          </section>
        </div>

        <Explainer summary="How the boards, badges and Forever-ready check work">
          <p>
            Repository facts are read from <a href="https://docs.github.com/en/rest" rel={EXT} className={link}>GitHub&apos;s public API</a> at
            most every few hours and shown with a link to each repository. Installs are counted from Everloot uploads, and
            shown once three installs report the addon. Stars can be bought, so only the Rising board uses them, and only
            as a week&apos;s gain. CurseForge, Wago and WoWInterface are linked, never read.
          </p>
          <p>
            {view.forever ? (
              <>
                Forever-ready means the addon&apos;s .toc lists Interface {view.forever.interface}, the number for Forever build{" "}
                {view.forever.version}. Blizzard&apos;s game files do not state it; we derive it from the version, the way
                Classic Era 1.15.9 is 11509. It is not confirmed in the live client yet, so treat the badge as a hint, not a promise it loads.
              </>
            ) : (
              "Forever-ready is not checked: no Forever build is known."
            )}
          </p>
          <dl className="space-y-1">
            {(Object.keys(BADGE_LABEL) as BadgeId[]).map((id) => (
              <div key={id}><dt className="inline text-fg">{BADGE_LABEL[id]}: </dt><dd className="inline">{BADGES[id]}</dd></div>
            ))}
          </dl>
          <p>Everloot is not affiliated with these projects.</p>
        </Explainer>
      </article>
    </Container>
  );
}
