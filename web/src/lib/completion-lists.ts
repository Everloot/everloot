import { agreedCatalog } from "../../../kb/src/completion-rollup";
import type { AchievementEntry, ChainEntry, FactionEntry, TitleEntry } from "../../../kb/src/completion";
import { slugify } from "../../../kb/src/lore-slug";
import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { CLIENT_FACTIONS } from "@/data/game-data/client-factions";
import { CLIENT_QUEST_LINES } from "@/data/game-data/client-quest-lines";
import { CLIENT_TITLES } from "@/data/game-data/client-titles";
import { uploadStore } from "./upload-store";

// The achievements, factions, titles and quest chains the database lists: the completion rollup's agreed catalog, the same
// three-reporter rule the collections tool and the MCP tool read (kb/src/completion-rollup.ts). Nothing
// here is read from the game files and no owned progress is touched.

/** An entry and whether player uploads confirm it (the rollup agrees on the same id); the rest come from the game files only. */
export type Listed<T> = T & { confirmed: boolean };

/** `base` says whether any game-file entry was read. */
export interface CompletionCatalog { achievements: Listed<AchievementEntry>[]; factions: Listed<FactionEntry>[]; titles: Listed<TitleEntry>[]; chains: Listed<ChainEntry>[]; dataAsOf: string | null; base: boolean }

/** The game-file entries by id, each unconfirmed until the rollup says otherwise. */
function baseEntries() {
  const achievements = new Map<number, Listed<AchievementEntry>>();
  for (const [id, a] of Object.entries(CLIENT_ACHIEVEMENTS.achievements)) {
    if (a.statistic) continue;
    achievements.set(Number(id), { achievementId: Number(id), name: a.title, category: "", points: a.points, criteriaCount: a.criteria.length, confirmed: false });
  }
  const factions = new Map<number, Listed<FactionEntry>>();
  for (const f of CLIENT_FACTIONS.factions) if (f.shown) factions.set(f.id, { factionId: f.id, name: f.name, header: undefined, major: false, confirmed: false });
  const titles = new Map<number, Listed<TitleEntry>>();
  for (const t of CLIENT_TITLES.titles) titles.set(t.id, { titleId: t.id, name: t.name, confirmed: false });
  const chains = new Map<number, Listed<ChainEntry>>();
  for (const c of CLIENT_QUEST_LINES.questLines) chains.set(c.id, { questLineId: c.id, name: c.name, questIds: c.questIds, truncated: false, confirmed: false });
  return { achievements, factions, titles, chains };
}

/** The rollup's agreed entries replace the base entries of the same id, marked confirmed. */
function merge<T>(base: Map<number, Listed<T>>, agreed: Map<number, T>): Listed<T>[] {
  const out = new Map(base);
  for (const [id, entry] of agreed) out.set(id, { ...entry, confirmed: true });
  return [...out.values()];
}

/**
 * The lists the database shows: the game files' entries, unconfirmed, with the agreed rollup entries confirmed on top.
 * Null only when there is no game-file base and the rollup could not be read (unrecorded, not empty).
 */
export async function loadCatalog(): Promise<CompletionCatalog | null> {
  const base = baseEntries();
  const hasBase = base.achievements.size + base.factions.size + base.titles.size + base.chains.size > 0;
  const read = await uploadStore.loadCompletion();
  if (!read.state && !hasBase) return null;
  const agreed = read.state ? agreedCatalog(read.state) : null;
  return {
    achievements: merge(base.achievements, agreed?.achievements ?? new Map()),
    factions: merge(base.factions, agreed?.factions ?? new Map()),
    titles: merge(base.titles, agreed?.titles ?? new Map()),
    chains: merge(base.chains, agreed?.chains ?? new Map()),
    dataAsOf: read.state ? read.dataAsOf : null,
    base: hasBase,
  };
}

/** `4-ten-quests`: the id, then the name's words. A name with no letters or digits leaves the bare id. */
function segment(id: number, name: string): string {
  const words = slugify(name);
  return words ? `${id}-${words}` : String(id);
}
export const achievementHref = (id: number, name: string) => `/database/achievements/${segment(id, name)}`;
export const factionHref = (id: number, name: string) => `/database/factions/${segment(id, name)}`;
export const titleHref = (id: number, name: string) => `/database/titles/${segment(id, name)}`;
export const chainHref = (id: number, name: string) => `/database/quest-chains/${segment(id, name)}`;

/** The id in an `<id>-<slug>` segment, or null when the segment does not start with one. */
export function parseSegment(value: string): number | null {
  const m = /^([1-9]\d{0,8})(?:-[a-z0-9-]*)?$/.exec(value);
  return m ? Number(m[1]) : null;
}
