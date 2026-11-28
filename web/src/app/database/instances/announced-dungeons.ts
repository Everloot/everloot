// Blizzard's October 20 dungeon overview, also recorded in kb/curated/blue-writeups/us-30550244.md.
// These are the publisher's advertised level bands and regions. Instance identities and entrances
// still come from the public database rows, so an announcement cannot create a map pin or instance URL.
export const ANNOUNCEMENT = "https://worldofwarcraft.blizzard.com/en-us/news/24301455/explore-the-new-dungeons-of-world-of-warcraft-forever";

interface AnnouncedDungeon {
  name: string;
  alias?: string;
  level: { min: number; max: number };
  zone: { name: string; mapId?: number };
}

export const ANNOUNCED_DUNGEONS: readonly AnnouncedDungeon[] = [
  { name: "Hall of Thanes", alias: "The Hall of Thanes", level: { min: 13, max: 18 }, zone: { name: "Dun Morogh", mapId: 1426 } },
  { name: "Ruins of Lordaeron", level: { min: 15, max: 20 }, zone: { name: "Tirisfal Glades", mapId: 1420 } },
  { name: "Excavation Site", alias: "Excavation Site: Wetlands", level: { min: 24, max: 29 }, zone: { name: "Wetlands", mapId: 1437 } },
  { name: "City of Dalaran", level: { min: 28, max: 33 }, zone: { name: "Alterac Mountains", mapId: 1416 } },
  { name: "The Drowned City", level: { min: 35, max: 40 }, zone: { name: "Stranglethorn Vale", mapId: 1434 } },
  { name: "Krol’dok Stronghold", level: { min: 40, max: 45 }, zone: { name: "Riverglades" } },
  { name: "Alcaz Prison", level: { min: 48, max: 53 }, zone: { name: "Dustwallow Marsh", mapId: 1445 } },
  { name: "Blackmaw Hold", level: { min: 55, max: 60 }, zone: { name: "Azshara", mapId: 1447 } },
  { name: "Shaper’s Terrace", alias: "The Shaper’s Terrace", level: { min: 58, max: 60 }, zone: { name: "Un'Goro Crater", mapId: 1449 } },
];
