import racesJson from "../../web/src/data/game-data/races.json" with { type: "json" };
import { RaceTable } from "./client-races.js";

/** The committed race table, validated once at load. The class_races tool and the class pages read the same file. */
export const RACE_TABLE: RaceTable = RaceTable.parse(racesJson);
