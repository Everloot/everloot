import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The one list of entries: posts, builds, search results, guide packs, projects. One card, a hairline
 * between entries. `ordered` when the order means something (newest first, best match first).
 */
export function EntryList({ ordered = false, label, children }: { ordered?: boolean; label?: string; children: ReactNode }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag data-entry-list aria-label={label} className="min-w-0 divide-y divide-line rounded-card border border-line bg-panel">
      {children}
    </Tag>
  );
}

export interface EntryProps {
  /** The entry's name. A link when `href` is set. */
  title: ReactNode;
  href?: string;
  /** Heading level of the title: h2 when the entries are the page's sections, h3 under a SectionHeading. */
  as?: "h2" | "h3" | "p";
  /** The small mono line above the title: type, source, date. */
  meta?: ReactNode;
  /** Links or buttons at the foot of the entry. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** One entry: a mono meta line, the title, a few lines of text, then its actions. */
export function Entry({ title, href, as: Tag = "h2", meta, actions, children }: EntryProps) {
  return (
    <li data-entry className="min-w-0 space-y-2 p-4 sm:p-6">
      {meta && <p className="font-mono text-xs text-muted">{meta}</p>}
      <Tag className="text-lg font-semibold leading-snug text-fg [overflow-wrap:anywhere]">
        {href ? <Link href={href} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{title}</Link> : title}
      </Tag>
      {children && <div className="space-y-2 text-sm text-fg-2">{children}</div>}
      {actions && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">{actions}</div>}
    </li>
  );
}
