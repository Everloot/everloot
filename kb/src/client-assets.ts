/**
 * Icons, tooltip text and interface art for the site, read from the public client and written to a
 * local directory with a build-stamped manifest: the talent catalog's icons, tooltips and frame pieces;
 * item icons and item tooltip facts; class, talent tree, raid buff and profession icons and the buff
 * spells' tooltips; the game's own continent and zone map pictures; and, for page banners, the loading
 * screens, race and faction emblems and the game's own WoW: Forever logo (assets/banners.ts). The
 * directory is uploaded to asset storage by a maintainer
 * (docs/ASSETS.md). It is never committed (docs/DATA_POLICY.md, "Blizzard's icons, tooltip text and
 * window frame").
 *
 * Only unencrypted files are read. A file with an encrypted block, or one that is not in the build, is
 * counted and left out. No key is loaded and no listfile: icon ids come from the spell, item, class and
 * skill tables, frame pieces from the interface atlas tables (UiTextureAtlas*) and map tiles from the
 * map art tables (UiMapArt*), all by file data id.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { TableSource } from "./client-extract.js";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import {
  atlasPieces, blpSize, FACTION_ELEMENTS, LOGO_ELEMENTS, narrowCrop, planLoadingScreens, POI_ELEMENTS, RACE_ATLAS, RACE_SEXES, raceElement, racesInBuild,
} from "./assets/banners.js";
import { buildItemSet, shardRecords, ITEM_SHARD_SIZE } from "./assets/items.js";
import { planMapArt, stitchPlan } from "./assets/map-art.js";
import { resolveTooltip, type EffectFacts, type SpellFacts } from "./assets/tooltip.js";
import { buildTalentCatalog, type Rows, type TableReader } from "./talents/build-catalog.js";
import { LABEL, type BuildStamp } from "./talents/catalog.js";

export const ASSET_SCHEMA = "everloot.game-assets/1";

/** Atlas element names the talent window needs, by purpose. Which exist in a build is checked, not assumed. */
const SHAPES = ["circle", "square", "choice"] as const;
const NODE_STATES = ["gray", "green", "yellow", "locked", "shadow", "greenglow"] as const;
export const FRAME_ELEMENTS: string[] = [
  ...SHAPES.flatMap((s) => NODE_STATES.map((st) => `talents-node-${s}-${st}`)),
  ...["gray", "locked", "yellow"].flatMap((st) => [`talents-arrow-head-${st}`, `talents-arrow-line-${st}`]),
  "talents-gate",
];

/**
 * Our tree name -> the client's per-spec background. The Classic trees keep their Classic names, the
 * client's backgrounds are named for the modern specs, so a few are the nearest match, listed here and
 * in the manifest as such rather than hidden.
 */
export const BACKGROUND_FOR: Record<string, { element: string; nearest?: true }> = {
  "warrior:Arms": { element: "talents-background-warrior-arms" },
  "warrior:Fury": { element: "talents-background-warrior-fury" },
  "warrior:Protection": { element: "talents-background-warrior-protection" },
  "paladin:Holy": { element: "talents-background-paladin-holy" },
  "paladin:Protection": { element: "talents-background-paladin-protection" },
  "paladin:Retribution": { element: "talents-background-paladin-retribution" },
  "hunter:Beast Mastery": { element: "talents-background-hunter-beastmastery" },
  "hunter:Marksmanship": { element: "talents-background-hunter-marksmanship" },
  "hunter:Survival": { element: "talents-background-hunter-survival" },
  "rogue:Assassination": { element: "talents-background-rogue-assassination" },
  "rogue:Combat": { element: "talents-background-rogue-outlaw", nearest: true },
  "rogue:Subtlety": { element: "talents-background-rogue-subtlety" },
  "priest:Discipline": { element: "talents-background-priest-discipline" },
  "priest:Holy": { element: "talents-background-priest-holy" },
  "priest:Shadow Magic": { element: "talents-background-priest-shadow", nearest: true },
  "shaman:Elemental Combat": { element: "talents-background-shaman-elemental", nearest: true },
  "shaman:Enhancement": { element: "talents-background-shaman-enhancement" },
  "shaman:Restoration": { element: "talents-background-shaman-restoration" },
  "mage:Arcane": { element: "talents-background-mage-arcane" },
  "mage:Fire": { element: "talents-background-mage-fire" },
  "mage:Frost": { element: "talents-background-mage-frost" },
  "warlock:Affliction": { element: "talents-background-warlock-affliction" },
  "warlock:Demonology": { element: "talents-background-warlock-demonology" },
  "warlock:Destruction": { element: "talents-background-warlock-destruction" },
  "druid:Balance": { element: "talents-background-druid-balance" },
  "druid:Feral Combat": { element: "talents-background-druid-feral", nearest: true },
  "druid:Restoration": { element: "talents-background-druid-restoration" },
};

// The public manifest names files and sizes only. Hashes are in checksums.json beside it, which only the
// upload script reads (it is not uploaded), so the manifest the talent page fetches in the browser stays small.
const File = z.object({ file: z.string(), width: z.number().int(), height: z.number().int() });
const DataFile = z.object({ file: z.string(), bytes: z.number().int(), sha256: z.string() });
const Text = z.object({ text: z.string(), unresolved: z.array(z.string()) });
const Rect = z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() });

/** Icon size cap and WebP quality. Icons are small and many, so lossy; frame pieces stay lossless. */
const ICON_MAX = 128;
const ICON_QUALITY = 90;
/** Map pictures: the base zoom layer, never scaled up, capped so a continent stays a few hundred kB. */
const MAP_MAX = 2048;
const MAP_QUALITY = 82;
/** A small copy of each map picture, for the zoomed-out view where many zones show at once. */
const MAP_SMALL_MAX = 320;
/** Loading screens, for page banners: capped, lossy, with a small copy for phones and thumbnails. */
const LOADING_MAX = 1600;
const LOADING_QUALITY = 80;
const LOADING_SMALL_MAX = 640;
/** The logo has soft edges over transparency; lossy WebP keeps the alpha and stays small. */
const LOGO_QUALITY = 90;
export const CHECKSUM_SCHEMA = "everloot.game-assets-checksums/1";
export const ITEM_INDEX_SCHEMA = "everloot.game-items/1";
/** SkillLine.CategoryID of professions and of secondary skills (Cooking, First Aid, Fishing). */
const PROFESSION_CATEGORIES = new Set([9, 11]);

export const AssetManifest = z.object({
  schema: z.literal(ASSET_SCHEMA),
  label: z.literal(LABEL),
  build: z.object({ product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(), extractedAt: z.string() }),
  /** Talent entries by trait definition id. */
  spells: z.record(z.string(), z.object({
    spellId: z.number().int(),
    name: z.string().nullable(),
    /** Icon file name inside `icons`, or null when the icon was encrypted, absent or unreadable. */
    icon: z.string().nullable(),
    /** Passive spells get the square border, active ones the round one (SpellMisc attribute bit, not our guess). */
    passive: z.boolean().nullable(),
    description: Text.nullable(),
  })),
  frames: z.record(z.string(), File),
  /** "class:Tree name" -> frame element. `nearest`: the client has no background for that Classic tree, this is the closest. */
  backgrounds: z.record(z.string(), z.object({ element: z.string(), nearest: z.boolean() })),
  /**
   * By class file name in lower case ("warrior"): the class icon (ChrClasses.IconFileDataID) and its talent
   * trees in the client's order, each with its tree icon (SkillLine.SpellIconFileID). Icon names are inside `icons`.
   */
  classes: z.record(z.string(), z.object({
    classId: z.number().int(), name: z.string(), icon: z.string().nullable(),
    trees: z.array(z.object({ name: z.string().nullable(), icon: z.string().nullable() })),
  })).default({}),
  /** By profession name in lower case: SkillLine rows of the profession and secondary skill categories. */
  professions: z.record(z.string(), z.object({ skillLineId: z.number().int(), name: z.string(), icon: z.string().nullable() })).default({}),
  /**
   * Spell id -> icon name (SpellMisc.SpellIconFileDataID): the raid buff list's spells, and the spells the client
   * layer's relations point at (created by, reagent for) for the /database pages.
   */
  spellIcons: z.record(z.string(), z.string()).default({}),
  /** Pet family id -> icon name (CreatureFamily.IconFileID). */
  familyIcons: z.record(z.string(), z.string()).default({}),
  /** By UiMap id: the map's own picture and the world rectangle it covers, so the site lays it under the zone outlines. */
  maps: z.record(z.string(), File.extend({
    /** The same picture at most MAP_SMALL_MAX px, for the zoomed-out view; null if it could not be made. */
    small: File.nullable(),
    kind: z.enum(["continent", "zone"]), name: z.string(), continentId: z.number().int(),
    /** Zones with UiMap ids outside the original world's: shown only behind the spoiler switch. */
    heldBack: z.boolean(), rect: Rect,
  })).default({}),
  /** Spell id -> name and tooltip text, for the raid buff list's spells (the raid builder's hover tooltips). */
  spellTips: z.record(z.string(), z.object({ name: z.string().nullable(), description: Text.nullable() })).default({}),
  /**
   * By game map id: the loading screen of a continent, dungeon or raid, for page banners, with a small copy.
   * Maps with ids after the original world's are held back: shown only behind the spoiler switch.
   */
  loadingScreens: z.record(z.string(), File.extend({
    small: File.nullable(), kind: z.enum(["continent", "dungeon", "raid"]), name: z.string(), heldBack: z.boolean(), loadingScreenId: z.number().int(),
  })).default({}),
  /** By race name in lower case ("night elf"): the client's race icons, female and male; null where the build has none. */
  races: z.record(z.string(), z.object({ name: z.string(), female: File.nullable(), male: File.nullable() })).default({}),
  /** "alliance" and "horde": the faction emblems. */
  factions: z.record(z.string(), File).default({}),
  /** By the world map's legend category id ("flight"): the game's own minimap icon for it, and the atlas element it is. */
  poi: z.record(z.string(), File.extend({ element: z.string() })).default({}),
  /** The game's own WoW: Forever logo from the interface atlas, or null when the build has none. Never marketing art. */
  logo: File.extend({ element: z.string(), fileDataId: z.number().int() }).nullable().default(null),
  // Item tooltip facts are not listed here: they go to the private folder (ItemIndex), never to the public bucket.
  counts: z.object({
    iconsExtracted: z.number().int(), iconsEncrypted: z.number().int(), iconsAbsent: z.number().int(), iconsFailed: z.number().int(),
    framesExtracted: z.number().int(), framesEncrypted: z.number().int(), framesAbsent: z.number().int(), framesFailed: z.number().int(),
    tooltipsResolved: z.number().int(), tooltipsUnresolved: z.number().int(), tooltipsEmpty: z.number().int(),
    itemsRecorded: z.number().int().default(0), itemsWithIcon: z.number().int().default(0),
    mapsExtracted: z.number().int().default(0), mapsSkipped: z.number().int().default(0),
    loadingScreensExtracted: z.number().int().default(0), loadingScreensSkipped: z.number().int().default(0),
    emblemsExtracted: z.number().int().default(0), logoExtracted: z.number().int().default(0),
    poiExtracted: z.number().int().default(0),
  }),
  /** Frame elements the build does not have or that could not be read; the site falls back for these. */
  missingFrames: z.array(z.string()),
  /** Maps without a picture, and why (no art in the build, a tile encrypted or missing). */
  skippedMaps: z.array(z.string()).default([]),
  /** Loading screens, race and faction emblems and logo pieces that were not made, and why. */
  skippedBanners: z.array(z.string()).default([]),
});
export type AssetManifest = z.infer<typeof AssetManifest>;

/** Every public file with its size and hash, for the upload script's check. Stays on the maintainer's machine. */
export const AssetChecksums = z.object({ schema: z.literal(CHECKSUM_SCHEMA), files: z.record(z.string(), DataFile.omit({ file: true })) });
export type AssetChecksums = z.infer<typeof AssetChecksums>;

/**
 * The private folder's index: item tooltip facts in shards of `shardSize` ids (`items/<shard>.json`). The folder
 * goes to a private bucket that only the site's server reads, so items found only in the files are never public.
 */
export const ItemIndex = z.object({
  schema: z.literal(ITEM_INDEX_SCHEMA),
  label: z.literal(LABEL),
  build: z.object({ product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string() }),
  shardSize: z.number().int(),
  count: z.number().int(),
  shards: z.record(z.string(), DataFile),
});
export type ItemIndex = z.infer<typeof ItemIndex>;

export interface ConvertJob {
  /** The BLP to read; a job with `tiles` reads those instead. */
  src?: string;
  dst: string;
  crop?: [number, number, number, number] | null;
  /** After the crop, stretch the width by this factor (a classic loading screen back to 4:3). */
  scaleX?: number | null;
  /** Cut away transparent edges (a newer loading screen's empty bands above and below the scene). */
  trim?: boolean;
  max?: number | null;
  /** Lossy WebP at this quality; absent for lossless. */
  quality?: number | null;
  /** Map tiles to lay on a grid of `tile`-sized cells, by row and column. */
  tiles?: { src: string; row: number; col: number }[];
  tile?: [number, number];
}
export interface ConvertResult { dst: string; ok: boolean; width: number; height: number; error: string | null }
export type Converter = (jobs: ConvertJob[]) => Promise<ConvertResult[]>;

/**
 * Converts BLP to WebP with Pillow (scripts/blp_convert.py). Python must have Pillow installed. `-E` ignores
 * PYTHON* variables but, unlike `-I`, keeps the user's site-packages where Pillow usually is; the script's own
 * folder is the working directory and holds nothing but that script, and the downloaded files are only read as data.
 */
export const pillowConverter: Converter = async (jobs) => {
  if (!jobs.length) return [];
  // The script runs from its own folder, so every path it is given is absolute.
  const first = jobs[0].src ?? jobs[0].tiles?.[0]?.src;
  if (!first) throw new Error("a convert job has neither a source nor tiles");
  const jobFile = resolve(dirname(first), "jobs.json");
  writeFileSync(jobFile, JSON.stringify(jobs.map((j) => ({
    ...j, src: j.src ? resolve(j.src) : null, dst: resolve(j.dst), tiles: j.tiles?.map((t) => ({ ...t, src: resolve(t.src) })),
  }))));
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "blp_convert.py");
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(python, ["-E", script, jobFile], { cwd: dirname(script), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => reject(new Error(`could not start ${python}: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`blp_convert.py exited ${code}: ${stderr.trim()}`))));
  });
  return out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ConvertResult);
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const list = (rows: Rows | undefined) => [...(rows?.values() ?? [])];
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** SPELL_ATTR0_PASSIVE: bit 6 of the first SpellMisc attribute word. */
const ATTR_PASSIVE = 0x40;

export interface AssetRun {
  /** The public folder: manifest.json, the images, and checksums.json (not uploaded). */
  dir: string;
  /** The private folder (`<dir>-private`): items.json and the item shards; null when the snapshot has no item tables. */
  privateDir: string | null;
  manifest: AssetManifest;
  checksums: AssetChecksums;
  items: ItemIndex | null;
  /** Plain-language lines for the console. */
  notes: string[];
}

interface Fetched { status: "ok" | "encrypted" | "absent" | "failed"; buffer?: Buffer }

/**
 * What to extract beyond the talent catalog: the raid buff list's spell ids and the spells the client layer's
 * relations point at (for their icons), and an item allowlist (all items when absent).
 */
export interface AssetScope { buffSpells?: number[]; relationSpells?: number[]; items?: ReadonlySet<number> }

/** Reads the tables from a snapshot file, then builds the assets. */
export async function buildClientAssets(opts: { snapshotPath: string; outDir: string; source: TableSource; convert?: Converter } & AssetScope): Promise<AssetRun> {
  const meta = readClientMeta(opts.snapshotPath);
  const present = new Set(readClientTables(opts.snapshotPath));
  const cache = new Map<string, Rows>();
  const get: TableReader = (table) => {
    if (!present.has(table)) return undefined;
    if (!cache.has(table)) cache.set(table, readClientRows(opts.snapshotPath, table));
    return cache.get(table);
  };
  const build: BuildStamp = { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt };
  return buildAssetsFromTables({ get, build, outDir: opts.outDir, source: opts.source, convert: opts.convert, buffSpells: opts.buffSpells, relationSpells: opts.relationSpells, items: opts.items });
}

export async function buildAssetsFromTables(opts: { get: TableReader; build: BuildStamp; outDir: string; source: TableSource; convert?: Converter } & AssetScope): Promise<AssetRun> {
  const { get, build, source } = opts;
  const meta = build;
  const convert = opts.convert ?? pillowConverter;
  if (!source.readFile) throw new Error("this source cannot read files");
  for (const t of ["UiTextureAtlas", "UiTextureAtlasElement", "UiTextureAtlasMember", "SpellMisc", "SpellEffect", "Spell", "TraitDefinition"]) {
    if (!get(t)) throw new Error(`the snapshot has no ${t} table; run \`client-extract --refresh\` first`);
  }
  const { classes: catalogs } = buildTalentCatalog({ get, build, tables: [] });

  // Spell facts by id, from the tables, for tooltips.
  const radius = new Map(list(get("SpellRadius")).map((r) => [num(r.ID), num(r.Radius)]));
  const durations = new Map(list(get("SpellDuration")).map((r) => [num(r.ID), num(r.Duration)]));
  const misc = new Map(list(get("SpellMisc")).filter((r) => num(r.DifficultyID) === 0).map((r) => [num(r.SpellID), r]));
  const aura = new Map(list(get("SpellAuraOptions")).filter((r) => num(r.DifficultyID) === 0).map((r) => [num(r.SpellID), r]));
  const names = new Map(list(get("SpellName")).map((r) => [num(r.ID), text(r.Name_lang)]));
  const spellRows = new Map(list(get("Spell")).map((r) => [num(r.ID), r]));
  const effects = new Map<number, Record<string, unknown>[]>();
  for (const r of list(get("SpellEffect"))) {
    if (num(r.DifficultyID) !== 0) continue;
    const id = num(r.SpellID);
    effects.set(id, [...(effects.get(id) ?? []), r]);
  }
  const definitions = new Map(list(get("TraitDefinition")).map((r) => [num(r.ID), r]));
  const factsFor = (id: number): SpellFacts | undefined => {
    if (!effects.has(id) && !misc.has(id)) return undefined;
    const durationIndex = num(misc.get(id)?.DurationIndex);
    const eff: EffectFacts[] = (effects.get(id) ?? []).map((e) => ({
      index: num(e.EffectIndex),
      basePoints: typeof e.EffectBasePointsF === "number" ? e.EffectBasePointsF : num(e.EffectBasePoints),
      dieSides: num(e.EffectDieSides), periodMs: num(e.EffectAuraPeriod), chainTargets: num(e.EffectChainTargets), variance: num(e.Variance),
      radiusYards: Math.max(0, ...(Array.isArray(e.EffectRadiusIndex) ? e.EffectRadiusIndex : [e.EffectRadiusIndex]).map((i) => radius.get(num(i)) ?? 0)) || null,
    }));
    const a = aura.get(id);
    return {
      effects: eff, durationMs: durationIndex && durations.has(durationIndex) ? durations.get(durationIndex)! : null,
      procChance: num(a?.ProcChance) > 0 && num(a?.ProcChance) <= 100 ? num(a?.ProcChance) : null, procCharges: num(a?.ProcCharges) || null, name: names.get(id) ?? null,
    };
  };

  const dir = join(opts.outDir, `${meta.product}-${meta.buildId}-${meta.buildConfig.slice(0, 8)}`);
  const privateDir = `${dir}-private`;
  const work = join(dir, "_work");
  rmSync(dir, { recursive: true, force: true });
  rmSync(privateDir, { recursive: true, force: true });
  // Size and hash of every public file written, for checksums.json.
  const checksums: AssetChecksums["files"] = {};
  const track = (rel: string) => {
    const bytes = readFileSync(join(dir, rel));
    checksums[rel] = { bytes: bytes.length, sha256: sha(bytes) };
  };
  mkdirSync(join(dir, "icons"), { recursive: true });
  mkdirSync(join(dir, "frames"), { recursive: true });
  mkdirSync(join(dir, "maps"), { recursive: true });
  for (const folder of ["loading", "emblems", "logo", "poi"]) mkdirSync(join(dir, folder), { recursive: true });
  mkdirSync(work, { recursive: true });

  const fetched = new Map<number, Fetched>();
  async function fetchFile(id: number): Promise<Fetched> {
    const known = fetched.get(id);
    if (known) return known;
    let result: Fetched;
    try {
      const status = source.fileStatus?.(id);
      if (status === "absent") result = { status: "absent" };
      else if (status === "encrypted") result = { status: "encrypted" };
      else {
        const read = await source.readFile!(id);
        result = !read ? { status: "absent" } : read.encryptedBlocks > 0 ? { status: "encrypted" } : { status: "ok", buffer: read.buffer };
      }
    } catch {
      result = { status: "failed" };
    }
    fetched.set(id, result);
    return result;
  }

  // Icons and tooltips, one per talent entry.
  const spells: AssetManifest["spells"] = {};
  const iconIdOf = new Map<string, number>();
  let resolved = 0, unresolvedCount = 0, empty = 0;
  for (const c of catalogs) {
    for (const tree of c.trees) {
      for (const node of tree.nodes) {
        for (const entry of node.entries) {
          const key = String(entry.definitionId);
          if (spells[key]) continue;
          const def = definitions.get(entry.definitionId);
          const shown = num(def?.VisibleSpellID) || num(def?.SpellID) || entry.spellId;
          const raw = text(spellRows.get(shown)?.Description_lang);
          const self = factsFor(shown) ?? { effects: [], durationMs: null };
          let description: { text: string; unresolved: string[] } | null = null;
          if (raw) {
            description = resolveTooltip(raw, self, factsFor);
            if (description.unresolved.length) unresolvedCount += 1; else resolved += 1;
          } else empty += 1;
          const attrs = misc.get(shown)?.Attributes;
          const word = Array.isArray(attrs) ? num(attrs[0]) : null;
          spells[key] = { spellId: entry.spellId, name: entry.name, icon: null, passive: word === null ? null : (word & ATTR_PASSIVE) !== 0, description };
          if (entry.iconFileId) iconIdOf.set(key, entry.iconFileId);
        }
      }
    }
  }

  const failures = new Set<string>();
  const stats = { iconsExtracted: 0, iconsEncrypted: 0, iconsAbsent: 0, iconsFailed: 0, framesExtracted: 0, framesEncrypted: 0, framesAbsent: 0, framesFailed: 0 };
  const count = (kind: "icons" | "frames", status: Fetched["status"] | "extracted") => {
    const k = `${kind}${status === "ok" || status === "extracted" ? "Extracted" : status === "encrypted" ? "Encrypted" : status === "absent" ? "Absent" : "Failed"}` as keyof typeof stats;
    stats[k] += 1;
  };

  async function convertAll(jobs: (ConvertJob & { key: string })[], kind: "icons" | "frames", into: Record<string, z.infer<typeof File>>, folder: string) {
    const results = await convert(jobs.map(({ key: _k, ...j }) => j));
    for (let i = 0; i < jobs.length; i++) {
      const r = results[i];
      if (!r?.ok) { count(kind, "failed"); failures.add(`${kind}: ${r?.error ?? "no answer"}`); continue; }
      const file = `${folder}/${jobs[i].dst.split(/[\\/]/).pop()}`;
      track(file);
      into[jobs[i].key] = { file, width: r.width, height: r.height };
      count(kind, "extracted");
    }
  }

  // Classes: the class icon, and the class's talent trees in the client's order with their tree icons.
  const skillLines = new Map(list(get("SkillLine")).map((r) => [num(r.ID), r]));
  const classes: AssetManifest["classes"] = {};
  const classIcon = new Map<string, number>();
  const treeIcons = new Map<string, number[]>();
  for (const row of list(get("ChrClasses"))) {
    const name = text(row.Name_lang);
    const key = (text(row.Filename) ?? name)?.toLowerCase();
    if (!key || !name) continue;
    const trees = [...(catalogs.find((c) => c.classId === num(row.ID))?.trees ?? [])].sort((a, b) => a.order - b.order);
    classes[key] = { classId: num(row.ID), name, icon: null, trees: trees.map((t) => ({ name: t.name, icon: null })) };
    if (num(row.IconFileDataID) > 0) classIcon.set(key, num(row.IconFileDataID));
    treeIcons.set(key, trees.map((t) => num(skillLines.get(t.skillLineId)?.SpellIconFileID)));
  }

  // Professions and secondary skills, by name; a child skill line (an expansion's tier) is left out.
  const professions: AssetManifest["professions"] = {};
  const professionIcon = new Map<string, number>();
  for (const row of [...skillLines.values()].sort((a, b) => num(a.ID) - num(b.ID))) {
    const name = text(row.DisplayName_lang);
    if (!name || !PROFESSION_CATEGORIES.has(num(row.CategoryID)) || num(row.ParentSkillLineID) !== 0) continue;
    const key = name.toLowerCase();
    if (professions[key]) continue;
    professions[key] = { skillLineId: num(row.ID), name, icon: null };
    if (num(row.SpellIconFileID) > 0) professionIcon.set(key, num(row.SpellIconFileID));
  }

  // Spell icons: the raid builder's buff spells, and the spells items are created by or used in on the /database pages.
  const spellIconOf = new Map<number, number>();
  for (const id of new Set([...(opts.buffSpells ?? []), ...(opts.relationSpells ?? [])])) {
    const file = num(misc.get(id)?.SpellIconFileDataID);
    if (file > 0) spellIconOf.set(id, file);
  }
  // ...and their names and tooltip text, for the raid builder's hover tooltips, resolved like the talents'.
  const spellTips: AssetManifest["spellTips"] = {};
  for (const id of new Set(opts.buffSpells ?? [])) {
    const name = names.get(id) ?? null;
    const raw = text(spellRows.get(id)?.Description_lang);
    if (!name && !raw) continue;
    spellTips[String(id)] = { name, description: raw ? resolveTooltip(raw, factsFor(id) ?? { effects: [], durationMs: null }, factsFor) : null };
  }

  // Pet families: their icon.
  const familyIconOf = new Map<number, number>();
  for (const row of list(get("CreatureFamily"))) if (num(row.IconFileID) > 0) familyIconOf.set(num(row.ID), num(row.IconFileID));

  // Items: tooltip facts for every named item (or the allowlist), and their icons.
  // Their Use and Equip lines are the spells' descriptions, resolved like the talents'.
  const describe = (id: number) => {
    const raw = text(spellRows.get(id)?.Description_lang);
    return raw ? resolveTooltip(raw, factsFor(id) ?? { effects: [], durationMs: null }, factsFor).text : null;
  };
  const itemSet = get("ItemSparse") && get("Item") ? buildItemSet(get, opts.items, describe) : null;

  // Icons: one file per file data id, whoever asks for it.
  const wantedIcons = new Set<number>([
    ...iconIdOf.values(), ...classIcon.values(), ...[...treeIcons.values()].flat(), ...professionIcon.values(),
    ...spellIconOf.values(), ...familyIconOf.values(), ...(itemSet?.iconOf.values() ?? []),
  ].filter((id) => id > 0));
  // Not listed in the manifest: pages find an icon by the name an entry gives, and the list would be thousands long.
  const icons: Record<string, z.infer<typeof File>> = {};
  const iconJobs: (ConvertJob & { key: string })[] = [];
  for (const id of wantedIcons) {
    const f = await fetchFile(id);
    if (f.status !== "ok") { count("icons", f.status); continue; }
    const src = join(work, `icon-${id}.blp`);
    writeFileSync(src, f.buffer!);
    iconJobs.push({ key: String(id), src, dst: join(dir, "icons", `${id}.webp`), max: ICON_MAX, quality: ICON_QUALITY });
  }
  await convertAll(iconJobs, "icons", icons, "icons");
  const iconName = (id: number | undefined) => (id && icons[String(id)] ? icons[String(id)].file.replace(/^icons\//, "") : null);
  for (const [key, id] of iconIdOf) spells[key].icon = iconName(id);
  for (const [key, c] of Object.entries(classes)) {
    c.icon = iconName(classIcon.get(key));
    const ids = treeIcons.get(key) ?? [];
    c.trees.forEach((t, i) => { t.icon = iconName(ids[i]); });
  }
  for (const [key, p] of Object.entries(professions)) p.icon = iconName(professionIcon.get(key));
  const spellIcons: AssetManifest["spellIcons"] = {};
  for (const [id, file] of spellIconOf) {
    const name = iconName(file);
    if (name) spellIcons[String(id)] = name;
  }
  const familyIcons: AssetManifest["familyIcons"] = {};
  for (const [id, file] of familyIconOf) {
    const name = iconName(file);
    if (name) familyIcons[String(id)] = name;
  }

  // Item shards, into the private folder: they hold every named item, released or not, so they never go to
  // the public bucket. An item records its icon only when the icon file was extracted.
  let items: ItemIndex | null = null;
  let itemsWithIcon = 0;
  if (itemSet) {
    for (const [id, file] of itemSet.iconOf) {
      if (!icons[String(file)]) continue;
      itemSet.records.get(id)!.i = file;
      itemsWithIcon += 1;
    }
    mkdirSync(join(privateDir, "items"), { recursive: true });
    const shards: Record<string, z.infer<typeof DataFile>> = {};
    for (const [shard, records] of shardRecords(itemSet.records)) {
      const body = Buffer.from(JSON.stringify(records));
      writeFileSync(join(privateDir, "items", `${shard}.json`), body);
      shards[String(shard)] = { file: `items/${shard}.json`, bytes: body.length, sha256: sha(body) };
    }
    items = ItemIndex.parse({
      schema: ITEM_INDEX_SCHEMA, label: LABEL,
      build: { product: build.product, buildId: build.buildId, version: build.version, buildConfig: build.buildConfig },
      shardSize: ITEM_SHARD_SIZE, count: itemSet.records.size, shards,
    });
    writeFileSync(join(privateDir, "items.json"), `${JSON.stringify(items, null, 1)}\n`);
  }

  // Map pictures: each continent's and zone's tiles laid on their grid and cut to the picture.
  const maps: AssetManifest["maps"] = {};
  const skippedMaps: string[] = [];
  if (["UiMap", "UiMapAssignment", "UiMapXMapArt", "UiMapArt", "UiMapArtStyleLayer", "UiMapArtTile"].every((t) => get(t))) {
    const plan = planMapArt(get);
    skippedMaps.push(...plan.skipped);
    const mapJobs: (ConvertJob & { target: (typeof plan.targets)[number]; small: boolean })[] = [];
    for (const target of plan.targets) {
      const label = `${target.name} (${target.uiMapId})`;
      let grid: ReturnType<typeof stitchPlan>;
      try {
        grid = stitchPlan(target.layer, target.tiles);
      } catch (e) {
        skippedMaps.push(`${label}: ${(e as Error).message}`);
        continue;
      }
      if (grid.missing.length) { skippedMaps.push(`${label}: ${grid.missing.length} tile(s) missing from the grid`); continue; }
      const tiles: NonNullable<ConvertJob["tiles"]> = [];
      let problem: string | null = null;
      for (const tile of target.tiles) {
        const f = await fetchFile(tile.fileId);
        if (f.status !== "ok") { problem = `tile file ${tile.fileId} is ${f.status}`; break; }
        const src = join(work, `tile-${tile.fileId}.blp`);
        writeFileSync(src, f.buffer!);
        tiles.push({ src, row: tile.row, col: tile.col });
      }
      if (problem) { skippedMaps.push(`${label}: ${problem}`); continue; }
      const shared = { target, tiles, tile: [target.layer.tileWidth, target.layer.tileHeight] as [number, number], crop: grid.crop, quality: MAP_QUALITY };
      mapJobs.push({ ...shared, small: false, dst: join(dir, "maps", `${target.uiMapId}.webp`), max: MAP_MAX });
      mapJobs.push({ ...shared, small: true, dst: join(dir, "maps", `${target.uiMapId}-small.webp`), max: MAP_SMALL_MAX });
    }
    const results = mapJobs.length ? await convert(mapJobs.map(({ target: _t, small: _s, ...j }) => j)) : [];
    const smallOf = new Map<number, z.infer<typeof File>>();
    mapJobs.forEach((job, i) => {
      const r = results[i];
      if (!job.small || !r?.ok) return;
      const file = `maps/${job.target.uiMapId}-small.webp`;
      track(file);
      smallOf.set(job.target.uiMapId, { file, width: r.width, height: r.height });
    });
    mapJobs.forEach((job, i) => {
      const r = results[i];
      const t = job.target;
      if (job.small) return;
      if (!r?.ok) {
        skippedMaps.push(`${t.name} (${t.uiMapId}): could not convert (${r?.error ?? "no answer"})`);
        // A small copy without its full picture is not shown; it must not be uploaded either.
        if (smallOf.has(t.uiMapId)) { rmSync(join(dir, smallOf.get(t.uiMapId)!.file), { force: true }); delete checksums[smallOf.get(t.uiMapId)!.file]; }
        return;
      }
      const file = `maps/${t.uiMapId}.webp`;
      track(file);
      maps[String(t.uiMapId)] = {
        file, width: r.width, height: r.height, small: smallOf.get(t.uiMapId) ?? null,
        kind: t.kind, name: t.name, continentId: t.continentId, heldBack: t.heldBack, rect: t.rect,
      };
    });
  }

  // Frame pieces: the atlas element names the window needs, cut out of their atlas files.
  const atlases = new Map(list(get("UiTextureAtlas")).map((r) => [num(r.ID), r]));
  const elementByName = new Map(list(get("UiTextureAtlasElement")).map((r) => [String(r.Name), num(r.ID)]));
  const memberOf = new Map<number, Record<string, unknown>>();
  for (const m of list(get("UiTextureAtlasMember"))) if (!memberOf.has(num(m.UiTextureAtlasElementID))) memberOf.set(num(m.UiTextureAtlasElementID), m);
  const backgrounds: AssetManifest["backgrounds"] = {};
  const wanted = new Set(FRAME_ELEMENTS);
  for (const [k, v] of Object.entries(BACKGROUND_FOR)) { wanted.add(v.element); backgrounds[k] = { element: v.element, nearest: v.nearest === true }; }
  const frames: AssetManifest["frames"] = {};
  const missingFrames: string[] = [];
  const frameJobs: (ConvertJob & { key: string })[] = [];
  for (const name of wanted) {
    const el = elementByName.get(name);
    const member = el === undefined ? undefined : memberOf.get(el);
    const atlas = member ? atlases.get(num(member.UiTextureAtlasID)) : undefined;
    if (!member || !atlas) { missingFrames.push(name); count("frames", "absent"); continue; }
    const fileId = num(atlas.FileDataID);
    const f = await fetchFile(fileId);
    if (f.status !== "ok") { missingFrames.push(name); count("frames", f.status); continue; }
    const src = join(work, `atlas-${fileId}.blp`);
    writeFileSync(src, f.buffer!);
    frameJobs.push({ key: name, src, dst: join(dir, "frames", `${name}.webp`), crop: [num(member.CommittedLeft), num(member.CommittedTop), num(member.CommittedRight), num(member.CommittedBottom)] });
  }
  await convertAll(frameJobs, "frames", frames, "frames");
  for (const name of wanted) if (!frames[name] && !missingFrames.includes(name)) missingFrames.push(name);
  for (const [k, v] of Object.entries(backgrounds)) if (!frames[v.element]) delete backgrounds[k];

  // Loading screens: one picture per file, whichever maps show it, with a small copy.
  const loadingScreens: AssetManifest["loadingScreens"] = {};
  const skippedBanners: string[] = [];
  let loadingSkipped = 0;
  if (get("Map") && get("LoadingScreens")) {
    const plan = planLoadingScreens(get);
    skippedBanners.push(...plan.skipped);
    loadingSkipped += plan.skipped.length;
    const problem = new Map<number, string>();
    const jobs: (ConvertJob & { fileId: number; small: boolean })[] = [];
    const shapeOf = new Map(plan.targets.map((t) => [t.fileId, t.shape] as const));
    for (const [fileId, shape] of shapeOf) {
      const f = await fetchFile(fileId);
      if (f.status !== "ok") { problem.set(fileId, `picture file ${fileId} is ${f.status}`); continue; }
      // A classic picture is cut to the scene inside its frame, below the logo, and stretched back to 4:3.
      const size = shape === "narrow" ? blpSize(f.buffer!) : null;
      if (shape === "narrow" && !size) { problem.set(fileId, `picture file ${fileId} has no size the extractor can read`); continue; }
      const cut = size ? narrowCrop(size.width, size.height) : null;
      const src = join(work, `loading-${fileId}.blp`);
      writeFileSync(src, f.buffer!);
      // A newer picture has empty transparent bands above and below the scene; they are cut away.
      const shared = { fileId, src, quality: LOADING_QUALITY, crop: cut?.crop ?? null, scaleX: cut?.scaleX ?? null, trim: shape === "main" };
      jobs.push({ ...shared, small: false, dst: join(dir, "loading", `${fileId}.webp`), max: LOADING_MAX });
      jobs.push({ ...shared, small: true, dst: join(dir, "loading", `${fileId}-small.webp`), max: LOADING_SMALL_MAX });
    }
    const results = jobs.length ? await convert(jobs.map(({ fileId: _f, small: _s, ...j }) => j)) : [];
    const made = new Map<number, { full?: z.infer<typeof File>; small?: z.infer<typeof File> }>();
    jobs.forEach((job, i) => {
      const r = results[i];
      if (!r?.ok) { if (!job.small) problem.set(job.fileId, `could not convert (${r?.error ?? "no answer"})`); return; }
      made.set(job.fileId, { ...made.get(job.fileId), [job.small ? "small" : "full"]: { file: `loading/${job.fileId}${job.small ? "-small" : ""}.webp`, width: r.width, height: r.height } });
    });
    for (const m of made.values()) {
      // A small copy without its full picture is not shown, so it is not uploaded either.
      if (!m.full) { if (m.small) rmSync(join(dir, m.small.file), { force: true }); continue; }
      track(m.full.file);
      if (m.small) track(m.small.file);
    }
    for (const t of plan.targets) {
      const m = made.get(t.fileId);
      if (!m?.full) { skippedBanners.push(`${t.name} (${t.mapId}): ${problem.get(t.fileId) ?? "not made"}`); loadingSkipped += 1; continue; }
      loadingScreens[String(t.mapId)] = { ...m.full, small: m.small ?? null, kind: t.kind, name: t.name, heldBack: t.heldBack, loadingScreenId: t.loadingScreenId };
    }
  }

  // Race and faction emblems and the game's own logo: named pieces of interface atlases, cut out like the frame.
  const races: AssetManifest["races"] = {};
  const factions: AssetManifest["factions"] = {};
  let logo: AssetManifest["logo"] = null;
  let emblemsExtracted = 0;
  const raceNames = get("ChrRaces") ? racesInBuild(get) : [];
  const emblemElements = [...raceNames.flatMap((n) => RACE_SEXES.map((s) => raceElement(RACE_ATLAS[n].atlas, s))), ...Object.values(FACTION_ELEMENTS)];
  const pieces = atlasPieces(get, [...emblemElements, ...LOGO_ELEMENTS, ...Object.values(POI_ELEMENTS).flat()]);
  const emblems = new Map<string, z.infer<typeof File>>();
  async function cutPiece(element: string, folder: string, quality?: number): Promise<z.infer<typeof File> | null> {
    const p = pieces.get(element);
    if (!p) { skippedBanners.push(`${element}: not in this build's atlas tables`); return null; }
    const f = await fetchFile(p.fileId);
    if (f.status !== "ok") { skippedBanners.push(`${element}: atlas file ${p.fileId} is ${f.status}`); return null; }
    const src = join(work, `atlas-${p.fileId}.blp`);
    writeFileSync(src, f.buffer!);
    const [r] = await convert([{ src, dst: join(dir, folder, `${element}.webp`), crop: p.crop, ...(quality ? { quality } : {}) }]);
    if (!r?.ok) { skippedBanners.push(`${element}: could not convert (${r?.error ?? "no answer"})`); return null; }
    const file = `${folder}/${element}.webp`;
    track(file);
    return { file, width: r.width, height: r.height };
  }
  for (const element of emblemElements) {
    const made = await cutPiece(element, "emblems");
    if (made) { emblems.set(element, made); emblemsExtracted += 1; }
  }
  for (const name of raceNames) {
    const [female, male] = RACE_SEXES.map((s) => emblems.get(raceElement(RACE_ATLAS[name].atlas, s)) ?? null);
    if (female || male) races[name.toLowerCase()] = { name, female, male };
  }
  for (const [faction, element] of Object.entries(FACTION_ELEMENTS)) {
    const made = emblems.get(element);
    if (made) factions[faction] = made;
  }
  // The logo: the sharpest of the listed pieces that reads. None found means no logo, never a stand-in.
  for (const element of LOGO_ELEMENTS) {
    const made = await cutPiece(element, "logo", LOGO_QUALITY);
    if (made) { logo = { ...made, element, fileDataId: pieces.get(element)!.fileId }; break; }
  }

  // The world map's legend icons: one minimap piece per category that has one, the first listed that the build holds.
  const poi: AssetManifest["poi"] = {};
  for (const [category, elements] of Object.entries(POI_ELEMENTS)) {
    for (const element of elements) {
      const made = await cutPiece(element, "poi");
      if (made) { poi[category] = { ...made, element }; break; }
    }
  }

  rmSync(work, { recursive: true, force: true });
  const manifest = AssetManifest.parse({
    schema: ASSET_SCHEMA, label: LABEL,
    build: { product: build.product, buildId: build.buildId, version: build.version, buildConfig: build.buildConfig, extractedAt: new Date().toISOString() },
    spells, frames, backgrounds, classes, professions, spellIcons, familyIcons, maps, spellTips, loadingScreens, races, factions, poi, logo,
    counts: {
      ...stats, tooltipsResolved: resolved, tooltipsUnresolved: unresolvedCount, tooltipsEmpty: empty,
      itemsRecorded: items?.count ?? 0, itemsWithIcon, mapsExtracted: Object.keys(maps).length, mapsSkipped: skippedMaps.length,
      loadingScreensExtracted: Object.keys(loadingScreens).length,
      loadingScreensSkipped: loadingSkipped,
      emblemsExtracted, logoExtracted: logo ? 1 : 0, poiExtracted: Object.keys(poi).length,
    },
    missingFrames: missingFrames.sort(),
    skippedMaps,
    skippedBanners,
  });
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  const sums = AssetChecksums.parse({ schema: CHECKSUM_SCHEMA, files: Object.fromEntries(Object.entries(checksums).sort(([a], [b]) => a.localeCompare(b))) });
  writeFileSync(join(dir, "checksums.json"), `${JSON.stringify(sums, null, 1)}\n`);
  const c = manifest.counts;
  const notes = [
    ...[...failures].slice(0, 5).map((f) => `could not convert (${f})`),
    `icons: ${c.iconsExtracted} extracted, ${c.iconsEncrypted} encrypted skipped, ${c.iconsAbsent} not in build, ${c.iconsFailed} failed`,
    `frame pieces: ${c.framesExtracted} extracted, ${c.framesEncrypted} encrypted skipped, ${c.framesAbsent} not in build, ${c.framesFailed} failed`,
    `tooltips: ${c.tooltipsResolved} fully resolved, ${c.tooltipsUnresolved} with placeholders, ${c.tooltipsEmpty} without text`,
    `classes: ${Object.keys(classes).length}, professions: ${Object.keys(professions).length}, spell icons: ${Object.keys(spellIcons).length}, pet family icons: ${Object.keys(familyIcons).length}`,
    items ? `items: ${c.itemsRecorded} recorded in ${Object.keys(items.shards).length} shards (private folder), ${c.itemsWithIcon} with an icon` : "items: no item tables in the snapshot",
    `maps: ${c.mapsExtracted} pictures, ${c.mapsSkipped} skipped`,
    `loading screens: ${c.loadingScreensExtracted} maps with a picture (${new Set(Object.values(loadingScreens).map((l) => l.file)).size} files), ${c.loadingScreensSkipped} skipped; buff tooltips: ${Object.keys(spellTips).length}`,
    `emblems: ${c.emblemsExtracted} (races: ${Object.keys(races).length}, factions: ${Object.keys(factions).length})`,
    `map legend icons: ${c.poiExtracted} of ${Object.keys(POI_ELEMENTS).length} categories (${Object.entries(poi).map(([k, p]) => `${k}: ${p.element}`).join(", ") || "none"})`,
    logo ? `logo: ${logo.element}, atlas file ${logo.fileDataId}, ${logo.width} x ${logo.height}` : "logo: none in this build's files (no stand-in is used)",
  ];
  return { dir, privateDir: items ? privateDir : null, manifest, checksums: sums, items, notes };
}
