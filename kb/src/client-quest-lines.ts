/**
 * Every quest line the game files list: its id, its client name and the quests on it in `QuestLineXQuest`'s
 * `OrderIndex` order (ties by row id). A line with no quest rows keeps an empty list. A line with no name, or whose
 * name marks it as a development leftover, is left out.
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

export const QUEST_LINES_SCHEMA = "everloot.client-quest-lines/1";

export const ClientQuestLines = z.object({
  schema: z.literal(QUEST_LINES_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** By quest line id, with its quest ids in the order the files give them. */
  questLines: z.array(z.object({ id: z.number().int(), name: z.string(), questIds: z.array(z.number().int()) })),
});
export type ClientQuestLines = z.infer<typeof ClientQuestLines>;

const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : 0);

export function buildClientQuestLines(snapshotPath: string): ClientQuestLines {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const empty = new Map<number, Record<string, unknown>>();
  const lines = present.has("QuestLine") ? readClientRows(snapshotPath, "QuestLine") : empty;
  const links = present.has("QuestLineXQuest") ? readClientRows(snapshotPath, "QuestLineXQuest") : empty;
  const quests = new Map<number, { order: number; row: number; quest: number }[]>();
  for (const [row, link] of links) {
    const line = num(link.QuestLineID), quest = num(link.QuestID);
    if (line <= 0 || quest <= 0) continue;
    const list = quests.get(line) ?? [];
    list.push({ order: num(link.OrderIndex), row, quest });
    quests.set(line, list);
  }
  const questLines: ClientQuestLines["questLines"] = [];
  for (const [id, row] of [...lines].sort(([a], [b]) => a - b)) {
    const name = typeof row.Name_lang === "string" ? row.Name_lang.trim() : "";
    if (!name || isDevelopmentItemName(name)) continue;
    const questIds = (quests.get(id) ?? []).sort((a, b) => a.order - b.order || a.row - b.row).map((q) => q.quest);
    questLines.push({ id, name, questIds });
  }
  return ClientQuestLines.parse({
    schema: QUEST_LINES_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    questLines,
  });
}

/** One quest line per line, so a new build's file reads as a line diff in review. */
export function serializeClientQuestLines(table: ClientQuestLines): string {
  const { questLines, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  return `${top},\n "questLines": [\n${questLines.map((q) => `  ${JSON.stringify(q)}`).join(",\n")}\n ]\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-quest-lines.json). */
export function writeClientQuestLines(snapshotPath: string, path: string): ClientQuestLines {
  const table = buildClientQuestLines(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientQuestLines(table));
  return table;
}
