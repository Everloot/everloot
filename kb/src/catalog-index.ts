/**
 * The game-file catalogs (achievements, factions, titles, quest lines, mounts, legacy perks, races, instances) as
 * an in-memory index. These rows are Blizzard data under their own credit, so they never enter the CC BY-SA
 * knowledge release; the knowledge tools union this index with the release at query time instead.
 *
 * `buildCatalogIndex` is pure and takes already-parsed JSON, so the web host (no file access at runtime) can call
 * it with its JSON imports. Only `readCatalogFiles` touches `fs`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE } from "@everloot/protocol";
import { z } from "zod";
import { catalogPath } from "./catalog-paths.js";
import { ClientAchievements } from "./client-achievements.js";
import { ClientEncounters } from "./client-encounters.js";
import { ClientFactions } from "./client-factions.js";
import { ClientMounts } from "./client-mounts.js";
import { ClientQuestLines } from "./client-quest-lines.js";
import { RaceTable } from "./client-races.js";
import { ClientTitles } from "./client-titles.js";
import { LegacyPerkCatalog } from "./legacy-perks/catalog.js";
import { allTerms, type SearchHit } from "./search.js";

export const CATALOG_KINDS = ["achievement", "faction", "title", "quest_chain", "mount", "legacy_perk", "race", "instance"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

/** Catalog ids start here, far above any release rowid, and are the same on every build. */
export const CATALOG_ID_BASE = 1_000_000_000;
const KIND_SPAN = 10_000_000;

export function catalogId(kind: string, extId: string): number {
  const kindIndex = (CATALOG_KINDS as readonly string[]).indexOf(kind);
  if (kindIndex < 0) throw new Error(`not a catalog kind: ${kind}`);
  return CATALOG_ID_BASE + kindIndex * KIND_SPAN + Number(extId);
}

export function isCatalogId(id: number): boolean {
  return Number.isInteger(id) && id >= CATALOG_ID_BASE && id < CATALOG_ID_BASE + CATALOG_KINDS.length * KIND_SPAN;
}

const LICENCE = "Game data © Blizzard Entertainment, Inc.; not under Everloot's licence";

/** Only what the index reads of map.json: the dungeon and raid entrances and the build they came from. */
export const WorldMapEntrances = z.object({
  source: z.object({ version: z.string(), extractedAt: z.string() }),
  entrances: z.array(z.object({
    mapId: z.number().int(), name: z.string().optional(), raid: z.boolean(), minLevel: z.number().int().optional(), maxLevel: z.number().int().optional(),
  })),
});
export type WorldMapEntrances = z.infer<typeof WorldMapEntrances>;

export interface CatalogFiles {
  achievements?: ClientAchievements;
  mounts?: ClientMounts;
  encounters?: ClientEncounters;
  map?: WorldMapEntrances;
  legacyPerks?: LegacyPerkCatalog;
  races?: RaceTable;
  factions?: ClientFactions;
  titles?: ClientTitles;
  questLines?: ClientQuestLines;
}

export type CatalogRecord = SearchHit & { body: string; data: Record<string, unknown> };

export interface CatalogIndex {
  byKind: Map<string, CatalogRecord[]>;
  byId: Map<number, CatalogRecord>;
  byName: Map<string, CatalogRecord[]>;
}

/** The file parsed with its schema, or undefined when it is not there. A file that is there but wrong still throws. */
function readJson<T>(root: string, file: string, schema: z.ZodType<T>): T | undefined {
  const path = join(root, file);
  return existsSync(path) ? schema.parse(JSON.parse(readFileSync(path, "utf8"))) : undefined;
}

/** Reads the catalogs under `root` (web/src/data/game-data). Node only. A missing file is listed, never thrown. */
export function readCatalogFiles(root: string): { files: CatalogFiles; missing: string[] } {
  const missing: string[] = [];
  const get = <T>(file: string, schema: z.ZodType<T>): T | undefined => {
    const f = readJson(root, file, schema);
    if (f === undefined) missing.push(file);
    return f;
  };
  const files: CatalogFiles = {
    achievements: get("client-achievements.json", ClientAchievements),
    mounts: get("client-mounts.json", ClientMounts),
    legacyPerks: get("legacy-perks.json", LegacyPerkCatalog),
    races: get("races.json", RaceTable),
    encounters: get("client-encounters.json", ClientEncounters),
    map: get("map.json", WorldMapEntrances),
    factions: get("client-factions.json", ClientFactions),
    titles: get("client-titles.json", ClientTitles),
    questLines: get("client-quest-lines.json", ClientQuestLines),
  };
  return { files, missing };
}

interface Stamp { version: string; extractedAt: string }

const show = (v: unknown): string =>
  Array.isArray(v) ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : String(v);

/** One record: the name, then one `field: value` line per field; `data` carries the build and the same fields. */
function record(kind: CatalogKind, extId: string, name: string, stamp: Stamp, fields: Record<string, unknown>): CatalogRecord {
  const body = [name, ...Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${show(v)}`)].join("\n");
  return {
    id: catalogId(kind, extId),
    extId,
    kind,
    name,
    snippet: body.slice(0, 160),
    gameVersion: "forever",
    sourceId: "game-files",
    sourceUrl: `${SITE}${catalogPath(kind, extId, name)}`,
    licence: LICENCE,
    retrievedAt: stamp.extractedAt,
    body,
    data: { build: stamp.version, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) },
  };
}

const stampOf = (f: { build: Stamp }): Stamp => f.build;

function recordsOfAchievements(f: ClientAchievements): CatalogRecord[] {
  return Object.entries(f.achievements).filter(([, a]) => !a.statistic).map(([id, a]) =>
    record("achievement", id, a.title, stampOf(f), { points: a.points, criteriaCount: a.criteria.length, description: a.description }));
}

function recordsOfMounts(f: ClientMounts): CatalogRecord[] {
  return Object.entries(f.mounts).map(([id, m]) => record("mount", id, m.name, stampOf(f), { spellId: m.spellId, ridingSkill: m.ridingSkill }));
}

function recordsOfLegacyPerks(f: LegacyPerkCatalog): CatalogRecord[] {
  const out: CatalogRecord[] = [];
  for (const tree of f.trees) {
    for (const node of tree.nodes) {
      for (const e of node.entries) {
        if (e.name === null) continue;
        out.push(record("legacy_perk", String(e.id), e.name, stampOf(f), {
          treeId: tree.id, nodeId: node.id, spellId: e.spellId, maxRanks: e.maxRanks ?? undefined,
        }));
      }
    }
  }
  return out;
}

function recordsOfRaces(f: RaceTable): CatalogRecord[] {
  return f.races.map((r) => record("race", String(r.id), r.name, stampOf(f), {
    faction: r.faction, classes: r.classes.map((c) => c.name), traits: r.traits.map((t) => t.name),
  }));
}

function recordsOfInstances(map: WorldMapEntrances, encounters: ClientEncounters | undefined): CatalogRecord[] {
  return map.entrances.flatMap((e) => {
    if (!e.name) return [];
    const list = (encounters?.instances[String(e.mapId)] ?? []).map((x) => ({ id: x.id, name: x.name }));
    return [record("instance", String(e.mapId), e.name, map.source, { raid: e.raid, minLevel: e.minLevel, maxLevel: e.maxLevel, encounters: list })];
  });
}

function recordsOfFactions(f: ClientFactions): CatalogRecord[] {
  return f.factions.map((x) => record("faction", String(x.id), x.name, stampOf(f), { parentId: x.parentId, shown: x.shown }));
}

function recordsOfTitles(f: ClientTitles): CatalogRecord[] {
  return f.titles.map((t) => record("title", String(t.id), t.name, stampOf(f), {}));
}

function recordsOfQuestLines(f: ClientQuestLines): CatalogRecord[] {
  return f.questLines.map((q) => record("quest_chain", String(q.id), q.name, stampOf(f), { questIds: q.questIds, questCount: q.questIds.length }));
}

/** Pure: builds the index from parsed files. A file that is undefined gives no records. */
export function buildCatalogIndex(files: CatalogFiles): CatalogIndex {
  const all: CatalogRecord[] = [
    ...(files.achievements ? recordsOfAchievements(files.achievements) : []),
    ...(files.factions ? recordsOfFactions(files.factions) : []),
    ...(files.titles ? recordsOfTitles(files.titles) : []),
    ...(files.questLines ? recordsOfQuestLines(files.questLines) : []),
    ...(files.mounts ? recordsOfMounts(files.mounts) : []),
    ...(files.legacyPerks ? recordsOfLegacyPerks(files.legacyPerks) : []),
    ...(files.races ? recordsOfRaces(files.races) : []),
    ...(files.map ? recordsOfInstances(files.map, files.encounters) : []),
  ];
  const index: CatalogIndex = { byKind: new Map(), byId: new Map(), byName: new Map() };
  for (const r of all) {
    index.byId.set(r.id, r);
    const kind = index.byKind.get(r.kind) ?? [];
    kind.push(r);
    index.byKind.set(r.kind, kind);
    const key = allTerms(r.name);
    const named = index.byName.get(key) ?? [];
    named.push(r);
    index.byName.set(key, named);
  }
  return index;
}

/** Exact normalised name first, then names holding every query term, then names holding any term. */
export function searchCatalog(index: CatalogIndex, query: string, opts: { kinds?: string[]; limit?: number } = {}): CatalogRecord[] {
  const q = allTerms(query);
  if (!q) return [];
  const terms = q.split(" ");
  const limit = opts.limit ?? 10;
  const kinds = opts.kinds ? new Set(opts.kinds) : undefined;
  const exact: CatalogRecord[] = [];
  const every: CatalogRecord[] = [];
  const some: CatalogRecord[] = [];
  for (const [key, records] of index.byName) {
    const words = new Set(key.split(" "));
    const hits = terms.filter((t) => words.has(t)).length;
    if (hits === 0) continue;
    const tier = key === q ? exact : hits === terms.length ? every : some;
    for (const r of records) if (!kinds || kinds.has(r.kind)) tier.push(r);
  }
  return [...exact, ...every, ...some].slice(0, limit);
}

export function getCatalogEntity(index: CatalogIndex, id: number): CatalogRecord | undefined {
  return index.byId.get(id);
}

/** Exact, case-insensitive name match, optionally within one kind. */
export function getCatalogByName(index: CatalogIndex, name: string, kind?: string): CatalogRecord[] {
  const lower = name.toLowerCase();
  return (index.byName.get(allTerms(name)) ?? []).filter((r) => r.name.toLowerCase() === lower && (!kind || r.kind === kind));
}

export function catalogCounts(index: CatalogIndex): Record<string, number> {
  return Object.fromEntries([...index.byKind].map(([k, v]) => [k, v.length]));
}
