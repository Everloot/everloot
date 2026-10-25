import type { ReactNode } from "react";
import { QUALITY_TEXT, type Quality } from "./quality";

export interface TooltipFrameProps {
  /** The entity's name, first line, in its quality colour for items. */
  name: ReactNode;
  quality?: Quality;
  /** The lines the game shows, one element per line. */
  children?: ReactNode;
  /** Small line at the foot, for the design system page; entity pages leave it out. */
  foot?: ReactNode;
  /** An icon beside the name, inside the frame (the hover card's); pages draw theirs outside. */
  icon?: ReactNode;
  /** Label for the frame as a region, e.g. "Linen Cloth, from the game files". */
  label?: string;
}

/**
 * The game's tooltip box for an item, NPC, quest or zone shown on a page: dark in every theme, as
 * in the game, with the blue-grey edge and inner line. 13/18 text, 8 × 10 padding, at most 320 px
 * wide (full width on a phone). Colours inside use the dark tokens (the `bg-tooltip` class
 * re-declares them).
 */
export default function TooltipFrame({ name, quality, children, foot, icon, label }: TooltipFrameProps) {
  return (
    <section aria-label={label} data-tooltip-frame className="w-full rounded-[4px] border border-tooltip-border bg-tooltip p-px sm:max-w-tip">
      <div className="rounded-[3px] border border-tooltip-inner px-2.5 py-2 text-tip text-fg">
        {icon ? (
          <div className="mb-1 flex items-center gap-2.5">
            {icon}
            <p className={`min-w-0 text-[14px] font-semibold leading-[18px] [overflow-wrap:anywhere] ${quality ? QUALITY_TEXT[quality] : "text-fg"}`}>{name}</p>
          </div>
        ) : (
          <p className={`text-[14px] font-semibold leading-[18px] [overflow-wrap:anywhere] ${quality ? QUALITY_TEXT[quality] : "text-fg"}`}>{name}</p>
        )}
        {children && <div className="text-fg-2">{children}</div>}
        {foot && <p className="mt-1.5 text-xs text-muted">{foot}</p>}
      </div>
    </section>
  );
}
