import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader, SectionHeading } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { pageMetadata } from "@/lib/seo";
import { hubIndexable, loadWiki, publishedPages, recentPages, TYPE_LABEL, wikiHref } from "@/lib/wiki";
import { PAGE_TYPES } from "../../../../kb/src/wiki/page";
import WikiIndex, { type WikiGroup } from "./WikiIndex";

// The pages change only with a deploy; an hour matches the pages themselves.
export const revalidate = 3600;

const DESCRIPTION = "What WoW: Forever's dungeons, raids, zones and changes are, in Everloot's own words, with live data from the Forever database beside each page.";
const LEDE = "What things are in WoW: Forever and why they matter, with the database's data beside them.";

export async function generateMetadata(): Promise<Metadata> {
  return {
    ...pageMetadata({ title: "WoW Forever Wiki", description: DESCRIPTION, path: "/wiki" }),
    // Indexed once it lists a page that is itself indexed; an empty hub stays out of search.
    robots: { index: hubIndexable(loadWiki()), follow: true },
  };
}

export default function WikiHub() {
  const wiki = loadWiki();
  const pages = publishedPages(wiki);
  const groups: WikiGroup[] = PAGE_TYPES.map((type) => ({
    type,
    label: TYPE_LABEL[type].plural,
    pages: pages.filter((p) => p.type === type).sort((a, b) => a.title.localeCompare(b.title)).map((p) => ({ slug: p.slug, title: p.title })),
  })).filter((g) => g.pages.length > 0);
  const recent = recentPages(wiki);

  return (
    <Container width="reading">
      <PageHeader trail={trailFor("/wiki")!} title="Wiki" lede={LEDE} />
      <div className="space-y-12">
        {pages.length === 0 ? (
          <p className="text-sm text-muted">No pages are published yet.</p>
        ) : (
          <>
            <section aria-labelledby="recent">
              <SectionHeading id="recent">Recent pages</SectionHeading>
              <ul className="space-y-1 text-sm">
                {recent.map((p) => (
                  <li key={p.slug} className="flex flex-wrap items-baseline gap-x-3">
                    <Link href={wikiHref(p.slug)} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{p.title}</Link>
                    <span className="text-meta text-muted">{TYPE_LABEL[p.type].word}{p.reviewed && <> · <span className="font-mono tabular-nums">{p.reviewed.on}</span></>}</span>
                  </li>
                ))}
              </ul>
            </section>
            <WikiIndex groups={groups} />
          </>
        )}
        <section aria-labelledby="archive">
          <SectionHeading id="archive">Lore archive, 2023</SectionHeading>
          <p className="text-sm text-fg-2">
            Lore and history as the Warcraft Wiki stood in November 2023, before WoW: Forever.{" "}
            <Link href="/lore" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Open the lore archive</Link>
          </p>
        </section>
      </div>
    </Container>
  );
}
