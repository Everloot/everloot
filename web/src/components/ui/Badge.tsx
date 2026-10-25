import type { ReactNode } from "react";
import { QUALITY_LABEL, QUALITY_TEXT, type Quality } from "./quality";

/** The tooltip on the unconfirmed marker. */
export const UNCONFIRMED_TITLE = "From the game files, not yet confirmed by players";

/**
 * The badge set, and only this set:
 * - `files`: not a pill but a quiet marker, one hollow diamond (the agreement meter's empty mark: no install
 *   has reported it yet) with a tooltip. A dotted ring read as a loading spinner. Screen readers hear
 *   "unconfirmed" (or `children`, when given). Never a chip or a sentence (density spec, 2026-10-20).
 *   `title` replaces the tooltip when the marker means something else (a build made on an older game build).
 * - `confirmed`: solid accent, for a fact three installs agree on.
 * - `neutral`: a plain fact (a build, a type).
 * - `quality`: an item quality in its own colour.
 */
export type BadgeProps =
  | { tone: "files"; children?: ReactNode; title?: string }
  | { tone: "confirmed"; children?: ReactNode }
  | { tone: "neutral"; children: ReactNode }
  | { tone: "quality"; quality: Quality; children?: ReactNode };

const BASE = "inline-flex h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 font-mono text-xs";

export default function Badge(props: BadgeProps) {
  switch (props.tone) {
    case "files":
      return (
        <span data-badge="files" title={props.title ?? UNCONFIRMED_TITLE} className="inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center align-middle">
          <span aria-hidden="true" className="block h-2 w-2 rotate-45 rounded-[1px] border-[1.5px] border-edge" />
          <span className="sr-only">{props.children ?? "unconfirmed"}</span>
        </span>
      );
    case "confirmed":
      return <span data-badge="confirmed" className={`${BASE} border-accent text-accent`}>{props.children ?? "Confirmed by 3 installs"}</span>;
    case "neutral":
      return <span data-badge="neutral" className={`${BASE} border-line text-fg-2`}>{props.children}</span>;
    case "quality":
      return <span data-badge="quality" className={`${BASE} border-current ${QUALITY_TEXT[props.quality]}`}>{props.children ?? QUALITY_LABEL[props.quality]}</span>;
  }
}
