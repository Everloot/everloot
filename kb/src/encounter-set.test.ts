import { expect, test } from "vitest";
import encounters from "../../web/src/data/game-data/client-encounters.json";
import map from "../../web/src/data/game-data/map.json";
import { playableEncounters } from "./encounter-set.js";

const listed = (id: number) => {
  const list = encounters.instances[String(id) as keyof typeof encounters.instances] as { id: number; name: string; difficultyId?: number }[];
  return playableEncounters(list, map.entrances.find((e) => e.mapId === id)?.difficultyIds);
};

test("an instance lists the bosses of its first difficulty, not every difficulty's copy", () => {
  // Blackfathom Deeps: 21 rows across three difficulties; a player meets seven bosses, Aku'mai last.
  expect(listed(48).map((e) => e.name)).toEqual(["Ghamoo-ra", "Lady Sarevess", "Geilhast", "Lorgus Jett", "Old Serra'kis", "Twilight Lord Kelris", "Aku'mai"]);
  expect(listed(109)).toHaveLength(8);
  expect(new Set(listed(109).map((e) => e.name)).size).toBe(8);
  expect(listed(90).map((e) => e.name)).toEqual(["Grubbis", "Viscous Fallout", "Electrocutioner 6000", "Crowd Pummeler 9-60", "Mekgineer Thermaplugg"]);
  // A list with one set keeps it whole.
  expect(listed(36)).toHaveLength(8);
  expect(listed(230)).toHaveLength(21);
});

test("rows bound to no difficulty stay, and no difficulties keeps every row", () => {
  const rows = [{ id: 1 }, { id: 2, difficultyId: 1 }, { id: 3, difficultyId: 198 }];
  expect(playableEncounters(rows, [1, 198]).map((e) => e.id)).toEqual([1, 2]);
  expect(playableEncounters(rows, []).map((e) => e.id)).toEqual([1, 2, 3]);
});
