import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { PageHeader, Prose, RailFacts, ReadingLayout, SectionHeading, type TocItem } from "@/components/ui";
import { longDate } from "@/data/wow-forever";
import { trailFor } from "@/lib/breadcrumbs";
import { newsArticleJsonLd } from "@/lib/jsonld";
import { lastChanged, loadNews, newsHref, postDescription, publishedPost, publishedPosts } from "@/lib/news";
import { pageMetadata } from "@/lib/seo";
import { loadWiki, publishedPage } from "@/lib/wiki";
import { resolveTokens } from "@/lib/wiki-names";
import { WikiBlock, type TextContext } from "../../wiki/wiki-text";

/**
 * One news post: Everloot's own words about the site or the game. The body is the wiki's syntax, so a post
 * links database entities and wiki pages the same way a wiki page does. Only published posts are built; a
 * draft or unknown slug answers 404.
 */

// Posts change only with a deploy, but their tokens read the database's names, so a page is rebuilt at most once an hour.
export const revalidate = 3600;
export function generateStaticParams() {
  return publishedPosts(loadNews()).map((p) => ({ slug: p.slug }));
}

const LINK = "text-accent hover:underline underline-offset-4";
const RELATED = 5;

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const post = publishedPost(loadNews(), slug);
  if (!post) return { robots: { index: false, follow: true } };
  const base = pageMetadata({ title: post.title, description: postDescription(post), path: newsHref(post.slug) });
  return {
    ...base,
    openGraph: { ...base.openGraph, type: "article", publishedTime: post.published, ...(post.updated ? { modifiedTime: post.updated } : {}), authors: [post.author] },
    robots: { index: true, follow: true },
  };
}

export default async function NewsArticle(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const news = loadNews();
  const post = publishedPost(news, slug);
  if (!post) notFound();

  const wiki = loadWiki();
  const ctx: TextContext = { tokens: await resolveTokens(post), pages: (s) => publishedPage(wiki, s) };
  const path = newsHref(post.slug);
  const trail = [...trailFor("/news")!, { name: post.title, path }];
  const others = publishedPosts(news).filter((p) => p.slug !== post.slug).slice(0, RELATED);

  // Contents from the body's own headings; a post with fewer than two needs none.
  const headings = post.blocks.flatMap((b, i) => (b.type === "heading" ? [{ i, id: `h-${i}-${b.text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, label: b.text }] : []));
  const toc: TocItem[] = headings.length > 1
    ? [...headings, ...(post.sources.length > 0 ? [{ id: "sources", label: "Sources" }] : []), ...(others.length > 0 ? [{ id: "more-news", label: "More news" }] : [])]
    : [];
  const meta = (
    <RailFacts
      items={[
        { label: "Author", value: <span data-author>{post.author}</span> },
        { label: "Published", value: <time dateTime={post.published}>{longDate(post.published)}</time> },
        ...(post.updated ? [{ label: "Updated", value: <time dateTime={post.updated}>{longDate(post.updated)}</time> }] : []),
      ]}
    />
  );

  return (
    <ReadingLayout items={toc} meta={meta}>
      <JsonLd data={newsArticleJsonLd({ title: post.title, description: postDescription(post), path, published: post.published, modified: lastChanged(post), author: post.author })} />
      <article data-news-post>
        <PageHeader
          trail={trail}
          title={post.title}
          lede={post.summary}
          meta={
            <>
              {post.tags.map((t) => <span key={t} className="rounded-control border border-line px-2">{t}</span>)}
            </>
          }
        />

        <Prose>
          {post.blocks.map((b, i) => {
            const heading = toc.length > 0 ? headings.find((h) => h.i === i) : undefined;
            return heading
              ? <h3 key={i} id={heading.id} className="scroll-mt-24 text-base font-semibold text-fg">{heading.label}</h3>
              : <WikiBlock key={i} block={b} ctx={ctx} />;
          })}
        </Prose>

        {post.sources.length > 0 && (
          <section aria-labelledby="sources" className="mt-12">
            <SectionHeading id="sources">Sources</SectionHeading>
            <ul className="space-y-1 text-sm">
              {post.sources.map((s) => <li key={s.url}><a href={s.url} rel="noopener" className={LINK}>{s.title}</a></li>)}
            </ul>
          </section>
        )}

        {others.length > 0 && (
          <section aria-labelledby="more-news" className="mt-12 border-t border-line pt-6">
            <SectionHeading id="more-news">More news</SectionHeading>
            <ul className="space-y-2 text-sm">
              {others.map((p) => (
                <li key={p.slug}>
                  <Link href={newsHref(p.slug)} className={LINK}>{p.title}</Link>
                  <span className="text-meta text-muted"> · <time dateTime={p.published}>{p.published}</time></span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-12 text-sm text-fg-2">
          <Link href="/news" className={LINK}>All news</Link>
        </p>
      </article>
    </ReadingLayout>
  );
}
