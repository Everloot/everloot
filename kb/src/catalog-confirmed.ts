import type { CompletionLoader } from "./mcp-server.js";

/** The catalog kinds the completion rollup can agree on, with the ids it agrees on. */
export interface ConfirmedIds {
  achievement: Set<number>;
  faction: Set<number>;
  title: Set<number>;
  quest_chain: Set<number>;
  asOf: string | null;
}

/**
 * The ids player uploads agree on (3 or more installs), read from the completion rollup.
 * Null when there is no loader, it fails, or it returns no state: the answer then stays unconfirmed.
 */
export async function confirmedCatalog(loader: CompletionLoader | undefined): Promise<ConfirmedIds | null> {
  if (!loader) return null;
  try {
    // Agreement is not per install; the loader's facts hold the agreed lists whichever install asks.
    const loaded = await loader("");
    if (!loaded) return null;
    const { achievements, factions, titles, chains } = loaded.facts;
    return {
      achievement: new Set(achievements.keys()),
      faction: new Set(factions.keys()),
      title: new Set(titles.keys()),
      quest_chain: new Set(chains.keys()),
      asOf: loaded.dataAsOf ? loaded.dataAsOf.slice(0, 10) : null,
    };
  } catch {
    return null;
  }
}

/** The confirmation sentence for a catalog entry the rollup agrees on, else null. */
export function confirmedLine(kind: string, extId: string, ids: ConfirmedIds): string | null {
  if (kind !== "achievement" && kind !== "faction" && kind !== "title" && kind !== "quest_chain") return null;
  if (!ids[kind].has(Number(extId))) return null;
  return `Confirmed by player uploads (3 or more installs agree) as of ${ids.asOf ?? "an unrecorded date"}.`;
}
