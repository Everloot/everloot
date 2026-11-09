import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readCatalogFiles } from "../catalog-index.js";
import type { ClientAchievements } from "../client-achievements.js";
import { ClientClassGear } from "../client-class-gear.js";
import { ClientClassSpells } from "../client-class-spells.js";
import type { ClientEncounters } from "../client-encounters.js";
import type { ClientFactions } from "../client-factions.js";
import type { ClientMounts } from "../client-mounts.js";
import type { ClientQuestLines } from "../client-quest-lines.js";
import type { RaceTable } from "../client-races.js";
import { ClientRecipes } from "../client-recipes.js";
import type { ClientTitles } from "../client-titles.js";
import type { LegacyPerkCatalog } from "../legacy-perks/catalog.js";

/**
 * The committed catalog files the game-file datasets are built from (web/src/data/game-data). The eight catalog
 * kinds come through `readCatalogFiles`, with the schema each file already has; the recipe, class, talent and
 * raid-buff files are read here with theirs. Only `readOpenDataGameFiles` touches `fs`; the builders take parsed files.
 */

const stamp = z.object({ version: z.string(), extractedAt: z.string() });

/** What the export reads of a trimmed talent file (web/scripts/trim-talent-catalog.mjs writes them). */
export const TalentFile = z.object({
  schema: z.literal("everloot.talent-catalog/2"),
  build: stamp,
  classId: z.number().int(),
  className: z.string(),
  trees: z.array(z.object({
    id: z.number().int(),
    name: z.string().nullable(),
    order: z.number().int(),
    nodes: z.array(z.object({
      id: z.number().int(),
      x: z.number().int(), y: z.number().int(), row: z.number().int(), col: z.number().int(),
      kind: z.enum(["single", "tiered", "choice"]),
      maxRanks: z.number().int(),
      entries: z.array(z.object({ definitionId: z.number().int(), spellId: z.number().int(), name: z.string().nullable(), maxRanks: z.number().int() })),
      prereqs: z.array(z.object({ nodeId: z.number().int(), rule: z.enum(["any", "all"]) })),
    })),
  })),
});
export type TalentFile = z.infer<typeof TalentFile>;

export const RAID_SCOPES = ["self", "single", "party", "raid", "area", "enemy", "mixed", "unknown"] as const;
export const RAID_TREE_PROOFS = ["talent spell", "spell chain", "talent name"] as const;

/** What the export reads of the site's raid file (web/src/data/game-data/raid-<build>.json). */
export const RaidFile = z.object({
  schema: z.literal("everloot.web-raid-data/1"),
  build: z.string(),
  entries: z.array(z.object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(["buff", "debuff"]),
    class: z.string(),
    family: z.string(),
    scope: z.enum(RAID_SCOPES),
    tree: z.union([z.literal("baseline"), z.literal("unknown"), z.literal(1), z.literal(2), z.literal(3)]),
    treeProof: z.enum(RAID_TREE_PROOFS).optional(),
    names: z.array(z.string()),
    spellIds: z.array(z.number().int()),
  })),
});
export type RaidFile = z.infer<typeof RaidFile>;

export interface OpenDataCatalogs {
  achievements: ClientAchievements;
  factions: ClientFactions;
  titles: ClientTitles;
  questLines: ClientQuestLines;
  mounts: ClientMounts;
  encounters: ClientEncounters;
  recipes: ClientRecipes;
  classGear: ClientClassGear;
  classSpells: ClientClassSpells;
  races: RaceTable;
  legacyPerks: LegacyPerkCatalog;
  /** One file per class, in file-name order. */
  talents: TalentFile[];
  raidBuffs: RaidFile;
}

function readJson<T>(root: string, file: string, schema: z.ZodType<T>): T {
  const path = join(root, file);
  if (!existsSync(path)) throw new Error(`open-data: ${file} is missing under ${root}; an export without a committed catalog would silently leave it out`);
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** The import line of raid.ts names the current raid file; the export reads the same one as the site. */
function raidFileName(root: string): string {
  const source = readFileSync(join(root, "raid.ts"), "utf8");
  const hit = source.match(/from "\.\/(raid-[^"]+\.json)"/);
  if (!hit) throw new Error("open-data: raid.ts does not import a raid-<build>.json file");
  return hit[1]!;
}

/** Reads every catalog file under `root` (web/src/data/game-data). Node only. A missing file throws. */
export function readOpenDataGameFiles(root: string): OpenDataCatalogs {
  const { files, missing } = readCatalogFiles(root);
  const need = ["client-achievements.json", "client-factions.json", "client-titles.json", "client-quest-lines.json", "client-mounts.json", "client-encounters.json", "races.json", "legacy-perks.json"];
  const gone = need.filter((f) => missing.includes(f));
  if (gone.length) throw new Error(`open-data: ${gone.join(", ")} missing under ${root}; an export without a committed catalog would silently leave it out`);
  const talentsDir = join(root, "talents");
  const talents = existsSync(talentsDir) ? readdirSync(talentsDir).filter((f) => f.endsWith(".json")).sort().map((f) => readJson(talentsDir, f, TalentFile)) : [];
  if (!talents.length) throw new Error(`open-data: no talent files under ${talentsDir}`);
  return {
    achievements: files.achievements!, factions: files.factions!, titles: files.titles!, questLines: files.questLines!,
    mounts: files.mounts!, encounters: files.encounters!, races: files.races!, legacyPerks: files.legacyPerks!,
    recipes: readJson(root, "client-recipes.json", ClientRecipes),
    classGear: readJson(root, "client-class-gear.json", ClientClassGear),
    classSpells: readJson(root, "client-class-spells.json", ClientClassSpells),
    talents,
    raidBuffs: readJson(root, raidFileName(root), RaidFile),
  };
}
