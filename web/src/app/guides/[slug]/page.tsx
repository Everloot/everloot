import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import GuideHistory from "@/components/guides/GuideHistory";
import GuidePlan from "@/components/guides/GuidePlan";
import GuideSources from "@/components/guides/GuideSources";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { PageHeader, Prose, RailFacts, ReadingLayout, SectionHeading, type TocItem } from "@/components/ui";
import { classLabel } from "@/lib/class-context";
import { GUIDE_STATE_LABEL, guideFreshness, guideIndexable, type GuideFreshness, type GuideState } from "@/lib/guide-freshness";
import { ACTIVITY_LABEL, ROLE_LABEL, guideHref, loadGuides, publishedGuide, publishedGuides, type Guide } from "@/lib/guides";
import { guideArticleJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { loadCatalog } from "@/lib/talents/catalogs";
import { PUBLISHED_CHANGES, classTalentChanges } from "@/lib/talents/freshness-records";
import type { TalentCatalog } from "@/lib/talents/types";
import { loadWiki, publishedPage, type Block } from "@/lib/wiki";
import { resolveTokens } from "@/lib/wiki-names";
import { guideLinkTarget } from "../../../../../kb/src/guides/guide";
import { slugify } from "../../../../../kb/src/lore-slug";
import { WikiBlock, type TextContext } from "../../wiki/wiki-text";

// One published guide: how current it is, its plan, its four sections, its sources and its versions. Only published
// guides are built and no other address renders, so a draft or an unknown slug is a 404 here and on its card. How
// current a guide is depends on the day, the talent trees and the build watch's change records, so a page is rebuilt
// at most once an hour; kb/guides and the wiki pages its links name are read then (next.config.js traces both).
export const revalidate = 3600;
export const dynamicParams = false;
export function generateStaticParams() {
  return publishedGuides(loadGuides()).map((g) => ({ slug: g.slug }));
}

type Params = { params: Promise<{ slug: string }> };

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const TITLE_MAX = 60;

/** "Frost leveling · WoW Forever Mage guide", shortened to fit 60 characters: the class words go first. */
function guideTitle(guide: Guide): string {
  const full = `${guide.title} · WoW Forever ${classLabel(guide.classSlug)} guide`;
  if (full.length <= TITLE_MAX) return full;
  const short = `${guide.title} · WoW Forever`;
  return short.length <= TITLE_MAX ? short : guide.title;
}

/** The guide against its class's tree today. The change records are read here, on the server, for the freshness rules. */
async function freshnessOf(guide: Guide): Promise<{ catalog: TalentCatalog; freshness: GuideFreshness }> {
  const catalog = await loadCatalog(guide.classSlug);
  const today = new Date().toISOString().slice(0, 10);
  return { catalog, freshness: guideFreshness(guide, catalog, classTalentChanges(PUBLISHED_CHANGES, catalog.classId), today) };
}

const anchor = (heading: string) => slugify(heading) || "section";

/** The `##` sections in order, each with the blocks under it (`###` subsections included). */
function sectionsOf(blocks: Block[]): { heading: string; blocks: Block[] }[] {
  const out: { heading: string; blocks: Block[] }[] = [];
  for (const b of blocks) {
    if (b.type === "heading" && b.level === 2) out.push({ heading: b.text, blocks: [] });
    else out.at(-1)?.blocks.push(b);
  }
  return out;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const guide = publishedGuide(loadGuides(), slug);
  if (!guide) return { robots: { index: false, follow: true } };
  const path = guideHref(guide.slug);
  const base = pageMetadata({ title: guideTitle(guide), description: guide.summary, path, image: `${path}/opengraph-image` });
  const { freshness } = await freshnessOf(guide);
  return {
    ...base,
    openGraph: {
      ...base.openGraph, type: "article", authors: [guide.author],
      ...(guide.history[0] ? { publishedTime: guide.history[0].on } : {}), ...(guide.reviewed ? { modifiedTime: guide.reviewed.on } : {}),
    },
    // The sitemap lists a guide by the same rule.
    robots: { index: guideIndexable(guide, freshness), follow: true },
  };
}

const STATE_NOTE: Record<Exclude<GuideState, "current">, string> = {
  "review-due": "It is due for another review:",
  stale: "Since then the game files changed talents its plan uses, so parts of it may be out of date until it is reviewed again:",
  broken: "Its plan no longer fits the talent tree, so it cannot be followed as written until it is reviewed again:",
};
const STATE_TONE: Record<Exclude<GuideState, "current">, string> = { "review-due": "text-warning", stale: "text-warning", broken: "text-danger" };

/** Who reviewed the guide against which build, and, when it is not current, why, in the freshness rules' words. */
function Freshness({ guide, freshness }: { guide: Guide; freshness: GuideFreshness }) {
  const review = guide.reviewed && (
    <>Reviewed by {guide.reviewed.by} on <time dateTime={guide.reviewed.on}>{guide.reviewed.on}</time> against game build {guide.reviewed.build}.</>
  );
  const { state } = freshness;
  if (state === "current") return <p data-guide-state="current" className="text-sm text-fg-2">{review}</p>;
  return (
    <section aria-labelledby="guide-state" data-guide-state={state} className="space-y-2 rounded-card border border-line bg-canvas p-4 text-sm text-fg-2">
      <h2 id="guide-state" className={`text-base font-semibold ${STATE_TONE[state]}`}>{GUIDE_STATE_LABEL[state]}</h2>
      <p>{review} {STATE_NOTE[state]}</p>
      <ul className="list-disc space-y-1 pl-5">
        {freshness.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
      </ul>
    </section>
  );
}

export default async function GuidePage({ params }: Params) {
  const { slug } = await params;
  const guides = loadGuides();
  const guide = publishedGuide(guides, slug);
  if (!guide) notFound();

  const { catalog, freshness } = await freshnessOf(guide);
  const wiki = loadWiki();
  const ctx: TextContext = {
    tokens: await resolveTokens(guide),
    pages: (s) => publishedPage(wiki, s),
    // A link to another guide is drawn only while that guide is published, whatever reached main.
    linkable: (href) => {
      const target = guideLinkTarget(href);
      return target === null || publishedGuide(guides, target) !== null;
    },
  };
  const sections = sectionsOf(guide.blocks);
  const path = guideHref(guide.slug);
  const name = classLabel(guide.classSlug);
  const hub = `/classes/${guide.classSlug}`;
  const published = guide.history[0]?.on;
  const toc: TocItem[] = [
    { id: "plan", label: "The plan" },
    ...sections.map((s) => ({ id: anchor(s.heading), label: s.heading })),
    { id: "sources", label: "Sources" },
    { id: "history", label: "Version history" },
  ];
  const meta = (
    <RailFacts
      items={[
        { label: "Author", value: guide.author },
        ...(guide.reviewed ? [
          { label: "Reviewed", value: <>{guide.reviewed.by}, <time dateTime={guide.reviewed.on}>{guide.reviewed.on}</time></> },
          { label: "Game build", value: guide.reviewed.build },
        ] : []),
        { label: "Version", value: <a href={`#version-${guide.version}`} className={LINK}>{guide.version}</a> },
      ]}
    />
  );

  return (
    <ReadingLayout items={toc} meta={meta}>
      <JsonLd data={published && guide.reviewed ? guideArticleJsonLd({ title: guide.title, summary: guide.summary, path, published, modified: guide.reviewed.on }) : null} />
      <article data-guide>
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: "Guides", path: "/guides" }, { name: guide.title, path }]}
          title={guide.title}
          lede={guide.summary}
          meta={
            <>
              <Link href={hub} className={CLASS_TEXT[guide.classSlug]}>{name}</Link>
              <span>{ACTIVITY_LABEL[guide.activity]}</span>
              <span>Levels {guide.levels.from}–{guide.levels.to}</span>
              <span>{guide.roles.map((r) => ROLE_LABEL[r]).join(", ")}</span>
            </>
          }
        />

        <Freshness guide={guide} freshness={freshness} />
        <GuidePlan classSlug={guide.classSlug} catalog={catalog} sets={freshness.sets} />

        <div className="mt-12">
          <Prose>
            {sections.map((s) => (
              <section key={s.heading} aria-labelledby={anchor(s.heading)}>
                <SectionHeading id={anchor(s.heading)}>{s.heading}</SectionHeading>
                {s.blocks.map((b, i) => <WikiBlock key={i} block={b} ctx={ctx} />)}
              </section>
            ))}
          </Prose>
        </div>

        <GuideSources sources={guide.sources} />
        <GuideHistory history={guide.history} version={guide.version} />

        <p className="mt-12 text-sm text-fg-2">
          <Link href="/guides" className={LINK}>All guides</Link> · <Link href={hub} className={LINK}>{name} class page</Link>
        </p>
      </article>
    </ReadingLayout>
  );
}
