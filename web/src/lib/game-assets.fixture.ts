// Test data for the site-wide game art, in the shape `npm run kb -- client-assets` writes: the public
// manifest, and the private folder's item index and one item shard. Invented values. Used by
// game-assets.test.ts and the page tests; never by a page.

const pic = (name: string) => ({ file: `maps/${name}.webp`, width: 1002, height: 668, small: { file: `maps/${name}-small.webp`, width: 320, height: 213 } });
const rect = (top: number, bottom: number, left: number, right: number) => ({ left, top, right, bottom });

export const siteManifest = {
  schema: "everloot.game-assets/1",
  label: "found in game files, unconfirmed",
  build: { product: "wow_classic_beta", buildId: 70450, version: "1.60.1.70450", buildConfig: "b".repeat(32), extractedAt: "2026-10-18T00:00:00.000Z" },
  spells: {}, frames: {}, backgrounds: {}, counts: {}, missingFrames: [],
  classes: {
    warrior: { classId: 1, name: "Warrior", icon: "6001.webp", trees: [{ name: "Fury", icon: "6003.webp" }, { name: "Arms", icon: "6002.webp" }, { name: "Protection", icon: null }] },
    mage: { classId: 8, name: "Mage", icon: null, trees: [] },
  },
  professions: { alchemy: { skillLineId: 171, name: "Alchemy", icon: "7001.webp" }, riding: { skillLineId: 762, name: "Riding", icon: "7002.webp" }, cooking: { skillLineId: 185, name: "Cooking", icon: null } },
  spellIcons: { "6673": "8001.webp" },
  maps: {
    "13": { ...pic("13"), kind: "continent", name: "Eastern Kingdoms", continentId: 0, heldBack: false, rect: rect(4000, -4000, 4000, -4000) },
    "1429": { ...pic("1429"), kind: "zone", name: "Elwynn Forest", continentId: 0, heldBack: false, rect: rect(500, -500, 1000, 0) },
    "1426": { ...pic("1426"), kind: "zone", name: "Dun Morogh", continentId: 0, heldBack: false, rect: rect(-3000, -3500, -3000, -3500) },
    "2548": { ...pic("2548"), kind: "zone", name: "Riverglades", continentId: 0, heldBack: true, rect: rect(3000, 2000, 3000, 2000) },
  },
  spellTips: { "6673": { name: "Battle Shout", description: { text: "Raises attack power by 20 for 2 min.", unresolved: [] } } },
  loadingScreens: {
    "0": loading(9000, "continent", "Eastern Kingdoms", false),
    "1": loading(9001, "continent", "Kalimdor", false),
    "36": loading(9036, "dungeon", "Deadmines", false),
    "189": loading(9189, "dungeon", "Scarlet Monastery", false),
    "249": loading(9249, "raid", "Onyxia's Lair", false),
    "409": loading(9409, "raid", "Molten Core", false),
    "2789": loading(9789, "raid", "The Tainted Scar", true),
  },
  races: {
    human: { name: "Human", female: emblem("raceicon128-human-female"), male: emblem("raceicon128-human-male") },
    "night elf": { name: "Night Elf", female: null, male: emblem("raceicon128-nightelf-male") },
  },
  factions: { alliance: emblem("AllianceEmblem"), horde: emblem("HordeEmblem") },
  // The map legend's icons: a build that has pieces for two categories, none for the rest.
  poi: { dungeon: { file: "poi/Dungeon.webp", width: 50, height: 50 }, flight: { file: "poi/TaxiNode_Neutral.webp", width: 32, height: 32 } },
  logo: { file: "logo/logo-wow-forever-2x.webp", width: 640, height: 640, element: "logo-wow-forever-2x", fileDataId: 7312237 },
};

function loading(file: number, kind: string, name: string, heldBack: boolean) {
  return { file: `loading/${file}.webp`, width: 1600, height: 900, small: { file: `loading/${file}-small.webp`, width: 640, height: 360 }, kind, name, heldBack, loadingScreenId: file };
}
function emblem(element: string) {
  return { file: `emblems/${element}.webp`, width: 128, height: 128 };
}

export const itemIndex = {
  schema: "everloot.game-items/1",
  label: "found in game files, unconfirmed",
  build: { product: "wow_classic_beta", buildId: 70450, version: "1.60.1.70450", buildConfig: "b".repeat(32) },
  shardSize: 512, count: 2,
  shards: { "0": { file: "items/0.json", bytes: 1, sha256: "0".repeat(64) } },
};

export const shard0 = {
  "9": { n: "Linen Cloth", q: 1, l: 5, r: 0, b: 0, s: 0, c: 7, sc: 5, d: 0, st: [], sp: 13, u: 0, i: 132889, cr: [], rq: [], fx: [] },
  "25": { n: "Worn Shortsword", q: 3, l: 2, r: 5, b: 2, s: 13, c: 2, sc: 7, d: 1900, st: [7, 4], sp: 7, u: 1, t: "Old.", cr: [], rq: [], fx: [] },
};

/** A private bucket in memory: path -> JSON. Records what was asked for. */
export function memoryStore(files: Record<string, unknown>) {
  const reads: string[] = [];
  return { reads, read: async (path: string) => { reads.push(path); return files[path] ?? null; } };
}
