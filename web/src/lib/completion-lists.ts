import { agreedCatalog } from "../../../kb/src/completion-rollup";
import type { AchievementEntry, ChainEntry, FactionEntry, TitleEntry } from "../../../kb/src/completion";
import { slugify } from "../../../kb/src/lore-slug";
import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { CLIENT_FACTIONS } from "@/data/game-data/client-factions";
import { CLIENT_QUEST_LINES } from "@/data/game-data/client-quest-lines";
import { CLIENT_TITLES } from "@/data/game-data/client-titles";
import { uploadStore } from "./upload-store";

// The achievements, factions, titles and quest chains the database lists: the game files' entries (unconfirmed) merged with
// the completion rollup's agreed catalog (confirmed), the same three-reporter rule the collections tool and the MCP tool
// read (kb/src/completion-rollup.ts). The rollup's entry wins where both have an id. No owned progress is touched.

/**
 * An entry and whether player uploads confirm it (the rollup agrees on the same id); the rest come from the game files only.
 * `reporters` is how many installs back its best-supported version so far (3 or more once confirmed, 0 with no rollup), so a
 * page can draw the agreement meter short of three.
 */
export type Listed<T> = T & { confirmed: boolean; reporters: number };

/**
 * `base` says whether any game file was read, even one with no eligible entry. `confirmations` says whether the
 * rollup was read: when false, no entry is known to be confirmed or unconfirmed, so a list must say "unrecorded".
 */
export interface CompletionCatalog { achievements: Listed<AchievementEntry>[]; factions: Listed<FactionEntry>[]; titles: Listed<TitleEntry>[]; chains: Listed<ChainEntry>[]; dataAsOf: string | null; base: boolean; confirmations: boolean }

/** Whether a game-file wrapper could be read; a file that is there but holds no eligible entry still counts. */
function readable(file: () => unknown): boolean {
  try { return file() != null; } catch { return false; }
}

/** The game-file entries by id, each unconfirmed until the rollup says otherwise, and whether any file was read. */
function baseEntries() {
  const achievements = new Map<number, Listed<AchievementEntry>>();
  const factions = new Map<number, Listed<FactionEntry>>();
  const titles = new Map<number, Listed<TitleEntry>>();
  const chains = new Map<number, Listed<ChainEntry>>();
  const read = [
    readable(() => {
      for (const [id, a] of Object.entries(CLIENT_ACHIEVEMENTS.achievements)) {
        if (a.statistic) continue;
        achievements.set(Number(id), { achievementId: Number(id), name: a.title, category: "", points: a.points, criteriaCount: a.criteria.length, confirmed: false, reporters: 0 });
      }
      return CLIENT_ACHIEVEMENTS.achievements;
    }),
    readable(() => {
      for (const f of CLIENT_FACTIONS.factions) if (f.shown) factions.set(f.id, { factionId: f.id, name: f.name, header: undefined, major: false, confirmed: false, reporters: 0 });
      return CLIENT_FACTIONS.factions;
    }),
    readable(() => {
      for (const t of CLIENT_TITLES.titles) titles.set(t.id, { titleId: t.id, name: t.name, confirmed: false, reporters: 0 });
      return CLIENT_TITLES.titles;
    }),
    readable(() => {
      for (const c of CLIENT_QUEST_LINES.questLines) chains.set(c.id, { questLineId: c.id, name: c.name, questIds: c.questIds, truncated: false, confirmed: false, reporters: 0 });
      return CLIENT_QUEST_LINES.questLines;
    }),
  ];
  return { achievements, factions, titles, chains, available: read.some(Boolean) };
}

/** The installs behind the best-supported version of an id in a rollup bucket; 0 when none reported it. */
type Bucket = Record<string, { v: unknown[] }[]> | undefined;
const reporters = (bucket: Bucket, id: number): number => (bucket?.[String(id)] ?? []).reduce((n, v) => Math.max(n, v.v.length), 0);

/**
 * The rollup's agreed entries replace the base entries of the same id, marked confirmed; every entry carries how many
 * installs reported it so far.
 */
function merge<T>(base: Map<number, Listed<T>>, agreed: Map<number, T>, bucket: Bucket): Listed<T>[] {
  const out = new Map(base);
  for (const [id, entry] of agreed) out.set(id, { ...entry, confirmed: true, reporters: 0 });
  return [...out.values()].map((entry) => ({ ...entry, reporters: reporters(bucket, idOf(entry)) }));
}

/** The id an entry of any of the four kinds carries. */
const idOf = (e: object): number => (e as { achievementId?: number }).achievementId ?? (e as { factionId?: number }).factionId ?? (e as { titleId?: number }).titleId ?? (e as { questLineId: number }).questLineId;

/**
 * The lists the database shows: the game files' entries, unconfirmed, with the agreed rollup entries confirmed on top.
 * Null only when there is no game-file base and the rollup could not be read (unrecorded, not empty).
 */
export async function loadCatalog(): Promise<CompletionCatalog | null> {
  const base = baseEntries();
  const read = await uploadStore.loadCompletion();
  if (!read.state && !base.available) return null;
  const agreed = read.state ? agreedCatalog(read.state) : null;
  return {
    achievements: merge(base.achievements, agreed?.achievements ?? new Map(), read.state?.catalog.a),
    factions: merge(base.factions, agreed?.factions ?? new Map(), read.state?.catalog.f),
    titles: merge(base.titles, agreed?.titles ?? new Map(), read.state?.catalog.t),
    chains: merge(base.chains, agreed?.chains ?? new Map(), read.state?.catalog.q),
    dataAsOf: read.state ? read.dataAsOf : null,
    base: base.available,
    confirmations: read.state !== null,
  };
}

/** `4-ten-quests`: the id, then the name's words. A name with no letters or digits leaves the bare id. */
function segment(id: number, name: string): string {
  const words = slugify(name);
  return words ? `${id}-${words}` : String(id);
}
export const achievementHref = (id: number, name: string) => `/database/achievements/${segment(id, name)}`;
export const factionHref = (id: number, name: string) => `/database/factions/${segment(id, name)}`;
/** The `%s` in a game-file title name: where the game puts the character's name. */
const NAME_SLOT = /%s/g;
/** A title as the database shows it: `%s` becomes `<Name>`, as the game fills it with the character's name. */
export const titleDisplayName = (name: string) => name.replace(NAME_SLOT, "<Name>").trim();
/** The slug leaves the name slot out: `144-bloodsail-admiral`, not `144-bloodsail-admiral-s`. */
export const titleHref = (id: number, name: string) => `/database/titles/${segment(id, name.replace(NAME_SLOT, " "))}`;
export const chainHref = (id: number, name: string) => `/database/quest-chains/${segment(id, name)}`;

/**
 * What the game files say of a faction beyond its name: the parent they name for it, and whether they name it as
 * another faction's parent (a header of the reputation pane). Null when the file could not be read.
 */
export function factionInFiles(id: number): { parent: { id: number; name: string } | null; header: boolean } | null {
  let factions: typeof CLIENT_FACTIONS.factions;
  try { factions = CLIENT_FACTIONS.factions; } catch { return null; }
  const row = factions.find((f) => f.id === id);
  if (!row) return null;
  const parent = row.parentId === undefined ? undefined : factions.find((f) => f.id === row.parentId);
  return { parent: parent ? { id: parent.id, name: parent.name } : null, header: factions.some((f) => f.parentId === id) };
}

/** A header the files list without a standing of its own: no player reported one, so its page is noindex and out of the sitemap. */
export const factionHeaderOnly = (entry: Listed<FactionEntry>): boolean => !entry.confirmed && (factionInFiles(entry.factionId)?.header ?? false);

/** The id in an `<id>-<slug>` segment, or null when the segment does not start with one. */
export function parseSegment(value: string): number | null {
  const m = /^([1-9]\d{0,8})(?:-[a-z0-9-]*)?$/.exec(value);
  return m ? Number(m[1]) : null;
}
