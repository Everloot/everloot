import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Container, Facts, TooltipFrame } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { factionHeaderOnly, factionHref, factionInFiles, loadCatalog, parseSegment } from "@/lib/completion-lists";
import { entityTitle } from "@/lib/entity-meta";
import { pageMetadata } from "@/lib/seo";
import { CLIENT_LABEL } from "../../../../../../kb/src/edges";
import { EntityHeader, EntityTop, LINK, Unreachable } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

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
                  ...(files ? [{ label: "Header", value: files.header ? "Yes" : "No" }] : []),
                  ...(parent ? [{ label: "Parent faction", value: parent }] : []),
                  ...(entry.major ? [{ label: "Kind", value: "Major faction" }] : []),
                ]}
              />
            }
          />
        ) : <Unreachable />}
      </article>
    </Container>
  );
}
