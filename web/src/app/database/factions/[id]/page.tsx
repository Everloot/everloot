import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import LoreSection from "@/components/LoreSection";
import { Container, Facts, InShort, OpenData, Tabs, TooltipFrame } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { factionHeaderOnly, factionHref, factionInFiles, loadCatalog, parseSegment } from "@/lib/completion-lists";
import { entityTitle } from "@/lib/entity-meta";
import { entitySummary } from "@/lib/evidence";
import { loreForEntity } from "@/lib/lore";
import { pageMetadata } from "@/lib/seo";
import { CLIENT_LABEL } from "../../../../../../kb/src/edges";
import { EmptyTab, EntityHeader, EntityTop, known, LINK, Unreachable } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** The quick-facts line that says whether three installs reported the faction in their reputation pane. */
const REPORTED = "3 of 3 installs agree";
/** The name line of a page whose name is the game files', in the words the item pages use for it. */
const FILES_NAME = "The name is shown from the game files; players have not reported it yet.";

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  const entry = id === null ? undefined : (await loadCatalog())?.factions.find((f) => f.factionId === id);
  // A listed entry is a page, from the game files or three players' reports; nothing listed says noindex rather than cache a thin page.
  if (!entry) return { robots: { index: false, follow: true } };
  return {
    ...pageMetadata({ title: entityTitle(entry.name, "faction"), description: `The ${entry.name} reputation faction in WoW: Forever${entry.header ? `, under ${entry.header}` : ""}${entry.confirmed ? ", as three installs reported it." : `. ${CLIENT_LABEL}.`}`, path: factionHref(entry.factionId, entry.name) }),
    // A header the files list with no standing of its own is a thin page: noindex, and out of the sitemap.
    robots: { index: !factionHeaderOnly(entry), follow: true },
  };
}

export default async function FactionPage(props: Props) {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  if (id === null) notFound();
  const catalog = await loadCatalog();
  const entry = catalog?.factions.find((f) => f.factionId === id);
  if (catalog && !entry) notFound();
  if (entry) {
    const canonical = factionHref(entry.factionId, entry.name);
    if (`/database/factions/${segment}` !== canonical) permanentRedirect(canonical);
  }
  const title = entry?.name ?? `Faction ${id}`;
  const trail = [...trailFor("/database/factions")!, { name: title, path: `/database/factions/${segment}` }];
  // The files' parent, linked when it has a page of its own; else the header three players saw it under.
  const files = factionInFiles(id);
  const parent = files?.parent && catalog?.factions.some((f) => f.factionId === files.parent!.id)
    ? <Link href={factionHref(files.parent.id, files.parent.name)} className={LINK}>{files.parent.name}</Link>
    : files?.parent?.name ?? entry?.header ?? null;
  // The page in a few lines: what it is, who reported it, what the files say, and where the name came from.
  const under = files?.parent?.name ?? entry?.header ?? null;
  const [what, observed, name] = entry
    ? entitySummary({
      identity: `${entry.major ? "A major faction" : files?.header ? "A header of the reputation pane" : "A reputation faction"}${under ? ` under ${under}` : ""} in WoW: Forever.`,
      observed: entry.confirmed ? "Players reported it in their reputation pane, three installs agreeing." : "No player has reported it in a reputation pane yet.",
      named: entry.confirmed,
    })
    : [];
  const inFiles = files
    ? `The game files list it${files.parent ? ` under ${files.parent.name}` : ""}${files.header ? " and name it as other factions' parent" : ""}.`
    : "No game file read so far lists it.";
  // The name on an unconfirmed page is the files' own, so the name line says so instead of "no agreed name".
  const summary = entry ? [what, observed, inFiles, "No quest is linked to it yet.", !entry.confirmed && files ? FILES_NAME : name] : [];
  // The archive files a faction under no type of its own, so its page is one of the "other" pages.
  const lore = entry ? await loreForEntity("other", entry.name) : null;

  return (
    <Container width="data">
      <article>
        <EntityHeader trail={trail} title={title} meta={["Faction", entry?.header ?? null, <span key="id" className="tabular-nums">ID {id}</span>]} />
        {entry ? (
          <>
            <EntityTop
              box={
                <TooltipFrame name={entry.name} label={entry.confirmed ? `${entry.name}, as players reported it` : `${entry.name}, ${CLIENT_LABEL.toLowerCase()}`}>
                  {entry.header && <p>{entry.header}</p>}
                  {entry.major && <p>Major faction</p>}
                </TooltipFrame>
              }
              facts={
                <Facts
                  layout="list"
                  label={`${entry.name}: quick facts`}
                  items={[
                    ...(files ? [{ label: "Header", value: files.header ? "Yes" : "No" }] : []),
                    ...(parent ? [{ label: "Parent faction", value: parent }] : []),
                    ...(entry.major ? [{ label: "Kind", value: "Major faction" }] : []),
                    // Short of three installs: the meter with how many have reported, never the words "not reported".
                    { label: "Player reports", value: known(entry.confirmed ? REPORTED : null, entry.reporters) },
                    { label: "Track this", value: <Link href="/tools/collections" className={LINK}>Collections tool</Link> },
                  ]}
                />
              }
            />
            <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
            <OpenData text={[`${entry.name} (faction ${id})`, ...summary, `Source: https://everloot.app${factionHref(entry.factionId, entry.name)}`].join("\n")} />
            <Tabs
              label={`${entry.name}: relations`}
              tabs={[
                {
                  id: "reputation-from", label: "Reputation from", count: 0,
                  // A quest is public once 3 installs report it; which faction it pays is in no file read so far and in no report.
                  panel: <EmptyTab action={null} message="No quest is linked to this faction yet. A quest shows once 3 installs report it, and the reputation it gives is in none of the game files read so far." />,
                },
              ]}
            />
            <div className="mt-6 space-y-6 empty:hidden">
              <LoreSection match={lore} />
            </div>
          </>
        ) : <Unreachable />}
      </article>
    </Container>
  );
}
