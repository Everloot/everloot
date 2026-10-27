/**
 * The client achievements: every achievement the game files carry, with its criteria from
 * `Achievement.Criteria_tree` walked through `CriteriaTree` (the text nodes become criteria; group
 * nodes have no text). Blizzard's data, labelled "found in game files, unconfirmed", pages only —
 * the committed file is the pages' source, and the API, MCP and bulk exports stay clean
 * (docs/DATA_POLICY.md). The build watch regenerates it with every new build.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { CLIENT_LABEL } from "./edges.js";

export const ACHIEVEMENTS_SCHEMA = "everloot.client-achievements/1";

const CriterionSchema = z.object({
  text: z.string(),
  /** The amount the tree asks for; where 1, the field is absent. */
  amount: z.number().int().optional(),
});

const ClientAchievement = z.object({
  title: z.string(),
  points: z.number().int(),
  /** The achievement's own text; absent when the files give none. */
  description: z.string().optional(),
  criteria: z.array(CriterionSchema),
});

export const ClientAchievements = z.object({
  schema: z.literal(ACHIEVEMENTS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** Every achievement keyed by its id, in id order in the file. */
  achievements: z.record(z.string(), ClientAchievement),
  /** Where the names of achievement categories live: player uploads; the files carry only the id. */
  note: z.literal("criteria and text are the game files'; category names come from player reports"),
});
export type ClientAchievements = z.infer<typeof ClientAchievements>;
export type ClientAchievement = z.infer<typeof ClientAchievement>;
export type ClientCriterion = z.infer<typeof CriterionSchema>;

/** criteria.json-style one achievement per line, so a new build's file reads as a line diff in review. */
export function serializeClientAchievements(table: ClientAchievements): string {
  const { achievements, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const ids = Object.keys(achievements).sort((a, b) => Number(a) - Number(b));
  const rows = (pair: [string, ClientAchievement]) => `  ${JSON.stringify(pair[0])}: ${JSON.stringify(pair[1])}`;
  return `${top},\n "achievements": {\n${ids.map((id) => rows([id, achievements[id] as ClientAchievement])).join(",\n")}\n }\n}\n`;
}

export interface TreeRow { ID: number; Parent: number; OrderIndex: number; Description_lang: string | null; Amount: number }

/** DFS under the achievement's root tree, order index first; text nodes are criteria, group nodes are not. */
export function criteriaOf(rootId: number, tree: Map<number, TreeRow>): ClientCriterion[] {
  const childrenOf = new Map<number, TreeRow[]>();
  for (const row of tree.values()) {
    if (row.Parent === 0) continue;
    const list = childrenOf.get(row.Parent);
    if (list) list.push(row);
    else childrenOf.set(row.Parent, [row]);
  }
  const out: ClientCriterion[] = [];
  const walk = (id: number) => {
    const kids = childrenOf.get(id) ?? [];
    kids.sort((a, b) => a.OrderIndex - b.OrderIndex);
    for (const k of kids) {
      const text = k.Description_lang?.trim() ?? "";
      if (text && (childrenOf.get(k.ID)?.length ?? 0) === 0) out.push(k.Amount > 1 ? { text, amount: k.Amount } : { text });
      walk(k.ID);
    }
  };
  if (!tree.has(rootId) && !childrenOf.has(rootId)) return [];
  const root = tree.get(rootId);
  const rootText = root?.Description_lang?.trim() ?? "";
  if (rootText && (childrenOf.get(rootId)?.length ?? 0) === 0) {
    out.push(root && root.Amount > 1 ? { text: rootText, amount: root.Amount } : { text: rootText });
  }
  walk(rootId);
  return out;
}

export function buildClientAchievements(snapshotPath: string): ClientAchievements {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string) => (present.has(t) ? readClientRows(snapshotPath, t) : undefined);
  const achievements = get("Achievement");
  const tree = get("CriteriaTree");
  const out: Record<string, ClientAchievement> = {};
  if (achievements && tree) {
    for (const row of achievements.values()) {
      const id = Number(row.ID);
      const title = typeof row.Title_lang === "string" ? row.Title_lang.trim() : "";
      if (!title) continue;
      const description = typeof row.Description_lang === "string" ? row.Description_lang.trim() : "";
      const criteria = typeof row.Criteria_tree === "number" && row.Criteria_tree > 0
        ? criteriaOf(row.Criteria_tree, new Map([...tree].map(([id, r]) => [id, r as unknown as TreeRow])))
        : [];
      out[id] = ClientAchievement.parse({
        title,
        points: Number(row.Points ?? 0),
        criteria,
        ...(description ? { description } : {}),
      });
    }
  }
  return ClientAchievements.parse({
    schema: ACHIEVEMENTS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    achievements: out,
    note: "criteria and text are the game files'; category names come from player reports",
  });
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-achievements.json). */
export function writeClientAchievements(snapshotPath: string, path: string): ClientAchievements {
  const table = buildClientAchievements(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientAchievements(table));
  return table;
}
