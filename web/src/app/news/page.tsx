import type { Metadata } from "next";
import Link from "next/link";
import { Card, Container, PageHeader, SectionHeading } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { filterTimeline, loadTimeline, type ChangeEntry } from "@/lib/changes";
import { hubIndexable, loadNews, publishedPosts } from "@/lib/news";
import { pageMetadata } from "@/lib/seo";
import ChangeList from "../changes/change-list";
import { FeaturedNewsCard, NewsCard } from "./news-card";

// The posts change only with a deploy, so the hub asks to be rebuilt at most once an hour. "From Blizzard" reads the
// changes timeline: with the blue store configured, that fetch revalidates every 10 minutes and on the "blue" tag the
// cron sets when it adds posts, so the hub is rebuilt at most every 10 minutes and after each new Blizzard post.
export const revalidate = 3600;

const DESCRIPTION = "What is new on Everloot and what it means for WoW: Forever players: site updates, data milestones and launch notes, in Everloot's own words.";
const LEDE = "What is new on Everloot and what it means for players, newest first.";
const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
/** How many of Blizzard's newest entries the section under the cards lists. */
const FROM_BLIZZARD = 6;
/** Blizzard's own entries: its forum and Bluesky posts and hotfixes, and the game builds. An entry Everloot wrote never counts. */
const fromBlizzard = (e: ChangeEntry) => e.type === "build" || e.source === "forum" || e.source === "bluesky";

export async function generateMetadata(): Promise<Metadata> {
  return {
    ...pageMetadata({ title: "Everloot News", description: DESCRIPTION, path: "/news" }),
    // Indexed once it lists a post; an empty hub stays out of search.
    robots: { index: hubIndexable(loadNews()), follow: true },
  };
}

/** The news hub: the newest post as a featured card, the rest as a card grid, then Blizzard's newest posts, hotfixes and builds. */
export default async function NewsHub() {
  const posts = publishedPosts(loadNews());
  // Who wrote it is checked before the six newest are taken, so an Everloot entry can neither show nor push one out.
  const blizzard = filterTimeline(await loadTimeline(), "all", "forever").filter(fromBlizzard).slice(0, FROM_BLIZZARD);
  return (
    <Container width="wide">
      <PageHeader trail={trailFor("/news")!} title="News" lede={LEDE} meta={<a href="/news/feed.xml" className={LINK}>RSS</a>} />
      <div className="space-y-12">
        {posts.length === 0 ? (
          <p data-empty-state className="text-sm text-fg-2">
            No posts yet. The first one appears here and in the <a href="/news/feed.xml" className={LINK}>news feed</a> when it is
            published. Blizzard&apos;s own posts are on the <Link href="/changes" className={LINK}>changes timeline</Link>.
          </p>
        ) : (
          <>
            <div data-news-post><FeaturedNewsCard post={posts[0]} /></div>
            {posts.length > 1 && (
              <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {posts.slice(1).map((p) => <li key={p.slug} data-news-post><NewsCard post={p} /></li>)}
              </ol>
            )}
          </>
        )}
        <section aria-labelledby="blizzard">
          <SectionHeading id="blizzard" action={<Link href="/changes" className={LINK}>Every change →</Link>}>From Blizzard</SectionHeading>
          {blizzard.length > 0 ? (
            <Card><ChangeList entries={blizzard} types columns /></Card>
          ) : (
            <p className="text-sm text-fg-2">
              New builds, hotfixes and blue posts are on their own page.{" "}
              <Link href="/changes" className={LINK}>Open the changes timeline</Link>
            </p>
          )}
        </section>
      </div>
    </Container>
  );
}
