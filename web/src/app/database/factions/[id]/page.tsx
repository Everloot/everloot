import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Container, Facts, TooltipFrame } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { factionHref, loadCatalog, parseSegment } from "@/lib/completion-lists";
import { pageMetadata } from "@/lib/seo";
import { CLIENT_LABEL } from "../../../../../../kb/src/edges";
import { EntityHeader, EntityTop, Unreachable } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  const entry = id === null ? undefined : (await loadCatalog())?.factions.find((f) => f.factionId === id);
  // A listed entry is a page, from the game files or three players' reports; nothing listed says noindex rather than cache a thin page.
  if (!entry) return { robots: { index: false, follow: true } };
  return {
    ...pageMetadata({ title: `${entry.name} (faction)`, description: `The ${entry.name} reputation faction in WoW: Forever${entry.header ? `, under ${entry.header}` : ""}${entry.confirmed ? ", as three players reported it." : `. ${CLIENT_LABEL}.`}`, path: factionHref(entry.factionId, entry.name) }),
    robots: { index: true, follow: true },
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

  return (
    <Container width="data">
      <article>
        <EntityHeader trail={trail} title={title} meta={["Faction", entry?.header ?? null, <span key="id" className="tabular-nums">ID {id}</span>]} />
        {entry ? (
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
                  { label: "Header", value: entry.header ?? "Not reported" },
                  ...(entry.major ? [{ label: "Kind", value: "Major faction" }] : []),
                  { label: "ID", value: entry.factionId, numeric: true },
                ]}
              />
            }
          />
        ) : <Unreachable />}
      </article>
    </Container>
  );
}
