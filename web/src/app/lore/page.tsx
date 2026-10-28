import type { Metadata } from "next";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import LoreSearchForm from "@/components/LoreSearchForm";
import { BROWSE_HEADINGS, BROWSE_TYPES, hasTypes, loreSlug, startHere, UNAVAILABLE, UNAVAILABLE_COPY, zonePages, type BrowseSlug } from "@/lib/lore";
import JsonLd from "@/components/JsonLd";
import LoreSource from "@/components/LoreSource";
import { BannerArt } from "@/components/game/PageBanner";
import { BANNER_MAP, loadingArt, loadSiteAssets } from "@/lib/game-assets";
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

export default async function LoreLanding() {
  const release = getRelease();
  if (!release) noStore();
  // The wiki count only: curated Forever rows are not part of the 2023 wiki.
  const pages = release ? release.manifest.counts["warcraft-wiki-2023"] ?? null : null;
  const start = release ? startHere() : [];
  const zones = release && hasTypes() === true ? zonePages() : [];

  // The section's banner: a loading screen with the title on it, only when the asset URL is set and the upload has it.
  const assets = await loadSiteAssets();
  const banner = loadingArt(assets, BANNER_MAP.lore);
  return (
    <article>
      <JsonLd data={loreCollectionJsonLd({ name: "Lore archive", description: LEAD, path: "/lore", creditText: CREDIT })} />
      <PageHeader
        trail={trailFor("/lore")!}
        title="Lore archive"
        lede={<>The Warcraft Wiki as it stood on 13 November 2023{pages !== null ? <>, {formatter.format(pages)} pages</> : null}. {LEAD}</>}
        banner={banner ? { image: <BannerArt art={banner} eager /> } : undefined}
      />
      <Container width="reading">

        {release ? (
          <div className="space-y-12">
            <LoreSearchForm />
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
            {hasTypes() === true && (
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
