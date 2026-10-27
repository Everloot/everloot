/**
 * The race table: which races can be made with which class, on which faction, and each race's racial
 * traits, read from one build's game files (`ChrRaces`, `CharBaseInfo`, `ChrClasses`,
 * `ChrRaceRacialAbility`). Blizzard's data, labelled "found in game files, unconfirmed", stamped with the
 * build and committed as a game-data file (docs/DATA_POLICY.md, "Races, classes and racial traits").
 * Ids, pairs and trait names may go anywhere the client layer goes; a trait's description is game text and
 * stays on pages: the MCP tool and the API leave it out.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables, type ClientBuildMeta } from "./client-snapshot.js";
import { CLIENT_LABEL } from "./edges.js";
import type { TableReader } from "./talents/build-catalog.js";

export const RACES_SCHEMA = "everloot.races/1";

export const RACE_FACTIONS = ["Alliance", "Horde", "Neutral"] as const;
/** `ChrRaces.Alliance`: 0 Alliance, 1 Horde, 2 neither. */
const FACTION_OF: Record<number, (typeof RACE_FACTIONS)[number]> = { 0: "Alliance", 1: "Horde", 2: "Neutral" };

export const RaceTrait = z.object({
  /** The trait's name, without the "<Race> - Active - " prefix of `Name_lang`. */
  name: z.string(),
  kind: z.enum(["active", "passive"]),
  /** The client's order on the character screen. */
  order: z.number().int(),
  /** The short text with colour codes stripped. Game text: pages only, never in API or MCP answers. */
  description: z.string(),
});
export type RaceTrait = z.infer<typeof RaceTrait>;

export const RaceTable = z.object({
  schema: z.literal(RACES_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  /** Every race at least one class can be made with in this build, by id. */
  races: z.array(z.object({
    id: z.number().int(),
    name: z.string(),
    faction: z.enum(RACE_FACTIONS),
    /** From `CharBaseInfo`, by class id. */
    classes: z.array(z.object({ id: z.number().int(), name: z.string() })),
    traits: z.array(RaceTrait),
  })),
});
export type RaceTable = z.infer<typeof RaceTable>;
export type Race = RaceTable["races"][number];

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "Orc - Active - Blood Fury" and "Skyborne - Horde - Passive - Wind Blessed": the kind, then the name. */
const TRAIT_NAME = /^.+? - (Active|Passive) - (.+)$/;

/**
 * A trait's short text as plain words: the client's colour codes (`|cn…:`, `|cFFxxxxxx`, `|r`) removed, and
 * the leading label dropped when it only repeats the trait's name ("Hardiness (Passive):").
 */
export function traitText(raw: unknown, name: string): string {
  const plain = str(raw).replace(/\|cn[A-Z0-9_]+:/g, "").replace(/\|c[0-9A-Fa-f]{8}/g, "").replace(/\|r/g, "").replace(/\s+/g, " ").trim();
  const label = `${name}:`;
  const passive = `${name} (Passive):`;
  for (const prefix of [passive, label]) if (plain.startsWith(prefix)) return plain.slice(prefix.length).trim();
  return plain;
}

export function buildRaceTable(get: TableReader, meta: ClientBuildMeta): RaceTable {
  const classNames = new Map([...(get("ChrClasses")?.values() ?? [])].map((r) => [num(r.ID), str(r.Name_lang)]));
  const classesOf = new Map<number, Set<number>>();
  for (const r of get("CharBaseInfo")?.values() ?? []) {
    const race = num(r.RaceID), cls = num(r.ClassID);
    if (!classNames.has(cls)) throw new Error(`CharBaseInfo ${num(r.ID)} names class ${cls}, which ChrClasses does not have`);
    classesOf.set(race, (classesOf.get(race) ?? new Set()).add(cls));
  }
  const traitsOf = new Map<number, (RaceTrait & { id: number })[]>();
  for (const r of get("ChrRaceRacialAbility")?.values() ?? []) {
    const m = TRAIT_NAME.exec(str(r.Name_lang));
    // Never guessed: a name the pattern does not read stops the run, so the file is fixed, not quietly wrong.
    if (!m) throw new Error(`ChrRaceRacialAbility ${num(r.ID)}: cannot read "${str(r.Name_lang)}" as "<race> - Active|Passive - <name>"`);
    const name = m[2].trim();
    const race = num(r.ChrRacesID);
    traitsOf.set(race, [...(traitsOf.get(race) ?? []), {
      id: num(r.ID), name, kind: m[1] === "Active" ? "active" : "passive", order: num(r.Order), description: traitText(r.DescriptionShort_lang, name),
    }]);
  }
  const races: Race[] = [];
  for (const r of [...(get("ChrRaces")?.values() ?? [])].sort((a, b) => num(a.ID) - num(b.ID))) {
    const id = num(r.ID);
    const classes = classesOf.get(id);
    if (num(r.PlayableRaceBit) < 0 || !classes?.size) continue;
    const faction = FACTION_OF[num(r.Alliance)];
    if (!faction) throw new Error(`ChrRaces ${id}: Alliance ${String(r.Alliance)} is not 0, 1 or 2`);
    races.push({
      id, name: str(r.Name_lang), faction,
      classes: [...classes].sort((a, b) => a - b).map((c) => ({ id: c, name: classNames.get(c)! })),
      traits: (traitsOf.get(id) ?? []).sort((a, b) => a.order - b.order || a.id - b.id).map(({ id: _id, ...t }) => t),
    });
  }
  return RaceTable.parse({
    schema: RACES_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    races,
  });
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/races.json). */
export function writeRaceTable(snapshotPath: string, path: string): RaceTable {
  const present = new Set(readClientTables(snapshotPath));
  const table = buildRaceTable((t) => (present.has(t) ? readClientRows(snapshotPath, t) : undefined), readClientMeta(snapshotPath));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(table, null, 1)}\n`);
  return table;
}
