import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import { Container, PageHeader, SectionHeading } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { hubIndexable, loadNews, publishedPosts } from "@/lib/news";
import { pageMetadata } from "@/lib/seo";
import { FeaturedNewsCard, NewsCard } from "./news-card";

// The posts change only with a deploy; an hour matches the pages themselves.
export const revalidate = 3600;

const DESCRIPTION = "What is new on Everloot and what it means for WoW: Forever players: site updates, data milestones and launch notes, in Everloot's own words.";
const LEDE = "What is new on Everloot and what it means for players, newest first.";
/** The in-feed ad follows this many cards in the grid (the featured post not counted). */
const FEED_AD_AFTER = 6;
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
    <Container width="wide">
      <PageHeader trail={trailFor("/news")!} title="News" lede={LEDE} meta={<a href="/news/feed.xml" className={LINK}>RSS</a>} />
      <div className="space-y-12">
        {posts.length === 0 ? (
          <p data-empty-state className="text-sm text-muted">No posts yet. The first one appears here when it is published.</p>
        ) : (
          <>
            <div data-news-post><FeaturedNewsCard post={posts[0]} /></div>
            {posts.length > 1 && (
              <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {posts.slice(1).flatMap((p, i) => {
                  const card = <li key={p.slug} data-news-post><NewsCard post={p} /></li>;
                  // Only between cards: a grid with no card after the sixth gets no ad.
                  return i === FEED_AD_AFTER - 1 && posts.length > FEED_AD_AFTER + 1
                    ? [card, <li key="ad-in-feed" data-ad-in-feed className="col-span-full empty:hidden"><AdSlot slot="inContent" /></li>]
                    : [card];
                })}
              </ol>
            )}
          </>
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
