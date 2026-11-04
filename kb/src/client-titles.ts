/**
 * Every character title the game files list: its id and `CharTitles.Name_lang` as the file holds it, so the `%s`
 * placeholder for the player's name stays in. A title with no name, or whose name marks it as a development
 * leftover, is left out.
 *
 * Blizzard's data, labelled "found in game files, unconfirmed". The site's pages and the knowledge search (catalog-index.ts)
 * read it. The build watch regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL } from "./edges.js";

export const TITLES_SCHEMA = "everloot.client-titles/1";

export const ClientTitles = z.object({
  schema: z.literal(TITLES_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** By title id; `name` keeps the `%s` placeholder. */
  titles: z.array(z.object({ id: z.number().int(), name: z.string() })),
});
export type ClientTitles = z.infer<typeof ClientTitles>;

export function buildClientTitles(snapshotPath: string): ClientTitles {
  const meta = readClientMeta(snapshotPath);
  const rows = new Set(readClientTables(snapshotPath)).has("CharTitles") ? readClientRows(snapshotPath, "CharTitles") : new Map<number, Record<string, unknown>>();
  const titles: ClientTitles["titles"] = [];
  for (const [id, row] of [...rows].sort(([a], [b]) => a - b)) {
    const name = typeof row.Name_lang === "string" ? row.Name_lang.trim() : "";
    if (!name || isDevelopmentItemName(name)) continue;
    titles.push({ id, name });
  }
  return ClientTitles.parse({
    schema: TITLES_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    titles,
  });
}

/** One title per line, so a new build's file reads as a line diff in review. */
export function serializeClientTitles(table: ClientTitles): string {
  const { titles, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  return `${top},\n "titles": [\n${titles.map((t) => `  ${JSON.stringify(t)}`).join(",\n")}\n ]\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-titles.json). */
export function writeClientTitles(snapshotPath: string, path: string): ClientTitles {
  const table = buildClientTitles(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientTitles(table));
  return table;
}
