import type { ReactNode } from "react";

/**
 * The one section heading: 20 px semibold, with an optional action at the right ("All →") and an
 * optional one-line note under it. `as="h3"` inside a section that already has an h2; same look.
 */
export default function SectionHeading({ id, as: Tag = "h2", action, note, children }: { id?: string; as?: "h2" | "h3"; action?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Tag id={id} className="scroll-mt-24 text-xl font-semibold tracking-tight text-fg">{children}</Tag>
        {action && <div className="text-sm">{action}</div>}
      </div>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
    </div>
  );
}
