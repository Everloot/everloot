import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { Container } from "@/components/ui";
import { longDate } from "@/data/wow-forever";
import { GAME_LABEL, TYPE_LABEL, loadTimeline, loadWriteups, postIdOfSegment, postPath, writeupFor, type BlueWriteup, type ChangeEntry } from "@/lib/changes";
import { loadSiteAssets } from "@/lib/game-assets";
import { blueWriteupJsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { mentionIndex, siteSpellNames, type MentionIndex } from "@/lib/spell-mentions";
import { writeupBlocks, writeupText, type Inline } from "@/lib/writeup";
import { clampExcerpt, clampText } from "../../../../../kb/src/text-safety";
import WithSpells from "../with-spells";

/**
 * One Blizzard post on Everloot: its title, author and time, the short excerpt the data policy allows (marked
 * as Blizzard's words), our own write-up when a maintainer has reviewed one, and the link to the original.
 * The address is `/changes/<page id>-<slug>`; a wrong slug moves to the right one, an unknown id is a 404.
 * Indexed only once it carries our write-up: an excerpt alone is mostly Blizzard's words.
 */

type Props = { params: Promise<{ post: string }> };

// Blue posts are refreshed by the cron through the blue cache tag.
export const revalidate = 900;
export function generateStaticParams() {
  return [];
}

const LINK = "text-accent hover:underline underline-offset-4";
const BLUE = "text-blue-post hover:underline underline-offset-4";
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
  copy.source === "forum" && copy.region === entry.region ? `in a second thread on the ${sourceLabel(copy)}` : `on the ${sourceLabel(copy)}`;

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

function PostList({ id, title, entries, more }: { id: string; title: string; entries: ChangeEntry[]; more?: { href: string; label: string } }) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h2 id={id} className="text-h2-sm text-fg sm:text-h2">{title}</h2>
      <ul className="mt-2 space-y-2">
        {entries.map((e) => (
          <li key={e.id} className="text-cell">
            <Link href={postPath(e)!} className={`${BLUE} [overflow-wrap:anywhere]`}>{e.title}</Link>
            <span className="text-meta text-muted"> · <time dateTime={e.at}>{e.at.slice(0, 10)}</time></span>
          </li>
        ))}
      </ul>
      {more && <p className="mt-2 text-meta"><Link href={more.href} className={LINK}>{more.label}</Link></p>}
    </section>
  );
}

export default async function BluePostPage(props: Props) {
  const segment = (await props.params).post;
  const found = await find(segment);
  if (!found) notFound();
  if (`/changes/${segment}` !== found.path) permanentRedirect(found.path);
  const { entry, all, path, writeup } = found;

  const assets = await loadSiteAssets();
  const index = mentionIndex(assets, assets ? await siteSpellNames() : []);
  const excerpt = clampExcerpt(entry.excerpt);
  const day = entry.at.slice(0, 10);
  const others = all.filter((e) => e.id !== entry.id && e.game === entry.game && isPost(e));
  const byAuthor = entry.author ? others.filter((e) => e.author === entry.author).slice(0, RELATED) : [];
  const sameDay = others.filter((e) => e.at.slice(0, 10) === day).slice(0, RELATED);
  const authorHref = `/changes?${new URLSearchParams([...(entry.game === "classic" ? [["game", "classic"]] : []), ["author", entry.author ?? ""]]).toString()}`;
  const where = entry.source === "bluesky" ? "on Bluesky" : "on Blizzard's forums";
  const copies = entry.copies ?? [];

  return (
    <Container width="reading">
      <article data-blue-post>
        <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Patch notes and Blizzard posts", path: "/changes" }, { name: entry.title, path }])} />
        {writeup && (
          <JsonLd data={blueWriteupJsonLd({ title: entry.title, description: describe(found), path, reviewedOn: writeup.reviewed.on, original: { url: entry.url, at: entry.at } })} />
        )}
        <header className="mb-6">
          <p className="text-meta text-muted">{TYPE_LABEL[entry.type]} · {GAME_LABEL[entry.game]}</p>
          <h1 className="mt-1 text-title-sm text-blue-post [overflow-wrap:anywhere] sm:text-title">{entry.title}</h1>
          <p className="mt-2 text-meta text-fg-2">
            {entry.author && <span data-author className="font-semibold text-blue-post">{entry.author}</span>}
            {entry.role && <span>, {entry.role}</span>}
            {" · "}<time dateTime={entry.at} title={stamp(entry.at)}>{longDate(day)}</time>
            {" · "}{sourceLabel(entry)}
            {entry.category && entry.category !== "Bluesky" && <>{" · "}{entry.category}</>}
          </p>
        </header>

        {excerpt && (
          <figure data-excerpt className="border-l-2 border-blue-post pl-4">
            <blockquote cite={entry.url ?? undefined} className="text-blue-post">
              <p><WithSpells text={excerpt} index={index} /></p>
            </blockquote>
            <figcaption className="mt-1 text-meta text-muted">Blizzard&apos;s words, an excerpt.</figcaption>
          </figure>
        )}

        {(writeup || entry.summary) && (
          <section data-writeup={writeup ? "" : undefined} aria-labelledby="notes" className="mt-8 space-y-3 text-fg">
            <h2 id="notes" className="text-h2-sm text-fg sm:text-h2">Our notes</h2>
            {writeup
              ? writeupBlocks(writeup.body).map((b, i) => b.kind === "p"
                ? <p key={i}><Parts parts={b.parts} index={index} /></p>
                : <ul key={i} className="list-disc space-y-1 pl-6">{b.items.map((item, j) => <li key={j}><Parts parts={item} index={index} /></li>)}</ul>)
              : <p><WithSpells text={entry.summary!} index={index} /></p>}
            {writeup && <p className="text-meta text-muted">Reviewed <time dateTime={writeup.reviewed.on}>{longDate(writeup.reviewed.on)}</time></p>}
          </section>
        )}

        {entry.url && (
          <p className="mt-8">
            <a data-original href={entry.url} rel="noopener" className={`${LINK} font-medium`}>Read the full post {where}</a>
          </p>
        )}
        {copies.length > 0 && (
          <p data-also-posted className="mt-2 text-meta text-fg-2">
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

        <div className="mt-12 grid gap-8 border-t border-line pt-6 sm:grid-cols-2">
          <PostList id="more-from" title={`More from ${entry.author}`} entries={byAuthor} more={{ href: authorHref, label: `Every post by ${entry.author}` }} />
          <PostList id="same-day" title="Same day" entries={sameDay} />
        </div>
      </article>
    </Container>
  );
}
