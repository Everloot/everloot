import Link from "./PendingLink";

type Steps = { label: string; page: number; prevHref?: string | null; nextHref?: string | null };
type Numbered = { label: string; page: number; pages: number; href: (page: number) => string };

/** The page numbers a numbered pager shows: the first, the last, and the current one with a neighbour each side. */
export function pageWindow(page: number, pages: number): (number | null)[] {
  const keep = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  return keep.flatMap((p, i) => (i > 0 && p - keep[i - 1] > 1 ? [null, p] : [p]));
}

/**
 * Two forms. With `prevHref`/`nextHref`: Previous, the page number, Next, for a list the server pages without
 * a count (`?page=2`). With `pages` and `href`: "‹ 1 2 … 77 ›", 32 px controls, for the database lists.
 * Links only where there is a page.
 */
export default function Pager(props: Steps | Numbered) {
  if ("pages" in props) return <NumberedPager {...props} />;
  const { label, page, prevHref, nextHref } = props;
  const step = "inline-flex min-h-11 items-center text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
  return (
    <nav aria-label={label} className="mt-4 flex items-center gap-4 text-sm">
      {prevHref && <Link href={prevHref} className={step}>Previous</Link>}
      <span className="font-mono tabular-nums text-muted">Page {page}</span>
      {nextHref && <Link href={nextHref} className={step}>Next</Link>}
    </nav>
  );
}

function NumberedPager({ label, page, pages, href }: Numbered) {
  if (pages < 2) return null;
  const box = "ctl inline-flex min-w-8 items-center justify-center px-2 tabular-nums";
  return (
    <nav aria-label={label} className="flex items-center gap-1 text-control">
      {page > 1
        ? <Link href={href(page - 1)} rel="prev" aria-label="Previous page" className={`${box} text-fg-2 hover:bg-panel hover:text-fg`}>‹</Link>
        : <span aria-hidden="true" className={`${box} text-line`}>‹</span>}
      {pageWindow(page, pages).map((p, i) => p === null
        ? <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted">…</span>
        : p === page
          ? <span key={p} aria-current="page" className={`${box} border border-edge text-fg`}>{p}</span>
          : <Link key={p} href={href(p)} aria-label={`Page ${p}`} className={`${box} text-fg-2 hover:bg-panel hover:text-fg`}>{p}</Link>)}
      {page < pages
        ? <Link href={href(page + 1)} rel="next" aria-label="Next page" className={`${box} text-fg-2 hover:bg-panel hover:text-fg`}>›</Link>
        : <span aria-hidden="true" className={`${box} text-line`}>›</span>}
    </nav>
  );
}

/**
 * The line above and below a database list: the count on the left, the rows shown and the pager on the right
 * ("3,845 items · 1–50 · ‹ 1 2 … 77 ›").
 */
export function ResultStrip({ total, noun, page, perPage, href, label = "Pages" }: { total: number; noun: string; page: number; perPage: number; href: (page: number) => string; label?: string }) {
  // An empty list says so in its own empty state, never as a bare "0 items".
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return (
    <div data-result-strip className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-meta text-muted">
      <span className="tabular-nums"><span className="text-fg-2">{total.toLocaleString("en-US")}</span> {noun}</span>
      {pages > 1 && (
        <span className="flex items-center gap-2">
          <span className="tabular-nums">{from.toLocaleString("en-US")}–{to.toLocaleString("en-US")}</span>
          <Pager label={label} page={page} pages={pages} href={href} />
        </span>
      )}
    </div>
  );
}
