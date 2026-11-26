import type { SiteAssets } from "./game-assets";

/**
 * The /database front door's grid: the entity types in three groups, each card with a one-line "what you'll find" and
 * an icon taken from the asset manifest the site already reads (a map pin, a class icon, a pet's own icon). A card
 * whose art the manifest lacks draws none. Hubs in DATABASE_HUBS that no card names (quest chains, terrain, the loot
 * and coverage pages, the download) stay linked under the grid, so a hub added later is never dropped.
 */
export interface DatabaseCard { href: string; label: string; note: string; icon: (a: SiteAssets) => string | null | undefined }
export interface DatabaseGroup { key: string; heading: string; cards: DatabaseCard[] }

/** The value under the smallest numeric key: a stable pick that does not move when the map gains entries. */
const lowest = (m: ReadonlyMap<number, string>) => [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k))[0];
const firstClass = (a: SiteAssets) => a.classes.values().next().value;

export const DATABASE_GROUPS: readonly DatabaseGroup[] = [
  {
    key: "world",
    heading: "World",
    cards: [
      { href: "/database/zones", label: "Zones", note: "Each zone's map, NPCs, quests and dungeons.", icon: (a) => a.poi.get("flight") },
      { href: "/database/instances", label: "Dungeons and raids", note: "Entrances, bosses and reported loot.", icon: (a) => a.poi.get("dungeon") },
      { href: "/database/bosses", label: "Bosses", note: "Every boss, its instance and its order.", icon: (a) => a.poi.get("raid") },
      { href: "/database/npcs", label: "NPCs", note: "Creatures and characters players have met.", icon: (a) => a.poi.get("trainer") },
      { href: "/database/objects", label: "Objects", note: "Chests, herbs and ore, and what they hold.", icon: (a) => a.poi.get("chest") },
      { href: "/database/vendors", label: "Vendors", note: "Who sells what, and where they stand.", icon: (a) => a.poi.get("service") },
      { href: "/database/quests", label: "Quests", note: "Quests players have picked up and turned in.", icon: (a) => a.poi.get("quest") },
    ],
  },
  {
    key: "items",
    heading: "Items and gear",
    cards: [
      { href: "/database/items", label: "Items", note: "Every item in the game files, by class and type.", icon: (a) => a.professions.get("blacksmithing")?.icon },
      { href: "/database/item-sets", label: "Item sets", note: "Sets, their pieces and their bonuses.", icon: (a) => a.professions.get("tailoring")?.icon },
      { href: "/database/mounts", label: "Mounts", note: "Mounts and the riding skill they need.", icon: (a) => a.professions.get("riding")?.icon },
      { href: "/database/pets", label: "Companion pets", note: "Pets and the spells that summon them.", icon: (a) => lowest(a.petIcons) },
      { href: "/database/toys", label: "Toys", note: "Toys and the items that teach them.", icon: (a) => a.professions.get("engineering")?.icon },
      { href: "/database/currencies", label: "Currencies", note: "Currencies, their categories and caps.", icon: (a) => lowest(a.currencyIcons) },
    ],
  },
  {
    key: "character",
    heading: "Character",
    cards: [
      { href: "/classes", label: "Classes", note: "Each class's talents, spells and guides.", icon: (a) => firstClass(a)?.icon },
      { href: "/tools/talents", label: "Talents", note: "Plan a build and share it.", icon: (a) => firstClass(a)?.trees[0]?.icon },
      { href: "/database/spells", label: "Spells", note: "Spells and abilities from the game files.", icon: (a) => lowest(a.spellIcons) },
      { href: "/database/achievements", label: "Achievements", note: "Achievements, their points and criteria.", icon: (a) => lowest(a.achievementIcons) },
      { href: "/database/titles", label: "Titles", note: "Titles a character can earn.", icon: (a) => a.races.get("human")?.male ?? null },
      { href: "/database/factions", label: "Factions", note: "Reputation factions and their groups.", icon: (a) => a.factions.get("alliance") },
      { href: "/database/holidays", label: "Holidays", note: "World events, when they start and how long they last.", icon: (a) => a.professions.get("cooking")?.icon },
      { href: "/database/pet-families", label: "Hunter pet families", note: "Families and the spells on their skill line.", icon: (a) => lowest(a.familyIcons) },
    ],
  },
];

/** Every href the grid links. */
export const GRID_HREFS: ReadonlySet<string> = new Set(DATABASE_GROUPS.flatMap((g) => g.cards.map((c) => c.href)));
