/**
 * Loading screens, race and faction emblems and the game's own logo, planned from the client's tables.
 * Pure: it reads table rows and says which file (or which piece of an atlas file) each picture is. The
 * fetching and converting are done by client-assets.ts and scripts/blp_convert.py.
 *
 * Tables, with column names from WoWDBDefs:
 * - Map: each game map's name, kind (InstanceType 0 world, 1 dungeon, 2 raid), the loading screen it
 *   shows (LoadingScreenID) and, for a dungeon or raid, where its entrance is (CorpseMapID, Corpse).
 * - LoadingScreens: the picture files of a loading screen. A newer row names one picture
 *   (MainImageFileDataID); an older one the classic 4:3 picture (NarrowScreenFileDataID), which is
 *   cut to the scene inside its frame (narrowCrop).
 * - ChrRaces: the race names the build has.
 * - UiTextureAtlasElement and UiTextureAtlasMember: the race icons (`raceicon128-<race>-<sex>`), the
 *   faction emblems and the game's logo are named pieces of interface atlas files, like the talent frame.
 */
import { placeUiMaps } from "../world-map-data.js";
import type { Rows, TableReader } from "../talents/build-catalog.js";

/**
 * Dungeon and raid maps of the original world have ids up to 533 (Naxxramas). Maps with later ids are
 * later additions that may not be released, so their loading screens show only behind the spoiler switch,
 * like the zones the map layer holds back.
 */
export const ORIGINAL_MAP_MAX = 533;

/**
 * The races Blizzard's race and class article lists for WoW: Forever (2026-09-22): the name the site
 * uses, the race's ChrRaces.ClientFileString, and the name in the client's race icons (the file string
 * in lower case, except Undead, whose file string is "Scourge"). The client holds icons for every race
 * of the modern game; only these are extracted, so the public manifest names no unannounced race.
 */
export const RACE_ATLAS: Record<string, { file: string; atlas: string }> = {
  Human: { file: "Human", atlas: "human" }, Dwarf: { file: "Dwarf", atlas: "dwarf" },
  "Night Elf": { file: "NightElf", atlas: "nightelf" }, Gnome: { file: "Gnome", atlas: "gnome" },
  Orc: { file: "Orc", atlas: "orc" }, Undead: { file: "Scourge", atlas: "undead" },
  Tauren: { file: "Tauren", atlas: "tauren" }, Troll: { file: "Troll", atlas: "troll" },
  Skyborne: { file: "Skyborne", atlas: "skyborne" },
};
export const RACE_SEXES = ["female", "male"] as const;
export const raceElement = (atlas: string, sex: (typeof RACE_SEXES)[number]) => `raceicon128-${atlas}-${sex}`;

/** The faction emblems, by the client's atlas name. */
export const FACTION_ELEMENTS: Record<string, string> = { alliance: "AllianceEmblem", horde: "HordeEmblem" };

/**
 * The game's own WoW: Forever logo in the client's interface atlas, sharpest first. Only this logo is
 * used: it comes from the game files like the other pieces. Blizzard's marketing logos are not used.
 */
export const LOGO_ELEMENTS = ["logo-wow-forever-2x", "logo-wow-forever"] as const;

/**
 * The game's own minimap icons for the world map's legend and pins, by the site's legend category id
 * (web/src/lib/map-view.ts, CATEGORY_IDS): the interface atlas elements to try, first found wins. These are the
 * pieces the game draws on its own map and minimap (Interface/Minimap/ObjectIconsAtlas). Vendors and other NPCs
 * have no piece of their own there, and herbs and ore are tracked with spell icons, so those categories keep the
 * site's glyph. Which elements a build has is checked, not assumed.
 */
export const POI_ELEMENTS: Record<string, readonly string[]> = {
  flight: ["TaxiNode_Neutral"],
  dungeon: ["Dungeon"],
  raid: ["Raid"],
  service: ["Innkeeper"],
  trainer: ["Profession"],
  quest: ["QuestNormal"],
  chest: ["VignetteLoot"],
};

export interface LoadingTarget {
  mapId: number;
  name: string;
  kind: "continent" | "dungeon" | "raid";
  heldBack: boolean;
  loadingScreenId: number;
  /** The picture file: the widest one the loading screen names. */
  fileId: number;
  /** Which column it came from: a newer single picture, or the classic 4:3 one. */
  shape: "main" | "narrow";
}

/**
 * The classic loading screens (the 4:3 "narrow" picture) are stored square and stretched to 4:3 on
 * screen, and are drawn inside a parchment frame with the World of Warcraft logo at the top. Only the
 * picture inside the frame, below the logo, is kept (from 25% to 79% of the height), and it is stretched
 * back to 4:3, so the banners show the scene the way the game does and no logo appears outside the
 * launch banner.
 */
export const NARROW_KEEP = { top: 0.25, bottom: 0.79, stretch: 4 / 3 } as const;

/** The crop (left, top, right, bottom) and horizontal stretch for a classic picture of this size. */
export function narrowCrop(width: number, height: number): { crop: [number, number, number, number]; scaleX: number } {
  return { crop: [0, Math.round(height * NARROW_KEEP.top), width, Math.round(height * NARROW_KEEP.bottom)], scaleX: (NARROW_KEEP.stretch * height) / width };
}

/** Width and height from a BLP2 header, or null for anything else. */
export function blpSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 20 || buffer.toString("latin1", 0, 4) !== "BLP2") return null;
  const width = buffer.readUInt32LE(12), height = buffer.readUInt32LE(16);
  return width > 0 && height > 0 ? { width, height } : null;
}

export interface AtlasPiece {
  element: string;
  fileId: number;
  /** Left, top, right, bottom in the atlas file. */
  crop: [number, number, number, number];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const list = (rows: Rows | undefined) => [...(rows?.values() ?? [])];
const pair = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length >= 2 ? [num(v[0]), num(v[1])] : null);

/**
 * The single picture of a newer row, else the classic 4:3 one. The widescreen columns are not read: their
 * layout (frame, logo) has not been checked, and no map this extractor uses needs them in build 70450.
 */
const PICTURE_COLUMNS = ["MainImageFileDataID", "NarrowScreenFileDataID"] as const;

/** The game maps that are continents: those a continent UiMap lies on. */
function continentMapIds(get: TableReader): Set<number> {
  const placed = placeUiMaps(list(get("UiMapAssignment")));
  const out = new Set<number>();
  for (const u of list(get("UiMap"))) {
    const at = placed.get(num(u.ID));
    if (u.Type === 2 && num(u.ParentUiMapID) === 947 && at) out.add(at.mapId);
  }
  return out;
}

/**
 * The loading screen of each continent and of each dungeon and raid the map layer places (an entrance on
 * a continent), in map id order. A map whose loading screen has no picture row is named in `skipped`.
 */
export function planLoadingScreens(get: TableReader): { targets: LoadingTarget[]; skipped: string[] } {
  const maps = get("Map"), screens = get("LoadingScreens");
  if (!maps || !screens) throw new Error("the snapshot has no Map or LoadingScreens table; run `client-extract --refresh` first");
  const continents = continentMapIds(get);
  const targets: LoadingTarget[] = [];
  const skipped: string[] = [];
  for (const m of [...list(maps)].sort((a, b) => num(a.ID) - num(b.ID))) {
    const mapId = num(m.ID), name = typeof m.MapName_lang === "string" ? m.MapName_lang.trim() : "";
    if (!name || /^<unused>/i.test(name)) continue;
    let kind: LoadingTarget["kind"];
    if (continents.has(mapId)) kind = "continent";
    else if (m.InstanceType === 1 || m.InstanceType === 2) {
      // The same rule as the map layer's entrances: only an instance entered somewhere on a continent.
      const at = pair(m.Corpse);
      if (!at || (at[0] === 0 && at[1] === 0) || !continents.has(num(m.CorpseMapID))) continue;
      kind = m.InstanceType === 2 ? "raid" : "dungeon";
    } else continue;
    const loadingScreenId = num(m.LoadingScreenID);
    const row = screens.get(loadingScreenId);
    const column = row ? PICTURE_COLUMNS.find((c) => num(row[c]) > 0) : undefined;
    if (!row || !column) { skipped.push(`${name} (${mapId}): no loading screen picture in this build`); continue; }
    targets.push({
      mapId, name, kind, heldBack: kind !== "continent" && mapId > ORIGINAL_MAP_MAX, loadingScreenId, fileId: num(row[column]),
      shape: column === "MainImageFileDataID" ? "main" : "narrow",
    });
  }
  return { targets, skipped };
}

/** Atlas pieces by element name; an element with no member or atlas row is left out (the caller reports it). */
export function atlasPieces(get: TableReader, names: Iterable<string>): Map<string, AtlasPiece> {
  const atlases = new Map(list(get("UiTextureAtlas")).map((r) => [num(r.ID), r]));
  const elementByName = new Map(list(get("UiTextureAtlasElement")).map((r) => [String(r.Name), num(r.ID)]));
  const memberOf = new Map<number, Record<string, unknown>>();
  for (const m of list(get("UiTextureAtlasMember"))) if (!memberOf.has(num(m.UiTextureAtlasElementID))) memberOf.set(num(m.UiTextureAtlasElementID), m);
  const out = new Map<string, AtlasPiece>();
  for (const element of names) {
    const id = elementByName.get(element);
    const member = id === undefined ? undefined : memberOf.get(id);
    const atlas = member ? atlases.get(num(member.UiTextureAtlasID)) : undefined;
    if (!member || !atlas || num(atlas.FileDataID) <= 0) continue;
    out.set(element, {
      element, fileId: num(atlas.FileDataID),
      crop: [num(member.CommittedLeft), num(member.CommittedTop), num(member.CommittedRight), num(member.CommittedBottom)],
    });
  }
  return out;
}

/** The listed races the build's ChrRaces has (by ClientFileString), by the site's name. */
export function racesInBuild(get: TableReader): string[] {
  const files = new Set(list(get("ChrRaces")).map((r) => (typeof r.ClientFileString === "string" ? r.ClientFileString : "")));
  return Object.keys(RACE_ATLAS).filter((name) => files.has(RACE_ATLAS[name].file));
}
