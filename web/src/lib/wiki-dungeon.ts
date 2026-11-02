/**
 * What a dungeon or raid wiki page shows beside its text, read through its entrance binding from the instance rows the
 * database pages show (lib/instances), so the wiki, the instance page and the map never disagree and each fact keeps its
 * own gate. The level and entrance the game files give are unconfirmed; an entrance or a boss players report is listed
 * once 3 installs agree, with how many and when last. What no source gives is left out, never shown as zero.
 */
import { slugify } from "../../../kb/src/lore-slug";
import type { PageType } from "../../../kb/src/wiki/page";
import type { WorldMapData } from "../../../kb/src/world-map-data";
import { instanceHref, instanceRows, levelLabel, loadSightings, type InstanceRow } from "./instances";
import { loadWiki, publishedPages, type WikiPage } from "./wiki";
import { WORLD_MAP } from "./world-map";
import type { ZoneSightings } from "./zones";

/** The page types that show their instance's facts where the other types keep placeholders. */
export const isDungeonType = (type: PageType): boolean => type === "dungeon" || type === "raid";

export interface DungeonFacts {
  /** The instance's row, as its database page has it. */
  row: InstanceRow;
  /** The level exactly as the game files give it: "16" for one level, a range only when they give one, null for none. */
  level: string | null;
  /** The instance's database page. */
  href: string;
  /** Storage did not answer: what players reported is unknown, not none, and the row holds only the game files' facts. */
  unreachable: boolean;
}

/** The instance a dungeon or raid page's entrance binding names: the game files' entrance with that name slug, or null. */
export function boundInstance(page: Pick<WikiPage, "type" | "binds">, data: Pick<WorldMapData, "entrances"> = WORLD_MAP): number | null {
  const { entrance } = page.binds;
  if (!isDungeonType(page.type) || typeof entrance !== "string") return null;
  return data.entrances.find((e) => slugify(e.name) === entrance)?.mapId ?? null;
}

/**
 * The facts of the instance a page binds, or null: for another type, an unbound page, an entrance the game files do not
 * have, or an instance the site does not list (its entrance in a held-back zone and nobody has confirmed it).
 */
export function dungeonFacts(
  page: Pick<WikiPage, "type" | "binds">,
  seen: ZoneSightings & { unreachable?: boolean },
  data: Pick<WorldMapData, "zones" | "continents" | "entrances"> = WORLD_MAP,
): DungeonFacts | null {
  const id = boundInstance(page, data);
  if (id === null) return null;
  const unreachable = seen.unreachable === true;
  const row = instanceRows(unreachable ? {} : seen, data).get(id);
  return row ? { row, level: levelLabel(row.level), href: instanceHref(row.instanceMapId, row.name), unreachable } : null;
}

/** `dungeonFacts` with players' reports from storage, which is read only for a page that can show facts. */
export async function loadDungeonFacts(page: Pick<WikiPage, "type" | "binds">): Promise<DungeonFacts | null> {
  if (boundInstance(page) === null) return null;
  return dungeonFacts(page, await loadSightings());
}

/**
 * The published dungeon or raid page that binds this instance, for the "Prepare" link on its database page. A draft gets
 * no link, and a wiki that cannot be read means no link, never a failed page.
 */
export function prepPage(instanceMapId: number, data: Pick<WorldMapData, "entrances"> = WORLD_MAP): WikiPage | null {
  try {
    return publishedPages(loadWiki()).find((p) => boundInstance(p, data) === instanceMapId) ?? null;
  } catch {
    return null;
  }
}
