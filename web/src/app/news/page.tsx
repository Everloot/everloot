import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader, SectionHeading } from "@/components/ui";
import { longDate } from "@/data/wow-forever";
import { trailFor } from "@/lib/breadcrumbs";
import { hubIndexable, loadNews, newsHref, publishedPosts } from "@/lib/news";
import { pageMetadata } from "@/lib/seo";

// The posts change only with a deploy; an hour matches the pages themselves.
export const revalidate = 3600;

const DESCRIPTION = "What is new on Everloot and what it means for WoW: Forever players: site updates, data milestones and launch notes, in Everloot's own words.";
const LEDE = "What is new on Everloot and what it means for players, newest first.";
const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

export async function generateMetadata(): Promise<Metadata> {
  return {
    ...pageMetadata({ title: "Everloot News", description: DESCRIPTION, path: "/news" }),
    // Indexed once it lists a post; an empty hub stays out of search.
    robots: { index: hubIndexable(loadNews()), follow: true },
  };
}

export default function NewsHub() {
  const posts = publishedPosts(loadNews());
  return (
    <Container width="reading">
      <PageHeader trail={trailFor("/news")!} title="News" lede={LEDE} meta={<a href="/news/feed.xml" className={LINK}>RSS</a>} />
      <div className="space-y-12">
        {posts.length === 0 ? (
          <p data-empty-state className="text-sm text-muted">No posts yet. The first one appears here when it is published.</p>
        ) : (
          <ol className="space-y-8">
            {posts.map((p) => (
              <li key={p.slug} data-news-post>
                <article>
                  <h2 className="text-h2-sm text-fg sm:text-h2"><Link href={newsHref(p.slug)} className={LINK}>{p.title}</Link></h2>
                  <p className="mt-1 text-meta text-muted">
                    <time dateTime={p.published}>{longDate(p.published)}</time> · {p.author}
                    {p.tags.length > 0 && <> · {p.tags.join(", ")}</>}
                  </p>
                  <p className="mt-2 text-cell text-fg-2">{p.summary}</p>
                </article>
              </li>
            ))}
          </ol>
        )}
        <section aria-labelledby="blizzard">
          <SectionHeading id="blizzard">Blizzard&apos;s own posts</SectionHeading>
          <p className="text-sm text-fg-2">
            New builds, hotfixes and blue posts are on their own page.{" "}
            <Link href="/changes" className={LINK}>Open the changes timeline</Link>
          </p>
        </section>
      </div>
    </Container>
  );
}
