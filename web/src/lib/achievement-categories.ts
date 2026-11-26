import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";

// The achievement categories as the game files nest them (`Achievement_Category`, found in game files, unconfirmed):
// the walk an achievement page and its hover card (lib/site-card.ts) both take, so the two never drift.

export interface CategoryStep { id: number; name: string }

/** The category and the ones above it, top first; empty for an id the files do not name. */
export function categoryPath(id: number | undefined): CategoryStep[] {
  const out: CategoryStep[] = [];
  const seen = new Set<number>();
  for (let at = id; at !== undefined && !seen.has(at); ) {
    seen.add(at);
    const c = CLIENT_ACHIEVEMENTS.categories?.[String(at)];
    if (!c) break;
    out.unshift({ id: at, name: c.name });
    at = c.parent;
  }
  return out;
}
