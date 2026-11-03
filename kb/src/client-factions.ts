/**
 * Every faction the game files list: its id, its client name, its parent faction (the group it sits under) and
 * whether it shows in the reputation pane (`Faction.ReputationIndex` is a slot number; a faction with no slot there
 * holds -1, which the unsigned column in the 1.60.1 files reads back as 255). A faction with no name, or whose name marks it as a development leftover, is left out.
 *
 * Blizzard's data, labelled "found in game files, unconfirmed", pages only. The build watch regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL } from "./edges.js";

export const FACTIONS_SCHEMA = "everloot.client-factions/1";

export const ClientFactions = z.object({
  schema: z.literal(FACTIONS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** By faction id; `parentId` only when the files name a parent, `shown` when the faction has a reputation pane slot. */
  factions: z.array(z.object({ id: z.number().int(), name: z.string(), parentId: z.number().int().optional(), shown: z.boolean() })),
});
export type ClientFactions = z.infer<typeof ClientFactions>;

const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : 0);
/** The column is an unsigned byte in the 1.60.1 files, so "no slot" (-1) reads back as 255; both mean hidden. */
const inReputationPane = (v: unknown) => typeof v === "number" && v >= 0 && v < 255;

export function buildClientFactions(snapshotPath: string): ClientFactions {
  const meta = readClientMeta(snapshotPath);
  const rows = new Set(readClientTables(snapshotPath)).has("Faction") ? readClientRows(snapshotPath, "Faction") : new Map<number, Record<string, unknown>>();
  const factions: ClientFactions["factions"] = [];
  for (const [id, row] of [...rows].sort(([a], [b]) => a - b)) {
    const name = typeof row.Name_lang === "string" ? row.Name_lang.trim() : "";
    if (!name || isDevelopmentItemName(name)) continue;
    const parentId = num(row.ParentFactionID);
    factions.push({ id, name, ...(parentId > 0 ? { parentId } : {}), shown: inReputationPane(row.ReputationIndex) });
  }
  return ClientFactions.parse({
    schema: FACTIONS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    factions,
  });
}

/** One faction per line, so a new build's file reads as a line diff in review. */
export function serializeClientFactions(table: ClientFactions): string {
  const { factions, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  return `${top},\n "factions": [\n${factions.map((f) => `  ${JSON.stringify(f)}`).join(",\n")}\n ]\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-factions.json). */
export function writeClientFactions(snapshotPath: string, path: string): ClientFactions {
  const table = buildClientFactions(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientFactions(table));
  return table;
}
