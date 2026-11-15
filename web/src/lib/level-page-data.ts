import { cache } from "react";
import { instanceHref, instanceRows, instanceTitle } from "./instances";
import { TALENT_CLASSES, loadCatalog } from "./talents/catalogs";
import { buildLevelUnlocks, LEVELS, type LevelData } from "./level-unlocks";

/** Build-time inputs only: no uploads, corpus replay or network reads. Never call loadSightings here. */
export const loadLevelData = cache(async (): Promise<LevelData> => ({
  classes: await Promise.all(TALENT_CLASSES.map(async (slug) => {
    const catalog = await loadCatalog(slug);
    return { slug, name: catalog.className, pointLevels: catalog.rules.pointLevels ?? [] };
  })),
  // client-class-spells contains ids, not learn levels or trainer offerings. See the class source audit.
  spells: null,
  // Released zones in map.json have bounds, but no supported level range.
  zones: null,
  // Use the same released-entrance and range rules as the database, with game files alone.
  instances: [...instanceRows().values()].map((row) => ({
    name: instanceTitle(row), href: instanceHref(row.instanceMapId, row.name),
    min: row.level?.min ?? null, max: row.level?.max ?? null, raid: row.raid,
  })),
  // Profession skill requirements are not character-level unlocks; riding levels are not recorded here.
  trainers: null,
}));

// Route handlers do not share React's render cache. Keep this immutable file-derived list per module instance.
let sitemapPaths: Promise<string[]> | undefined;
export function levelSitemapPaths(): Promise<string[]> {
  return sitemapPaths ??= loadLevelData().then((data) =>
    LEVELS.filter((n) => buildLevelUnlocks(data, n).hasData).map((n) => `/tools/level/${n}`));
}
