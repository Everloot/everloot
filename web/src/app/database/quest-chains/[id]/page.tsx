import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound, permanentRedirect } from "next/navigation";
import { DataTable, TooltipFrame } from "@/components/ui";
import EntityLink from "@/components/EntityLink";
import { trailFor } from "@/lib/breadcrumbs";
import { chainHref, loadCatalog, parseSegment } from "@/lib/completion-lists";
import { asOfLine, entitySummary } from "@/lib/evidence";
import { loadNames, npcNames } from "@/lib/names";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { chainFacts, levelRange, NO_CHAIN_FACTS } from "@/lib/chain-facts";
import { questPage } from "@kb/world-pages";
import { zoneHref } from "@/lib/zones";
import QuestChainFlow from "@/components/QuestChainFlow";
import { pageMetadata } from "@/lib/seo";
import { CLIENT_LABEL } from "@kb/edges";
import { EntityPage, LINK, Unreachable } from "../../entity";
import { plural } from "../../list-parts";
import { loadQuestNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@kb/client-layer-file";
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
    ...pageMetadata({ title: `${entry.name} (quest chain)`, description: `The ${entry.name} quest chain in WoW: Forever and the quests in it${entry.confirmed ? ", as three installs reported it." : `. ${CLIENT_LABEL}.`}`, path: chainHref(entry.questLineId, entry.name), image: `${chainHref(entry.questLineId, entry.name)}/opengraph-image` }),
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
  // Levels, the first quest's giver and where it stands: each only where three installs agree (lib/chain-facts.ts).
  const world = entry ? await loadWorldFacts() : null;
  const known = entry ? chainFacts(entry.questIds, world) : NO_CHAIN_FACTS;
  const levelOf = (id: number) => (world && !world.unreachable ? questPage(id, world).level : null);
  const startName = known.startNpcId !== null && world ? npcNames(world).get(known.startNpcId) : undefined;
  // A chain cut at 80 quests has more than it lists.
  const count = entry ? `${entry.questIds.length}${entry.truncated ? "+" : ""}` : "";
  const questCount = !entry ? null : entry.truncated ? `${count} quests` : plural(entry.questIds.length, "quest");
  // The page in a few lines: what it is, who reported it and when, and where the name came from. A chain only the
  // files list carries the files' name, so its name line says so rather than "no agreed name".
  const asOf = asOfLine(catalog?.dataAsOf ?? null, Date.now());
  const [what, observed, name] = entry ? entitySummary({
    identity: entry.truncated
      ? `A quest chain in WoW: Forever of more than ${entry.questIds.length} quests; the first ${entry.questIds.length} are listed.`
      : `A ${entry.questIds.length === 1 ? "one" : entry.questIds.length}-quest chain in WoW: Forever.`,
    observed: entry.confirmed
      ? `Players reported it, three installs agreeing${asOf ? ` (${asOf})` : ""}.`
      : catalog?.confirmations
        ? `Found in game files, unconfirmed: ${entry.reporters} of 3 installs have reported it${asOf ? ` (${asOf})` : ""}.`
        : "Found in game files, unconfirmed; player reports could not be read just now.",
    nameFrom: entry.confirmed ? "players" : "none",
  }) : [];
  // Not confirmed is not "not reported": some installs may have reported it (the line above counts them), and when the
  // reports could not be read the page cannot say either.
  const filesName = `The name and the quests are shown from the game files; ${catalog?.confirmations ? "not confirmed by three installs yet" : "player reports could not be read just now"}.`;
  const summary = entry ? [what, observed, entry.confirmed ? name : filesName] : [];

  return (
    <EntityPage
      name={title}
      jsonLd={entry && { name: title, path: chainHref(entry.questLineId, entry.name), identifier: `quest_chain:${id}` }}
      header={{ trail, title, meta: ["Quest chain", questCount, known.levels ? `Level ${levelRange(known.levels)}` : null, <span key="id" className="tabular-nums">ID {id}</span>] }}
      box={entry && <TooltipFrame name={entry.name} label={entry.confirmed ? `${entry.name}, as players reported it` : `${entry.name}, ${CLIENT_LABEL.toLowerCase()}`}><p>{questCount}</p></TooltipFrame>}
      facts={entry && [
        { label: "Quests", value: count, numeric: true },
        ...(known.levels ? [{ label: "Levels", value: levelRange(known.levels), numeric: true }] : []),
        ...(known.startNpcId !== null ? [{ label: "Start", value: <EntityLink kind="npc" id={known.startNpcId} name={startName} /> }] : []),
        ...(known.zone ? [{ label: "Zone", value: <Link href={zoneHref(known.zone.mapId, known.zone.name)} className={LINK}>{known.zone.name}</Link> }] : []),
        ...(entry.truncated ? [{ label: "Length", value: "Longer than the 80 quests listed" }] : []),
        { label: "ID", value: entry.questLineId, numeric: true },
      ]}
      notices={!entry && <Unreachable />}
      summary={entry ? summary : undefined}
      main={entry && <>
        {entry.questIds.length === 1 && !entry.truncated && <p className="text-meta text-muted">{entry.confirmed ? "Players reported this chain with one quest." : "The game files list this chain with one quest."}</p>}
        <QuestChainFlow questIds={entry.questIds} name={entry.name} href={chainHref(entry.questLineId, entry.name)} nameOf={nameOf} truncated={entry.truncated} />
        <DataTable
          dense
          caption={`Quests in ${entry.name}`}
          columns={[
            { key: "quest", header: "Quest", cell: ({ questId }: { questId: number; position: number }) => <>
              <EntityLink kind="quest" id={questId} name={nameOf(questId)} />
              {!quests.has(questId) && nameOf(questId) && <span className="sr-only"> ({GAME_NAME_TITLE.wiki.toLowerCase()})</span>}
            </> },
            { key: "position", header: "Position", numeric: true, cell: ({ position }: { questId: number; position: number }) => position },
            // The quest's level once three installs agree on it; blank otherwise, never a neighbour's.
            { key: "level", header: "Level", numeric: true, cell: ({ questId }: { questId: number; position: number }) => levelOf(questId) },
            { key: "name", header: "Name reports", cell: ({ questId }: { questId: number; position: number }) => nameOf(questId) ? null : "Name not reported yet." },
          ]}
          meta={({ questId, position }) => <>Position {position}{!nameOf(questId) && " · Name not reported yet."}</>}
          rows={entry.questIds.map((questId, index) => ({ questId, position: index + 1 }))}
          rowKey={({ questId }) => String(questId)}
        />
      </>}
      openData={entry && { report: { type: "Quest chain", id, path: chainHref(entry.questLineId, entry.name) }, text: [`${entry.name} (quest chain ${id})`, ...summary, `Source: https://everloot.app${chainHref(entry.questLineId, entry.name)}`].join("\n") }}
    />
  );
}
