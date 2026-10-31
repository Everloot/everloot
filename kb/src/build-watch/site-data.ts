/**
 * The committed game data the site reads, as the build watch sees it. The files are the ones the
 * generators already write (see web/src/data/game-data/README.md):
 *
 *   web/src/data/game-data/talents/<class>.json   web/scripts/trim-talent-catalog.mjs
 *   web/src/data/game-data/raid-<build>.json      web/scripts/build-raid-game-data.ts (also addon/modules/raid_data.lua)
 *   web/src/data/game-data/map.json               npm run kb -- client-map
 *   web/src/data/game-data/client-layer.json      npm run kb -- client-layer (relation edges for the database pages)
 *   web/src/data/game-data/races.json             npm run kb -- client-races (races, their classes and racial traits)
 *   web/src/data/game-data/client-achievements.json  npm run kb -- client-achievements (achievements and criteria)
 *   web/src/data/game-data/client-encounters.json  npm run kb -- client-encounters (each instance's bosses)
 *   web/src/data/game-data/client-mounts.json      npm run kb -- client-mounts (the mount list)
 *   web/src/data/game-data/spell-values.json      the build watch (numbers of the spells talents show)
 *   web/src/data/game-data/changes/<id>.json      the build watch (one changelog entry per build)
 *
 * The same reader serves the committed files (the comparison baseline) and the freshly generated ones.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { WorldMapData } from "../world-map-data.js";
import { BuildStamp, ClassCatalog, Entry, LABEL, Node, Tree } from "../talents/catalog.js";
import { changeFileName, type ChangeEntry } from "./changes.js";

export const GAME_DATA_DIR = "web/src/data/game-data";
export const RAID_LUA = "addon/modules/raid_data.lua";
export const RAID_TS = `${GAME_DATA_DIR}/raid.ts`;

/** A talent file as `trim-talent-catalog.mjs` writes it: structure and names, no text, no numbers. */
const TrimmedNode = Node.extend({ entries: z.array(Entry.pick({ definitionId: true, spellId: true, name: true, maxRanks: true })) });
const TrimmedTree = Tree.omit({ skillLineId: true, edges: true }).extend({ nodes: z.array(TrimmedNode) });
export const TrimmedClass = ClassCatalog.omit({ trees: true, warnings: true }).extend({ trees: z.array(TrimmedTree) });
export type TrimmedClass = z.infer<typeof TrimmedClass>;

const Scope = z.string();
/** The raid file as `build-raid-game-data.ts` writes it. Only what the build watch compares is described. */
export const WebRaid = z.object({
  schema: z.literal("everloot.web-raid-data/1"),
  build: z.string(),
  notFound: z.array(z.string()),
  entries: z.array(z.object({
    id: z.string(), label: z.string(), kind: z.enum(["buff", "debuff"]), class: z.string(), family: z.string(),
    scope: Scope, tree: z.union([z.string(), z.number()]), treeProof: z.string().optional(),
    names: z.array(z.string()), spellIds: z.array(z.number().int()),
    byRank: z.array(z.object({ rank: z.number().int().nullable(), spellIds: z.array(z.number().int()), scope: Scope })).optional(),
  })),
}).passthrough();
export type WebRaid = z.infer<typeof WebRaid>;

export const SPELL_VALUES_SCHEMA = "everloot.spell-values/1";
const SpellValue = z.object({
  name: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  /** First 12 hex digits of a sha256 over the tooltip texts; null when the spell has none. The text itself is never kept. */
  textHash: z.string().nullable(),
  effects: Entry.shape.effects,
});
/** Numbers of the spells that talents show: the part of the catalog the trimmed talent files leave out. */
export const SpellValueTable = z.object({
  schema: z.literal(SPELL_VALUES_SCHEMA),
  label: z.literal(LABEL),
  build: BuildStamp,
  spells: z.record(z.string(), SpellValue),
});
export type SpellValueTable = z.infer<typeof SpellValueTable>;

export const textHash = (...texts: (string | null)[]): string | null =>
  texts.every((t) => t === null) ? null : createHash("sha256").update(texts.map((t) => t ?? "").join("\u0000")).digest("hex").slice(0, 12);

/** Spell numbers from the full catalog (which the build watch reads but never commits). */
export function spellValuesOf(build: BuildStamp, classes: ClassCatalog[]): SpellValueTable {
  const spells: SpellValueTable["spells"] = {};
  for (const c of classes) for (const t of c.trees) for (const n of t.nodes) for (const e of n.entries) {
    spells[String(e.spellId)] = { name: e.name, durationMs: e.durationMs, textHash: textHash(e.description, e.auraDescription), effects: e.effects };
  }
  return SpellValueTable.parse({ schema: SPELL_VALUES_SCHEMA, label: LABEL, build, spells });
}

export interface SiteData {
  talents: TrimmedClass[];
  raid: WebRaid | null;
  map: WorldMapData | null;
  spellValues: SpellValueTable | null;
}

export const raidFileName = (version: string) => `raid-${version}.json`;
const dataDir = (root: string) => join(root, GAME_DATA_DIR);

export function raidFiles(root: string): string[] {
  return existsSync(dataDir(root)) ? readdirSync(dataDir(root)).filter((f) => /^raid-[0-9.]+\.json$/.test(f)).sort() : [];
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/** What is under `root`; null when there is no talent data yet. */
export function readSiteData(root: string): SiteData | null {
  const dir = dataDir(root);
  const talentDir = join(dir, "talents");
  if (!existsSync(talentDir)) return null;
  const talents = readdirSync(talentDir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => TrimmedClass.parse(readJson(join(talentDir, f))));
  if (!talents.length) return null;
  const raids = raidFiles(root);
  const opt = <T>(path: string, schema: z.ZodType<T>): T | null => (existsSync(path) ? schema.parse(readJson(path)) : null);
  return {
    talents: talents.sort((a, b) => a.classId - b.classId),
    raid: raids.length ? WebRaid.parse(readJson(join(dir, raids[raids.length - 1]))) : null,
    map: opt(join(dir, "map.json"), WorldMapData),
    spellValues: opt(join(dir, "spell-values.json"), SpellValueTable),
  };
}

/** The build the talent files were read from: the identity of "what the site has". */
export const siteBuild = (data: SiteData): BuildStamp => data.talents[0].build;

/** One spell per line, so a diff between builds reads spell by spell. */
export function writeSpellValues(root: string, table: SpellValueTable): string {
  const path = join(dataDir(root), "spell-values.json");
  mkdirSync(dirname(path), { recursive: true });
  const ids = Object.keys(table.spells).sort((a, b) => Number(a) - Number(b));
  const lines = ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(table.spells[id])}`).join(",\n");
  const { spells: _s, ...head } = table;
  writeFileSync(path, `${JSON.stringify(head).slice(0, -1)},"spells":{\n${lines}\n}}\n`);
  return path;
}

export function writeChangeEntry(root: string, entry: ChangeEntry): string {
  const path = join(dataDir(root), "changes", changeFileName(entry.product, entry.build.buildId));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`);
  return path;
}

/**
 * Points raid.ts at the new build's raid file. Only the import line changes. Throws when the file has no
 * such line, since a silent miss would leave the page reading a file that is about to be deleted.
 */
export function retargetRaidImport(root: string, version: string): boolean {
  const path = join(root, RAID_TS);
  const text = readFileSync(path, "utf8");
  const re = /(from\s+")\.\/raid-[0-9.]+\.json(")/;
  if (!re.test(text)) throw new Error(`${RAID_TS} has no import of a raid-<build>.json file`);
  const next = text.replace(re, `$1./${raidFileName(version)}$2`);
  if (next === text) return false;
  writeFileSync(path, next);
  return true;
}

/** Where the site lists the change records it bundles (web/src/lib/talents/freshness-records.ts, PUBLISHED_CHANGES). */
export const RECORDS_TS = "web/src/lib/talents/freshness-records.ts";

/**
 * Lists a new build's change record in RECORDS_TS: one import line after the last record's, and its name at the end
 * of PUBLISHED_CHANGES. The name is the product's last word and the build id (wowf70707, beta70532), as the file
 * already names them. False when it is listed already; throws when the file has no such list, so a miss is loud.
 */
export function addPublishedChange(root: string, product: string, buildId: number): boolean {
  const path = join(root, RECORDS_TS);
  const text = readFileSync(path, "utf8");
  const name = `${product.split("_").pop()}${buildId}`;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const imports = [...text.matchAll(/^import [a-z]+[0-9]+ from "@\/data\/game-data\/changes\/[a-z0-9_]+-[0-9]+\.json";(?=\r?$)/gm)];
  const list = /^(export const PUBLISHED_CHANGES: readonly unknown\[\] = \[)([a-z0-9, ]*)(\];)(?=\r?$)/m.exec(text);
  if (!imports.length || !list) throw new Error(`${RECORDS_TS} has no change record imports or no PUBLISHED_CHANGES list`);
  const names = list[2].split(",").map((s) => s.trim()).filter(Boolean);
  if (names.includes(name)) return false;
  const last = imports[imports.length - 1];
  const end = last.index + last[0].length;
  const line = `import ${name} from "@/data/game-data/changes/${changeFileName(product, buildId)}";`;
  const withImport = `${text.slice(0, end)}${eol}${line}${text.slice(end)}`;
  writeFileSync(path, withImport.replace(list[0], `${list[1]}${[...names, name].join(", ")}${list[3]}`));
  return true;
}

/** Drops the keys that change on every extraction, so two runs of one build compare equal. */
const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "extractedAt").map(([k, x]) => [k, stable(x)]))
      : v;

/**
 * Relative paths of the generated files that differ from the ones under `committed`. JSON is compared by
 * value without `extractedAt`; the Lua file byte for byte.
 */
const text = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

export function differingFiles(generated: string, committed: string, files: string[]): string[] {
  return files.filter((rel) => {
    const a = join(generated, rel), b = join(committed, rel);
    if (!existsSync(a) || !existsSync(b)) return true;
    return rel.endsWith(".json")
      ? JSON.stringify(stable(readJson(a))) !== JSON.stringify(stable(readJson(b)))
      : text(a) !== text(b);
  });
}

/** Every generated file under a root, as paths relative to it. */
export function generatedFiles(root: string): string[] {
  const dir = dataDir(root);
  const talents = existsSync(join(dir, "talents")) ? readdirSync(join(dir, "talents")).filter((f) => f.endsWith(".json")).sort().map((f) => `${GAME_DATA_DIR}/talents/${f}`) : [];
  const top = ["map.json", "client-layer.json", "races.json", "client-achievements.json", "client-encounters.json", "client-mounts.json", "spell-values.json", "client-digests.json", ...raidFiles(root)].filter((f) => existsSync(join(dir, f))).map((f) => `${GAME_DATA_DIR}/${f}`);
  return [...talents, ...top, ...(existsSync(join(root, RAID_LUA)) ? [RAID_LUA] : [])];
}
