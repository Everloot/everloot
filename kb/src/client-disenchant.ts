/**
 * Disenchanting in the game files. `ItemDisenchantLoot` lists the bands the game sorts a disenchanted item into: an
 * item class (armor or weapon), a quality and an item level range. WoW: Forever's bands are its own (5 to 15, 16 to 20,
 * ...), not the classic ones other addons print. What a band yields is server-side and not in the files; it comes
 * from the disenchants players record (kb/src/disenchant.ts).
 *
 * This file keeps the bands, the armor and weapon items `ItemSparse` places in each (quality and item level), the ones
 * whose flags say they cannot be disenchanted (`Flags[0]` bit 0x8000: enchanter wands, PvP rewards), and the armor
 * and weapons the files list (`Item`) without a level, which players' own item reports place instead. Ids and numbers
 * only: item names stay in private storage (docs/DATA_POLICY.md). Blizzard's data, labelled "found in game files,
 * unconfirmed". The build watch regenerates it with every new build.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { CLIENT_LABEL } from "./edges.js";

export const DISENCHANT_SCHEMA = "everloot.client-disenchant/1";

/** `Item.ClassID` of the two classes the bands name. */
export const WEAPON = 2;
export const ARMOR = 4;
/** `ItemSparse.Flags[0]`: the item cannot be disenchanted. */
export const NO_DISENCHANT_FLAG = 0x8000;

/** One band: `[id, item class, quality, min item level, max item level, enchanting skill required]`. */
const Band = z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int()]);
export type BandRow = z.infer<typeof Band>;

export const ClientDisenchant = z.object({
  schema: z.literal(DISENCHANT_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** Every band in the files, by id. */
  bands: z.array(Band),
  /** The items the files place in each band, by band id, ascending. */
  items: z.record(z.string(), z.array(z.number().int())),
  /** Armor and weapons in a band's class and quality range that the files say cannot be disenchanted, ascending. */
  noDisenchant: z.array(z.number().int()),
  /** Armor and weapons (`Item`) with no `ItemSparse` row, so no quality or level in the files, by class id. */
  unleveled: z.record(z.string(), z.array(z.number().int())),
  note: z.literal("ids, bands, qualities and item levels are the game files'; what a band yields comes from players"),
});
export type ClientDisenchant = z.infer<typeof ClientDisenchant>;

export interface DisenchantBand { id: number; itemClass: number; quality: number; minLevel: number; maxLevel: number; skill: number }

export const bandOf = ([id, itemClass, quality, minLevel, maxLevel, skill]: BandRow): DisenchantBand =>
  ({ id, itemClass, quality, minLevel, maxLevel, skill });

/** The band an item of this class, quality and item level falls in, or null. */
export function findBand(bands: readonly DisenchantBand[], itemClass: number, quality: number, itemLevel: number): DisenchantBand | null {
  return bands.find((b) => b.itemClass === itemClass && b.quality === quality && itemLevel >= b.minLevel && itemLevel <= b.maxLevel) ?? null;
}

/** One list per line, so a new build's file reads as a line diff in review. */
export function serializeClientDisenchant(table: ClientDisenchant): string {
  const { bands, items, noDisenchant, unleveled, note, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const lists = (rec: Record<string, number[]>) =>
    Object.keys(rec).sort((a, b) => Number(a) - Number(b)).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(rec[k])}`).join(",\n");
  return `${top},\n "bands": [\n${bands.map((b) => `  ${JSON.stringify(b)}`).join(",\n")}\n ],\n` +
    ` "items": {\n${lists(items)}\n },\n "noDisenchant": ${JSON.stringify(noDisenchant)},\n` +
    ` "unleveled": {\n${lists(unleveled)}\n },\n "note": ${JSON.stringify(note)}\n}\n`;
}

export function buildClientDisenchant(snapshotPath: string): ClientDisenchant {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string) => (present.has(t) ? readClientRows(snapshotPath, t) : new Map<number, Record<string, unknown>>());
  const bandRows: BandRow[] = [...get("ItemDisenchantLoot")]
    .map(([id, r]) => [id, Number(r.Class), Number(r.Quality), Number(r.MinLevel), Number(r.MaxLevel), Number(r.SkillRequired ?? 0)] as BandRow)
    .filter((b) => b.every(Number.isInteger) && (b[1] === ARMOR || b[1] === WEAPON))
    .sort((a, b) => a[0] - b[0]);
  const bands = bandRows.map(bandOf);
  const qualities = new Set(bands.map((b) => b.quality));
  const items: Record<string, number[]> = {};
  const noDisenchant: number[] = [];
  const unleveled: Record<string, number[]> = {};
  const sparse = get("ItemSparse");
  for (const [id, item] of [...get("Item")].sort(([a], [b]) => a - b)) {
    const itemClass = Number(item.ClassID);
    if (itemClass !== ARMOR && itemClass !== WEAPON) continue;
    const row = sparse.get(id);
    if (!row) {
      (unleveled[itemClass] ??= []).push(id);
      continue;
    }
    // A row without a name is not an item the game shows.
    if (typeof row.Display_lang !== "string" || row.Display_lang.trim() === "") continue;
    const quality = Number(row.OverallQualityID);
    if (!qualities.has(quality)) continue;
    const flags = Array.isArray(row.Flags) ? Number(row.Flags[0]) : Number(row.Flags ?? 0);
    if (Number.isInteger(flags) && (flags & NO_DISENCHANT_FLAG) !== 0) {
      noDisenchant.push(id);
      continue;
    }
    const band = findBand(bands, itemClass, quality, Number(row.ItemLevel));
    if (band) (items[band.id] ??= []).push(id);
  }
  return ClientDisenchant.parse({
    schema: DISENCHANT_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    bands: bandRows,
    items,
    noDisenchant,
    unleveled,
    note: "ids, bands, qualities and item levels are the game files'; what a band yields comes from players",
  });
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-disenchant.json). */
export function writeClientDisenchant(snapshotPath: string, path: string): ClientDisenchant {
  const table = buildClientDisenchant(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientDisenchant(table));
  return table;
}
