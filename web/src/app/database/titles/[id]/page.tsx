import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Container, Facts, InShort, OpenData, Tabs, TooltipFrame } from "@/components/ui";
import { CLIENT_TITLES } from "@/data/game-data/client-titles";
import { trailFor } from "@/lib/breadcrumbs";
import { loadCatalog, parseSegment, titleHref } from "@/lib/completion-lists";
import { entitySummary } from "@/lib/evidence";
import { pageMetadata } from "@/lib/seo";
import { CLIENT_LABEL } from "../../../../../../kb/src/edges";
import { EmptyTab, EntityHeader, EntityTop, known, LINK, Unreachable } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** The quick-facts line that says whether three installs reported holding the title. */
const REPORTED = "3 of 3 installs agree";
/** The name line of a page whose name is the game files', in the words the item pages use for it. */
const FILES_NAME = "The name is shown from the game files; players have not reported it yet.";

/** Whether the game files list the title; null when the file could not be read. */
function titleInFiles(id: number): boolean | null {
  try { return CLIENT_TITLES.titles.some((t) => t.id === id); } catch { return null; }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  const entry = id === null ? undefined : (await loadCatalog())?.titles.find((t) => t.titleId === id);
  // A listed entry is a page, from the game files or three players' reports; nothing listed says noindex rather than cache a thin page.
  if (!entry) return { robots: { index: false, follow: true } };
  return {
    ...pageMetadata({ title: `${entry.name} (title)`, description: `The ${entry.name} title in WoW: Forever${entry.confirmed ? ", as three installs reported it." : `. ${CLIENT_LABEL}.`}`, path: titleHref(entry.titleId, entry.name) }),
    robots: { index: true, follow: true },
  };
}

export default async function TitlePage(props: Props) {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  if (id === null) notFound();
  const catalog = await loadCatalog();
  const entry = catalog?.titles.find((t) => t.titleId === id);
  if (catalog && !entry) notFound();
  if (entry) {
    const canonical = titleHref(entry.titleId, entry.name);
    if (`/database/titles/${segment}` !== canonical) permanentRedirect(canonical);
  }
  const title = entry?.name ?? `Title ${id}`;
  const trail = [...trailFor("/database/titles")!, { name: title, path: `/database/titles/${segment}` }];
  // The page in a few lines: what it is, who reported it, what the files say, and where the name came from.
  const [what, observed, name] = entry
    ? entitySummary({
      identity: "A character title in WoW: Forever.",
      observed: entry.confirmed ? "Players reported holding it, three installs agreeing." : "No player has reported holding it yet.",
      named: entry.confirmed,
    })
    : [];
  const listed = titleInFiles(id);
  const inFiles = listed ? "The game files list it." : "No game file read so far lists it.";
  // The name on an unconfirmed page is the files' own, so the name line says so instead of "no agreed name".
  const summary = entry ? [what, observed, inFiles, "No achievement is linked to it yet.", !entry.confirmed && listed ? FILES_NAME : name] : [];

  return (
    <Container width="data">
      <article>
        <EntityHeader trail={trail} title={title} meta={["Title", <span key="id" className="tabular-nums">ID {id}</span>]} />
        {entry ? (
          <>
            <EntityTop
              box={<TooltipFrame name={entry.name} label={entry.confirmed ? `${entry.name}, as players reported it` : `${entry.name}, ${CLIENT_LABEL.toLowerCase()}`} />}
              facts={
                <Facts
                  layout="list"
                  label={`${entry.name}: quick facts`}
                  items={[
                    // Short of three installs: the meter with how many have reported, never the words "not reported".
                    { label: "Player reports", value: known(entry.confirmed ? REPORTED : null, entry.reporters) },
                    { label: "Track this", value: <Link href="/tools/collections" className={LINK}>Collections tool</Link> },
                    { label: "ID", value: entry.titleId, numeric: true },
                  ]}
                />
              }
            />
            <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
            <OpenData text={[`${entry.name} (title ${id})`, ...summary, `Source: https://everloot.app${titleHref(entry.titleId, entry.name)}`].join("\n")} />
            <Tabs
              label={`${entry.name}: relations`}
              tabs={[
                {
                  id: "earned-by", label: "Earned by", count: 0,
                  // The achievement that rewards a title is in none of the game files read so far, and no report carries it: a plain line, no meter.
                  panel: <EmptyTab players={false} action={null} message="No achievement is linked to this title yet. The game files read so far name no title rewards; an achievement shows once 3 installs report it." />,
                },
              ]}
            />
          </>
        ) : <Unreachable />}
      </article>
    </Container>
  );
}
