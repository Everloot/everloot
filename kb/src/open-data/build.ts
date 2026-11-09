import { GATHER_KINDS, INSTANCE_TYPES, NPC_ROLES, RELS, ENTITY_KINDS } from "@everloot/protocol";
import { z } from "zod";
import { rollupDrops, lootWindowsFromRecords } from "../drop-rollup.js";
import { observedEdges, type Edge } from "../edges.js";
import { tallyVotes, WORLD_AGREEMENT } from "../fact-states.js";
import { confirmedEntrances, instanceBosses, instanceFactsFromRecords } from "../instances.js";
import { describe, type Taxonomy } from "../item-taxonomy.js";
import { objectSightingRowsFromRecords, objectSpawnRowsFromRecords, objectSpawns } from "../object-spawns.js";
import { foldRecorderInstalls } from "../recorder-installs.js";
import { vendorPage, npcPage, questTraits, worldFactsFromRecords } from "../world-pages.js";
import { itemFactsFromRecords } from "../drop-rollup.js";
import { placeFlights } from "../world-coords.js";
import type { WorldMapData } from "../world-map-data.js";
import { RAID_SCOPES, RAID_TREE_PROOFS, type OpenDataCatalogs } from "./game-data.js";
import type { OpenDataLayer } from "./manifest.js";

/**
 * The datasets of the open data export (docs/2026-10-22-lane-open-data-export-closeout.md).
 *
 * The observed datasets are built from the same readers the site's pages use, and every row's schema makes the rule
 * a type: each `installs` count is an integer of at least three, and the objects are strict, so a row with fewer
 * installs, or with a key the schema does not name (an install id, a character name), is refused by `parse`
 * before it can be written. The game-file datasets are Blizzard's and are read from the committed game-data files.
 */

/** The record kinds the observed datasets read. Anything else in the input, named records included, is dropped first. */
export const OPEN_DATA_KINDS = ["npc_sighting", "quest", "vendor", "loot", "item_seen", "instance_entrance", "encounter", "object_sighting"] as const;

const INSTALLS = z.number().int().min(WORLD_AGREEMENT).describe(`How many installs agree. At least ${WORLD_AGREEMENT}.`);
const ID = z.number().int().positive();
const MAP = z.number().int().nonnegative().describe("The game's map id (a UiMap id for a zone).");
const COORD = z.number().min(0).max(100).describe("A position on the 0 to 100 map scale.");
const TIME = z.string().datetime({ offset: true }).nullable();
const NAME_OR_NULL = (what: string) => z.string().nullable().describe(`${what}; null when fewer than ${WORLD_AGREEMENT} installs agree on one.`);
const INT_OR_NULL = (what: string) => z.number().int().nullable().describe(`${what}; null when fewer than ${WORLD_AGREEMENT} installs agree on one.`);

/** A fact and the count behind it are both set or both null: a value with no count, or a count with no value, is a bug. */
function paired(value: Record<string, unknown>, counts: Record<string, unknown>, ctx: z.RefinementCtx) {
  for (const [key, count] of Object.entries(counts)) {
    if ((value[key] === null) !== (count === null)) ctx.addIssue({ code: "custom", message: `${key}: the value and its installs count must both be set or both null` });
  }
}

export interface Dataset {
  /** File name without extension. */
  name: string;
  layer: OpenDataLayer;
  about: string;
  schema: z.ZodType;
  rows: unknown[];
  /** The denominator; null when the layer has no count of its own. */
  candidates: number | null;
  candidatesAre: string;
}

const group = <T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> => {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
};
const byNumber = <T extends object>(rows: T[], key: (row: T) => number) => rows.sort((a, b) => key(a) - key(b));

/** The value 3 or more installs agree on, with how many agree; null when no value has three or two have. */
function agree(rows: readonly { installId: string; value: string | number }[]): { value: string | number; installs: number } | null {
  const winner = tallyVotes(rows).winner;
  return winner ? { value: winner.value, installs: winner.voters.size } : null;
}
const text = (a: ReturnType<typeof agree>) => (a ? (a.value as string) : null);
const num = (a: ReturnType<typeof agree>) => (a ? (a.value as number) : null);

// ---- observed ------------------------------------------------------------------------------------------------

const npcRow = z.object({
  npcId: ID,
  name: NAME_OR_NULL("The NPC's name"),
  level: INT_OR_NULL("The NPC's level"),
  creatureType: NAME_OR_NULL("The creature type the game shows (Beast, Undead, Humanoid)"),
  rank: NAME_OR_NULL("normal, elite, rare, rare_elite or boss"),
  roles: z.array(z.object({ role: z.enum(NPC_ROLES), installs: INSTALLS }).strict()).describe("What the NPC does for players, each role seen by 3 or more installs from its window."),
  pins: z.array(z.object({ mapId: MAP, x: COORD, y: COORD, installs: INSTALLS }).strict()).describe("Where the NPC stands: the median of the installs' positions on each map where 3 or more measured it."),
  installs: z.object({ name: INSTALLS.nullable(), level: INSTALLS.nullable(), creatureType: INSTALLS.nullable(), rank: INSTALLS.nullable() }).strict(),
}).strict().superRefine((r, ctx) => paired(r, r.installs, ctx));

function npcs(records: readonly unknown[]): Dataset {
  const byId = group(worldFactsFromRecords([...records]).npcs, (r) => r.npcId);
  const rows: z.infer<typeof npcRow>[] = [];
  for (const [npcId, sightings] of byId) {
    const pick = <K extends "name" | "level" | "creatureType" | "rank">(field: K) =>
      agree(sightings.flatMap((r) => (r[field] === undefined ? [] : [{ installId: r.installId, value: r[field] as string | number }])));
    const [name, level, creatureType, rank] = [pick("name"), pick("level"), pick("creatureType"), pick("rank")];
    const roleInstalls = new Map<string, Set<string>>();
    for (const r of sightings) {
      if (r.positionKind !== "interaction" || !r.role || !r.installId.trim()) continue;
      roleInstalls.set(r.role, (roleInstalls.get(r.role) ?? new Set<string>()).add(r.installId.trim()));
    }
    const roles = NPC_ROLES.flatMap((role) => (roleInstalls.get(role)?.size ?? 0) >= WORLD_AGREEMENT ? [{ role, installs: roleInstalls.get(role)!.size }] : []);
    const pins = npcPage(npcId, { npcs: sightings, quests: [], vendors: [] }).pins.map((p) => ({ mapId: p.mapId, x: p.x, y: p.y, installs: p.reporters }));
    if (!name && !level && !creatureType && !rank && !roles.length && !pins.length) continue;
    rows.push({
      npcId, name: text(name), level: num(level), creatureType: text(creatureType), rank: text(rank) as string | null, roles, pins,
      installs: { name: name?.installs ?? null, level: level?.installs ?? null, creatureType: creatureType?.installs ?? null, rank: rank?.installs ?? null },
    });
  }
  return {
    name: "npcs", layer: "observed", about: "NPCs: name, level, creature type, rank, roles and where they stand, each fact only when 3 or more installs agree.",
    schema: npcRow, rows: byNumber(rows, (r) => r.npcId), candidates: byId.size, candidatesAre: "NPCs that at least one install reported",
  };
}

const questRow = z.object({
  questId: ID,
  title: NAME_OR_NULL("The quest's title"),
  level: INT_OR_NULL("The quest's level"),
  giverNpcId: INT_OR_NULL("The NPC who gives the quest"),
  turnInNpcId: INT_OR_NULL("The NPC the quest is turned in to"),
  category: NAME_OR_NULL("The quest log header the quest sits under"),
  side: z.enum(["alliance", "horde", "both"]).nullable().describe("Alliance or Horde when 3 or more installs on that faction report it and none on the other; both when 3 on each; null otherwise."),
  suggestedGroup: INT_OR_NULL("The suggested group size"),
  tag: NAME_OR_NULL("group, dungeon, raid or pvp"),
  rewards: z.array(z.object({ itemId: ID, installs: INSTALLS }).strict()).describe("Reward item ids that 3 or more installs report."),
  installs: z.object({
    title: INSTALLS.nullable(), level: INSTALLS.nullable(), giverNpcId: INSTALLS.nullable(), turnInNpcId: INSTALLS.nullable(),
    category: INSTALLS.nullable(), side: INSTALLS.nullable(), suggestedGroup: INSTALLS.nullable(), tag: INSTALLS.nullable(),
  }).strict(),
}).strict().superRefine((r, ctx) => paired(r, r.installs, ctx));

function quests(records: readonly unknown[]): Dataset {
  const byId = group(worldFactsFromRecords([...records]).quests, (r) => r.questId);
  const rows: z.infer<typeof questRow>[] = [];
  for (const [questId, sightings] of byId) {
    const pick = (field: "title" | "level" | "giverNpcId" | "turnInNpcId" | "category" | "suggestedGroup" | "tag") =>
      agree(sightings.flatMap((r) => (r[field] === undefined ? [] : [{ installId: r.installId, value: r[field] as string | number }])));
    const [title, level, giver, turnIn, category, suggestedGroup, tag] =
      [pick("title"), pick("level"), pick("giverNpcId"), pick("turnInNpcId"), pick("category"), pick("suggestedGroup"), pick("tag")];
    const side = questTraits(sightings).side;
    const factions = { alliance: new Set<string>(), horde: new Set<string>() };
    for (const r of sightings) if (r.faction && r.installId.trim()) factions[r.faction].add(r.installId.trim());
    const sideInstalls = side === "both" ? Math.min(factions.alliance.size, factions.horde.size) : side ? factions[side].size : null;
    const rewardInstalls = new Map<number, Set<string>>();
    for (const r of sightings) {
      for (const itemId of r.rewardItemIds) {
        if (Number.isInteger(itemId) && itemId > 0 && r.installId.trim()) rewardInstalls.set(itemId, (rewardInstalls.get(itemId) ?? new Set<string>()).add(r.installId.trim()));
      }
    }
    const rewards = [...rewardInstalls].filter(([, set]) => set.size >= WORLD_AGREEMENT).map(([itemId, set]) => ({ itemId, installs: set.size })).sort((a, b) => a.itemId - b.itemId);
    if (!title && !level && !giver && !turnIn && !category && !suggestedGroup && !tag && !side && !rewards.length) continue;
    rows.push({
      questId, title: text(title), level: num(level), giverNpcId: num(giver), turnInNpcId: num(turnIn), category: text(category), side,
      suggestedGroup: num(suggestedGroup), tag: text(tag), rewards,
      installs: {
        title: title?.installs ?? null, level: level?.installs ?? null, giverNpcId: giver?.installs ?? null, turnInNpcId: turnIn?.installs ?? null,
        category: category?.installs ?? null, side: sideInstalls, suggestedGroup: suggestedGroup?.installs ?? null, tag: tag?.installs ?? null,
      },
    });
  }
  return {
    name: "quests", layer: "observed", about: "Quests: title, level, giver, turn-in, category, side, group size, tag and reward item ids, each only when 3 or more installs agree.",
    schema: questRow, rows: byNumber(rows, (r) => r.questId), candidates: byId.size, candidatesAre: "quests that at least one install reported",
  };
}

const vendorRow = z.object({
  vendorNpcId: ID, itemId: ID,
  priceCopper: z.number().int().nonnegative(),
  limitedStock: z.number().int().positive().nullable().describe("The stock 3 or more installs agree on; null when unlimited or not agreed."),
  unlimited: z.boolean().describe("True when 3 or more installs saw no stock limit. False with a null limitedStock means the stock is unrecorded, not unlimited."),
  installs: INSTALLS,
}).strict();

function vendorOffers(records: readonly unknown[]): Dataset {
  const byVendor = group(worldFactsFromRecords([...records]).vendors, (r) => r.vendorNpcId);
  const rows: z.infer<typeof vendorRow>[] = [];
  const reported = new Set<string>();
  for (const [vendorNpcId, offers] of byVendor) {
    for (const o of offers) if (o.installId.trim() && Number.isInteger(o.itemId) && o.itemId > 0 && Number.isInteger(o.priceCopper) && o.priceCopper >= 0) reported.add(`${vendorNpcId}|${o.itemId}|${o.priceCopper}`);
    for (const offer of vendorPage(vendorNpcId, { npcs: [], quests: [], vendors: offers }).offers) {
      rows.push({ vendorNpcId, itemId: offer.itemId, priceCopper: offer.priceCopper, limitedStock: offer.limitedStock, unlimited: offer.unlimited, installs: offer.reporters });
    }
  }
  rows.sort((a, b) => a.vendorNpcId - b.vendorNpcId || a.itemId - b.itemId || a.priceCopper - b.priceCopper);
  return {
    name: "vendor-offers", layer: "observed", about: "What vendors sell: an item at a copper price, only when 3 or more installs saw that item at that price.",
    schema: vendorRow, rows, candidates: reported.size, candidatesAre: "vendor, item and price combinations that at least one install reported",
  };
}

const SOURCE = { sourceNpcId: ID.nullable(), sourceObjectId: ID.nullable() };
const oneSource = (r: { sourceNpcId: number | null; sourceObjectId: number | null }, ctx: z.RefinementCtx) => {
  if ((r.sourceNpcId === null) === (r.sourceObjectId === null)) ctx.addIssue({ code: "custom", message: "exactly one of sourceNpcId and sourceObjectId is set" });
};
const dropRow = z.object({
  ...SOURCE, itemId: ID,
  lootWindows: z.number().int().positive().describe("Loot windows the game's loot API attributed to the source, from every install together."),
  windowsWithItem: z.number().int().positive().describe("Of those windows, how many held the item."),
  rate: z.number().min(0).max(1).describe("windowsWithItem / lootWindows. A share of loot windows, not a kill-based drop chance."),
  installs: INSTALLS.describe(`Installs that opened a loot window on the source. At least ${WORLD_AGREEMENT}.`),
}).strict().superRefine(oneSource);
const zeroRow = z.object({
  ...SOURCE,
  lootWindows: z.number().int().positive().describe("Loot windows opened on the source, none with an item."),
  installs: INSTALLS,
}).strict().superRefine(oneSource);

function drops(records: readonly unknown[]): Dataset[] {
  const rolled = rollupDrops(lootWindowsFromRecords([...records]));
  const sources = (r: { sourceNpcId?: number; sourceObjectId?: number }) => ({ sourceNpcId: r.sourceNpcId ?? null, sourceObjectId: r.sourceObjectId ?? null });
  const rates = rolled.rates.filter((r) => r.public && r.drops > 0).map((r) => ({
    ...sources(r), itemId: r.itemId, lootWindows: r.kills, windowsWithItem: r.drops, rate: r.rate, installs: r.reporters,
  }));
  const zeros = rolled.measuredZeros.filter((z) => z.public).map((z) => ({ ...sources(z), lootWindows: z.kills, installs: z.reporters }));
  return [
    {
      name: "drop-rates", layer: "observed", about: "How often an item was in the loot windows opened on an NPC or an object, once 3 or more installs opened windows on it.",
      schema: dropRow, rows: rates, candidates: rolled.rates.filter((r) => r.drops > 0).length, candidatesAre: "source and item pairs seen in at least one loot window",
    },
    {
      name: "drop-measured-zeros", layer: "observed", about: "Sources whose loot windows held no item at all, once 3 or more installs opened windows on them.",
      schema: zeroRow, rows: zeros, candidates: rolled.measuredZeros.length, candidatesAre: "sources with at least one loot window and no item seen",
    },
  ];
}

const relationRow = z.object({
  fromKind: z.enum(ENTITY_KINDS), fromId: ID, rel: z.enum(RELS), toKind: z.enum(ENTITY_KINDS), toId: ID,
  installs: INSTALLS, firstSeen: TIME, lastSeen: TIME,
}).strict();

/** How many distinct relations anyone reported, to set beside the ones 3 installs agree on. Mirrors `observedEdges`' four kinds. */
function reportedRelations(records: readonly unknown[]): number {
  const keys = new Set<string>();
  const id = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0);
  for (const raw of records) {
    const r = raw as Record<string, unknown>;
    if (typeof r.installId !== "string" || !r.installId.trim()) continue;
    if (r.kind === "loot" && r.sourceEvidence === "loot-api" && Array.isArray(r.items)) {
      const source = id(r.sourceNpcId) ? `npc:${id(r.sourceNpcId)}` : id(r.sourceObjectId) ? `object:${id(r.sourceObjectId)}` : null;
      if (source) for (const it of r.items as { itemId?: unknown }[]) if (id(it?.itemId)) keys.add(`drop|${source}|${id(it.itemId)}`);
    }
    if (r.kind === "vendor" && id(r.vendorNpcId) && Array.isArray(r.items)) for (const o of r.items as { itemId?: unknown }[]) if (id(o?.itemId)) keys.add(`sold|${id(r.vendorNpcId)}|${id(o.itemId)}`);
    if (r.kind === "quest" && id(r.questId) && Array.isArray(r.rewardItemIds)) for (const item of r.rewardItemIds) if (id(item)) keys.add(`reward|${id(r.questId)}|${id(item)}`);
    if (r.kind === "npc_sighting" && ["npc", "interaction", "vignette"].includes(String(r.positionKind)) && id(r.npcId) && typeof r.mapId === "number" && Number.isInteger(r.mapId) && r.mapId >= 0) keys.add(`zone|${id(r.npcId)}|${r.mapId}`);
  }
  return keys.size;
}

function relations(records: readonly unknown[], asOf: Date): Dataset {
  const rows = observedEdges([...records], asOf).map((e) => ({
    fromKind: e.fromKind, fromId: e.fromId, rel: e.rel, toKind: e.toKind, toId: e.toId, installs: e.installs as number, firstSeen: e.firstSeen, lastSeen: e.lastSeen,
  })).sort((a, b) => a.rel.localeCompare(b.rel) || a.fromId - b.fromId || a.toId - b.toId);
  return {
    name: "relations", layer: "observed", about: "Relations players saw: dropped by, sold by, reward from and located in, each only when 3 or more installs agree.",
    schema: relationRow, rows, candidates: reportedRelations(records), candidatesAre: "relations (drop, vendor item, quest reward, NPC zone) that at least one install reported",
  };
}

const entranceRow = z.object({
  instanceMapId: ID.describe("The instance's map id, the id the game files' entrances carry."),
  mapId: MAP.describe("The outdoor map the install zoned in from."),
  x: COORD, y: COORD,
  name: NAME_OR_NULL("The instance's name"),
  instanceType: z.enum(INSTANCE_TYPES).nullable().describe("party (dungeon) or raid; null when fewer than 3 installs agree."),
  lastSeen: TIME,
  installs: z.object({ position: INSTALLS, name: INSTALLS.nullable(), instanceType: INSTALLS.nullable() }).strict(),
}).strict().superRefine((r, ctx) => paired({ name: r.name, instanceType: r.instanceType }, { name: r.installs.name, instanceType: r.installs.instanceType }, ctx));

const bossRow = z.object({
  instanceMapId: ID, encounterId: ID,
  name: NAME_OR_NULL("The boss encounter's name"),
  kills: z.number().int().nonnegative().describe("Kills reported, every install's together. A wipe is not a kill."),
  npcIds: z.array(z.object({ npcId: ID, installs: INSTALLS }).strict()).describe("Boss creature ids that 3 or more installs agree the encounter lists."),
  lastSeen: TIME,
  installs: z.object({ listed: INSTALLS, name: INSTALLS.nullable() }).strict(),
}).strict().superRefine((r, ctx) => paired({ name: r.name }, { name: r.installs.name }, ctx));

function instances(records: readonly unknown[], asOf: Date): Dataset[] {
  const facts = instanceFactsFromRecords([...records]);
  const labelled = <T extends { installId: string }>(rows: T[], id: (r: T) => number, value: (r: T) => string) =>
    new Map([...group(rows, id)].map(([key, list]) => [key, agree(list.map((r) => ({ installId: r.installId, value: value(r) })))]));
  const names = labelled(facts.entrances, (r) => r.instanceMapId, (r) => r.name);
  const types = labelled(facts.entrances, (r) => r.instanceMapId, (r) => r.instanceType);
  const places = new Set(facts.entrances.map((r) => `${r.instanceMapId}|${r.mapId}`));
  const entrances = confirmedEntrances(facts.entrances, asOf).map((e) => ({
    instanceMapId: e.instanceMapId, mapId: e.mapId, x: e.x, y: e.y, name: e.name, instanceType: e.instanceType, lastSeen: e.lastSeen,
    installs: { position: e.reporters, name: e.name === null ? null : names.get(e.instanceMapId)?.installs ?? null, instanceType: e.instanceType === null ? null : types.get(e.instanceMapId)?.installs ?? null },
  }));
  const encounters = group(facts.encounters, (r) => `${r.instanceMapId}|${r.encounterId}`);
  const bosses = [...instanceBosses(facts.encounters, asOf)].flatMap(([instanceMapId, list]) => list.map((b) => {
    const rows = encounters.get(`${instanceMapId}|${b.encounterId}`) ?? [];
    const name = agree(rows.map((r) => ({ installId: r.installId, value: r.name })));
    const npcInstalls = new Map<number, Set<string>>();
    for (const r of rows) for (const npcId of r.npcIds) npcInstalls.set(npcId, (npcInstalls.get(npcId) ?? new Set<string>()).add(r.installId));
    return {
      instanceMapId, encounterId: b.encounterId, name: b.name, kills: b.kills, lastSeen: b.lastSeen,
      npcIds: b.npcIds.map((npcId) => ({ npcId, installs: npcInstalls.get(npcId)!.size })),
      installs: { listed: b.reporters, name: b.name === null ? null : name?.installs ?? null },
    };
  })).sort((a, b) => a.instanceMapId - b.instanceMapId || a.encounterId - b.encounterId);
  return [
    {
      name: "entrances", layer: "observed", about: "Dungeon and raid entrances: where 3 or more installs zoned in from, on an outdoor map.",
      schema: entranceRow, rows: entrances, candidates: places.size, candidatesAre: "instance and outdoor map combinations that at least one install zoned in from",
    },
    {
      name: "bosses", layer: "observed", about: "Boss encounters listed for an instance once 3 or more installs reported them there.",
      schema: bossRow, rows: bosses, candidates: encounters.size, candidatesAre: "instance and encounter combinations that at least one install reported",
    },
  ];
}

const objectRow = z.object({
  objectId: ID,
  name: NAME_OR_NULL("The object's name as the client showed it"),
  gatherKind: z.enum(GATHER_KINDS).nullable().describe("How the object is opened (herb, ore, chest, fishing, other); null when fewer than 3 installs agree."),
  installs: z.object({ name: INSTALLS.nullable(), gatherKind: INSTALLS.nullable() }).strict(),
}).strict().superRefine((r, ctx) => paired(r, r.installs, ctx));
const pinRow = z.object({
  key: z.string().describe("A stable key for the pin, from the object id, the map and the first agreed position."),
  objectId: ID, mapId: MAP, x: COORD, y: COORD,
  source: z.enum(["loot", "treasure"]).describe("loot: where players stood when they opened it. treasure: where the minimap showed it."),
  lastSeen: TIME,
  installs: INSTALLS.describe(`Installs with a position within one map unit of the pin's centre. At least ${WORLD_AGREEMENT}.`),
}).strict();

function objects(records: readonly unknown[], asOf: Date): Dataset[] {
  const loot = objectSpawnRowsFromRecords([...records]);
  const seen = objectSightingRowsFromRecords([...records]);
  const byId = group([...loot, ...seen], (r) => r.objectId);
  const kindRows = group(loot, (r) => r.objectId);
  const rows: z.infer<typeof objectRow>[] = [];
  for (const [objectId, list] of byId) {
    const name = agree(list.flatMap((r) => (r.name === undefined ? [] : [{ installId: r.installId, value: r.name }])));
    const kind = agree((kindRows.get(objectId) ?? []).flatMap((r) => (r.gatherKind === undefined ? [] : [{ installId: r.installId, value: r.gatherKind }])));
    if (!name && !kind) continue;
    rows.push({ objectId, name: text(name), gatherKind: text(kind) as z.infer<typeof objectRow>["gatherKind"], installs: { name: name?.installs ?? null, gatherKind: kind?.installs ?? null } });
  }
  const pins = (source: "loot" | "treasure", spawns: ReturnType<typeof objectSpawns>) => spawns.pins.map((p) => ({
    key: p.key, objectId: p.objectId, mapId: p.mapId, x: p.x, y: p.y, source, lastSeen: p.lastSeen ?? null, installs: p.reporters,
  }));
  const lootSpawns = objectSpawns(loot, [], asOf), treasureSpawns = objectSpawns(seen, [], asOf);
  const clusters = (s: ReturnType<typeof objectSpawns>) => s.pins.length + s.unconfirmed.reduce((sum, u) => sum + u.clusters, 0);
  return [
    {
      name: "objects", layer: "observed", about: "Objects (herbs, ore, chests, treasure): the name and how they are opened, each only when 3 or more installs agree.",
      schema: objectRow, rows: byNumber(rows, (r) => r.objectId), candidates: byId.size, candidatesAre: "objects that at least one install reported",
    },
    {
      name: "object-pins", layer: "observed", about: "Where objects stand: a cluster of positions within one map unit, only when 3 or more installs are in it. Fishing never has a pin.",
      schema: pinRow, rows: [...pins("loot", lootSpawns), ...pins("treasure", treasureSpawns)].sort((a, b) => a.objectId - b.objectId || a.mapId - b.mapId || (a.key < b.key ? -1 : 1)),
      candidates: clusters(lootSpawns) + clusters(treasureSpawns), candidatesAre: "position clusters of at least one install",
    },
  ];
}

const itemNameRow = z.object({
  itemId: ID,
  name: z.string().min(1).describe("The name the game client showed for the item."),
  installs: INSTALLS,
}).strict();

function itemNames(records: readonly unknown[]): Dataset {
  const byId = group(itemFactsFromRecords([...records]).names, (r) => r.itemId);
  const rows: z.infer<typeof itemNameRow>[] = [];
  for (const [itemId, list] of byId) {
    const agreed = agree(list.map((r) => ({ installId: r.installId, value: r.name })));
    if (agreed) rows.push({ itemId, name: agreed.value as string, installs: agreed.installs });
  }
  return {
    name: "item-names", layer: "observed", about: "Item names players reported, only when 3 or more installs reported the same one. Names from the game files or the Warcraft Wiki are not here.",
    schema: itemNameRow, rows: byNumber(rows, (r) => r.itemId), candidates: byId.size, candidatesAre: "items that at least one install named",
  };
}

// ---- game files ---------------------------------------------------------------------------------------------

const BOUNDS = z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() }).strict().describe("World yards.");
const itemCategoryRow = z.object({
  itemId: ID, classId: z.number().int().nonnegative(), subclassId: z.number().int().nonnegative(), inventoryType: z.number().int().nonnegative(),
  quality: z.number().int().nonnegative().nullable(),
  className: z.string().nullable(), subclassName: z.string().nullable(), slot: z.string().nullable(), qualityName: z.string().nullable(),
}).strict();
const clientRelationRow = z.object({
  fromKind: z.enum(ENTITY_KINDS), fromId: ID, rel: z.enum(RELS), toKind: z.enum(ENTITY_KINDS), toId: ID, build: z.string(),
}).strict();
const zoneRow = z.object({ uiMapId: ID, name: z.string(), continentId: z.number().int().nonnegative(), bounds: BOUNDS }).strict();
const continentRow = z.object({ id: z.number().int().nonnegative(), name: z.string(), bounds: BOUNDS }).strict();
const gameEntranceRow = z.object({ mapId: ID, name: z.string(), raid: z.boolean(), continentId: z.number().int().nonnegative(), worldX: z.number(), worldY: z.number() }).strict();
const flightNodeRow = z.object({ id: ID, name: z.string(), continentId: z.number().int().nonnegative(), worldX: z.number(), worldY: z.number() }).strict();
const flightPathRow = z.object({ from: ID, to: ID, continentId: z.number().int().nonnegative(), points: z.array(z.tuple([z.number(), z.number()])).describe("[worldX, worldY] in yards.") }).strict();

export interface GameFilesInput {
  build: { version: string; extractedAt: string };
  edges: readonly Edge[];
  taxonomy: Taxonomy;
  map: WorldMapData;
  catalogs: OpenDataCatalogs;
}

// ---- the catalog files ----------------------------------------------------------------------------------------

const BUILD = z.string().describe("The game build the file was read from.");
const NONNEG = z.number().int().nonnegative();
const RANK = NONNEG.describe("A skill rank; 0 where the files give none.");
const achievementRow = z.object({
  achievementId: ID, title: z.string(), points: NONNEG,
  criteria: NONNEG.describe("How many criteria the files list for it; their text is not here."),
  statistic: z.boolean().describe("True for a statistic, which the game counts and never awards."),
  build: BUILD,
}).strict();
const factionRow = z.object({
  factionId: ID, name: z.string(), parentId: NONNEG.nullable().describe("The parent faction; null when the files give none."),
  shown: z.boolean().describe("Whether the reputation pane shows it."), build: BUILD,
}).strict();
const titleRow = z.object({ titleId: ID, name: z.string().describe("As the file holds it, with %s where the player's name goes."), build: BUILD }).strict();
const questLineRow = z.object({ questLineId: ID, name: z.string(), questIds: z.array(ID).describe("The quests on the line, in the files' order."), build: BUILD }).strict();
const mountRow = z.object({ mountId: ID, name: z.string(), spellId: ID.describe("The spell that teaches it."), ridingSkill: NONNEG.nullable().describe("The riding skill its type asks for; null when the files give none."), build: BUILD }).strict();
const encounterRow = z.object({ instanceMapId: ID, encounterId: ID, name: z.string(), difficultyId: NONNEG.nullable().describe("Set only when the row is bound to one difficulty."), build: BUILD }).strict();
const recipeRow = z.object({
  professionId: ID.describe("The profession's skill line id."), professionName: z.string(), spellId: ID,
  itemId: ID.nullable().describe("The item the spell makes; null when it makes none."),
  minRank: RANK, yellowRank: RANK, greyRank: RANK,
  reagents: z.array(z.object({ itemId: ID, count: z.number().int().positive() }).strict()),
  build: BUILD,
}).strict();
const classGearRow = z.object({
  classId: ID, className: z.string(), itemClassId: NONNEG, itemSubclassId: NONNEG,
  level: NONNEG.describe("The level the class gets the proficiency at; 0 from the start."), build: BUILD,
}).strict();
const classGearRestrictionRow = z.object({ itemId: ID, classMask: z.number().int().describe("The item's own class mask as the files store it (a signed integer): bit (class id - 1) set for each class that may equip it."), build: BUILD }).strict();
const classSpellRow = z.object({ classId: ID, className: z.string(), spellId: ID, build: BUILD }).strict();
const raceRow = z.object({
  raceId: ID, name: z.string(), faction: z.enum(["Alliance", "Horde", "Neutral"]),
  classes: z.array(z.object({ classId: ID, name: z.string() }).strict()),
  traits: z.array(z.object({ name: z.string(), kind: z.enum(["active", "passive"]), order: NONNEG }).strict()).describe("Racial traits; their text is not here."),
  build: BUILD,
}).strict();
const legacyPerkRow = z.object({
  treeId: ID, nodeId: ID, entryId: ID, definitionId: ID, spellId: NONNEG,
  name: z.string().nullable().describe("null when the files hold no name row for it."),
  maxRanks: z.number().int().nullable(), build: BUILD,
}).strict();
const talentNodeRow = z.object({
  classId: ID, className: z.string(), treeId: ID, treeName: z.string().nullable(), nodeId: ID,
  x: z.number().int(), y: z.number().int(), row: NONNEG, col: NONNEG,
  kind: z.enum(["single", "tiered", "choice"]), maxRanks: NONNEG,
  entries: z.array(z.object({ definitionId: ID, spellId: ID, name: z.string().nullable(), maxRanks: NONNEG }).strict()),
  prereqs: z.array(z.object({ nodeId: ID, rule: z.enum(["any", "all"]) }).strict()),
  build: BUILD,
}).strict();
const raidBuffRow = z.object({
  id: z.string(), label: z.string(), kind: z.enum(["buff", "debuff"]), class: z.string(),
  family: z.string().describe("Effects in one family do not stack. The grouping is Everloot's; everything else is the files'."),
  scope: z.enum(RAID_SCOPES),
  tree: z.union([z.literal("baseline"), z.literal("unknown"), z.literal(1), z.literal(2), z.literal(3)]).describe("The talent tree (1 to 3, client order) that gives the effect; baseline when no talent does."),
  treeProof: z.enum(RAID_TREE_PROOFS).nullable(),
  names: z.array(z.string()), spellIds: z.array(ID), build: BUILD,
}).strict();

function catalogs(c: OpenDataCatalogs): Dataset[] {
  const label = (version: string) => `all rows of the build ${version}`;
  const one = (name: string, about: string, schema: z.ZodType, rows: unknown[], version: string): Dataset =>
    ({ name, layer: "game-files", about, schema, rows, candidates: rows.length, candidatesAre: label(version) });
  const achievements = Object.entries(c.achievements.achievements).map(([id, a]) =>
    ({ achievementId: Number(id), title: a.title, points: a.points, criteria: a.criteria.length, statistic: a.statistic === true, build: c.achievements.build.version }));
  const factions = c.factions.factions.map((f) => ({ factionId: f.id, name: f.name, parentId: f.parentId ?? null, shown: f.shown, build: c.factions.build.version }));
  const titles = c.titles.titles.map((t) => ({ titleId: t.id, name: t.name, build: c.titles.build.version }));
  const questLines = c.questLines.questLines.map((q) => ({ questLineId: q.id, name: q.name, questIds: q.questIds, build: c.questLines.build.version }));
  const mounts = Object.entries(c.mounts.mounts).map(([id, m]) => ({ mountId: Number(id), name: m.name, spellId: m.spellId, ridingSkill: m.ridingSkill ?? null, build: c.mounts.build.version }));
  const encounters = Object.entries(c.encounters.instances).flatMap(([mapId, list]) =>
    list.map((e) => ({ instanceMapId: Number(mapId), encounterId: e.id, name: e.name, difficultyId: e.difficultyId ?? null, build: c.encounters.build.version })));
  const recipes = c.recipes.professions.flatMap((p) => p.recipes.map(([spellId, itemId, minRank, yellowRank, greyRank, reagents]) => ({
    professionId: p.id, professionName: p.name, spellId, itemId: itemId === 0 ? null : itemId, minRank, yellowRank, greyRank,
    reagents: reagents.map(([item, count]) => ({ itemId: item, count })), build: c.recipes.build.version,
  })));
  const classGear = Object.entries(c.classGear.classes).flatMap(([className, cls]) =>
    cls.gear.map(([itemClassId, itemSubclassId, level]) => ({ classId: cls.id, className, itemClassId, itemSubclassId, level, build: c.classGear.build.version })));
  const restrictions = Object.entries(c.classGear.restricted).map(([itemId, classMask]) => ({ itemId: Number(itemId), classMask, build: c.classGear.build.version }));
  const classSpells = Object.entries(c.classSpells.classes).flatMap(([className, cls]) => cls.spells.map((spellId) => ({ classId: cls.id, className, spellId, build: c.classSpells.build.version })));
  const races = c.races.races.map((r) => ({
    raceId: r.id, name: r.name, faction: r.faction, classes: r.classes.map((k) => ({ classId: k.id, name: k.name })),
    traits: r.traits.map((t) => ({ name: t.name, kind: t.kind, order: t.order })), build: c.races.build.version,
  }));
  const legacyPerks = c.legacyPerks.trees.flatMap((tree) => tree.nodes.flatMap((node) => node.entries.map((e) =>
    ({ treeId: tree.id, nodeId: node.id, entryId: e.id, definitionId: e.definitionId, spellId: e.spellId, name: e.name, maxRanks: e.maxRanks, build: c.legacyPerks.build.version }))));
  const talentNodes = c.talents.flatMap((file) => file.trees.flatMap((tree) => tree.nodes.map((n) => ({
    classId: file.classId, className: file.className, treeId: tree.id, treeName: tree.name, nodeId: n.id,
    x: n.x, y: n.y, row: n.row, col: n.col, kind: n.kind, maxRanks: n.maxRanks,
    entries: n.entries.map((e) => ({ definitionId: e.definitionId, spellId: e.spellId, name: e.name, maxRanks: e.maxRanks })),
    prereqs: n.prereqs.map((p) => ({ nodeId: p.nodeId, rule: p.rule })), build: file.build.version,
  }))));
  const talentBuild = c.talents[0]?.build.version ?? "";
  const raidBuffs = c.raidBuffs.entries.map((e) => ({
    id: e.id, label: e.label, kind: e.kind, class: e.class, family: e.family, scope: e.scope, tree: e.tree, treeProof: e.treeProof ?? null,
    names: e.names, spellIds: e.spellIds, build: c.raidBuffs.build,
  }));
  return [
    one("achievements", "Every achievement the build lists: title, points, how many criteria, and whether it is a statistic. No criteria text or description.", achievementRow, byNumber(achievements, (r) => r.achievementId), c.achievements.build.version),
    one("factions", "Every faction the build lists: name, parent and whether the reputation pane shows it.", factionRow, byNumber(factions, (r) => r.factionId), c.factions.build.version),
    one("titles", "Every character title the build lists, as the file holds it.", titleRow, byNumber(titles, (r) => r.titleId), c.titles.build.version),
    one("quest-lines", "Every quest line the build lists, with its quest ids in order.", questLineRow, byNumber(questLines, (r) => r.questLineId), c.questLines.build.version),
    one("mounts", "Every mount the build lists: name, the spell that teaches it and the riding skill it asks for.", mountRow, byNumber(mounts, (r) => r.mountId), c.mounts.build.version),
    one("encounters", "The boss encounters the files list for each instance, by the instance's map id.", encounterRow, encounters, c.encounters.build.version),
    one("recipes", "Every recipe on each profession's skill line: the spell, the item it makes, its ranks and its reagents. Ids and ranks; no names.", recipeRow, recipes, c.recipes.build.version),
    one("class-gear", "The item class and subclass pairs each class's proficiencies allow, with the level it gets each at.", classGearRow, classGear, c.classGear.build.version),
    one("class-gear-restrictions", "Items whose own class mask leaves a class out.", classGearRestrictionRow, byNumber(restrictions, (r) => r.itemId), c.classGear.build.version),
    one("class-spells", "The spells on each class's own skill lines. Ranks, talents, passives and helper spells are mixed, as in the files.", classSpellRow, classSpells, c.classSpells.build.version),
    one("races", "Each race a class can be made with: faction, the classes it can be and its racial traits by name. No trait text.", raceRow, byNumber(races, (r) => r.raceId), c.races.build.version),
    one("legacy-perks", "WoW: Forever's Legacy perks: one row per perk entry with its tree, node, definition and spell ids, name and ranks.", legacyPerkRow, legacyPerks, c.legacyPerks.build.version),
    one("talent-nodes", "One row per talent node of every class: tree, position, kind, ranks, entries (definition, spell, name, ranks) and prerequisites. No descriptions or icons.", talentNodeRow, talentNodes, talentBuild),
    one("raid-buffs", "Raid buffs and debuffs: the spell ids and aura names of each, its reach, and the talent tree it needs where the files prove it.", raidBuffRow, raidBuffs, c.raidBuffs.build),
  ];
}

function gameFiles(g: GameFilesInput): Dataset[] {
  const items = g.taxonomy.items.map((row) => {
    const c = describe(g.taxonomy, row);
    return { itemId: row[0], classId: row[1], subclassId: row[2], inventoryType: row[3], quality: row[4], className: c.class?.label ?? null, subclassName: c.subclass?.name ?? null, slot: c.slot?.name ?? null, qualityName: c.quality?.name ?? null };
  });
  const relationsRows = g.edges.filter((e) => e.evidence === "client").map((e) => ({ fromKind: e.fromKind, fromId: e.fromId, rel: e.rel, toKind: e.toKind, toId: e.toId, build: e.build ?? g.build.version }));
  // Zones that may be unreleased stay out, and so do the flight masters and lines placed in or named for one.
  const flights = placeFlights({ flightNodes: g.map.flightNodes, flightPaths: g.map.flightPaths, zones: g.map.zones, heldBackZones: g.map.heldBackZones });
  const hidden = new Set(flights.masters.filter((m) => m.heldBack).map((m) => m.id));
  // The map file carries more per spot than the rows name (uiMapId, level ranges, difficulties); the rows keep their fields.
  const entrances = g.map.entrances.map(({ mapId, name, raid, continentId, worldX, worldY }) => ({ mapId, name, raid, continentId, worldX, worldY }));
  const nodes = g.map.flightNodes.filter((n) => !hidden.has(n.id)).map(({ id, name, continentId, worldX, worldY }) => ({ id, name, continentId, worldX, worldY }));
  const paths = g.map.flightPaths.filter((p) => !hidden.has(p.from) && !hidden.has(p.to));
  const label = `all rows of the build ${g.build.version}`;
  return [
    { name: "item-categories", layer: "game-files", about: "Every item the build lists, with its class, subclass, slot and quality (ids and the client's category names; no item names).", schema: itemCategoryRow, rows: items, candidates: items.length, candidatesAre: label },
    { name: "relations", layer: "game-files", about: "Relations between ids the game files hold: created by, reagent for, part of set, same icon and profession.", schema: clientRelationRow, rows: relationsRows, candidates: relationsRows.length, candidatesAre: label },
    { name: "zones", layer: "game-files", about: "Zone rectangles in world yards, for the released zones.", schema: zoneRow, rows: g.map.zones, candidates: g.map.zones.length + g.map.heldBackZones.length, candidatesAre: "zones in the files, held-back ones included, which are left out" },
    { name: "continents", layer: "game-files", about: "Continents with their rectangles in world yards.", schema: continentRow, rows: g.map.continents, candidates: g.map.continents.length, candidatesAre: label },
    { name: "entrances", layer: "game-files", about: "Dungeon and raid entrance points, in world yards.", schema: gameEntranceRow, rows: entrances, candidates: g.map.entrances.length, candidatesAre: label },
    { name: "flight-masters", layer: "game-files", about: "Flight masters, in world yards.", schema: flightNodeRow, rows: nodes, candidates: g.map.flightNodes.length, candidatesAre: "flight masters in the files, those in held-back zones included, which are left out" },
    { name: "flight-paths", layer: "game-files", about: "One flight line per pair of flight masters, as points in world yards.", schema: flightPathRow, rows: paths, candidates: g.map.flightPaths.length, candidatesAre: "flight lines in the files, those ending at a held-back flight master included, which are left out" },
    ...catalogs(g.catalogs),
  ];
}

// ---- the build ----------------------------------------------------------------------------------------------

export interface OpenDataInput {
  /** Public records, as the corpus API serves them (an install id, or its pseudonym, on each). */
  records: readonly unknown[];
  /** When the uploads behind the records were current; null when the source did not say. */
  dataAsOf: string | null;
  /** The time the export is made; a time after the records' own is the ceiling when `dataAsOf` is null. */
  generatedAt: string;
  gameFiles: GameFilesInput;
}

export interface OpenData {
  datasets: Dataset[];
  source: { records: number; installs: number; kinds: string[] };
  /** The install ids of the input, kept in memory only so the writer can prove none reached a row. */
  installIds: ReadonlySet<string>;
}

export function buildOpenData(input: OpenDataInput): OpenData {
  const wanted = new Set<string>(OPEN_DATA_KINDS);
  // One voter per Polestar Recorder player, before any rule counts installs; the public feed has done it already.
  const records = foldRecorderInstalls(input.records.filter((r): r is { kind: string; installId: string } =>
    typeof r === "object" && r !== null && wanted.has((r as { kind?: string }).kind ?? "") && typeof (r as { installId?: unknown }).installId === "string"));
  const asOf = new Date(input.dataAsOf ?? input.generatedAt);
  const installs = new Set(records.map((r) => r.installId.trim()).filter(Boolean));
  const datasets = [
    npcs(records), quests(records), vendorOffers(records), ...drops(records), relations(records, asOf), ...instances(records, asOf), ...objects(records, asOf), itemNames(records),
    ...gameFiles(input.gameFiles),
  ];
  return { datasets, source: { records: records.length, installs: installs.size, kinds: [...OPEN_DATA_KINDS] }, installIds: installs };
}
