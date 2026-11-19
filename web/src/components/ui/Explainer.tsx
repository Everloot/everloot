import type { ReactNode } from "react";

/**
 * An explanation the page keeps but does not lead with: how a number is counted, where the data comes
 * from, how to take part. Closed until asked for, so the page reads as its content, not its caveats.
 * The text is in the page either way (search engines and screen readers get all of it).
 */
export default function Explainer({ summary, children, open = false }: { summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details data-explainer open={open} className="group mt-6 text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-edge font-mono text-xs text-muted group-open:border-accent group-open:text-accent">?</span>
        {summary}
      </summary>
      <div className="mt-2 max-w-prose space-y-2 border-l border-line pl-4 text-fg-2">{children}</div>
    </details>
  );
}
