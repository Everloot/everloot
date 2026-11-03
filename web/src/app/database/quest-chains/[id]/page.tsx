import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Container, DataTable, Facts, TooltipFrame } from "@/components/ui";
import EntityLink from "@/components/EntityLink";
import { trailFor } from "@/lib/breadcrumbs";
import { chainHref, loadCatalog, parseSegment } from "@/lib/completion-lists";
import { loadNames } from "@/lib/names";
import { pageMetadata } from "@/lib/seo";
import { CLIENT_LABEL } from "../../../../../../kb/src/edges";
import { EntityHeader, EntityTop, Unreachable } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  const entry = id === null ? undefined : (await loadCatalog())?.chains.find((c) => c.questLineId === id);
  // A listed entry is a page, from the game files or three players' reports; nothing listed says noindex rather than cache a thin page.
  if (!entry) return { robots: { index: false, follow: true } };
  return {
    ...pageMetadata({ title: `${entry.name} (quest chain)`, description: `The ${entry.name} quest chain in WoW: Forever and the quests in it${entry.confirmed ? ", as three players reported it." : `. ${CLIENT_LABEL}.`}`, path: chainHref(entry.questLineId, entry.name) }),
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
  // A chain cut at 80 quests has more than it lists.
  const count = entry ? `${entry.questIds.length}${entry.truncated ? "+" : ""}` : "";

  return (
    <Container width="data">
      <article>
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
            <DataTable
              dense
              caption={`Quests in ${entry.name}`}
              columns={[{ key: "quest", header: "Quest", cell: (questId: number) => <EntityLink kind="quest" id={questId} name={quests.get(questId)} /> }]}
              rows={entry.questIds}
              rowKey={String}
            />
          </>
        ) : <Unreachable />}
      </article>
    </Container>
  );
}
