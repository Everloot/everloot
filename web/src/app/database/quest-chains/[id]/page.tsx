import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { entityPageJsonLd } from "@/lib/jsonld";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Container, DataTable, Facts, InShort, OpenData, TooltipFrame } from "@/components/ui";
import EntityLink from "@/components/EntityLink";
import { trailFor } from "@/lib/breadcrumbs";
import { chainHref, loadCatalog, parseSegment } from "@/lib/completion-lists";
import { asOfLine, entitySummary } from "@/lib/evidence";
import { loadNames } from "@/lib/names";
import { pageMetadata } from "@/lib/seo";
import { CLIENT_LABEL } from "../../../../../../kb/src/edges";
import { EntityHeader, EntityTop, LINK, Unreachable } from "../../entity";
import { loadQuestNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { GAME_NAME_TITLE } from "@/components/EntityRelations";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  const entry = id === null ? undefined : (await loadCatalog())?.chains.find((c) => c.questLineId === id);
  // A listed entry is a page, from the game files or three players' reports; nothing listed says noindex rather than cache a thin page.
  if (!entry) return { robots: { index: false, follow: true } };
  return {
    ...pageMetadata({ title: `${entry.name} (quest chain)`, description: `The ${entry.name} quest chain in WoW: Forever and the quests in it${entry.confirmed ? ", as three installs reported it." : `. ${CLIENT_LABEL}.`}`, path: chainHref(entry.questLineId, entry.name) }),
    robots: { index: true, follow: true },
  };
}

export default async function QuestChainPage(props: Props) {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  if (id === null) notFound();
  const catalog = await loadCatalog();
  const entry = catalog?.chains.find((c) => c.questLineId === id);
  if (catalog && !entry) notFound();
  if (entry) {
    const canonical = chainHref(entry.questLineId, entry.name);
    if (`/database/quest-chains/${segment}` !== canonical) permanentRedirect(canonical);
  }
  const title = entry?.name ?? `Quest chain ${id}`;
  const trail = [...trailFor("/database/quest-chains")!, { name: title, path: `/database/quest-chains/${segment}` }];
  const quests = entry ? (await loadNames()).quests : new Map<number, string>();
  const wiki = entry ? await loadQuestNames(CLIENT_LAYER.build.version) : null;
  const nameOf = (id: number) => quests.get(id) ?? wiki?.names.get(id)?.name;
  // A chain cut at 80 quests has more than it lists.
  const count = entry ? `${entry.questIds.length}${entry.truncated ? "+" : ""}` : "";
  // The page in a few lines: what it is, who reported it and when, and where the name came from. A chain only the
  // files list carries the files' name, so its name line says so rather than "no agreed name".
  const asOf = asOfLine(catalog?.dataAsOf ?? null, Date.now());
  const [what, observed, name] = entry ? entitySummary({
    identity: entry.truncated
      ? `A quest chain in WoW: Forever of more than ${entry.questIds.length} quests; the first ${entry.questIds.length} are listed.`
      : `A quest chain in WoW: Forever of ${entry.questIds.length} ${entry.questIds.length === 1 ? "quest" : "quests"}.`,
    observed: entry.confirmed
      ? `Players reported it, three installs agreeing${asOf ? ` (${asOf})` : ""}.`
      : catalog?.confirmations
        ? `Found in game files, unconfirmed: ${entry.reporters} of 3 installs have reported it${asOf ? ` (${asOf})` : ""}.`
        : "Found in game files, unconfirmed; player reports could not be read just now.",
    named: entry.confirmed,
  }) : [];
  // Not confirmed is not "not reported": some installs may have reported it (the line above counts them), and when the
  // reports could not be read the page cannot say either.
  const filesName = `The name and the quests are shown from the game files; ${catalog?.confirmations ? "not confirmed by three installs yet" : "player reports could not be read just now"}.`;
  const summary = entry ? [what, observed, entry.confirmed ? name : filesName] : [];

  return (
    <Container width="data">
      <article>
        {entry && <JsonLd data={entityPageJsonLd({ name: title, path: chainHref(entry.questLineId, entry.name), identifier: `quest_chain:${id}` })} />}
        <EntityHeader trail={trail} title={title} meta={["Quest chain", entry ? `${count} quests` : null, <span key="id" className="tabular-nums">ID {id}</span>]} />
        {entry ? (
          <>
            <EntityTop
              box={<TooltipFrame name={entry.name} label={entry.confirmed ? `${entry.name}, as players reported it` : `${entry.name}, ${CLIENT_LABEL.toLowerCase()}`}><p>{count} quests</p></TooltipFrame>}
              facts={
                <Facts
                  layout="list"
                  label={`${entry.name}: quick facts`}
                  items={[
                    { label: "Quests", value: count, numeric: true },
                    ...(entry.truncated ? [{ label: "Length", value: "Longer than the 80 quests listed" }] : []),
                    { label: "ID", value: entry.questLineId, numeric: true },
                  ]}
                />
              }
            />
            <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
            <OpenData text={[`${entry.name} (quest chain ${id})`, ...summary, `Source: https://everloot.app${chainHref(entry.questLineId, entry.name)}`].join("\n")} />
            {entry.questIds.length === 1 && !entry.truncated && <p className="text-meta text-muted">{entry.confirmed ? "Players reported this chain with one quest." : "The game files list this chain with one quest."}</p>}
            <DataTable
              dense
              caption={`Quests in ${entry.name}`}
              columns={[
                { key: "quest", header: "Quest", cell: (questId: number) => <>
                  <EntityLink kind="quest" id={questId} name={nameOf(questId)} />
                  {!quests.has(questId) && nameOf(questId) && <span className="sr-only"> ({GAME_NAME_TITLE.wiki.toLowerCase()})</span>}
                </> },
                { key: "position", header: "Position", numeric: true, cell: (questId: number) => entry.questIds.indexOf(questId) + 1 },
                { key: "name", header: "Name reports", cell: (questId: number) => nameOf(questId) ? null : "Name not reported yet; no agreed name yet, 3 installs needed." },
              ]}
              meta={(questId: number) => <>Position {entry.questIds.indexOf(questId) + 1}{!nameOf(questId) && " · Name not reported yet; no agreed name yet, 3 installs needed."}</>}
              rows={entry.questIds}
              rowKey={String}
            />
          </>
        ) : <Unreachable />}
      </article>
    </Container>
  );
}
