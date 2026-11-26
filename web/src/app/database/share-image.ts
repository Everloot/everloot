import { notFound } from "next/navigation";
import { CLIENT_LABEL } from "@kb/edges";
import { renderEntityCard } from "@/lib/og-card";

// The social card of a database page with no installs meter of its own (every type but items, NPCs and quests): the
// name the page shows, its type, and one to three facts the page states. Text only: docs/ASSETS.md keeps game art on
// share cards to the item card. Each opengraph-image.tsx asks the same question its page does, so an id the page
// answers with a 404 is a 404 here too (docs/SEO.md).

export interface ShareCard {
  /** The type as the page's header names it ("Mount", "Hunter pet family"). */
  type: string;
  /** The name the page shows, or its "Mount 6" stand-in. */
  title: string;
  /** Facts the page states; empty ones are left out and only the first three are drawn. */
  facts?: (string | null | undefined | false)[];
}

/** Where the page's name and facts come from: three installs, or the game files alone. */
export const provenance = (confirmed: boolean) => (confirmed ? "3 of 3 installs agree" : CLIENT_LABEL);

/** `n piece(s)`, as the pages count things. */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The card for one record, or the page's 404 when there is none. */
export function shareImage(card: ShareCard | null | undefined) {
  if (!card) notFound();
  return renderEntityCard({ title: card.title, type: card.type, facts: (card.facts ?? []).filter((f): f is string => Boolean(f)), installs: null });
}
