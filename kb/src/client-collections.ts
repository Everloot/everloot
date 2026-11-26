/**
 * The collectables the game files list beside mounts (client-mounts.ts):
 * - currencies (`CurrencyTypes`, with `CurrencyCategory`'s name): name, the files' own description, the icon file and
 *   the cap when there is one. A currency in the "Hidden" or "Unused" category (the game's own trackers, such as
 *   talent resets) or whose name or text marks it as a development leftover is left out;
 * - companion pets (`BattlePetSpecies`): the species named by its creature (`Creature.Name_lang`), the creature, the
 *   summon spell and the icon file. A species whose creature the files do not name is left out;
 * - toys (`Toy`): the toy id and its item id only. Item names follow the item name rule and stay in private storage.
 *
 * Blizzard's data, labelled "found in game files, unconfirmed", pages only. The descriptions are game text, shown on
 * the currency pages and nowhere else. The build watch regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL } from "./edges.js";

export const COLLECTIONS_SCHEMA = "everloot.client-collections/1";

/** Currency categories that hold the game's own counters, not anything a player collects. */
const HIDDEN_CATEGORIES = new Set(["Hidden", "Unused"]);

const Currency = z.object({
  id: z.number().int(), name: z.string(), category: z.string(),
  description: z.string().optional(), iconFileId: z.number().int().optional(), max: z.number().int().optional(),
});
const Pet = z.object({ id: z.number().int(), name: z.string(), creatureId: z.number().int(), spellId: z.number().int(), iconFileId: z.number().int().optional() });
const Toy = z.object({ id: z.number().int(), itemId: z.number().int() });

export const ClientCollections = z.object({
  schema: z.literal(COLLECTIONS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  currencies: z.array(Currency),
  pets: z.array(Pet),
  toys: z.array(Toy),
});
export type ClientCollections = z.infer<typeof ClientCollections>;
export type ClientCurrency = z.infer<typeof Currency>;
export type ClientPet = z.infer<typeof Pet>;
export type ClientToy = z.infer<typeof Toy>;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? 0) || 0);

export function buildClientCollections(snapshotPath: string): ClientCollections {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string) => (present.has(t) ? readClientRows(snapshotPath, t) : new Map<number, Record<string, unknown>>());
  const byId = <T>(rows: Map<number, T>) => [...rows].sort(([a], [b]) => a - b);

  const categories = get("CurrencyCategory");
  const currencies: ClientCollections["currencies"] = [];
  for (const [id, row] of byId(get("CurrencyTypes"))) {
    const name = text(row.Name_lang);
    const description = text(row.Description_lang);
    const category = text(categories.get(num(row.CategoryID))?.Name_lang);
    if (!name || isDevelopmentItemName(name) || /\[DNT\]/i.test(description) || HIDDEN_CATEGORIES.has(category)) continue;
    const icon = num(row.InventoryIconFileID), max = num(row.MaxQty);
    currencies.push({ id, name, category, ...(description ? { description } : {}), ...(icon > 0 ? { iconFileId: icon } : {}), ...(max > 0 ? { max } : {}) });
  }

  const creatures = get("Creature");
  const pets: ClientCollections["pets"] = [];
  for (const [id, row] of byId(get("BattlePetSpecies"))) {
    const creatureId = num(row.CreatureID);
    const name = text(creatures.get(creatureId)?.Name_lang);
    if (!name || isDevelopmentItemName(name)) continue;
    const icon = num(row.IconFileDataID);
    pets.push({ id, name, creatureId, spellId: num(row.SummonSpellID), ...(icon > 0 ? { iconFileId: icon } : {}) });
  }

  const toys: ClientCollections["toys"] = [];
  for (const [id, row] of byId(get("Toy"))) if (num(row.ItemID) > 0) toys.push({ id, itemId: num(row.ItemID) });

  return ClientCollections.parse({
    schema: COLLECTIONS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    currencies, pets, toys,
  });
}

/** One entry per line, so a new build's file reads as a line diff in review. */
export function serializeClientCollections(table: ClientCollections): string {
  const { currencies, pets, toys, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const list = (key: string, rows: unknown[]) => ` ${JSON.stringify(key)}: [\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n ]`;
  return `${top},\n${[list("currencies", currencies), list("pets", pets), list("toys", toys)].join(",\n")}\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-collections.json). */
export function writeClientCollections(snapshotPath: string, path: string): ClientCollections {
  const table = buildClientCollections(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientCollections(table));
  return table;
}
