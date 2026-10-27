import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { Card, Container, Disclosure, PageHeader, Prose, SectionHeading } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { CC_BY_SA, wikiArticleJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { isBound, linkedFrom, loadWiki, publishedPage, publishedPages, sectionsInOrder, TYPE_LABEL, wikiHref, wikiIndexable, wikiTitle, type PageType, type WikiPage } from "@/lib/wiki";
import { isDungeonType, loadDungeonFacts } from "@/lib/wiki-dungeon";
import { resolveTokens } from "@/lib/wiki-names";
import { WORLD_MAP } from "@/lib/world-map";
import { zoneByMapId, zoneHref } from "@/lib/zones";
import { slugify } from "../../../../../kb/src/lore-slug";
import { PREP_SECTION } from "../../../../../kb/src/wiki/page";
import { ADVICE_NOTE, DungeonBosses, DungeonGlance } from "../dungeon-facts";
import { WikiBlock, type TextContext } from "../wiki-text";

// Pages change only with a deploy, but their data blocks will draw on player uploads, so each page is
// rebuilt at most once an hour. Only published pages are built; a draft or unknown slug answers 404.
export const revalidate = 3600;
export function generateStaticParams() {
  return publishedPages(loadWiki()).map((p) => ({ slug: p.slug }));
}

/** The data blocks each type will show; placeholders until the database fills them in. */
const DATA_BLOCKS: Record<PageType, string[]> = {
  // A dungeon or raid page shows what is known of its instance instead (dungeon-facts.tsx), never a placeholder.
  dungeon: [],
  raid: [],
  zone: ["NPCs", "Quests", "Vendors"],
  npc: ["Quests given and ended", "Drops"],
  faction: ["Reputation rewards"],
  "item-set": ["Where each piece drops"],
  event: ["Related quests and items"],
  concept: [],
  change: ["Posts and builds that mention it"],
  race: ["Census", "Playable classes"],
  class: ["Talents", "Trainers", "Census"],
};

const anchor = (heading: string) => slugify(heading) || "section";

/** The thing a page is bound to, when the site can name it: a dungeon or raid entrance, or a zone. */
function boundEntity(page: WikiPage): { name: string; path: string | null } | null {
  const { entrance, zone } = page.binds;
  if (typeof entrance === "string") {
    const e = WORLD_MAP.entrances.find((x) => slugify(x.name) === entrance);
    if (e) return { name: e.name, path: null };
  }
  if (typeof zone === "number" && page.type === "zone") {
    const z = zoneByMapId(zone);
    if (z) return { name: z.name, path: zoneHref(z.mapId, z.name) };
  }
  return null;
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const page = publishedPage(loadWiki(), slug);
  if (!page) return { robots: { index: false, follow: true } };
  const base = pageMetadata({ title: wikiTitle(page), description: page.summary, path: wikiHref(page.slug) });
  return {
    ...base,
    openGraph: { ...base.openGraph, type: "article" },
    robots: { index: wikiIndexable(page), follow: true },
  };
}

export default async function WikiArticle(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const wiki = loadWiki();
  const page = publishedPage(wiki, slug);
  if (!page) notFound();

  const ctx: TextContext = { tokens: await resolveTokens(page), pages: (s) => publishedPage(wiki, s) };
  const sections = sectionsInOrder(page);
  const inbound = linkedFrom(wiki, page.slug);
  const categories = page.categories.map((c) => wiki.categories.get(c) ?? c);
  // A page that binds nothing yet (written from a Blizzard post before the game files have it) has no
  // infobox or data blocks to fill, so it shows neither. A dungeon or raid page shows its instance's facts
  // in their place, and nothing where none are known.
  const bound = isBound(page);
  const dungeon = isDungeonType(page.type);
  const facts = dungeon ? await loadDungeonFacts(page) : null;
  const blocks = bound ? DATA_BLOCKS[page.type] : [];
  const path = wikiHref(page.slug);
  const trail = [...trailFor("/wiki")!, { name: page.title, path }];

  return (
    <Container width="reading">
      <JsonLd data={wikiArticleJsonLd({ title: page.title, summary: page.summary, path, reviewedOn: page.reviewed?.on ?? null, about: boundEntity(page) })} />
      <article>
        <PageHeader
          trail={trail}
          title={page.title}
          lede={page.summary}
          meta={<span>{TYPE_LABEL[page.type].word.replace(/^./, (c) => c.toUpperCase())}</span>}
        />

        {facts && <DungeonGlance facts={facts} />}
        {bound && !dungeon && (
          <Card as="section" aria-labelledby="at-a-glance" className="mb-8">
            <div data-wiki-placeholder="infobox">
              <h2 id="at-a-glance" className="text-sm font-semibold text-fg">At a glance</h2>
              <p className="mt-1 text-sm text-muted">Facts from the database appear here in a later update.</p>
            </div>
          </Card>
        )}

        <Prose>
          {sections.map((s) => (
            <section key={s.heading} aria-labelledby={anchor(s.heading)}>
              <SectionHeading id={anchor(s.heading)} note={dungeon && s.heading === PREP_SECTION ? ADVICE_NOTE : undefined}>{s.heading}</SectionHeading>
              {s.blocks.map((b, i) => <WikiBlock key={i} block={b} ctx={ctx} />)}
            </section>
          ))}
        </Prose>

        {facts && <DungeonBosses facts={facts} />}

        {blocks.length > 0 && (
          <section aria-labelledby="database-blocks" data-wiki-placeholder="blocks" className="mt-12">
            <SectionHeading id="database-blocks" note="Filled in from the database in a later update.">From the database</SectionHeading>
            <ul className="flex flex-wrap gap-2 text-sm text-muted">
              {blocks.map((name) => <li key={name} className="rounded-control border border-line px-3 py-1">{name}</li>)}
            </ul>
          </section>
        )}

        {categories.length > 0 && (
          <section aria-labelledby="categories" className="mt-12">
            <SectionHeading id="categories">Categories</SectionHeading>
            <p className="text-sm text-fg-2">{categories.join(" · ")}</p>
          </section>
        )}

        {inbound.length > 0 && (
          <div className="mt-12">
            <Disclosure summary={`Linked from (${inbound.length})`} as="h2" id="linked-from">
              <ul className="space-y-1 text-sm">
                {inbound.map((p) => <li key={p.slug}><Link href={wikiHref(p.slug)} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{p.title}</Link></li>)}
              </ul>
            </Disclosure>
          </div>
        )}

        <p className="mt-12 text-sm text-fg-2">
          <Link href="/wiki" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">All wiki pages</Link>
        </p>

        {page.origin === "adapted" && page.adaptedFrom.length > 0 && (
          <p data-wiki-credit className="mt-8 text-xs text-muted">
            Adapted from{" "}
            {page.adaptedFrom.map((a, i) => (
              <span key={a.url}>
                {i > 0 && (i === page.adaptedFrom.length - 1 ? " and " : ", ")}
                <a href={a.url} rel="noopener" className="hover:text-accent">{a.title}</a>
              </span>
            ))}{" "}
            by Warcraft Wiki contributors ·{" "}
            <a href={CC_BY_SA.url} rel="license noopener" className="hover:text-accent">{CC_BY_SA.name}</a>
          </p>
        )}
      </article>
    </Container>
  );
}
