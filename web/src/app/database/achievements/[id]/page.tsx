import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Badge, Container, DataTable, Facts, TooltipFrame } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { achievementHref, loadCatalog, parseSegment } from "@/lib/completion-lists";
import { entityTitle } from "@/lib/entity-meta";
import { pageMetadata } from "@/lib/seo";
import { CLIENT_LABEL } from "../../../../../../kb/src/edges";
import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { EmptyTab, EntityHeader, EntityTop, Unreachable } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };
// Two criteria can read the same, so a row is keyed by its place in the list.
type Criterion = { text: string; required: number; i: number };

/** The achievement's title, points, description and criteria from the game files, or null for an id the build lacks. */
function fromFiles(id: number) {
  const entry = CLIENT_ACHIEVEMENTS.achievements[String(id)];
  return entry ?? null;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  const listed = id === null ? undefined : (await loadCatalog())?.achievements.find((a) => a.achievementId === id);
  const entry = listed?.confirmed ? listed : undefined;
  const files = id === null ? null : fromFiles(id);
  // A page exists for an id three players reported, or for one the game files carry.
  if (!listed && !files) return { robots: { index: false, follow: true } };
  const name = listed?.name ?? files?.title ?? `Achievement ${id}`;
  const criteria = entry?.criteria ? "reported criteria" : files?.criteria.length ? "the criteria from the game files" : "criteria count";
  return {
    ...pageMetadata({ title: entityTitle(name, "achievement"), description: `The ${name} achievement in WoW: Forever: category, points and ${criteria}, ${entry ? "from player reports and the build's own game files as each has them." : `from the build's own game files. ${CLIENT_LABEL}.`}`, path: achievementHref(id!, name) }),
    robots: { index: true, follow: true },
  };
}

export default async function AchievementPage(props: Props) {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  if (id === null) notFound();
  const catalog = await loadCatalog();
  const listed = catalog?.achievements.find((a) => a.achievementId === id) ?? null;
  // A base entry is the game files' own, so it keeps the file-only presentation; only a confirmed one is a player report.
  const entry = listed?.confirmed ? listed : null;
  const files = fromFiles(id);
  if (catalog && !listed && !files) notFound();
  const title = listed?.name ?? files?.title ?? `Achievement ${id}`;
  const canonical = achievementHref(id, title);
  if (`/database/achievements/${segment}` !== canonical) permanentRedirect(canonical);
  const trail = [...trailFor("/database/achievements")!, { name: title, path: `/database/achievements/${segment}` }];
  // Player reports win; the build's files fill the gaps, as "unconfirmed". The files' criteria show when
  // the reports did not carry criteria, or never happened.
  const fileVersion = CLIENT_ACHIEVEMENTS.build.version;
  const fileCriteria = entry?.criteria ?? files?.criteria.map((c) => ({ text: c.text, required: c.amount ?? 1 })) ?? [];
  const fromReports = Boolean(entry?.criteria);
  const facts: { label: string; value: string | number | null; numeric?: boolean }[] = [
    { label: "Category", value: entry?.category ?? null },
    { label: "Points", value: entry?.points ?? files?.points ?? null, numeric: true },
    { label: "Criteria", value: fromReports ? entry!.criteriaCount : files?.criteria.length ?? null, numeric: true },
    { label: "ID", value: id, numeric: true },
  ];

  return (
    <Container width="data">
      <article>
        <EntityHeader trail={trail} title={title} meta={["Achievement", entry ? entry.category : null, <span key="id" className="tabular-nums">ID {id}</span>]} />
        {entry ? (
          <EntityTop
            box={
              <TooltipFrame name={title} label={`${title}, as players reported it`}>
                <p>{entry.category}</p>
                <p>{entry.points} points</p>
              </TooltipFrame>
            }
            facts={<Facts layout="list" label={`${title}: quick facts`} items={facts} />}
          />
        ) : files ? (
          <EntityTop
            box={
              <TooltipFrame name={title} label={`${title}, from the game files`}>
                <p aria-hidden={!files.description} className={files.description ? "" : "text-muted"}>{files.description ?? "The game files give no text for it"}</p>
                <p>{files.points} points</p>
              </TooltipFrame>
            }
            facts={<Facts layout="list" label={`${title}: quick facts`} items={facts} />}
          />
        ) : <Unreachable />}
        {fileCriteria.length > 0 && (
          <DataTable
            dense
            caption={`Criteria of ${title}${fromReports ? ", as three installs reported them" : ""}`}
            columns={[
              {
                key: "text", header: "Criterion",
                cell: (c: Criterion) => (fromReports ? c.text : <span className="inline-flex items-baseline gap-1.5"><Badge tone="files" />{c.text}</span>),
              },
              { key: "required", header: "Required", numeric: true, cell: (c: Criterion) => (c.required > 1 ? c.required : null) },
            ]}
            rows={fileCriteria.map((c, i) => ({ ...c, i }))}
            rowKey={(c) => String(c.i)}
          />
        )}
        {!fromReports && fileCriteria.length > 0 && (
          <p className="mt-2 text-meta text-muted">Criteria read from the client&apos;s own files of build {fileVersion} (found in game files, unconfirmed). They show as players reported them once three installs send the same list.</p>
        )}
        {entry && !entry.criteria && entry.criteriaCount > 0 && fileCriteria.length === 0 ? (
          <EmptyTab players={false} action={null} message="The criteria show once three installs report the same full list." />
        ) : null}
        {!entry && files && (
          <p className="mt-2 text-meta text-muted">Found in game files, unconfirmed. Criteria and text are the game files&apos;; the category and the count of installs that earned it appear once three installs agree.</p>
        )}
      </article>
    </Container>
  );
}
