// The game-data files' facts for answer_sources, built once from the site's own committed files (the same
// imports the pages read) and lent to the MCP mounts and GET /api/tools. Ids and facts only; see
// kb/src/files-evidence.ts and docs/DATA_POLICY.md.
import mapJson from "@/data/game-data/map.json";
import achievementsJson from "@/data/game-data/client-achievements.json";
import encountersJson from "@/data/game-data/client-encounters.json";
import mountsJson from "@/data/game-data/client-mounts.json";
import druid from "@/data/game-data/talents/druid.json";
import hunter from "@/data/game-data/talents/hunter.json";
import mage from "@/data/game-data/talents/mage.json";
import paladin from "@/data/game-data/talents/paladin.json";
import priest from "@/data/game-data/talents/priest.json";
import rogue from "@/data/game-data/talents/rogue.json";
import shaman from "@/data/game-data/talents/shaman.json";
import warlock from "@/data/game-data/talents/warlock.json";
import warrior from "@/data/game-data/talents/warrior.json";
import { buildFilesIndex, type FilesIndex } from "../../../kb/src/files-evidence";

let index: FilesIndex | null = null;

/** The index, built on first use and kept for the process. */
export function filesIndex(): FilesIndex {
  index ??= buildFilesIndex({
    map: mapJson, encounters: encountersJson, mounts: mountsJson, achievements: achievementsJson,
    talents: { druid, hunter, mage, paladin, priest, rogue, shaman, warlock, warrior },
  });
  return index;
}
