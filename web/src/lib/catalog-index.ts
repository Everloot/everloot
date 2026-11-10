// The game-file catalogs (achievements, factions, titles, quest lines, mounts, legacy perks, races, instances, zones) as the
// knowledge tools' search index, built once from the site's own committed files (the same imports the pages read) and
// lent to the MCP mounts and GET /api/tools. See kb/src/catalog-index.ts.
import achievementsJson from "@/data/game-data/client-achievements.json";
import encountersJson from "@/data/game-data/client-encounters.json";
import factionsJson from "@/data/game-data/client-factions.json";
import mountsJson from "@/data/game-data/client-mounts.json";
import titlesJson from "@/data/game-data/client-titles.json";
import questLinesJson from "@/data/game-data/client-quest-lines.json";
import legacyPerksJson from "@/data/game-data/legacy-perks.json";
import mapJson from "@/data/game-data/map.json";
import racesJson from "@/data/game-data/races.json";
import { buildCatalogIndex, WorldMapEntrances, type CatalogIndex } from "../../../kb/src/catalog-index";
import { ClientAchievements } from "../../../kb/src/client-achievements";
import { ClientEncounters } from "../../../kb/src/client-encounters";
import { ClientMounts } from "../../../kb/src/client-mounts";
import { ClientFactions } from "../../../kb/src/client-factions";
import { ClientQuestLines } from "../../../kb/src/client-quest-lines";
import { RaceTable } from "../../../kb/src/client-races";
import { ClientTitles } from "../../../kb/src/client-titles";
import { LegacyPerkCatalog } from "../../../kb/src/legacy-perks/catalog";

let index: CatalogIndex | null = null;
let failed = false;

/**
 * The index, built on first use and kept for the process. A file that does not parse leaves no index: the failure is
 * kept, so the files are not parsed again for every request, and said once; the tools then answer from the release alone.
 */
export function catalogIndex(): CatalogIndex | null {
  if (index || failed) return index;
  try {
    index = buildCatalogIndex({
      achievements: ClientAchievements.parse(achievementsJson),
      mounts: ClientMounts.parse(mountsJson),
      encounters: ClientEncounters.parse(encountersJson),
      map: WorldMapEntrances.parse(mapJson),
      // Parsed once here: the imports' schema fields are plain strings to the compiler.
      legacyPerks: LegacyPerkCatalog.parse(legacyPerksJson),
      races: RaceTable.parse(racesJson),
      factions: ClientFactions.parse(factionsJson),
      titles: ClientTitles.parse(titlesJson),
      questLines: ClientQuestLines.parse(questLinesJson),
    });
  } catch (error) {
    failed = true;
    console.warn(`The game-file catalog could not be built; the tools answer from the release alone: ${error instanceof Error ? error.message : String(error)}`);
  }
  return index;
}

/** For tests: forget the kept index and any kept failure. */
export function resetCatalogIndex(): void {
  index = null;
  failed = false;
}
