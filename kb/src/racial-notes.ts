import type { RaceTable, RaceTrait } from "./client-races.js";

/**
 * Blizzard's final racial pass for WoW: Forever, from its beta development notes (updated 26 October). The game
 * files (races.json) still carry the earlier traits, so each change here replaces the files' trait by name, in
 * the files' slot. Descriptions are Everloot's words for what the notes say, not game text. Only what the notes
 * change is here; a change that the files' short text does not mention (a cooldown it never states) is left out.
 */
export const RACIAL_NOTES = {
  sourceName: "Blizzard forums",
  sourceTitle: "WoW Forever Beta Development Notes – Updated 26 October",
  sourceUrl: "https://eu.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-26-october/631316/7",
  published: "2026-10-26",
} as const;

type Change = { race: string; trait: string; name?: string; description: string };

/** `race` is the files' race name; both Skyborne races share the Skyborne notes. */
const CHANGES: readonly Change[] = [
  { race: "Human", trait: "Ruthless", description: "Increases spell and ability critical chance by 1%" },
  { race: "Human", trait: "The Human Spirit", description: "10% increased Spirit" },
  { race: "Dwarf", trait: "Earth Fury", name: "Artisan's Precision", description: "Increases hit chance with spells and attacks by 1%" },
  { race: "Tauren", trait: "Plainsrunning", description: "Gain 2% movement speed per stack the longer you stay moving, up to 60%. No longer increases mounted speed" },
  { race: "Tauren", trait: "Endurance", description: "Total Health increased by 5%" },
  { race: "Orc", trait: "Savage", name: "Command", description: "Increases Warlock and Hunter pet damage by 5%" },
  { race: "Troll", trait: "Berserking", description: "Increases casting and attack speed by 10% for 15 sec" },
  ...["High Order Skyborne", "Windshaper Skyborne"].map((race) => ({ race, trait: "Wind Blessed", description: "2% increased melee, ranged, and spellcasting Haste" })),
  { race: "High Order Skyborne", trait: "Read Leyline", description: "Increases Health and Mana regeneration by 50% for 15 sec. Used at a Ley Line, also grants Attuned for 1 hour, raising it to 100%" },
  { race: "Windshaper Skyborne", trait: "Skysight", description: "Increases run speed by 15% for 15 sec. Used at an elemental convergence, also grants Charged for 1 hour, raising it to 30%" },
];

/** A trait after the notes; `fromNotes` marks one the notes changed. */
export type NotedTrait = RaceTrait & { fromNotes?: true };

/** The files' table with the notes' changes applied. A change whose trait the files no longer hold is skipped. */
export function withRacialNotes(table: RaceTable): RaceTable & { races: (RaceTable["races"][number] & { traits: NotedTrait[] })[] } {
  return {
    ...table,
    races: table.races.map((r) => ({
      ...r,
      traits: r.traits.map((t): NotedTrait => {
        const c = CHANGES.find((x) => x.race === r.name && x.trait === t.name);
        return c ? { ...t, name: c.name ?? t.name, description: c.description, fromNotes: true } : t;
      }),
    })),
  };
}
