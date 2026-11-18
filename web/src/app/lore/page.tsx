import type { Metadata } from "next";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import LoreSearchForm from "@/components/LoreSearchForm";
import { BROWSE_HEADINGS, BROWSE_TYPES, hasTypes, loreByExtId, loreSlug, openingSentence, startHere, UNAVAILABLE, UNAVAILABLE_COPY, zonePages, type BrowseSlug } from "@/lib/lore";
import JsonLd from "@/components/JsonLd";
import LoreSource from "@/components/LoreSource";
import { BANNER_MAP, emblems, loadingArt, loadSiteAssets } from "@/lib/game-assets";
import { Card, Container, Disclosure, Explainer, PageHeader, SectionHeading } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { loreCollectionJsonLd } from "@/lib/jsonld";
import { getRelease } from "@/lib/release";
import { pageMetadata } from "@/lib/seo";

// Cached for a day: it only reads the manifest. Without a release the page calls noStore(), so an
// "unavailable" answer is rendered per request and never baked into a build or kept in the cache.
export const revalidate = 86400;

const DESCRIPTION = "Warcraft Wiki pages as of 13 November 2023, searchable and attributed under CC BY-SA 4.0. Lore and history, not collected WoW: Forever data.";
const LEAD = "Lore, history, characters and places. Not collected WoW: Forever data.";
const CREDIT = "Warcraft Wiki contributors, CC BY-SA 4.0";

export const metadata: Metadata = pageMetadata({ title: "Lore archive", description: DESCRIPTION, path: "/lore" });

const formatter = new Intl.NumberFormat("en-US");
const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

// Background to Forever's zones and dungeons, from the existing 2023 archive, not Forever facts.
const FEATURED_STORIES = [
  "321633-mount-hyjal", "10915-dalaran", "519874-lordaeron",
] as const satisfies readonly `${number}-${string}`[];

const CATEGORIES = [
  { name: "Factions", href: "/lore/254870-faction", art: "factions" },
  { name: "Races", href: "/lore/394728-race", art: "races" },
  { name: "Places", href: "/lore/zones", art: "places" },
  { name: "Characters", href: "/lore/npcs", art: "characters" },
  { name: "Events", href: "/lore/10897-timeline", art: "events" },
] as const;

export default async function LoreLanding() {
  const release = await getRelease();
  if (!release) noStore();
  // The wiki count only: curated Forever rows are not part of the 2023 wiki.
  const pages = release ? release.manifest.counts["warcraft-wiki-2023"] ?? null : null;
  const typed = release ? (await hasTypes()) === true : false;
  const start = release ? await startHere() : [];
  const zones = typed ? await zonePages() : [];
  const stories = release ? (await Promise.all(FEATURED_STORIES.map(async (slug) => {
    const page = await loreByExtId(slug.split("-")[0]!);
    return page && page !== UNAVAILABLE && !page.body.includes("REDIRECT") ? page : null;
  }))).filter((page) => page !== null) : [];

  // Reuse the section art and emblems only when the existing asset upload has them.
  const assets = await loadSiteAssets();
  const banner = loadingArt(assets, BANNER_MAP.lore);
  const icons = emblems(assets);
  const categoryArt = {
    factions: icons.factions.get("Alliance"), races: icons.races.get("Orc"),
    places: loadingArt(assets, BANNER_MAP.changes)?.url,
    characters: icons.races.get("Human"), events: loadingArt(assets, BANNER_MAP.raid)?.url,
  };
  return (
    <article>
      <JsonLd data={loreCollectionJsonLd({ name: "Lore archive", description: LEAD, path: "/lore", creditText: CREDIT })} />
      <PageHeader
        trail={trailFor("/lore")!}
        title="Lore archive"
        lede={<>The Warcraft Wiki as it stood on 13 November 2023{pages !== null ? <>, {formatter.format(pages)} pages</> : null}. {LEAD}</>}
      />
      <Container width="wide">

        {release ? (
          <div className="space-y-12">
            <LoreSearchForm />
            <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
              <div className="min-w-0 space-y-8">
                {banner && (
                  // Keep the whole loading screen visible rather than filling a shallow banner.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={banner.url} srcSet={banner.small ? `${banner.small.url} ${banner.small.width}w, ${banner.url} ${banner.width}w` : undefined}
                    sizes="(min-width: 1024px) 50vw, 100vw" alt="" aria-hidden="true" loading="eager" fetchPriority="high"
                    className="h-auto w-full rounded-card" />
                )}
                {stories.length > 0 && (
                  <section aria-labelledby="featured-story">
                    <SectionHeading id="featured-story">Stories behind Forever&apos;s world</SectionHeading>
                    <p className="mb-4 text-sm text-fg-2">Background to the places you explore in Forever, from the 2023 archive. These stories predate Forever&apos;s changes.</p>
                    <ul className="space-y-4">
                      {stories.map((page) => (
                        <li key={page.extId}>
                          <Link href={`/lore/${loreSlug(page)}`} className={`font-medium ${link}`}>{page.name}</Link>
                          <p className="mt-1 text-fg-2">{openingSentence(page.body)}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {start !== UNAVAILABLE && start.length > 0 && (
                  <Card as="section" aria-labelledby="start-here">
                    <SectionHeading id="start-here">Start here</SectionHeading>
                    <p className="text-fg-2">New to Warcraft&apos;s story? These pages cover the two factions, two of the major races, the main continents and two old enemies.</p>
                    <ul className="mt-4 space-y-3">
                      {start.map((page) => (
                        <li key={page.extId}>
                          <Link href={`/lore/${loreSlug(page)}`} className={`font-medium ${link}`}>{page.name}</Link>
                          {page.sentence && <p className="text-sm text-fg-2">{page.sentence}</p>}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
              <div className="min-w-0 space-y-8">
                <nav aria-labelledby="browse-categories">
                  <SectionHeading id="browse-categories">Browse by category</SectionHeading>
                  <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {CATEGORIES.filter((category) => typed || (category.art !== "places" && category.art !== "characters")).map((category) => (
                      <li key={category.name}>
                        <Card href={category.href} padding="none" className="flex min-h-20 items-center gap-4 px-4 py-3 font-medium text-fg">
                          {categoryArt[category.art] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={categoryArt[category.art]} alt="" aria-hidden="true" loading="lazy" className="h-16 w-20 shrink-0 object-contain" />
                          )}
                          <span>{category.name}</span>
                        </Card>
                      </li>
                    ))}
                  </ul>
                </nav>
                {typed && (
                  <nav aria-labelledby="browse">
                    <SectionHeading id="browse">Browse by type</SectionHeading>
                    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      {(Object.keys(BROWSE_TYPES) as BrowseSlug[]).map((slug) => (
                        <li key={slug}>
                          <Card href={`/lore/${slug}`} padding="none" className="flex min-h-11 items-center px-4 py-3 font-medium text-fg">
                            {BROWSE_HEADINGS[slug]}
                          </Card>
                        </li>
                      ))}
                      <li>
                        <Card href="/lore/coverage" padding="none" className="flex min-h-11 items-center px-4 py-3 text-fg-2">
                          What the archive covers
                        </Card>
                      </li>
                    </ul>
                  </nav>
                )}
              </div>
            </div>
            {zones !== UNAVAILABLE && zones.length > 0 && (
              <section aria-labelledby="zones">
                <SectionHeading
                  id="zones"
                  action={<Link href="/lore/zones" className={link}>All zones and locations</Link>}
                >
                  Zones
                </SectionHeading>
                <p className="mb-4 text-fg-2">
                  {formatter.format(zones.length)} pages carry the wiki&apos;s zone infobox, which towns and instances do not. Most do not record a continent, so they are listed by name.
                </p>
                <Disclosure summary="All zone pages">
                  <ul className="gap-x-6 text-sm sm:columns-2">
                    {zones.map((zone) => (
                      <li key={zone.extId} className="min-w-0 break-inside-avoid">
                        <Link href={`/lore/${loreSlug(zone)}`} className={`inline-flex min-h-9 items-center [overflow-wrap:anywhere] ${link}`}>{zone.name}</Link>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </section>
            )}
            <p className="text-sm text-muted">
              This archive predates WoW: Forever. For collected gameplay facts see the{" "}
              <Link href="/database" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Forever database</Link>.
              Everloot&apos;s own <Link href="/wiki" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">wiki</Link> is
              written around that data; anyone can{" "}
              <Link href="/docs/guides/wiki" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">propose a page</Link>.
            </p>
          </div>
        ) : (
          <Card as="section" aria-labelledby="unavailable">
            <SectionHeading id="unavailable">Lore archive unavailable</SectionHeading>
            <p className="text-sm text-fg-2">{UNAVAILABLE_COPY}</p>
          </Card>
        )}

        {release && (
          <Explainer summary="Licence and attribution">
            <p>Published under CC BY-SA 4.0 with a source link on every page.</p>
            <p>{release.manifest.notice}</p>
          </Explainer>
        )}
        <LoreSource />
      </Container>
    </article>
  );
}
