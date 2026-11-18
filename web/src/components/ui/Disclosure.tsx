import type { ReactNode } from "react";

/**
 * A question or an explanation, closed until asked for: the page keeps the text (and search engines
 * read it) without it standing between the visitor and the tool. Stack several under one
 * SectionHeading; each draws the hairline above it. Native <details>, so it opens without JavaScript. `wide`
 * drops the reading measure, for a table.
 */
export default function Disclosure({ summary, as: Tag = "h3", id, wide = false, children }: { summary: ReactNode; as?: "h2" | "h3"; id?: string; wide?: boolean; children: ReactNode }) {
  return (
    <details id={id} data-disclosure className="group border-t border-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 [&::-webkit-details-marker]:hidden">
        <Tag className="text-base font-semibold text-fg">{summary}</Tag>
        <span aria-hidden="true" className="shrink-0 font-mono text-muted transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className={`${wide ? "" : "max-w-[65ch] "}space-y-3 pb-4 text-fg-2`}>{children}</div>
    </details>
  );
}
