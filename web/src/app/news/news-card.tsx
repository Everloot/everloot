import Link from "next/link";
import { longDate } from "@/data/wow-forever";
import { newsHref, sourceNames, type NewsPost } from "@/lib/news";

/**
 * The /news cards: a 16:9 thumbnail (the post's hero `thumb`, else its `src`, else a branded placeholder),
 * a tag chip, the date, the title, a two-line summary and the publishers the post cites. The featured card is
 * the hub's newest post, drawn large and loaded eagerly; every other thumbnail loads lazily.
 */

type CardPost = Pick<NewsPost, "slug" | "title" | "summary" | "published" | "tags" | "hero" | "author" | "sources">;

const chipLabel = (tags: string[]): string | null => {
  const tag = tags.find((t) => t !== "news-recap") ?? tags[0];
  // "wow-forever" reads "WoW forever", not "Wow forever".
  return tag ? (tag.charAt(0).toUpperCase() + tag.slice(1).replace(/-/g, " ")).replace(/\bwow\b/gi, "WoW") : null;
};

/** The publishers a post cites, named as the post's byline names them. */
function Sources({ post, className = "" }: { post: CardPost; className?: string }) {
  const names = sourceNames(post);
  return names.length > 0 ? <p data-news-sources className={`text-meta text-muted${className ? ` ${className}` : ""}`}>Source: {names.join(", ")}</p> : null;
}

export function NewsThumb({ post, eager = false, sizes }: { post: CardPost; eager?: boolean; sizes: string }) {
  const src = post.hero?.thumb ?? post.hero?.src;
  if (!src) {
    return (
      <div data-news-thumb-placeholder aria-hidden className="flex aspect-video w-full flex-col justify-between border-b border-line bg-canvas p-4">
        <span className="font-mono text-xs text-muted">everloot</span>
        <span className="font-mono text-xs text-fg-2">News</span>
      </div>
    );
  }
  // The card copy is 800x450 and the source 1600x900: both 16:9, so the frame never shifts.
  const [w, h] = post.hero?.thumb ? [800, 450] : [1600, 900];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized static WebP; no optimizer round trip needed.
    <img data-news-thumb src={src} alt="" width={w} height={h} sizes={sizes} loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? { fetchPriority: "high" as const } : {})} className="aspect-video w-full object-cover" />
  );
}

function Meta({ post }: { post: CardPost }) {
  const chip = chipLabel(post.tags);
  // Dashed means unconfirmed on this site (design system rule 5).
  const unconfirmed = post.tags.includes("unconfirmed");
  return (
    <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
      {chip && (
        <span data-news-chip title={unconfirmed ? "Unconfirmed" : undefined} className={`rounded-control border px-2 py-0.5 text-xs text-fg-2 ${unconfirmed ? "border-dashed border-edge" : "border-line"}`}>
          {chip}{unconfirmed && <span className="sr-only">, unconfirmed</span>}
        </span>
      )}
      <time dateTime={post.published}>{longDate(post.published)}</time>
      <span aria-hidden>·</span>
      <span>{post.author}</span>
    </div>
  );
}

const CARD = "group flex h-full flex-col overflow-hidden rounded-card border border-line bg-panel transition-colors hover:border-edge focus-visible:border-edge";

export function FeaturedNewsCard({ post }: { post: CardPost }) {
  return (
    <Link href={newsHref(post.slug)} data-news-featured className={`${CARD} md:flex-row`}>
      <div className="overflow-hidden md:w-3/5 md:shrink-0"><NewsThumb post={post} eager sizes="(min-width: 1024px) 640px, 100vw" /></div>
      <div className="flex flex-col gap-3 p-5 md:justify-center md:p-7">
        <Meta post={post} />
        <h2 className="text-[22px] font-semibold leading-snug text-fg sm:text-[26px]">{post.title}</h2>
        <p className="line-clamp-3 text-[15px] leading-relaxed text-fg-2">{post.summary}</p>
        <Sources post={post} />
      </div>
    </Link>
  );
}

export function NewsCard({ post, heading: H = "h2" }: { post: CardPost; heading?: "h2" | "h3" }) {
  return (
    <Link href={newsHref(post.slug)} data-news-card className={CARD}>
      <div className="overflow-hidden"><NewsThumb post={post} sizes="(min-width: 1024px) 340px, (min-width: 640px) 50vw, 100vw" /></div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Meta post={post} />
        <H className="text-[16px] font-semibold leading-snug text-fg">{post.title}</H>
        <p className="line-clamp-2 text-sm leading-relaxed text-fg-2">{post.summary}</p>
        {/* At the foot of the card, so the lines align across a row. */}
        <Sources post={post} className="mt-auto pt-1" />
      </div>
    </Link>
  );
}
