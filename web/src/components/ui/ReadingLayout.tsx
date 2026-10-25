import type { ReactNode } from "react";

export interface TocItem {
  /** The id of the section's heading on the page. */
  id: string;
  label: string;
}

/** Label-over-value facts for the rail's `meta`: who wrote it, when, where it came from. */
export function RailFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl data-rail-facts className="space-y-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="font-mono text-xs text-muted">{item.label}</dt>
          <dd className="text-fg-2 [overflow-wrap:anywhere]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The layout for reading pages (articles, news and Blizzard posts, about, methodology, legal pages):
 * one text column at the reading width (768 px) and a rail to its right holding `meta` (source,
 * licence, date) and a contents list built from `items`. On a wide screen the rail stays in view; on a
 * phone it follows the text, so the page still opens on its title (the contents as a two-column list). Without `meta` and `items` it is
 * just the column. The data pages' counterpart is `<Container width="data">`.
 */
export default function ReadingLayout({ items = [], meta, children }: { items?: TocItem[]; meta?: ReactNode; children: ReactNode }) {
  if (!meta && items.length === 0) return <div data-container="reading" className="w-full min-w-0 max-w-reading">{children}</div>;
  return (
    <div data-container="reading" data-reading-layout className="w-full min-w-0 lg:grid lg:grid-cols-[minmax(0,48rem)_13rem] lg:gap-12">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{children}</div>
      <aside className="mt-12 text-sm lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:self-start">
        {meta && <div data-reading-meta className="rounded-card border border-line bg-panel p-4 lg:border-0 lg:bg-transparent lg:p-0">{meta}</div>}
        {items.length > 0 && (
          <nav aria-label="On this page" className={`rounded-card border border-line bg-panel p-4 lg:border-0 lg:bg-transparent lg:p-0 ${meta ? "mt-4 lg:mt-6" : ""}`}>
            <p className="font-mono text-xs text-muted">On this page</p>
            <ol className="mt-2 grid grid-cols-2 gap-x-4 lg:grid-cols-1 lg:border-l lg:border-line">
              {items.map((item) => (
                <li key={item.id} className="min-w-0">
                  <a href={`#${item.id}`} className="inline-flex min-h-9 items-center text-fg-2 hover:text-accent lg:-ml-px lg:border-l lg:border-transparent lg:pl-3 lg:hover:border-accent">
                    {item.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </aside>
    </div>
  );
}
