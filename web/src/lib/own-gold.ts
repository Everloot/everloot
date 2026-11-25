import { z } from "zod";
import { ownArmoryLinks } from "./armory-links";
import { privateSyncOn } from "./private-sync";
import { ownCharacterFacts } from "./private-sync-store";

const Stats = z.record(z.string(), z.number().finite());

/**
 * The addon's gold statistics for each of the account's own links, keyed by the associated armory character's path.
 * Only while private sync is on, and only through the account's own links and consented facts. Null when it is off or
 * the read fails, so a page shows no gold rather than wrong gold. Shown to the owner only, never ranked.
 */
export async function ownGold(userId: string): Promise<Map<string, Record<string, number>> | null> {
  if (!privateSyncOn()) return null;
  try {
    const links = await ownArmoryLinks(userId);
    const gold = new Map<string, Record<string, number>>();
    await Promise.all([...links].map(async ([linkId, path]) => {
      const fact = (await ownCharacterFacts(userId, linkId)).find((c) => c.category === "gold" && c.consented)?.fact;
      const stats = Stats.safeParse(fact?.data.stats);
      if (stats.success) gold.set(path, stats.data);
    }));
    return gold;
  } catch {
    return null;
  }
}
