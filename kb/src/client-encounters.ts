/**
 * The client encounters: every boss encounter the game files list for an instance (`DungeonEncounter`, keyed
 * by the instance's map id, in the files' own order). Blizzard's data, labelled "found in game files,
 * unconfirmed", pages only: the instance pages merge it with player reports player-first, and the API, MCP
 * and bulk exports stay clean (docs/DATA_POLICY.md). The build watch regenerates it with every new build.
 * The ids are the ones `ENCOUNTER_END` reports, so a file row and a player report meet on the same id.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { CLIENT_LABEL } from "./edges.js";

export const ENCOUNTERS_SCHEMA = "everloot.client-encounters/1";

const ClientEncounter = z.object({
  id: z.number().int(),
  name: z.string(),
  /** The difficulty the row is for; absent when the files bind it to none (0). */
  difficultyId: z.number().int().optional(),
});

export const ClientEncounters = z.object({
  schema: z.literal(ENCOUNTERS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** The encounters of each instance, keyed by its map id, in the files' order index then id. */
  instances: z.record(z.string(), z.array(ClientEncounter)),
  note: z.literal("names are the game files'; kills, creatures and dates come from player reports"),
});
export type ClientEncounters = z.infer<typeof ClientEncounters>;
export type ClientEncounter = z.infer<typeof ClientEncounter>;

/** One instance per line, so a new build's file reads as a line diff in review. */
export function serializeClientEncounters(table: ClientEncounters): string {
  const { instances, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const ids = Object.keys(instances).sort((a, b) => Number(a) - Number(b));
  const rows = ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(instances[id])}`);
  return `${top},\n "instances": {\n${rows.join(",\n")}\n }\n}\n`;
}

export function buildClientEncounters(snapshotPath: string): ClientEncounters {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const rows = present.has("DungeonEncounter") ? readClientRows(snapshotPath, "DungeonEncounter") : undefined;
  const byMap = new Map<number, { id: number; name: string; difficultyId: number; order: number }[]>();
  if (rows) {
    for (const row of rows.values()) {
      const name = typeof row.Name_lang === "string" ? row.Name_lang.trim() : "";
      const mapId = Number(row.MapID);
      if (!name || !(mapId > 0)) continue;
      const list = byMap.get(mapId) ?? [];
      list.push({ id: Number(row.ID), name, difficultyId: Number(row.DifficultyID ?? 0), order: Number(row.OrderIndex ?? 0) });
      byMap.set(mapId, list);
    }
  }
  const instances: Record<string, ClientEncounter[]> = {};
  for (const [mapId, list] of [...byMap].sort(([a], [b]) => a - b)) {
    list.sort((a, b) => a.order - b.order || a.id - b.id);
    instances[mapId] = list.map((e) => (e.difficultyId ? { id: e.id, name: e.name, difficultyId: e.difficultyId } : { id: e.id, name: e.name }));
  }
  return ClientEncounters.parse({
    schema: ENCOUNTERS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    instances,
    note: "names are the game files'; kills, creatures and dates come from player reports",
  });
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-encounters.json). */
export function writeClientEncounters(snapshotPath: string, path: string): ClientEncounters {
  const table = buildClientEncounters(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientEncounters(table));
  return table;
}
