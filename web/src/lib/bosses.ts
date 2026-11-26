import { slugify } from "@kb/lore-slug";
import { bossRows, instanceRows, type BossRow, type InstanceRow } from "./instances";

/**
 * The boss pages: one per encounter of a dungeon or raid the site lists (lib/instances.ts `instanceRows`), by the
 * encounter id the game files and ENCOUNTER_END share. The rows are the instance page's boss table (`bossRows`),
 * player-first, so a boss page and its instance's Bosses tab never disagree; an instance the site does not list (known
 * only from a held-back zone) gives no boss page, as it gives no instance page. Names are the files' unless 3 installs
 * agree on one; kills, creatures and dates come from player reports.
 */
export const BOSSES_PATH = "/database/bosses";

/** `2732-oggleflint`: the encounter id, then the name's words, as the instance pages build theirs. */
export function bossHref(id: number, name: string | null): string {
  const words = name ? slugify(name) : "";
  return `${BOSSES_PATH}/${words ? `${id}-${words}` : id}`;
}

export interface BossEntry {
  id: number;
  /** The name the page shows: 3 installs' or the files', else "Encounter N". */
  name: string;
  /** True when the name is the files', not one 3 installs agreed on. */
  filesName: boolean;
  row: BossRow;
  instance: InstanceRow;
  /** Its place in the files' encounter list (1 first), or null for an encounter only players report. */
  order: number | null;
  /** How many encounters the files list for its instance. */
  total: number;
  /** The difficulty the files bind the encounter to, or null when they bind it to none. */
  difficultyId: number | null;
}

/** The bosses of these instance rows, instance by instance, each in its boss table's order. */
export function bossEntries(rows: ReadonlyMap<number, InstanceRow> = filesRows()): BossEntry[] {
  return [...rows.values()].flatMap((instance) => bossRows(instance).map((row): BossEntry => {
    const index = instance.encounters.findIndex((e) => e.id === row.encounterId);
    return {
      id: row.encounterId, name: row.name ?? `Encounter ${row.encounterId}`, filesName: row.filesName, row, instance,
      order: index < 0 ? null : index + 1, total: instance.encounters.length,
      difficultyId: instance.encounters[index]?.difficultyId ?? null,
    };
  }));
}

let files: ReadonlyMap<number, InstanceRow> | null = null;
/** The instance rows from the game files alone, read once: the list search, the sitemap and the cards share. */
function filesRows(): ReadonlyMap<number, InstanceRow> {
  return (files ??= instanceRows());
}

export const bossEntry = (id: number, rows?: ReadonlyMap<number, InstanceRow>): BossEntry | undefined => bossEntries(rows).find((b) => b.id === id);

/** The bosses 3 installs tie this creature to, for its NPC page. */
export const bossesOfNpc = (npcId: number, rows: ReadonlyMap<number, InstanceRow>): BossEntry[] =>
  bossEntries(rows).filter((b) => b.row.boss?.npcIds.includes(npcId));
