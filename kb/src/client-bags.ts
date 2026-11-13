/**
 * The client bags: every container the game files list (`Item` class 1) with the number of slots it holds
 * (`ItemSparse.ContainerSlots`), its quality and its subclass (0 a plain bag; soul, herb, enchanting and the other
 * profession bags after it), and the files' word for each subclass (`ItemSubClass.DisplayName_lang`), which the
 * tooltip prints after the slot count ("14 Slot Bag", "20 Slot Herb Bag"). Quivers and ammo pouches are item class
 * 11 in this build and are not read. Ids and numbers only: item names, binding and required level are tooltip facts
 * that stay in private storage (docs/DATA_POLICY.md), so the bag calculator names only the bags players priced.
 * Blizzard's data, labelled "found in game files, unconfirmed". The build watch regenerates it with every new build.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { CLIENT_LABEL } from "./edges.js";

export const BAGS_SCHEMA = "everloot.client-bags/1";

/** `Item.ClassID` of containers. */
export const CONTAINER_CLASS = 1;
/** `Item.SubclassID` of a plain bag, the one any item fits in. */
export const PLAIN_BAG = 0;

const ClientBag = z.object({
  /** `ItemSparse.OverallQualityID`, 0 poor to 7 heirloom. */
  quality: z.number().int(),
  /** `ItemSparse.ContainerSlots`. */
  slots: z.number().int().positive(),
  /** `Item.SubclassID`: 0 a plain bag, the others hold one kind of item only. */
  subclass: z.number().int(),
});

export const ClientBags = z.object({
  schema: z.literal(BAGS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** The files' word for each container subclass, by subclass id. */
  subclasses: z.record(z.string(), z.string()),
  /** Every container with slots keyed by its item id, in id order in the file. */
  bags: z.record(z.string(), ClientBag),
  note: z.literal("ids, slot counts, qualities and subclasses are the game files'; names and prices come from players"),
});
export type ClientBags = z.infer<typeof ClientBags>;
export type ClientBag = z.infer<typeof ClientBag>;

/** One bag per line, so a new build's file reads as a line diff in review. */
export function serializeClientBags(table: ClientBags): string {
  const { bags, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const ids = Object.keys(bags).sort((a, b) => Number(a) - Number(b));
  const rows = ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(bags[id])}`);
  return `${top},\n "bags": {\n${rows.join(",\n")}\n }\n}\n`;
}

export function buildClientBags(snapshotPath: string): ClientBags {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string) => (present.has(t) ? readClientRows(snapshotPath, t) : undefined);
  const items = get("Item");
  const sparse = get("ItemSparse");
  const subclasses: Record<string, string> = {};
  for (const row of get("ItemSubClass")?.values() ?? []) {
    const name = typeof row.DisplayName_lang === "string" ? row.DisplayName_lang.trim() : "";
    if (Number(row.ClassID) === CONTAINER_CLASS && name) subclasses[String(Number(row.SubClassID))] = name;
  }
  const bags: Record<string, ClientBag> = {};
  if (items && sparse) {
    for (const [id, row] of [...sparse].sort(([a], [b]) => a - b)) {
      const item = items.get(id);
      if (!item || Number(item.ClassID) !== CONTAINER_CLASS) continue;
      const slots = Number(row.ContainerSlots ?? 0);
      // A row without a name is not an item the game shows; the name itself is not kept.
      const named = typeof row.Display_lang === "string" && row.Display_lang.trim() !== "";
      if (!named || !Number.isInteger(slots) || slots <= 0) continue;
      bags[id] = ClientBag.parse({ quality: Number(row.OverallQualityID ?? 0), slots, subclass: Number(item.SubclassID ?? 0) });
    }
  }
  return ClientBags.parse({
    schema: BAGS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    subclasses,
    bags,
    note: "ids, slot counts, qualities and subclasses are the game files'; names and prices come from players",
  });
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-bags.json). */
export function writeClientBags(snapshotPath: string, path: string): ClientBags {
  const table = buildClientBags(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientBags(table));
  return table;
}
