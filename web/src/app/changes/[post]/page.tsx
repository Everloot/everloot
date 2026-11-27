import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound, permanentRedirect } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import JsonLd from "@/components/JsonLd";
import { Badge, Card, Container, SectionHeading } from "@/components/ui";
import { longDate } from "@/data/wow-forever";
import { GAME_LABEL, TYPE_LABEL, foldTitleDay, fullerCopy, loadTimeline, loadWriteups, postDay, postIdOfSegment, postPath, timelineDegraded, writeupFor, type BlueWriteup, type ChangeEntry, type TitleDayRow } from "@/lib/changes";
import { keepBrieflyIf } from "@/lib/degraded-render";
import EdgeDegraded from "@/components/EdgeDegraded";
import { loadSiteAssets, siteAssetsFailed } from "@/lib/game-assets";
import { blueWriteupJsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { mentionIndex, siteSpellNames, type MentionIndex } from "@/lib/spell-mentions";
import { writeupBlocks, writeupText, type Inline } from "@/lib/writeup";
import { clampExcerpt, clampText } from "@kb/text-safety";
import ChangeList from "../change-list";
import WithSpells from "../with-spells";

/**
 * One Blizzard post on Everloot: its title, author and time, the short excerpt the data policy allows (marked
 * as Blizzard's words), our own write-up when a maintainer has reviewed one, and the link to the original.
 * The address is `/changes/<page id>-<slug>`; a wrong slug moves to the right one, an unknown id is a 404.
 * Indexed only once it carries our write-up: an excerpt alone is mostly Blizzard's words.
 * Under the post: the newer and the older post of the same game. Beside it (under it on a phone): more by the
 * author and the same day.
 */

type Props = { params: Promise<{ post: string }> };

// Blue posts are refreshed by the cron through the blue cache tag.
export const revalidate = 900;
export function generateStaticParams() {
  return [];
}

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const RELATED = 5;

/** UTC to the minute, whatever offset the time was written with. */
const stamp = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const sourceLabel = (e: ChangeEntry) => (e.source === "bluesky" ? "Bluesky" : e.region === "eu" ? "EU forum" : "US forum");
const isPost = (e: ChangeEntry) => e.type !== "build" && postPath(e) !== null;

interface Found { entry: ChangeEntry; all: ChangeEntry[]; path: string; writeup: BlueWriteup | null }

/** The announcement an address names. A regional copy's address finds the announcement, whose page is the one shown. */
async function find(segment: string): Promise<Found | null> {
  const id = postIdOfSegment(segment);
  if (!id) return null;
  const all = await loadTimeline();
  const entry = all.find((e) => e.type !== "build" && (e.id === id || e.copies?.some((c) => c.id === id)));
  if (!entry) return null;
  return { entry, all, path: postPath(entry)!, writeup: writeupFor(entry, loadWriteups()) };
}

/** "on the EU forum", or "in a second thread on the US forum" for a repeat on the same forum. */
const copyPlace = (entry: ChangeEntry, copy: ChangeEntry) =>
  copy.source === "news" ? "on Blizzard News"
    : copy.source === "forum" && copy.region === entry.region ? `in a second thread on the ${sourceLabel(copy)}` : `on the ${sourceLabel(copy)}`;

/** The search snippet: our write-up's opening when there is one, else what the page is, in our words. */
function describe({ entry, writeup }: Found): string {
  if (writeup) return clampText(writeupText(writeup.body), 160);
  const by = [entry.author, entry.role].filter(Boolean).join(", ");
  return clampText(`${TYPE_LABEL[entry.type]} by ${by || "Blizzard"} on the ${sourceLabel(entry)}, ${longDate(entry.at.slice(0, 10))}: ${entry.title}. A short excerpt and a link to the full post.`, 160);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const found = await find((await props.params).post);
  if (!found) return { robots: { index: false, follow: true } };
  return {
    ...pageMetadata({ title: found.entry.title, description: describe(found), path: found.path }),
    robots: { index: found.writeup !== null, follow: true },
  };
}

function Parts({ parts, index }: { parts: Inline[]; index: MentionIndex }) {
  return (
    <>
      {parts.map((p, i) => typeof p === "string"
        ? <WithSpells key={i} text={p} index={index} />
        : p.href.startsWith("/")
          ? <Link key={i} href={p.href} className={LINK}>{p.text}</Link>
          : <a key={i} href={p.href} rel="noopener" className={LINK}>{p.text}</a>)}
    </>
  );
}

/** Rows of one per title and day (foldTitleDay): several replies under one title that day are one row saying how many. */
function PostList({ id, title, rows, more }: { id: string; title: string; rows: TitleDayRow[]; more?: { href: string; label: string } }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={id} className="min-w-0">
      <SectionHeading id={id} action={more && <Link href={more.href} className={LINK}>{more.label}</Link>}>{title}</SectionHeading>
      <Card><ChangeList entries={rows.map((r) => r.entry)} posts={new Map(rows.map((r) => [r.entry.id, r.posts.length]))} /></Card>
    </section>
  );
}

/** The post before and after this one in the same game's timeline, two cards to step through the posts; at either end the one card takes the row. */
function Nearby({ newer, older }: { newer: ChangeEntry | null; older: ChangeEntry | null }) {
  if (!newer && !older) return null;
  const both = Boolean(newer && older);
  const card = (e: ChangeEntry, label: string, align: string) => (
    <Card href={postPath(e)!} className={`flex min-w-0 flex-col gap-1 ${both ? align : "sm:col-span-2"}`}>
      <span className="text-meta text-muted">{label}</span>
      <span className="text-cell font-medium text-blue-post [overflow-wrap:anywhere]">{e.title}</span>
      <time dateTime={e.at} className="whitespace-nowrap text-meta text-muted">{longDate(postDay(e))}</time>
    </Card>
  );
  return (
    <nav data-nearby aria-label="Nearby posts" className="mt-8 grid gap-4 sm:grid-cols-2">
      {newer && card(newer, "Newer", "")}
      {older && card(older, "Older", "sm:items-end sm:text-right")}
    </nav>
  );
}

export default async function BluePostPage(props: Props) {
  const segment = (await props.params).post;
  const found = await find(segment);
  // The bundled posts (the build's render, or a store outage) may lack this post: its page, or its 404, is kept seconds.
  const timelineDown = await keepBrieflyIf(await timelineDegraded());
  if (!found) notFound();
  if (`/changes/${segment}` !== found.path) permanentRedirect(found.path);
  const { entry, all, path, writeup } = found;

  const assets = await loadSiteAssets();
  // Spell tooltips need the asset files: a failed read is kept seconds too.
  const degraded = timelineDown || await keepBrieflyIf(siteAssetsFailed(assets));
  const index = mentionIndex(assets, assets ? await siteSpellNames() : []);
  // A copy stored cut short (the US hotfix of November 12 stops after its first sentence) shows its twin's fuller text.
  const fuller = fullerCopy(entry);
  const excerpt = clampExcerpt((fuller ?? entry).excerpt);
  // The copy whose words are shown: the header names its forum and time.
  const shown = fuller ?? entry;
  const day = postDay(entry);
  // Newest first, as the timeline lists them.
  const posts = all.filter((e) => e.game === entry.game && isPost(e)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const at = posts.findIndex((e) => e.id === entry.id);
  const newer = at > 0 ? posts[at - 1] : null;
  const older = at >= 0 && at < posts.length - 1 ? posts[at + 1] : null;
  // Each title and day is listed once around the page: this post, Newer and Older first, then Same day, then More from the author.
  const rowKey = (e: ChangeEntry) => `${postDay(e)}|${e.title}`;
  const listed = new Set([entry, newer, older].filter((e) => e !== null).map(rowKey));
  const sameDayRows = foldTitleDay(posts.filter((e) => !listed.has(rowKey(e)) && postDay(e) === day)).slice(0, RELATED);
  for (const row of sameDayRows) listed.add(rowKey(row.entry));
  const byAuthorRows = entry.author ? foldTitleDay(posts.filter((e) => !listed.has(rowKey(e)) && e.author === entry.author)).slice(0, RELATED) : [];
  const authorHref = `/changes?${new URLSearchParams([...(entry.game === "classic" ? [["game", "classic"]] : []), ["author", entry.author ?? ""]]).toString()}`;
  const where = entry.source === "bluesky" ? "on Bluesky" : "on Blizzard's forums";
  const copies = entry.copies ?? [];

  return (
    <Container width="wide" className="grid gap-12 lg:grid-cols-[minmax(0,48rem)_minmax(0,1fr)]">
      <article data-blue-post className="min-w-0">
        <EdgeDegraded when={degraded} />
        <JsonLd data={breadcrumbJsonLd([...trailFor("/changes")!, { name: entry.title, path }])} />
        {writeup && (
          <JsonLd data={blueWriteupJsonLd({ title: entry.title, description: describe(found), path, reviewedOn: writeup.reviewed.on, original: { url: entry.url, at: entry.at } })} />
        )}
        {/* Nothing above the title (design system rule 1): what kind of post it is leads the line under it. */}
        <header className="mb-6">
          <h1 className="text-title-sm text-blue-post [overflow-wrap:anywhere] sm:text-title">{entry.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone="neutral">{TYPE_LABEL[entry.type]} · {GAME_LABEL[entry.game]}</Badge>
            <p className="text-meta text-fg-2">
              {shown.author && <span data-author className="font-semibold text-blue-post">{shown.author}</span>}
              {shown.role && <span>, {shown.role}</span>}
              {" · "}<time dateTime={shown.at} title={stamp(shown.at)}>{longDate(day)}</time>
              {" · "}<span data-forum>{sourceLabel(shown)}</span>
              {entry.category && entry.category !== "Bluesky" && <>{" · "}{entry.category}</>}
            </p>
          </div>
        </header>

        {excerpt && (
          <Card as="section" aria-label="Blizzard's words">
            <figure data-excerpt className="border-l-2 border-blue-post pl-4">
              <blockquote cite={shown.url ?? undefined} className="text-fg">
                <p><WithSpells text={excerpt} index={index} /></p>
              </blockquote>
              <figcaption className="mt-1 text-meta text-muted">
                {fuller
                  ? `Excerpt from the ${sourceLabel(fuller)} post (it has more text than the ${(entry.region ?? "us").toUpperCase()} copy).`
                  : "Blizzard's words, an excerpt."}
              </figcaption>
            </figure>
          </Card>
        )}

        {writeup || entry.summary ? (
          <Card as="section" data-writeup={writeup ? "" : undefined} aria-labelledby="notes" className="mt-4">
            <SectionHeading id="notes" note={writeup && <>Reviewed <time dateTime={writeup.reviewed.on}>{longDate(writeup.reviewed.on)}</time></>}>Our notes</SectionHeading>
            <div className="space-y-3 text-fg">
              {writeup
                ? writeupBlocks(writeup.body).map((b, i) => b.kind === "p"
                  ? <p key={i}><Parts parts={b.parts} index={index} /></p>
                  : <ul key={i} className="list-disc space-y-1 pl-6">{b.items.map((item, j) => <li key={j}><Parts parts={item} index={index} /></li>)}</ul>)
                : <p><WithSpells text={entry.summary!} index={index} /></p>}
            </div>
          </Card>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          {entry.url && <a data-original href={entry.url} rel="noopener" className="btn">Read the full post {where}</a>}
          <Link href={entry.game === "classic" ? "/changes?game=classic" : "/changes"} className={`${LINK} text-sm`}>All posts</Link>
        </div>
        {copies.length > 0 && (
          <p data-also-posted className="mt-3 text-meta text-fg-2">
            Also posted{" "}
            {copies.map((c, i) => (
              <span key={c.id}>
                {i > 0 && (i === copies.length - 1 ? " and " : ", ")}
                {c.url ? <a href={c.url} rel="noopener" className={LINK}>{copyPlace(entry, c)}</a> : copyPlace(entry, c)}
              </span>
            ))}
            .
          </p>
        )}

        <Nearby newer={newer} older={older} />
      </article>
      {(byAuthorRows.length > 0 || sameDayRows.length > 0) && (
        <aside aria-label="More Blizzard posts" className="min-w-0 space-y-8">
          <PostList id="more-from" title={`More from ${entry.author}`} rows={byAuthorRows} more={{ href: authorHref, label: `Every post by ${entry.author}` }} />
          <PostList id="same-day" title="Same day" rows={sameDayRows} />
        </aside>
      )}
    </Container>
  );
}
