"use client";

import Link from "next/link";
import type { FocusEvent } from "react";
import Card from "@/components/ui/Card";
import GameIcon from "@/components/game/GameIcon";
import { CLASS_TEXT } from "./TalentTreeView";

export interface ClassChoice {
  slug: string;
  name: string;
  /** The game's class icon, when the page has the asset folder. */
  icon?: string | null;
  /** The class's trees, in the game's order. */
  trees?: string[];
}

/**
 * A browser leaves a name it can partly see in the scrolling row where it is when the name takes keyboard focus, so
 * the row brings it into view. A press does not move the row: the release has to land on the same name.
 */
function reveal(e: FocusEvent<HTMLAnchorElement>) {
  const row = e.currentTarget.closest("ul");
  if (row && row.scrollWidth > row.clientWidth && e.currentTarget.matches(":focus-visible")) {
    e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

/**
 * The nine classes in their icons and colours, nine across. `tiles` is the talent hub's picker: a big
 * icon, the name, and the trees under it. `strip` is the row above every class page's calculator, so
 * another class is one click away; the class being planned is marked with aria-current and a bar in
 * its colour. On a phone the strip is icons only, in one row, and the names stay for screen readers.
 * Without icons a phone gets one row of names that scrolls sideways, starting at the class being planned
 * where the browser supports scroll-initial-target. The row is inset 4 px so a focus ring is not cut at
 * its edges.
 */
export default function ClassPicker({ classes, current, variant }: { classes: ClassChoice[]; current?: string; variant: "tiles" | "strip" }) {
  if (variant === "tiles") {
    return (
      <nav aria-label="Classes">
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-9">
          {classes.map((c) => (
            <li key={c.slug} className="min-w-0">
              <Card href={`/tools/talents/${c.slug}`} padding="none" className="flex h-full flex-col items-center gap-2 px-1 py-4 text-center">
                {c.icon && <GameIcon src={c.icon} size={48} />}
                <span className={`max-w-full truncate font-semibold ${CLASS_TEXT[c.slug]}`}>{c.name}</span>
                {c.trees && c.trees.length > 0 && (
                  <span className="hidden text-xs leading-snug text-muted lg:block">
                    {c.trees.map((t) => <span key={t} className="block">{t}</span>)}
                  </span>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  const iconsOnly = classes.every((c) => c.icon);
  return (
    <nav aria-label="Classes">
      <ul className={`gap-1.5 sm:gap-2 ${iconsOnly ? "grid grid-cols-9" : "flex overflow-x-auto max-sm:-m-1 max-sm:scroll-px-1 max-sm:p-1 sm:grid sm:grid-cols-9 sm:overflow-visible"}`}>
        {classes.map((c) => {
          const on = c.slug === current;
          return (
            <li key={c.slug} className={iconsOnly ? "min-w-0" : "shrink-0 sm:min-w-0"}>
              <Link
                href={`/tools/talents/${c.slug}`}
                aria-current={on ? "page" : undefined}
                onFocus={iconsOnly ? undefined : reveal}
                className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-control border px-0.5 py-1.5 text-sm font-semibold transition-colors sm:rounded-card sm:py-2 ${iconsOnly ? "" : "max-sm:px-3"} ${CLASS_TEXT[c.slug]} ${on ? "border-current border-b-[3px] bg-panel" : "border-line bg-canvas hover:border-current"} ${on && !iconsOnly ? "max-sm:[scroll-initial-target:nearest]" : ""}`}
              >
                {c.icon && <GameIcon src={c.icon} size={28} />}
                <span className={`max-w-full truncate ${c.icon ? "sr-only sm:not-sr-only" : ""}`}>{c.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
