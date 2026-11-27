import type { ReactNode } from "react";

/**
 * The one section heading: 20 px semibold, with an optional action at the right ("All →") and an
 * optional one-line note under it. `as="h3"` inside a section that already has an h2; same look.
 * `size="data"` is the data-section step (15 → 16 px) for a section inside a database or entity page, so
 * "Lore" or "Changes across builds" matches the map and tab sections around it (docs/design/direction.md).
 */
export default function SectionHeading({ id, as: Tag = "h2", size = "section", action, note, children }: { id?: string; as?: "h2" | "h3"; size?: "section" | "data"; action?: ReactNode; note?: ReactNode; children: ReactNode }) {
  const data = size === "data";
  return (
    <div className={data ? "mb-2" : "mb-4"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Tag id={id} className={data ? "scroll-mt-24 text-h2-sm font-semibold text-fg sm:text-h2" : "scroll-mt-24 text-xl font-semibold tracking-tight text-fg"}>{children}</Tag>
        {action && <div className={data ? "text-meta" : "text-sm"}>{action}</div>}
      </div>
      {note && <p className={data ? "mt-1 text-meta text-muted" : "mt-1 text-sm text-muted"}>{note}</p>}
    </div>
  );
}
