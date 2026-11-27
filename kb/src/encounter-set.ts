/**
 * The bosses a player meets in an instance, from the files' encounter list. DungeonEncounter keeps one row set per
 * difficulty: rows bound to no difficulty apply to every one, and rows bound to a difficulty apply only there. Blackfathom
 * Deeps carries its 5-player rows beside its 10-player raid rows (198) and an older 5-player set (201); Sunken Temple
 * carries a 20-player raid set (215) beside two 5-player sets. Counting them all lists Aku'mai three times.
 *
 * So the list is the rows bound to no difficulty, plus the rows bound to the instance's first difficulty (MapDifficulty,
 * in the files' order: "Normal" for every dungeon). An instance whose files give no difficulty keeps every row.
 */
export function playableEncounters<E extends { difficultyId?: number }>(list: readonly E[], difficultyIds: readonly number[] = []): E[] {
  const first = difficultyIds[0];
  if (first === undefined) return [...list];
  return list.filter((e) => e.difficultyId === undefined || e.difficultyId === first);
}
