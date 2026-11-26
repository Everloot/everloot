/**
 * Which item begins which quest, from ItemSparse.StartQuestID: one [item id, quest id] pair per named item that
 * begins one, ordered by item id. An item with no name, or whose name marks it as a development leftover, is left out.
 *
 * The item shards on the private bucket carry the same column per item (assets/items.ts, `qs`); this small file is the
 * reverse index a quest page needs, kept apart from the client layer so only the pages that use it load it.
 * Blizzard's data, labelled "found in game files, unconfirmed". The build watch regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL } from "./edges.js";

export const QUEST_STARTS_SCHEMA = "everloot.client-quest-starts/1";

const ID = z.number().int().positive();

export const ClientQuestStarts = z.object({
  schema: z.literal(QUEST_STARTS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** [item id, quest id the item begins], by item id. */
  starts: z.array(z.tuple([ID, ID])),
});
export type ClientQuestStarts = z.infer<typeof ClientQuestStarts>;

const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : 0);

export function buildClientQuestStarts(snapshotPath: string): ClientQuestStarts {
  const meta = readClientMeta(snapshotPath);
  const rows = readClientTables(snapshotPath).includes("ItemSparse") ? readClientRows(snapshotPath, "ItemSparse") : new Map<number, Record<string, unknown>>();
  const starts: [number, number][] = [];
  for (const [rowId, row] of rows) {
    const item = num(row.ID) || rowId, quest = num(row.StartQuestID);
    const name = typeof row.Display_lang === "string" ? row.Display_lang.trim() : "";
    if (item > 0 && quest > 0 && name && !isDevelopmentItemName(name)) starts.push([item, quest]);
  }
  return ClientQuestStarts.parse({
    schema: QUEST_STARTS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    starts: starts.sort((a, b) => a[0] - b[0]),
  });
}

/** One pair per line, so a new build's file reads as a line diff in review. */
export function serializeClientQuestStarts(table: ClientQuestStarts): string {
  const { starts, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  return `${top},\n "starts": [\n${starts.map((s) => `  ${JSON.stringify(s)}`).join(",\n")}\n ]\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-quest-starts.json). */
export function writeClientQuestStarts(snapshotPath: string, path: string): ClientQuestStarts {
  const table = buildClientQuestStarts(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientQuestStarts(table));
  return table;
}
