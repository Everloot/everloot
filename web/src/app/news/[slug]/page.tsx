import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import JsonLd from "@/components/JsonLd";
import { PageHeader, Prose, ReadingLayout, type TocItem } from "@/components/ui";
import { longDate } from "@/data/wow-forever";
import { trailFor } from "@/lib/breadcrumbs";
import { couldBeBluePost, loadTimeline, postPathForUrl } from "@/lib/changes";
import { newsArticleJsonLd } from "@/lib/jsonld";
import { bodyForPage, lastChanged, loadNews, newsHref, postDescription, publishedPost, publishedPosts, readingMinutes, relatedPosts, sourceNames } from "@/lib/news";
import { pageMetadata } from "@/lib/seo";
import { NewsCard } from "../news-card";
import { loadWiki, publishedPage } from "@/lib/wiki";
import { resolveTokens } from "@/lib/wiki-names";
import { WikiBlock, type TextContext } from "../../wiki/wiki-text";

/**
 * One news post: Everloot's own words about the site or the game. The body is the wiki's syntax, so a post
 * links database entities and wiki pages the same way a wiki page does. Only published posts are built; a
 * draft or unknown slug answers 404.
 *
 * The page draws its own byline (author, date, reading time, sources), one Sources list and one related
 * list, so a body's own closing "Sources" / "Related" sections are left out (lib/news bodyForPage).
 */

// A post changes only with a deploy, but its tokens read the database's names, so the page is rebuilt at most once
// an hour. A post citing a Blizzard forum or Bluesky post also reads the changes timeline: with the blue store
// configured, that fetch revalidates every 10 minutes and on the "blue" tag the cron sets when it adds posts, so
// such a page is rebuilt at most every 10 minutes and after each new Blizzard post. Every other post stays hourly.
export const revalidate = 3600;
export function generateStaticParams() {
  return publishedPosts(loadNews()).map((p) => ({ slug: p.slug }));
}

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const RELATED = 3;
/** The in-article ad goes after this many paragraphs, and only in a post with at least one more after it. */
const AD_AFTER_PARAGRAPH = 3;
const AD_MIN_PARAGRAPHS = 4;
/** Article type: 17 px body at a 1.75 line height, brighter text, larger title and section headings. */
const ARTICLE = "text-[17px] leading-[1.75] [&_[data-prose]]:max-w-none [&_[data-prose]]:text-fg [&_[data-prose]>*+*]:mt-5 [&_h1]:text-[28px] [&_h1]:leading-tight sm:[&_h1]:text-[36px]";
/**
 * The body's measure, on its text only: 48ch of Geist runs about 70 letters a line at 17 px (its "0", which sets
 * the ch, is wider than its average letter). Headings and the in-article ad keep the column's full width.
 */
const MEASURE = "[&_[data-prose]>:is(p,ul,ol,blockquote)]:max-w-[48ch]";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const post = publishedPost(loadNews(), slug);
  if (!post) return { robots: { index: false, follow: true } };
  const base = pageMetadata({ title: post.title, description: postDescription(post), path: newsHref(post.slug), ...(post.hero ? { image: post.hero.share ?? post.hero.src, alt: post.hero.alt, imageWidth: post.hero.share ? 1200 : 1600, imageHeight: post.hero.share ? 675 : 900 } : {}) });
  return {
    ...base,
    openGraph: { ...base.openGraph, type: "article", publishedTime: post.published, ...(post.updated ? { modifiedTime: post.updated } : {}), authors: [post.author] },
    robots: { index: true, follow: true },
  };
}

const anchor = (i: number, text: string) => `h-${i}-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

export default async function NewsArticle(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const news = loadNews();
  const post = publishedPost(news, slug);
  if (!post) notFound();

  const wiki = loadWiki();
  const ctx: TextContext = { tokens: await resolveTokens(post), pages: (s) => publishedPage(wiki, s) };
  const path = newsHref(post.slug);
  const trail = [...trailFor("/news")!, { name: post.title, path }];
  const body = bodyForPage(post);
  const related = relatedPosts(news, post, body.relatedSlugs, RELATED);
  const sources = sourceNames(post);
  // A source that is a Blizzard post Everloot keeps a page for links that page too. Only a source on the forums or
  // Bluesky can be one, so a post citing nothing there never loads the timeline (and keeps its hourly rebuild).
  const timeline = post.sources.some((s) => couldBeBluePost(s.url)) ? await loadTimeline() : [];
  const minutes = readingMinutes(post.blocks);
  // Index of the block after which the in-article ad sits; -1 for a short post, which gets none.
  const paragraphs = body.blocks.flatMap((b, i) => (b.type === "paragraph" ? [i] : []));
  const adAfter = paragraphs.length >= AD_MIN_PARAGRAPHS ? paragraphs[AD_AFTER_PARAGRAPH - 1] : -1;

  // Contents from the body's own headings; a post with fewer than two needs none. Sources and Related appear once each.
  const headings = body.blocks.flatMap((b, i) => (b.type === "heading" ? [{ i, id: anchor(i, b.text), label: b.text }] : []));
  const toc: TocItem[] = headings.length > 1
    ? [...headings, ...(post.sources.length > 0 ? [{ id: "sources", label: "Sources" }] : []), ...(related.length > 0 ? [{ id: "related", label: "Related" }] : [])]
    : [];

  const byline = (
    <div data-byline className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-2">
      <span>By <span data-author className="font-medium text-fg">{post.author}</span></span>
      <span aria-hidden className="text-muted">·</span>
      <time dateTime={post.published}>{longDate(post.published)}</time>
      {post.updated && <><span aria-hidden className="text-muted">·</span><span>Updated <time dateTime={post.updated}>{longDate(post.updated)}</time></span></>}
      <span aria-hidden className="text-muted">·</span>
      <span data-reading-time>{minutes} min read</span>
      {sources.length > 0 && (
        <a href="#sources" data-source-badge className="rounded-control border border-line px-2 py-0.5 text-xs text-fg-2 hover:border-edge hover:text-fg">
          Source: {sources.join(", ")}
        </a>
      )}
    </div>
  );

  return (
    <div data-news-article className={`mx-auto w-full max-w-[66rem] ${ARTICLE}`}>
      <ReadingLayout items={toc} rail={<AdSlot slot="sidebar" />}>
        <JsonLd data={newsArticleJsonLd({ title: post.title, description: postDescription(post), path, published: post.published, modified: lastChanged(post), author: post.author, ...(post.hero ? { image: post.hero.share ?? post.hero.src } : {}) })} />
        <article data-news-post>
          <PageHeader trail={trail} title={post.title} lede={<span className="text-base leading-relaxed">{post.summary}</span>} />
          {byline}
          {post.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-meta text-muted">
              {post.tags.map((t) => <span key={t} className="rounded-control border border-line px-2">{t}</span>)}
            </div>
          )}

          {post.hero && (
            // eslint-disable-next-line @next/next/no-img-element -- a fixed 16:9 frame; the file is pre-sized for it.
            <img data-news-hero src={post.hero.src} alt={post.hero.alt} width={1600} height={900} sizes="(min-width: 1024px) 760px, 100vw" decoding="async" className="mt-6 aspect-video w-full rounded-card border border-line object-cover" fetchPriority="high" />
          )}

          <div data-news-body className={`mt-8 ${MEASURE}`}>
            <Prose>
              {body.blocks.map((b, i) => {
                const heading = headings.find((h) => h.i === i);
                const el = heading
                  ? <h2 key={i} id={heading.id} className="scroll-mt-24 !mt-10 text-[22px] font-semibold leading-snug text-fg sm:text-[24px]">{heading.label}</h2>
                  : <WikiBlock key={i} block={b} ctx={ctx} />;
                return i === adAfter ? [el, <div key="ad-in-article" data-ad-in-article><AdSlot slot="inContent" /></div>] : el;
              })}
            </Prose>
          </div>

          {post.sources.length > 0 && (
            <section aria-labelledby="sources" className="mt-12 rounded-card border border-line bg-panel p-5">
              <h2 id="sources" className="scroll-mt-24 text-base font-semibold text-fg">Sources</h2>
              <ul className="mt-2 space-y-1.5 text-[15px]">
                {post.sources.map((s) => {
                  const page = postPathForUrl(s.url, timeline);
                  return (
                    <li key={s.url}>
                      <a href={s.url} rel="noopener" className={LINK}>{s.title}</a>
                      {page && <> · <Link href={page} className={LINK}>On Everloot</Link></>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div data-ad-end-of-article><AdSlot slot="inContent" /></div>

          {related.length > 0 && (
            <section aria-labelledby="related" className="mt-12 border-t border-line pt-8">
              <h2 id="related" className="scroll-mt-24 text-[22px] font-semibold text-fg">Related</h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-3">
                {related.map((p) => (
                  <li key={p.slug} data-related-card><NewsCard post={p} heading="h3" /></li>
                ))}
              </ul>
            </section>
          )}

          <p className="mt-10 text-sm text-fg-2">
            <Link href="/news" className={LINK}>All news</Link>
          </p>
        </article>
      </ReadingLayout>
    </div>
  );
}
