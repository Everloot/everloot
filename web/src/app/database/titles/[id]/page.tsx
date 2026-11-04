import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Container, Facts, TooltipFrame } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { loadCatalog, parseSegment, titleHref } from "@/lib/completion-lists";
import { pageMetadata } from "@/lib/seo";
import { CLIENT_LABEL } from "../../../../../../kb/src/edges";
import { EntityHeader, EntityTop, Unreachable } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id: segment } = await props.params;
  const id = parseSegment(segment);
  const entry = id === null ? undefined : (await loadCatalog())?.titles.find((t) => t.titleId === id);
  // A listed entry is a page, from the game files or three players' reports; nothing listed says noindex rather than cache a thin page.
  if (!entry) return { robots: { index: false, follow: true } };
  return {
    ...pageMetadata({ title: `${entry.name} (title)`, description: `The ${entry.name} title in WoW: Forever${entry.confirmed ? ", as three players reported it." : `. ${CLIENT_LABEL}.`}`, path: titleHref(entry.titleId, entry.name) }),
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

  return (
    <Container width="data">
      <article>
        <EntityHeader trail={trail} title={title} meta={["Title", <span key="id" className="tabular-nums">ID {id}</span>]} />
        {entry ? (
          <EntityTop
            box={<TooltipFrame name={entry.name} label={entry.confirmed ? `${entry.name}, as players reported it` : `${entry.name}, ${CLIENT_LABEL.toLowerCase()}`} />}
            facts={<Facts layout="list" label={`${entry.name}: quick facts`} items={[{ label: "ID", value: entry.titleId, numeric: true }]} />}
          />
        ) : <Unreachable />}
      </article>
    </Container>
  );
}
