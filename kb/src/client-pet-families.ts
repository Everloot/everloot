/**
 * The hunter pet families the game files list (`CreatureFamily`): a family is a hunter's when its `PetFoodMask` names
 * any food (a warlock's demons and the remote controls eat nothing). Each keeps its name, icon file, its own skill
 * line (`SkillLine[0]`) and the spells on that line (`SkillLineAbility`), ascending, without the development
 * helpers ("Tamed Pet Passive (DND)"). The food mask itself is not kept: the files name no foods for its bits.
 *
 * Blizzard's data, labelled "found in game files, unconfirmed". Ids and family names only: spell names follow the
 * spell name rule on the pages. The build watch regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL } from "./edges.js";

export const PET_FAMILIES_SCHEMA = "everloot.client-pet-families/1";

const Family = z.object({
  id: z.number().int(), name: z.string(), iconFileId: z.number().int().optional(),
  skillLine: z.number().int(), spellIds: z.array(z.number().int()),
});
export type ClientPetFamily = z.infer<typeof Family>;

export const ClientPetFamilies = z.object({
  schema: z.literal(PET_FAMILIES_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  families: z.array(Family),
});
export type ClientPetFamilies = z.infer<typeof ClientPetFamilies>;

export function buildClientPetFamilies(snapshotPath: string): ClientPetFamilies {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string) => (present.has(t) ? readClientRows(snapshotPath, t) : new Map<number, Record<string, unknown>>());
  const spellNames = get("SpellName");
  const spellsOf = new Map<number, Set<number>>();
  for (const row of get("SkillLineAbility").values()) {
    const line = Number(row.SkillLine), spell = Number(row.Spell);
    if (!line || !spell || isDevelopmentItemName(String(spellNames.get(spell)?.Name_lang ?? ""))) continue;
    spellsOf.set(line, (spellsOf.get(line) ?? new Set()).add(spell));
  }
  const families: ClientPetFamilies["families"] = [];
  for (const [id, row] of [...get("CreatureFamily")].sort(([a], [b]) => a - b)) {
    const name = typeof row.Name_lang === "string" ? row.Name_lang.trim() : "";
    if (!name || isDevelopmentItemName(name) || !(Number(row.PetFoodMask) > 0)) continue;
    const skillLine = Array.isArray(row.SkillLine) ? Number(row.SkillLine[0]) || 0 : 0;
    const icon = Number(row.IconFileID) || 0;
    families.push({ id, name, ...(icon > 0 ? { iconFileId: icon } : {}), skillLine, spellIds: [...(spellsOf.get(skillLine) ?? [])].sort((a, b) => a - b) });
  }
  return ClientPetFamilies.parse({
    schema: PET_FAMILIES_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    families,
  });
}

/** One family per line, so a new build's file reads as a line diff in review. */
export function serializeClientPetFamilies(table: ClientPetFamilies): string {
  const { families, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  return `${top},\n "families": [\n${families.map((f) => `  ${JSON.stringify(f)}`).join(",\n")}\n ]\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-pet-families.json). */
export function writeClientPetFamilies(snapshotPath: string, path: string): ClientPetFamilies {
  const table = buildClientPetFamilies(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientPetFamilies(table));
  return table;
}
