import type { ReactNode } from "react";
import { UNCONFIRMED_TITLE } from "@/components/ui/Badge";
import type { Quality } from "@/components/ui/quality";
import GameIcon from "./GameIcon";

/**
 * The quiet "unconfirmed" marker as an edge: a 1 px dashed frame around what it wraps (the header icon),
 * with the tooltip and sr-only text of the `files` Badge. Never a chip or a sentence.
 */
function Unconfirmed({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span data-unconfirmed title={UNCONFIRMED_TITLE} className={`inline-flex rounded-control border border-dashed border-edge ${className}`.trim()}>
      {children}
      <span className="sr-only"> unconfirmed</span>
    </span>
  );
}

/**
 * The header's icon: omitted when game art is unavailable. An item's icon
 * (the page passes the game's question mark where its own is missing) has its quality border and no frame; with no
 * asset files an item has no icon at all.
 */
export function EntityIcon({ src, quality, unconfirmed = false, item = false }: { src?: string | null; quality?: Quality; unconfirmed?: boolean; item?: boolean }) {
  if (!src) return null;
  if (item) return (
    <span className="shrink-0" data-unconfirmed={unconfirmed || undefined} title={unconfirmed ? UNCONFIRMED_TITLE : undefined}>
      <GameIcon src={src} quality={quality} size={40} rounded="control" />
      {unconfirmed && <span className="sr-only"> unconfirmed</span>}
    </span>
  );
  const icon = <GameIcon src={src} quality={quality} size={40} rounded="control" />;
  return unconfirmed ? <Unconfirmed className="shrink-0 p-px">{icon}</Unconfirmed> : <span className="shrink-0">{icon}</span>;
}
