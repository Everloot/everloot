import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { dataAgeLabel } from "@/lib/data-age";
import { BROWSE_HEADINGS, BROWSE_TYPES, coverage, FACET_KEYS, PRE_CLASSIFICATION_COPY, UNAVAILABLE, UNAVAILABLE_COPY, type BrowseSlug, type FacetKey } from "@/lib/lore";
import { getRelease } from "@/lib/release";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, DataTable, Facts, PageHeader, SectionHeading } from "@/components/ui";
import LoreSource from "@/components/LoreSource";

// Cached for a day (fixed release). The unavailable answer calls noStore() so it is never cached.
export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  const available = getRelease() !== null;
  return {
    ...pageMetadata({
      title: available ? "Lore archive coverage" : "Lore archive unavailable",
      description: "What the lore archive covers: pages by type, facet, length and template damage. The archive is the Warcraft Wiki as of November 2023, not WoW: Forever data.",
      path: "/lore/coverage",
    }),
    robots: { index: available, follow: true },
  };
}

const FACET_LABELS: Record<FacetKey, string> = {
  expansion: "Expansion", profession: "Profession", class: "Class", race: "Race", zone: "Zone", faction: "Faction",
};
const formatter = new Intl.NumberFormat("en-US");
const num = (n: number) => formatter.format(n);
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

type TypeRow = { key: string; heading: string; href?: string; n: number };

export default async function CoveragePage() {
  const release = getRelease();
  const summary = coverage();
  const trail = trailFor("/lore/coverage")!;
  if (!release || summary === UNAVAILABLE) {
    noStore();
    return (
      <Container width="reading">
        <article>
          <PageHeader trail={trail} title="Lore archive unavailable" />
          <Card><p className="text-fg-2">{UNAVAILABLE_COPY}</p></Card>
        </article>
      </Container>
    );
  }
  const wikiPages = release.manifest.counts["warcraft-wiki-2023"] ?? 0;
  const types = summary.types;
  const typeRows: TypeRow[] = [
    ...(Object.keys(BROWSE_TYPES) as BrowseSlug[]).map((slug) => ({ key: slug, heading: BROWSE_HEADINGS[slug], href: `/lore/${slug}`, n: types?.[BROWSE_TYPES[slug]] ?? 0 })),
    { key: "other", heading: "Other pages", n: types?.other ?? 0 },
  ];

  return (
    <Container width="reading">
      <article>
        <PageHeader
          trail={trail}
          title="What the lore archive covers"
          lede="Counts come from the release manifest and the release itself. Everything here is the Warcraft Wiki as of 13 November 2023, not WoW: Forever data."
        />

        <div className="space-y-12">
          <section aria-labelledby="pages">
            <SectionHeading id="pages" note={<>{dataAgeLabel(summary.createdAt)}. A damaged page still shows a sentence where a wiki template dropped its value.</>}>Pages</SectionHeading>
            <Facts
              label="Pages in the archive"
              items={[
                { label: "Wiki pages", value: num(wikiPages), numeric: true },
                { label: "Full pages", value: num(summary.indexable), numeric: true },
                { label: "Damaged pages", value: summary.damaged === null ? "not measured" : num(summary.damaged), numeric: summary.damaged !== null },
                { label: "Release", value: summary.createdAt.slice(0, 10), numeric: true },
              ]}
            />
          </section>

          <section aria-labelledby="types">
            <SectionHeading id="types">Types</SectionHeading>
            {types === null ? (
              <Card><p className="text-fg-2">{PRE_CLASSIFICATION_COPY} Type counts arrive with the next knowledge release.</p></Card>
            ) : (
              <DataTable
                caption="Lore pages by type"
                rows={typeRows}
                rowKey={(row) => row.key}
                columns={[
                  { key: "type", header: "Type", cell: (row) => (row.href ? <Link href={row.href} className={link}>{row.heading}</Link> : <span className="text-fg-2">{row.heading}</span>) },
                  { key: "pages", header: "Pages", numeric: true, cell: (row) => num(row.n) },
                ]}
              />
            )}
          </section>

          {types !== null && (
            <section aria-labelledby="facets">
              <SectionHeading id="facets" note="The ten most common values per facet family, taken from the wiki's own category names.">Facets</SectionHeading>
              <div className="grid gap-4 sm:grid-cols-2">
                {FACET_KEYS.filter((key) => summary.facets[key].length > 0).map((key) => (
                  <Card key={key}>
                    <SectionHeading as="h3">{FACET_LABELS[key]}</SectionHeading>
                    <ul className="space-y-1 text-sm text-fg-2">
                      {summary.facets[key].map((f) => (
                        <li key={f.value} className="flex justify-between gap-4"><span className="min-w-0 [overflow-wrap:anywhere]">{f.value}</span><span className="font-mono tabular-nums text-muted">{num(f.n)}</span></li>
                      ))}
                    </ul>
                  </Card>
                ))}
              </div>
            </section>
          )}

          <p className="text-sm text-muted">
            <Link href="/lore" className={link}>About the lore archive</Link>
            {" "}· <Link href="/search" className={link}>Search</Link>
          </p>
        </div>
        <LoreSource />
      </article>
    </Container>
  );
}