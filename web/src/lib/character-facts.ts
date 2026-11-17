import { z } from "zod";
import type { CollectionsData, RaidsData, Section, ShowcaseInput } from "./character-showcase";
import type { StoredFact } from "./private-sync-store";

/**
 * A linked character's synced facts (private sync, showcase plan S5 and S6) as the showcase's own sections. Pure:
 * the reads happen in the page (character-view.ts) and the owner's preview, which pass the facts and the names in.
 * A category with no fact adds nothing, so its section stays `empty`; nothing is estimated and nothing is a zero
 * in place of a missing value. A stored shape this file does not know is left out the same way.
 */

/** What the facts are named with, read only for the categories a page has. */
export interface FactNames {
  /** The completion catalog entries 3 installs agree on; null when it could not be read. */
  catalog: { titles: ReadonlyMap<number, { name: string }> } | null;
}

/** The sections the facts fill. Gear, stats, talents, PvP, professions and reputations come from the armory now. */
export interface FactSections {
  raids?: Section<RaidsData>;
  collections?: Section<CollectionsData>;
}

// The stored shapes, as private-sync.ts builds them. Read back defensively: a row of any other shape is left out.
const raidData = z.object({
  lockouts: z.array(z.object({
    instance: z.string().min(1), difficulty: z.string().nullable(), killed: z.number().int().min(0), total: z.number().int().min(1), resetAt: z.string().datetime({ offset: true }),
  })),
});
const titleData = z.object({ titleIds: z.array(z.number().int()) });

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const shown = <T>(fact: StoredFact, data: T): Section<T> => ({ state: "shown", asOf: day(fact.capturedAt), data });

export function factSections(facts: readonly StoredFact[], names: FactNames, now: Date): FactSections {
  const out: FactSections = {};
  for (const fact of facts) {
    switch (fact.category) {
      case "raids": {
        const d = raidData.safeParse(fact.data);
        if (!d.success) break;
        // A lockout that has reset since the capture is gone this week.
        const live = d.data.lockouts.filter((l) => Date.parse(l.resetAt) > now.getTime());
        out.raids = shown(fact, {
          lockouts: live.map((l) => ({ instance: l.instance, difficulty: l.difficulty ?? "Raid", killed: l.killed, total: l.total, resets: day(l.resetAt), bosses: [] })),
          guildKills: null,
        });
        break;
      }
      case "achievements": {
        const d = titleData.safeParse(fact.data);
        const catalog = names.catalog;
        if (!d.success || !catalog) break;
        out.collections = shown(fact, {
          // Earned achievements come from Blizzard's API through the armory part of the page, not from sync.
          achievements: null, points: null,
          titles: d.data.titleIds.flatMap((id) => { const t = catalog.titles.get(id); return t ? [t.name] : []; }).sort((a, b) => a.localeCompare(b)),
          recent: [], categories: [], quests: null,
        });
        break;
      }
    }
  }
  return out;
}

/**
 * The page's input with the facts' sections in place. The header's date becomes the newest of the link's last upload
 * and the facts' captures.
 */
export function withFacts(input: ShowcaseInput, sections: FactSections): ShowcaseInput {
  const out: ShowcaseInput = { ...input };
  const dates = [input.lastUpload];
  for (const key of ["raids", "collections"] as const) {
    const s = sections[key];
    if (!s) continue;
    (out as unknown as Record<string, unknown>)[key] = s;
    if (s.state === "shown") dates.push(s.asOf);
  }
  out.lastUpload = dates.reduce((a, b) => (b > a ? b : a));
  return out;
}
