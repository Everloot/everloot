/** The addon's classification table, from Forever's own game-file extract. Ids and numbers only. */
export function disenchantLua(table: { bands: number[][]; noDisenchant: number[] }): string {
  return "-- Forever game-file bands; found in game files, unconfirmed. Regenerate with web/scripts/build-disenchant-data.ts.\n"
    + "local E = Everloot\nE.DISENCHANT_BANDS = {\n"
    + table.bands.map((b) => `  { ${b.join(", ")} },`).join("\n")
    + "\n}\nE.NO_DISENCHANT = {\n"
    + table.noDisenchant.map((id) => `  [${id}] = true,`).join("\n") + "\n}\n";
}
