/**
 * Every item set the game files list (`ItemSet`): its id, its pieces in the files' order, the skill and rank a crafted
 * set asks for, and its bonuses from `ItemSetSpell` as [pieces needed, spell id], fewest pieces first (ties by spell
 * id). A set with no name, whose name marks it as a development leftover, or with no pieces is left out. The names
 * themselves are not in the file: set names stay in private storage (docs/DATA_POLICY.md, "Item set and spell names
 * from the game files"), so this file holds ids and numbers only.
 *
 * Blizzard's data, labelled "found in game files, unconfirmed". The item set pages read it. The build watch
 * regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL } from "./edges.js";

export const ITEM_SETS_SCHEMA = "everloot.client-item-sets/1";

const Id = z.number().int();

export const ClientItemSets = z.object({
  schema: z.literal(ITEM_SETS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** By set id: the piece item ids, the bonuses as [pieces needed, spell id], and [skill line, rank] when the set asks for one. */
  sets: z.array(z.object({ id: Id, items: z.array(Id), bonuses: z.array(z.tuple([Id, Id])), skill: z.tuple([Id, Id]).optional() })),
});
export type ClientItemSets = z.infer<typeof ClientItemSets>;
export type ClientItemSet = ClientItemSets["sets"][number];

const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : 0);

export function buildClientItemSets(snapshotPath: string): ClientItemSets {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const empty = new Map<number, Record<string, unknown>>();
  const rows = present.has("ItemSet") ? readClientRows(snapshotPath, "ItemSet") : empty;
  const spells = present.has("ItemSetSpell") ? readClientRows(snapshotPath, "ItemSetSpell") : empty;
  const bonuses = new Map<number, [number, number][]>();
  for (const row of spells.values()) {
    const set = num(row.ItemSetID), spell = num(row.SpellID);
    if (set <= 0 || spell <= 0) continue;
    const list = bonuses.get(set) ?? [];
    list.push([num(row.Threshold), spell]);
    bonuses.set(set, list);
  }
  const sets: ClientItemSet[] = [];
  for (const [id, row] of [...rows].sort(([a], [b]) => a - b)) {
    const name = typeof row.Name_lang === "string" ? row.Name_lang.trim() : "";
    if (!name || isDevelopmentItemName(name)) continue;
    const items = (Array.isArray(row.ItemID) ? row.ItemID : []).map(num).filter((item) => item > 0);
    if (!items.length) continue;
    const own = (bonuses.get(id) ?? []).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const skill = num(row.RequiredSkill);
    sets.push({ id, items, bonuses: own, ...(skill > 0 ? { skill: [skill, num(row.RequiredSkillRank)] as [number, number] } : {}) });
  }
  return ClientItemSets.parse({
    schema: ITEM_SETS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    sets,
  });
}

/** One set per line, so a new build's file reads as a line diff in review. */
export function serializeClientItemSets(table: ClientItemSets): string {
  const { sets, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  return `${top},\n "sets": [\n${sets.map((s) => `  ${JSON.stringify(s)}`).join(",\n")}\n ]\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-item-sets.json). */
export function writeClientItemSets(snapshotPath: string, path: string): ClientItemSets {
  const table = buildClientItemSets(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientItemSets(table));
  return table;
}
