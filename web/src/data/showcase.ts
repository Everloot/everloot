import type { ShowcaseInput } from "@/lib/character-showcase";

/** Said at the top of every sample page (character profile design, 2026-10-24). */
export const SAMPLE_NOTE = "Sample data. Everything on this page is made up to show the shape; real character pages fill from players' own addon uploads after launch.";

/** The sample's dates: a fixed number of days before the visit, so the sample never goes stale. */
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * The sample character for /showcase/character (character profile design, 2026-10-24): Examplechar of Sampleguild
 * on the realm Showcase. Everything here is made up to show the page's shape, and the names say so. The item ids
 * are real items from the committed client layer so the links open a database page; the item levels, ranks and
 * counts are made up. The talents are older than two weeks and the raids have nothing synced, so the sample shows
 * those states too.
 */
export function sampleShowcase(now: Date): ShowcaseInput {
  const recent = daysBefore(now, 1);
  return {
    sample: true,
    path: "/showcase/character",
    name: "Examplechar",
    level: 60,
    race: "Orc",
    class: "SHAMAN",
    faction: "Horde",
    realm: "Showcase",
    guild: { name: "Sampleguild", path: null },
    lastUpload: recent,
    gear: {
      state: "shown",
      asOf: recent,
      data: [
        { slot: "Head", itemId: 1282, name: null, itemLevel: 60 },
        { slot: "Shoulder", itemId: 3480, name: null, itemLevel: 58 },
        { slot: "Chest", itemId: 1273, name: null, itemLevel: 60 },
        { slot: "Waist", itemId: 2546, name: null, itemLevel: 56 },
        { slot: "Legs", itemId: 2545, name: null, itemLevel: 60 },
        { slot: "Feet", itemId: 2037, name: null, itemLevel: 56 },
        { slot: "Wrist", itemId: 2854, name: null, itemLevel: 54 },
        { slot: "Hands", itemId: 1303, name: null, itemLevel: 58 },
        { slot: "Main hand", itemId: 864, name: null, itemLevel: 60 },
        { slot: "Off hand", itemId: 1276, name: null, itemLevel: 58 },
      ],
    },
    talents: {
      state: "shown",
      asOf: daysBefore(now, 20),
      data: { trees: [{ name: "Elemental Combat", points: 0 }, { name: "Enhancement", points: 30 }, { name: "Restoration", points: 21 }], code: null, planned: [] },
    },
    professions: { state: "shown", asOf: recent, data: [{ name: "Mining", rank: 300, maxRank: 300 }, { name: "Blacksmithing", rank: 280, maxRank: 300 }] },
    reputations: {
      state: "shown",
      asOf: recent,
      data: [
        { faction: "Sample Faction", standing: "Honored", value: 6000, max: 12000 },
        { faction: "Sample Renown", renown: true },
      ],
    },
    raids: { state: "empty" },
    collections: { state: "shown", asOf: recent, data: { achievements: 40, points: 400, titles: ["Sample Title"] } },
  };
}
