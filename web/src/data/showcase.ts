import { CLIENT_TAXONOMY } from "@/lib/items";
import type { GearRow, GearSlot, ShowcaseInput } from "@/lib/character-showcase";

/** Said at the top of every sample page (character profile design, 2026-10-24). */
export const SAMPLE_NOTE = "Sample data. Everything on this page is made up to show the shape; real character pages fill from players' own addon uploads after launch.";

/** The sample's dates: a fixed number of days before the visit, so the sample never goes stale. */
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
/** The next Tuesday after the visit, the sample's raid reset. */
const nextTuesday = (now: Date) => daysBefore(now, -(((2 - now.getUTCDay() + 7) % 7) || 7));

let qualities: Map<number, number | null> | null = null;
/** The quality the committed game files give an item, as the search results colour it; null for an id not in the build. */
function fileQuality(itemId: number): number | null {
  qualities ??= new Map(CLIENT_TAXONOMY.items.map((r) => [r[0], r[4]]));
  return qualities.get(itemId) ?? null;
}

/** Real item ids from the committed client layer, so the links open a database page; the item levels are made up. */
const GEAR: [GearSlot, number, number][] = [
  ["head", 1282, 60], ["neck", 4112, 58], ["shoulders", 3480, 58], ["back", 1270, 56], ["chest", 1273, 60], ["wrists", 2854, 54],
  ["hands", 1303, 58], ["waist", 2546, 56], ["legs", 2545, 60], ["feet", 2037, 56], ["finger1", 1077, 56], ["finger2", 1116, 54],
  ["trinket1", 1444, 60], ["trinket2", 744, 52], ["mainHand", 864, 60], ["offHand", 1276, 58],
];

/** Molten Core's bosses as the committed encounter list names them; the sample has killed the first six. */
const MOLTEN_CORE = ["Lucifron", "Magmadar", "Gehennas", "Garr", "Shazzrah", "Baron Geddon", "Sulfuron Harbinger", "Golemagg the Incinerator", "Majordomo Executus", "Ragnaros"];

/**
 * The sample character for /showcase/character (character profile design, 2026-10-24): Examplechar of Sampleguild
 * on the realm Showcase. Everything here is made up to show the page's shape, and the names say so: factions,
 * achievements and titles are "Sample ...". Item ids and boss names are real game data so links and strips read
 * true; item levels, stats, ranks and counts are made-up round numbers. The shirt, tabard and ranged slots are
 * empty, the talents are older than two weeks, and mounts and pets are unsupported, so the sample shows those
 * states too.
 */
export function sampleShowcase(now: Date): ShowcaseInput {
  const recent = daysBefore(now, 1);
  const gear: GearRow[] = GEAR.map(([slot, itemId, itemLevel]) => ({ slot, itemId, name: null, quality: fileQuality(itemId), itemLevel }));
  return {
    sample: true,
    path: "/showcase/character",
    name: "Examplechar",
    title: "Sample Title",
    level: 60,
    race: "Orc",
    class: "SHAMAN",
    faction: "Horde",
    realm: "Showcase",
    guild: { name: "Sampleguild", path: null },
    lastUpload: recent,
    gear: { state: "shown", asOf: recent, data: gear },
    stats: {
      state: "shown",
      asOf: recent,
      data: [
        { group: "Attributes", stats: [{ label: "Strength", value: "200" }, { label: "Agility", value: "100" }, { label: "Stamina", value: "250" }, { label: "Intellect", value: "150" }, { label: "Spirit", value: "100" }] },
        { group: "Melee", stats: [{ label: "Attack power", value: "800" }, { label: "Hit", value: "5%" }, { label: "Critical strike", value: "10%" }] },
        { group: "Ranged", stats: [{ label: "Attack power", value: "100" }, { label: "Hit", value: "0%" }, { label: "Critical strike", value: "5%" }] },
        { group: "Spell", stats: [{ label: "Bonus damage", value: "50" }, { label: "Bonus healing", value: "100" }, { label: "Critical strike", value: "5%" }, { label: "Mana every 5 seconds", value: "20" }] },
        { group: "Defense", stats: [{ label: "Armor", value: "4000" }, { label: "Defense", value: "300" }, { label: "Dodge", value: "5%" }, { label: "Parry", value: "5%" }, { label: "Block", value: "10%" }] },
      ],
    },
    talents: {
      state: "shown",
      asOf: daysBefore(now, 20),
      data: { trees: [{ name: "Elemental Combat", points: 0 }, { name: "Enhancement", points: 30 }, { name: "Restoration", points: 21 }], code: null, planned: [] },
    },
    pvp: { state: "shown", asOf: recent, data: { rank: 6, rankPoints: 9000, rankThreshold: 12000, rankMax: 14, season: null, honorableKills: 1500 } },
    raids: {
      state: "shown",
      asOf: recent,
      data: {
        lockouts: [{
          instance: "Molten Core", difficulty: "40 player", killed: 6, total: 10, resets: nextTuesday(now),
          bosses: MOLTEN_CORE.map((name, i) => ({ name, killed: i < 6 })),
        }],
        guildKills: [{ instance: "Molten Core", killed: 8, total: 10 }, { instance: "Onyxia's Lair", killed: 1, total: 1 }],
      },
    },
    collections: {
      state: "shown",
      asOf: recent,
      data: {
        achievements: 40,
        points: 400,
        recent: [
          { name: "Sample Achievement One", date: daysBefore(now, 1) },
          { name: "Sample Achievement Two", date: daysBefore(now, 3) },
          { name: "Sample Achievement Three", date: daysBefore(now, 6) },
        ],
        categories: [
          { name: "Quests", done: 10, total: 20 },
          { name: "Exploration", done: 10, total: 40 },
          { name: "Dungeons and raids", done: 10, total: 50 },
          { name: "Professions", done: 5, total: 20 },
          { name: "Reputation", done: 5, total: 20 },
        ],
        titles: ["Sample Title", "Sample Second Title"],
        quests: 500,
      },
    },
    reputations: {
      state: "shown",
      asOf: recent,
      data: [
        { faction: "Sample Faction A", standing: "Exalted", value: 999, max: 1000 },
        { faction: "Sample Faction B", standing: "Revered", value: 10000, max: 21000 },
        { faction: "Sample Faction C", standing: "Honored", value: 6000, max: 12000 },
        { faction: "Sample Faction D", standing: "Honored", value: 3000, max: 12000 },
        { faction: "Sample Faction E", standing: "Friendly", value: 1500, max: 6000 },
        { faction: "Sample Renown", renown: true },
      ],
    },
    professions: { state: "shown", asOf: recent, data: [{ name: "Mining", rank: 300, maxRank: 300 }, { name: "Blacksmithing", rank: 280, maxRank: 300 }, { name: "First Aid", rank: 225, maxRank: 300 }] },
  };
}
