import type { Metadata } from "next";
import { FEED, IMAGE, TWITTER_IMAGE } from "@/lib/seo";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Card, Explainer, Facts, PageHeader, Prose, ReadingLayout, SectionHeading, type TocItem } from "@/components/ui";
import LoreSource from "@/components/LoreSource";
import { trailFor } from "@/lib/breadcrumbs";
import { entityHref } from "@/components/EntityLink";
import { idForName, loadNames } from "@/lib/names";
import { BROWSE_HEADINGS, BROWSE_TYPES, CONVERSION_NOTE, FACET_KEYS, firstSentence, isIndexable, loreByExtId, loreSlug, parseLoreSlug, renderBody, UNAVAILABLE, UNAVAILABLE_COPY, type BrowseSlug, type LorePage as Lore } from "@/lib/lore";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

const FACET_LABELS = { expansion: "Expansion", profession: "Profession", class: "Class", race: "Race", zone: "Zone", faction: "Faction" } as const;

/** The browse slug for a stored type, or null for `other` and untyped rows. */
function browseSlug(type: Lore["type"]): BrowseSlug | null {
  const entry = (Object.entries(BROWSE_TYPES) as [BrowseSlug, string][]).find(([, t]) => t === type);
  return entry ? entry[0] : null;
}

// The archive is a fixed 2023 dump that only changes with a new release, so each page is rendered once
// on first request and then served from the cache, refreshed at most once a day. Building every page
// up front is not worth it (about 78k indexable pages from a 338 MB file), hence no prerendered params.
// Next does not cache a failed render, so when the release cannot be opened the page throws (a 500)
// instead of rendering the "unavailable" copy: a cached 200 would keep that answer, and its noindex, for a day.
export const revalidate = 86400;
export function generateStaticParams() {
  return [];
}

const UNAVAILABLE_TITLE = "Lore archive unavailable";

function label(page: Lore): string {
  return page.sourceId === "warcraft-wiki-2023" ? "Lore archive · Warcraft Wiki, 2023 dump" : `Lore archive · ${page.sourceId} · ${page.gameVersion}`;
}

function lookup(slug: string): Lore | null | typeof UNAVAILABLE {
  const parsed = parseLoreSlug(slug);
  return parsed ? loreByExtId(parsed.extId) : null;
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const page = lookup(slug);
  if (page === UNAVAILABLE) return { title: UNAVAILABLE_TITLE, robots: { index: false, follow: true } };
  if (!page) return { robots: { index: false, follow: true } };
  const description = firstSentence(page.body);
  const url = `/lore/${loreSlug(page)}`;
  return {
    title: `${page.name} · Lore archive`,
    description,
    alternates: { canonical: url, types: FEED },
    // A Warcraft Wiki copy stays readable (and linked to its original) but out of search: the wiki is the
    // source to rank. Everloot's own entries follow the length rule.
    robots: { index: page.sourceId !== "warcraft-wiki-2023" && isIndexable(page.body), follow: true },
    openGraph: { type: "article", title: page.name, description, url, siteName: "Everloot", images: [IMAGE] },
    twitter: { card: "summary", title: page.name, description, images: [TWITTER_IMAGE] },
  };
}

export default async function LorePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const parsed = parseLoreSlug(slug);
  if (!parsed) notFound();
  const page = loreByExtId(parsed.extId);
  if (page === UNAVAILABLE) throw new Error(`${UNAVAILABLE_TITLE}: ${UNAVAILABLE_COPY}`);
  if (!page) notFound();
  if (slug !== loreSlug(page)) permanentRedirect(`/lore/${loreSlug(page)}`);

  const blocks = renderBody(page.body);
  const wiki = page.sourceId === "warcraft-wiki-2023";
  const revised = page.revisionTimestamp ? page.revisionTimestamp.slice(0, 10) : null;
  const typeSlug = browseSlug(page.type);
  const facetLinks = typeSlug && page.facets
    ? FACET_KEYS.flatMap((key) => page.facets![key].map((value) => ({ key, value, href: `/lore/${typeSlug}?${key}=${encodeURIComponent(value)}` })))
    : [];
  const infoboxEntries = page.infobox ? Object.entries(page.infobox.fields) : [];
  const trail = [...(typeSlug ? trailFor(`/lore/${typeSlug}`)! : trailFor("/lore")!), { name: page.name, path: `/lore/${loreSlug(page)}` }];
  // The database page for the same thing, when players have agreed on a name that is exactly this page's.
  const dbKind = wiki && (page.type === "npc" || page.type === "item" || page.type === "quest") ? page.type : null;
  const names = dbKind ? await loadNames() : null;
  const dbId = dbKind && names ? idForName(dbKind === "npc" ? names.npcs : dbKind === "item" ? names.items : names.quests, page.name) : null;
  // The archive has no source headings; link to its text and the metadata sections without inventing story sections.
  const sections: TocItem[] = [
    { id: "lore-text", label: "Article text" },
    ...(dbKind && dbId !== null ? [{ id: "in-database", label: "In the database" }] : []),
    ...(infoboxEntries.length > 0 ? [{ id: "infobox", label: "Wiki infobox" }] : []),
    ...(typeSlug || page.categories.length > 0 ? [{ id: "categories", label: "Categories" }] : []),
  ];
  const source = (
    <LoreSource className="" href={page.sourceUrl} wiki={wiki} name={wiki ? undefined : page.sourceUrl.replace(/^https?:\/\//, "").split("/")[0]} licence={page.licence.replace("CC-BY-SA-4.0", "CC BY-SA 4.0")} />
  );
  return (
    <ReadingLayout items={sections.length > 1 ? sections : []} meta={source}>
      <article>
        <PageHeader
          trail={trail}
          title={page.name}
          meta={
            <>
              <span>{label(page)}</span>
              {revised && <span>Last wiki revision <span className="font-mono tabular-nums">{revised}</span></span>}
            </>
          }
        />

        {sections.length > 1 && (
          <details className="mb-6 rounded-card border border-line p-3 lg:hidden">
            <summary className="min-h-9 cursor-pointer text-sm text-fg-2">On this page</summary>
            <nav aria-label="Article sections">
              <ul className="mt-2 space-y-1">
                {sections.map((item) => <li key={item.id}><a href={`#${item.id}`} className={`inline-flex min-h-9 items-center text-sm ${link}`}>{item.label}</a></li>)}
              </ul>
            </nav>
          </details>
        )}

        <section id="lore-text" aria-label="Article text" tabIndex={-1} className="scroll-mt-24">
          <Prose>
            {blocks.map((block, i) =>
              block.type === "p" ? (
                <p key={i}>{block.text}</p>
              ) : (
                <ul key={i}>
                  {block.items.map((item, j) => <li key={j}>{item}</li>)}
                </ul>
              ),
            )}
          </Prose>
        </section>

        {dbKind && dbId !== null && (
          <Card as="section" aria-labelledby="in-database" className="mt-12">
            <SectionHeading id="in-database">In the Forever database</SectionHeading>
            <p className="text-sm text-fg-2">
              Players have recorded {page.name} in WoW: Forever.{" "}
              <Link href={entityHref(dbKind, dbId)} className={link}>See the {dbKind === "npc" ? "NPC" : dbKind} page</Link>
            </p>
          </Card>
        )}

        {infoboxEntries.length > 0 && (
          <section aria-labelledby="infobox" className="mt-12">
            <SectionHeading id="infobox" note="As written on the wiki in 2023; values are not interpreted and are not Forever data.">Details from the wiki infobox</SectionHeading>
            <Facts layout="rows" items={infoboxEntries.map(([key, value]) => ({ label: key, value }))} />
          </section>
        )}

        {(typeSlug || page.categories.length > 0) && (
          <section aria-labelledby="categories" className="mt-12">
            <SectionHeading id="categories">Categories</SectionHeading>
            {typeSlug && (
              <p className="text-sm text-fg-2">
                <Link href={`/lore/${typeSlug}`} className={link}>{BROWSE_HEADINGS[typeSlug]}</Link>
                {facetLinks.map((f) => (
                  <span key={`${f.key}:${f.value}`}>
                    {" · "}
                    <Link href={f.href} className={link}>{FACET_LABELS[f.key]}: {f.value}</Link>
                  </span>
                ))}
              </p>
            )}
            {page.categories.length > 0 && <p className="mt-2 text-sm text-muted">{page.categories.join(" · ")}</p>}
          </section>
        )}

        <p className="mt-12 text-sm text-fg-2">
          {slug === "forever-launch-date" && (
            <>
              More on the game, with the launch date quoted from Blizzard&apos;s own post:{" "}
              <Link href="/wow-forever" className={link}>What is WoW: Forever?</Link>{" "}
            </>
          )}
          {wiki && <>This archive predates WoW: Forever. For collected gameplay facts see the{" "}
          <Link href="/database" className={link}>Forever database</Link>.{" "}</>}
          <Link href="/search" className={link}>Search the archive</Link>.
        </p>

        {wiki && (
          <Explainer summary="About this copy">
            <p>{CONVERSION_NOTE}</p>
          </Explainer>
        )}
      </article>
    </ReadingLayout>
  );
}