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
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL } from "./edges.js";
import { expandAliases } from "./name-aliases.js";
import { allTerms, contentTerms, PICK_WORDS, type SearchHit } from "./search.js";
import { fromSpanish } from "./spanish.js";
import { itemFactsFromRecords } from "./drop-rollup.js";
import { agreedItemNames } from "./item-page.js";
import { agreedNpcNames, agreedQuestTitles, worldFactsFromRecords } from "./world-pages.js";
import { agreedObjectNames } from "./object-spawns.js";
import type { RecheckScope } from "./coverage.js";

// Append only: each position owns a permanent record-id range.
export const CATALOG_KINDS = ["achievement", "faction", "title", "quest_chain", "mount", "legacy_perk", "race", "instance", "item", "npc", "object", "quest", "zone"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

/** Catalog ids start here, far above any release rowid, and are the same on every build. */
export const CATALOG_ID_BASE = 1_000_000_000;
const KIND_SPAN = 10_000_000;

export function catalogId(kind: string, extId: string): number {
  const kindIndex = (CATALOG_KINDS as readonly string[]).indexOf(kind);
  if (kindIndex < 0) throw new Error(`not a catalog kind: ${kind}`);
  const n = Number(extId);
  // An id outside its kind's span would land in the next kind's range; "" and "1e3" are numbers but not ids.
  if (!/^\d+$/.test(extId) || n >= KIND_SPAN) throw new Error(`not a catalog id for ${kind}: ${extId}`);
  return CATALOG_ID_BASE + kindIndex * KIND_SPAN + n;
}

export function isCatalogId(id: number): boolean {
  return Number.isInteger(id) && id >= CATALOG_ID_BASE && id < CATALOG_ID_BASE + CATALOG_KINDS.length * KIND_SPAN;
}

export const CATALOG_LICENCE = "Game data © Blizzard Entertainment, Inc.; not under Everloot's licence";

/** Only what the index reads of map.json: released zones, dungeon and raid entrances, and their build. */
export const WorldMapEntrances = z.object({
  source: z.object({ version: z.string(), extractedAt: z.string() }),
  zones: z.array(z.object({ uiMapId: z.number().int(), name: z.string() })).optional(),
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

const isNamed = (x: unknown): x is { id: number; name: string } => typeof x === "object" && x !== null && "id" in x && "name" in x;

/** A list of named things reads as one `name (id)` line each; any other field is `field: value`. */
function fieldLine(key: string, value: unknown): string {
  if (Array.isArray(value) && value.length > 0 && value.every(isNamed)) return `${key}:\n${value.map((x) => `${x.name} (${x.id})`).join("\n")}`;
  return `${key}: ${show(value)}`;
}

/** The line every catalog answer carries: where the fact comes from and which build it was read in. */
export const catalogLabel = (build: string): string => `${CLIENT_LABEL} (build ${build}).`;

/** A record's body: the name, the game-file label with its build, then one `field: value` line per field. */
export function bodyOf(name: string, build: string, fields: Record<string, unknown>): string {
  const lines = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => fieldLine(k, v));
  return [name, catalogLabel(build), ...lines].join("\n");
}

/**
 * One record: the name, the game-file label with its build, then one `field: value` line per field; `data` carries
 * the build and the same fields. An empty name or a development leftover gives no record, for every kind.
 */
function record(kind: CatalogKind, extId: string, name: string, stamp: Stamp, fields: Record<string, unknown>): CatalogRecord | undefined {
  if (name.trim() === "" || isDevelopmentItemName(name)) return undefined;
  const body = bodyOf(name, stamp.version, fields);
  return {
    id: catalogId(kind, extId),
    recordId: catalogId(kind, extId),
    gameId: Number(extId),
    sourceKind: "game-files",
    build: stamp.version,
    extId,
    kind,
    name,
    snippet: body.slice(0, 160),
    gameVersion: "forever",
    sourceId: "game-files",
    sourceUrl: `${SITE}${catalogPath(kind, extId, name, "game-files")}`,
    licence: CATALOG_LICENCE,
    retrievedAt: stamp.extractedAt,
    body,
    data: { build: stamp.version, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) },
  };
}

const stampOf = (f: { build: Stamp }): Stamp => f.build;

function recordsOfAchievements(f: ClientAchievements): (CatalogRecord | undefined)[] {
  return Object.entries(f.achievements).filter(([, a]) => !a.statistic).map(([id, a]) =>
    record("achievement", id, a.title, stampOf(f), { points: a.points, criteriaCount: a.criteria.length }));
}

function recordsOfMounts(f: ClientMounts): (CatalogRecord | undefined)[] {
  return Object.entries(f.mounts).map(([id, m]) => record("mount", id, m.name, stampOf(f), { spellId: m.spellId, ridingSkill: m.ridingSkill }));
}

function recordsOfLegacyPerks(f: LegacyPerkCatalog): (CatalogRecord | undefined)[] {
  const out: (CatalogRecord | undefined)[] = [];
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

function recordsOfRaces(f: RaceTable): (CatalogRecord | undefined)[] {
  return f.races.map((r) => record("race", String(r.id), r.name, stampOf(f), {
    faction: r.faction, classes: r.classes.map((c) => c.name), traits: r.traits.map((t) => t.name),
  }));
}

function recordsOfInstances(map: WorldMapEntrances, encounters: ClientEncounters | undefined): (CatalogRecord | undefined)[] {
  return map.entrances.flatMap((e) => {
    if (!e.name) return [];
    const list = (encounters?.instances[String(e.mapId)] ?? []).map((x) => ({ id: x.id, name: x.name }));
    return [record("instance", String(e.mapId), e.name, map.source, { raid: e.raid, minLevel: e.minLevel, maxLevel: e.maxLevel, encounters: list })];
  });
}

function recordsOfFactions(f: ClientFactions): (CatalogRecord | undefined)[] {
  // The site lists and links only the factions the game shows; the others are internal names with no page.
  return f.factions.filter((x) => x.shown).map((x) => record("faction", String(x.id), x.name, stampOf(f), { parentId: x.parentId, shown: x.shown }));
}

function recordsOfTitles(f: ClientTitles): (CatalogRecord | undefined)[] {
  return f.titles.map((t) => record("title", String(t.id), t.name, stampOf(f), {}));
}

function recordsOfQuestLines(f: ClientQuestLines): (CatalogRecord | undefined)[] {
  return f.questLines.map((q) => record("quest_chain", String(q.id), q.name, stampOf(f), { questIds: q.questIds, questCount: q.questIds.length }));
}

/** Pure: builds the index from parsed files. A file that is undefined gives no records. */
export function buildCatalogIndex(files: CatalogFiles): CatalogIndex {
  const all = [
    ...(files.achievements ? recordsOfAchievements(files.achievements) : []),
    ...(files.factions ? recordsOfFactions(files.factions) : []),
    ...(files.titles ? recordsOfTitles(files.titles) : []),
    ...(files.questLines ? recordsOfQuestLines(files.questLines) : []),
    ...(files.mounts ? recordsOfMounts(files.mounts) : []),
    ...(files.legacyPerks ? recordsOfLegacyPerks(files.legacyPerks) : []),
    ...(files.races ? recordsOfRaces(files.races) : []),
    ...(files.map ? recordsOfInstances(files.map, files.encounters) : []),
    ...(files.map?.zones ?? []).map((zone) => record("zone", String(zone.uiMapId), zone.name, files.map!.source, { uiMapId: zone.uiMapId })),
  ].filter((r): r is CatalogRecord => r !== undefined);
  return indexRecords(all);
}

/** Only agreed names and ids leave the corpus here; no tooltip, description or other game text. */
export function gameplayIndex(records: unknown[], asOf: string | null, recheck: readonly RecheckScope[] = []): CatalogIndex {
  const items = itemFactsFromRecords(records, recheck);
  const world = worldFactsFromRecords(records, recheck);
  const names = {
    item: agreedItemNames(items), npc: agreedNpcNames(world), quest: agreedQuestTitles(world),
    object: agreedObjectNames(items.objects, recheck),
  };
  const all: CatalogRecord[] = [];
  for (const [kind, named] of Object.entries(names)) for (const [gameId, name] of named) {
    if (isDevelopmentItemName(name)) continue;
    const id = catalogId(kind, String(gameId));
    const body = `${name}\n${kind} gameId: ${gameId}\nName agreed by 3 or more installs. Snapshot: ${asOf ?? "unrecorded"}.`;
    all.push({ id, recordId: id, gameId, extId: String(gameId), kind, name, snippet: body,
      gameVersion: "forever", sourceKind: "observed", observed: { asOf },
      sourceId: "player-uploads", sourceUrl: `${SITE}${catalogPath(kind, String(gameId), name, "observed")}`,
      licence: "CC-BY-SA-4.0", retrievedAt: asOf ?? "unrecorded", body,
      data: { gameId, kind, name, observed: { asOf } },
    });
  }
  return indexRecords(all);
}

/** Rebuild all lookup maps together so a refreshed corpus cannot leave stale name entries. */
export function mergeCatalogIndexes(...indexes: (CatalogIndex | null)[]): CatalogIndex {
  return indexRecords(indexes.flatMap((index) => index ? [...index.byId.values()] : []));
}

function indexRecords(all: CatalogRecord[]): CatalogIndex {
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

/**
 * Exact normalised name first, then names holding every query term, then (unless `anyWord` is false) names holding
 * any term, those with more of the asked words first. The query is read the way `search` reads it: short forms
 * expanded, Spanish glossed, stopwords dropped. Pick words ("best") never match on their own.
 */
export function searchCatalog(index: CatalogIndex, query: string, opts: { kinds?: string[]; limit?: number; anyWord?: boolean } = {}): CatalogRecord[] {
  const { text } = expandAliases(fromSpanish(query.trim()));
  const terms = [...new Set(contentTerms(text))];
  if (terms.length === 0) return [];
  const asked = new Set([allTerms(text), terms.join(" ")]);
  const pickless = terms.filter((t) => !PICK_WORDS.has(t));
  const limit = opts.limit ?? 10;
  const kinds = opts.kinds ? new Set(opts.kinds) : undefined;
  const exact: CatalogRecord[] = [];
  const every: CatalogRecord[] = [];
  const some: { record: CatalogRecord; count: number }[] = [];
  for (const [key, records] of index.byName) {
    const words = new Set(key.split(" "));
    const wanted = records.filter((r) => !kinds || kinds.has(r.kind));
    if (asked.has(key)) exact.push(...wanted);
    else if (terms.every((t) => words.has(t))) every.push(...wanted);
    else if (opts.anyWord !== false) {
      const count = pickless.filter((t) => words.has(t)).length;
      if (count > 0) some.push(...wanted.map((record) => ({ record, count })));
    }
  }
  // The sort is stable, so names with the same count keep the index's order.
  const ranked = some.sort((a, b) => b.count - a.count).map((s) => s.record);
  return [...exact, ...every, ...ranked].slice(0, limit);
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
