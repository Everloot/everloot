/**
 * NPC, quest, and vendor pages from Everloot uploads.
 * A name, pin, title, level, giver, reward, or price is public after 3 installs agree.
 * A fact under a recheck scope (`WorldFacts.recheck`) that was agreed before the scope's date counts only the rows
 * captured after it, so three new installs show a changed value instead of old and new votes cancelling out.
 * No copied catalog.
 */
import type { RecheckScope } from "./coverage.js";
import { pendingForNpc, pendingLine, pendingLootFromRecords, type PendingCount, type PendingLoot } from "./pending-loot.js";
import { recheckRows, tallyVotes, WORLD_AGREEMENT } from "./fact-states.js";
import { npcZones, scopeSince, type ScopedFact } from "./recheck-scopes.js";

export { WORLD_AGREEMENT } from "./fact-states.js";

/** How the NPC stood toward the player who saw it, as the addon records it. */
export type NpcReaction = "friendly" | "neutral" | "hostile";
export const NPC_REACTIONS: readonly NpcReaction[] = ["friendly", "neutral", "hostile"];

/** The game's English creature types and the ranks `UnitClassification` gives (`worldboss` is `boss`). */
export const NPC_CREATURE_TYPES: readonly string[] = [
  "Beast", "Dragonkin", "Demon", "Elemental", "Giant", "Undead", "Humanoid", "Critter", "Mechanical", "Not specified", "Totem", "Non-combat Pet", "Gas Cloud",
];
export type NpcRank = "normal" | "elite" | "rare" | "rare_elite" | "boss";
export const NPC_RANKS: readonly NpcRank[] = ["normal", "elite", "rare", "rare_elite", "boss"];
export type QuestTag = "group" | "dungeon" | "raid" | "pvp";
export const QUEST_TAGS: readonly QuestTag[] = ["group", "dungeon", "raid", "pvp"];
export type QuestSide = "alliance" | "horde" | "both";
/** What an NPC does for players, from the window that opened (the protocol's `NPC_ROLES`). */
export type NpcRole = "vendor" | "trainer" | "questgiver" | "flightmaster" | "banker" | "auctioneer" | "stablemaster" | "innkeeper" | "repair";
export const NPC_ROLES: readonly NpcRole[] = ["vendor", "trainer", "questgiver", "flightmaster", "banker", "auctioneer", "stablemaster", "innkeeper", "repair"];

export type PositionKind = "player" | "npc" | "interaction" | "vignette";
const POSITION_KINDS: readonly PositionKind[] = ["player", "npc", "interaction", "vignette"];
/**
 * The positions that can make a pin: the NPC's own (`npc`, and `vignette`, the game's minimap marker for a rare),
 * and the player's while the NPC's window was open (a few yards away). `player`, where the player stood when
 * targeting, never does, and neither does a row without one.
 */
export const PIN_POSITION_KINDS: readonly PositionKind[] = ["npc", "interaction", "vignette"];
export function isPinPosition(kind: unknown): boolean {
  return PIN_POSITION_KINDS.includes(kind as PositionKind);
}

export type NpcSightingRow = {
  installId: string;
  npcId: number;
  name: string;
  positionKind?: PositionKind;
  /** Only on `interaction` rows. */
  role?: NpcRole;
  mapId: number;
  x: number;
  y: number;
  level?: number;
  reaction?: NpcReaction;
  creatureType?: string;
  rank?: NpcRank;
  /** When the client recorded it; only the recheck cut-off reads it. */
  capturedAt?: string;
};

export type QuestSighting = {
  installId: string;
  questId: number;
  title: string;
  level: number;
  giverNpcId?: number;
  turnInNpcId?: number;
  rewardItemIds: number[];
  category?: string;
  faction?: "alliance" | "horde";
  suggestedGroup?: number;
  tag?: QuestTag;
  capturedAt?: string;
};

export type VendorSighting = {
  installId: string;
  vendorNpcId: number;
  itemId: number;
  priceCopper: number;
  limitedStock?: number;
  capturedAt?: string;
};

export type WorldFacts = {
  npcs: NpcSightingRow[];
  quests: QuestSighting[];
  vendors: VendorSighting[];
  /** Loot windows the rates leave out, only counted (pending-loot.ts); read by the NPC page. */
  pending?: PendingLoot;
  /** The scopes in `kb/curated/recheck.json`; without them every row counts. */
  recheck?: readonly RecheckScope[];
};

export type NpcPin = { mapId: number; x: number; y: number; reporters: number };
/** `pendingLoot`: loot windows reported but not yet in the rates; absent when there are none. */
export type NpcPage = { npcId: number; name: string | null; pins: NpcPin[]; pendingLoot?: PendingCount };
export type QuestPage = {
  questId: number;
  title: string | null;
  level: number | null;
  giverNpcId: number | null;
  turnInNpcId: number | null;
  rewards: number[];
};
/** `limitedStock` null with `unlimited` false means the stock is unrecorded, not unlimited. */
export type VendorOffer = { itemId: number; priceCopper: number; limitedStock: number | null; unlimited: boolean; reporters: number };
export type VendorPage = { vendorNpcId: number; offers: VendorOffer[] };

const EMPTY: WorldFacts = { npcs: [], quests: [], vendors: [] };

const NO_SCOPES: readonly RecheckScope[] = [];
type Timed = { installId: string; capturedAt?: string };
const at = (row: { capturedAt?: string }) => (row.capturedAt ? { capturedAt: row.capturedAt } : {});

/** `since`: the fact's recheck cut-off (`scopeSince`), or none. */
function agreedLabel(rows: (Timed & { label: string })[], since?: string | null): string | null {
  return (tallyVotes(rows.map((row) => ({ installId: row.installId, value: row.label, ...at(row) })), since ? { recheckSince: since } : {}).winner?.value as string | undefined) ?? null;
}

/**
 * `agreedLabel` for many ids in one pass: id -> the label 3 installs agree on, ids without one left out. `sinceOf`
 * gives an id's recheck cut-off.
 */
export function agreedLabelsById(rows: (Timed & { id: number; label: string })[], sinceOf?: (id: number) => string | null): Map<number, string> {
  const byId = new Map<number, (Timed & { label: string })[]>();
  for (const row of rows) {
    const list = byId.get(row.id) ?? [];
    list.push(row);
    byId.set(row.id, list);
  }
  const out = new Map<number, string>();
  for (const [id, list] of byId) {
    const label = agreedLabel(list, sinceOf?.(id));
    if (label) out.set(id, label);
  }
  return out;
}

function groupRows<T, K>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r), list = out.get(k);
    if (list) list.push(r); else out.set(k, [r]);
  }
  return out;
}

/** Where each NPC is counted, by the coverage score's rule, for a scope that names zones. */
function zonesOf(npcs: readonly NpcSightingRow[]): Map<number, number | null> {
  return npcZones(npcs.map((r) => ({ npcId: r.npcId, mapId: r.mapId, installId: r.installId, pin: isPinPosition(r.positionKind) })));
}

/** `zonesOf` once per sightings array, so a list of quests or vendors places every NPC in one pass. */
const zoneCache = new WeakMap<readonly NpcSightingRow[], Map<number, number | null>>();
function zonesFor(npcs: readonly NpcSightingRow[]): Map<number, number | null> {
  const cached = zoneCache.get(npcs);
  if (cached) return cached;
  const zones = zonesOf(npcs);
  zoneCache.set(npcs, zones);
  return zones;
}

/** A rare, as the score counts one: its agreed rank, or with none agreed, any report of a rare rank. */
function isRare(rows: readonly NpcSightingRow[]): boolean {
  const rare = (v: unknown) => v === "rare" || v === "rare_elite";
  const agreed = tallyVotes(rows.flatMap((r) => (r.rank === undefined ? [] : [{ installId: r.installId, value: r.rank }]))).winner?.value;
  return agreed !== undefined ? rare(agreed) : rows.some((r) => rare(r.rank));
}

/** The NPC facts a scope can cover: its name and traits, and its pin on each map. A rare's name and pins are rares too. */
function npcScope(npcId: number, rows: readonly NpcSightingRow[], zone: number | null): { npc: ScopedFact; pin: (mapId: number) => ScopedFact } {
  const rare = isRare(rows);
  return {
    npc: { types: rare ? ["npcs", "rares"] : ["npcs"], zones: [zone], ids: [npcId] },
    pin: (mapId) => ({ types: rare ? ["pins", "rares"] : ["pins"], zones: [mapId], ids: [npcId] }),
  };
}

/** The quest facts a scope can cover: counted where the leading giver (then turn-in) stands, with the rewards' ids. */
function questScope(questId: number, rows: readonly QuestSighting[], zones: ReadonlyMap<number, number | null>): ScopedFact {
  const lead = (k: "giverNpcId" | "turnInNpcId") => {
    const id = tallyVotes(rows.flatMap((r) => (r[k] === undefined ? [] : [{ installId: r.installId, value: r[k]! }]))).groups.sort((a, b) => b.voters.size - a.voters.size)[0]?.value;
    return typeof id === "number" ? zones.get(id) ?? null : null;
  };
  const rewards = [...new Set(rows.flatMap((r) => r.rewardItemIds.filter((id) => Number.isInteger(id) && id > 0)))];
  return { types: ["quests"], zones: [lead("giverNpcId") ?? lead("turnInNpcId")], ids: [questId, ...rewards] };
}

/** Every NPC with an agreed name, by id: the names `npcPage` gives, in one pass over the sightings. */
export function agreedNpcNames(facts: Pick<WorldFacts, "npcs"> & Pick<Partial<WorldFacts>, "recheck">): Map<number, string> {
  const scopes = facts.recheck ?? NO_SCOPES;
  let sinceOf: ((id: number) => string | null) | undefined;
  if (scopes.length) {
    const zones = zonesFor(facts.npcs), byId = groupRows(facts.npcs, (r) => r.npcId);
    sinceOf = (id) => scopeSince(scopes, npcScope(id, byId.get(id) ?? [], zones.get(id) ?? null).npc);
  }
  return agreedLabelsById(facts.npcs.map((row) => ({ id: row.npcId, installId: row.installId, label: row.name, ...at(row) })), sinceOf);
}

/** Every quest with an agreed title, by id: the titles `questPage` gives, in one pass. Scopes by zone need the NPCs. */
export function agreedQuestTitles(facts: Pick<WorldFacts, "quests"> & Pick<Partial<WorldFacts>, "npcs" | "recheck">): Map<number, string> {
  const scopes = facts.recheck ?? NO_SCOPES;
  let sinceOf: ((id: number) => string | null) | undefined;
  if (scopes.length) {
    const zones = zonesFor(facts.npcs ?? []), byId = groupRows(facts.quests, (r) => r.questId);
    sinceOf = (id) => scopeSince(scopes, questScope(id, byId.get(id) ?? [], zones));
  }
  return agreedLabelsById(facts.quests.map((row) => ({ id: row.questId, installId: row.installId, label: row.title, ...at(row) })), sinceOf);
}

function agreedNumber(rows: (Timed & { value: number })[], since?: string | null): number | null {
  return (tallyVotes(rows, since ? { recheckSince: since } : {}).winner?.value as number | undefined) ?? null;
}

/** Installs per key, each key counting only the rows its recheck cut-off leaves (`recheckRows`). */
function installsAfter<T extends Timed, K>(rows: readonly T[], key: (r: T) => K | undefined, since: string | null): Map<K, Set<string>> {
  const out = new Map<K, Set<string>>();
  for (const [k, list] of groupRows(rows.filter((r) => key(r) !== undefined), (r) => key(r)!)) {
    out.set(k, new Set(recheckRows(list, since).rows.map((r) => r.installId.trim())));
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

function formatCopper(copper: number): string {
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  const coins = copper % 100;
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold}g`);
  if (silver > 0 || gold > 0) parts.push(`${silver}s`);
  parts.push(`${coins}c`);
  return parts.join(" ");
}

/** One NPC's sighting rows and scope, with its name's votes and their recheck cut-off, as `npcPage` reads them. */
function npcRows(npcId: number, facts: WorldFacts) {
  const rows = facts.npcs.filter((row) => row.npcId === npcId && row.installId.trim());
  const scopes = facts.recheck ?? NO_SCOPES;
  const scope = scopes.length ? npcScope(npcId, rows, zonesOf(rows).get(npcId) ?? null) : null;
  const names = rows.map((row) => ({ installId: row.installId, label: row.name, ...at(row) }));
  return { rows, scopes, scope, names, since: scope && scopeSince(scopes, scope.npc) };
}

/**
 * How many installs reported the leading name of an NPC with no agreed name, counted as `npcPage` counts them: the
 * count short of 3. 0 when none did, when a name is agreed, and when two names each have 3. A count only, never the name.
 */
export function npcNameReporters(npcId: number, facts: WorldFacts): number {
  const { names, since } = npcRows(npcId, facts);
  const tally = tallyVotes(names.map((row) => ({ installId: row.installId, value: row.label, ...at(row) })), since ? { recheckSince: since } : {});
  const most = Math.max(0, ...tally.groups.map((group) => group.voters.size));
  return most < WORLD_AGREEMENT ? most : 0;
}

export function npcPage(npcId: number, facts: WorldFacts): NpcPage {
  const { rows, scopes, scope, names, since } = npcRows(npcId, facts);
  const name = agreedLabel(names, since);
  const placed = groupRows(rows.filter((row) => isPinPosition(row.positionKind) && Number.isInteger(row.mapId) && row.mapId >= 0
    && row.x >= 0 && row.x <= 100 && row.y >= 0 && row.y <= 100), (row) => row.mapId);
  const grouped = new Map<number, Map<string, NpcSightingRow>>();
  for (const [mapId, list] of placed) {
    // A pin 3 installs placed before its scope's date counts only the rows after it, as the score's position does.
    const installs = new Map<string, NpcSightingRow>();
    for (const row of recheckRows(list, scope && scopeSince(scopes, scope.pin(mapId))).rows) installs.set(row.installId.trim(), row);
    grouped.set(mapId, installs);
  }
  const pins = [...grouped.entries()]
    .filter(([, installs]) => installs.size >= WORLD_AGREEMENT)
    .map(([mapId, installs]) => {
      const seen = [...installs.values()];
      return { mapId, x: median(seen.map((row) => row.x)), y: median(seen.map((row) => row.y)), reporters: installs.size };
    })
    .sort((a, b) => a.mapId - b.mapId);
  const pendingLoot = pendingForNpc(facts.pending, npcId);
  return { npcId, name, pins, ...(pendingLoot ? { pendingLoot } : {}) };
}

/**
 * An NPC's level and reaction, each public when 3 installs report the same one, for the NPC list. Kept apart
 * from `npcPage`, so the page and the MCP answer built on it stay as they are. A reaction is as seen by the
 * reporting player, so Alliance and Horde reports can disagree; then there is no agreed one.
 */
export function npcTraits(rows: NpcSightingRow[], recheck: readonly RecheckScope[] = NO_SCOPES): { level: number | null; reaction: NpcReaction | null; creatureType: string | null; rank: NpcRank | null } {
  const s = npcSince(rows, recheck);
  const level = agreedNumber(rows.filter((row) => row.level !== undefined).map((row) => ({ installId: row.installId, value: row.level!, ...at(row) })), s);
  const reaction = agreedLabel(rows.filter((row) => row.reaction !== undefined).map((row) => ({ installId: row.installId, label: row.reaction!, ...at(row) })), s);
  // The type and rank are the game's own for the creature, the same for every player, and need the same 3 installs.
  const creatureType = agreedLabel(rows.filter((row) => row.creatureType !== undefined).map((row) => ({ installId: row.installId, label: row.creatureType!, ...at(row) })), s);
  const rank = agreedLabel(rows.filter((row) => row.rank !== undefined).map((row) => ({ installId: row.installId, label: row.rank!, ...at(row) })), s);
  return { level, reaction: reaction as NpcReaction | null, creatureType, rank: rank as NpcRank | null };
}

/** The recheck cut-off for one NPC's name and traits, from its own rows. */
function npcSince(rows: readonly NpcSightingRow[], recheck: readonly RecheckScope[]): string | null {
  const npcId = rows[0]?.npcId;
  if (!recheck.length || npcId === undefined) return null;
  return scopeSince(recheck, npcScope(npcId, rows, zonesOf(rows).get(npcId) ?? null).npc);
}

/**
 * What an NPC does for players: each role 3 installs saw from its window, in `NPC_ROLES` order. An NPC can have
 * several (a quest giver who also sells), so this is not one agreed label.
 */
export function npcRoles(rows: NpcSightingRow[], recheck: readonly RecheckScope[] = NO_SCOPES): NpcRole[] {
  const installs = installsAfter(rows.filter((row) => row.positionKind === "interaction" && row.installId.trim()), (row) => row.role, npcSince(rows, recheck));
  return NPC_ROLES.filter((role) => (installs.get(role)?.size ?? 0) >= WORLD_AGREEMENT);
}

export function formatNpcPage(page: NpcPage): string {
  const lines = [page.name ? `NPC ${page.npcId} — ${page.name}` : `NPC ${page.npcId}`];
  if (!page.name) lines.push("No agreed name yet. A name needs 3 installs reporting the same one.");
  lines.push("Map");
  if (page.pins.length === 0) lines.push("No agreed position. A pin needs 3 installs on the same map.");
  for (const pin of page.pins) lines.push(`Map ${pin.mapId} at ${pin.x}, ${pin.y}  ${pin.reporters} reporters`);
  if (page.pendingLoot) lines.push(pendingLine(page.pendingLoot));
  return lines.join("\n");
}

export function handleNpcPage(args: { npcId: number }, facts: WorldFacts = EMPTY): string {
  if (!Number.isInteger(args.npcId) || args.npcId < 1) return "Name an npc id.";
  return formatNpcPage(npcPage(args.npcId, facts));
}

/** The recheck cut-off for one quest's fields, placed by its giver among `facts.npcs`. */
function questSince(questId: number, rows: readonly QuestSighting[], facts: Pick<Partial<WorldFacts>, "npcs" | "recheck">): string | null {
  const scopes = facts.recheck ?? NO_SCOPES;
  if (!scopes.length) return null;
  return scopeSince(scopes, questScope(questId, rows, zonesFor(facts.npcs ?? [])));
}

export function questPage(questId: number, facts: WorldFacts): QuestPage {
  const rows = facts.quests.filter((row) => row.questId === questId && row.installId.trim());
  const s = questSince(questId, rows, facts);
  const rewarded = rows.flatMap((row) => [...new Set(row.rewardItemIds)].filter((itemId) => Number.isInteger(itemId) && itemId >= 1).map((itemId) => ({ ...row, itemId })));
  const rewards = installsAfter(rewarded, (row) => row.itemId, s);
  return {
    questId,
    title: agreedLabel(rows.map((row) => ({ installId: row.installId, label: row.title, ...at(row) })), s),
    level: agreedNumber(rows.map((row) => ({ installId: row.installId, value: row.level, ...at(row) })), s),
    giverNpcId: agreedNumber(
      rows.filter((row) => row.giverNpcId !== undefined).map((row) => ({ installId: row.installId, value: row.giverNpcId!, ...at(row) })), s,
    ),
    turnInNpcId: agreedNumber(
      rows.filter((row) => row.turnInNpcId !== undefined).map((row) => ({ installId: row.installId, value: row.turnInNpcId!, ...at(row) })), s,
    ),
    rewards: [...rewards.entries()].filter(([, installs]) => installs.size >= WORLD_AGREEMENT).map(([itemId]) => itemId).sort((a, b) => a - b),
  };
}

/**
 * A quest's category, suggested group and tag, each public when 3 installs report the same one, and its side.
 * The side is the faction of the characters that accepted it: Alliance or Horde when 3 installs report that
 * faction and none reports the other, Both when 3 installs report each, and no side otherwise. It is never
 * guessed from the title, giver or zone.
 */
export function questTraits(rows: QuestSighting[], facts: Pick<Partial<WorldFacts>, "npcs" | "recheck"> = {}): { category: string | null; side: QuestSide | null; suggestedGroup: number | null; tag: QuestTag | null } {
  const s = rows.length ? questSince(rows[0]!.questId, rows, facts) : null;
  const category = agreedLabel(rows.filter((row) => row.category !== undefined).map((row) => ({ installId: row.installId, label: row.category!, ...at(row) })), s);
  const suggestedGroup = agreedNumber(rows.filter((row) => row.suggestedGroup !== undefined).map((row) => ({ installId: row.installId, value: row.suggestedGroup!, ...at(row) })), s);
  const tag = agreedLabel(rows.filter((row) => row.tag !== undefined).map((row) => ({ installId: row.installId, label: row.tag!, ...at(row) })), s);
  return { category, side: questSide(sideRows(rows, s).rows), suggestedGroup, tag: tag as QuestTag | null };
}

/** Alliance or Horde with `k` installs of that faction and none of the other, Both with `k` of each, else null. */
export function questSide(rows: readonly { installId: string; faction?: "alliance" | "horde" }[], k = WORLD_AGREEMENT): QuestSide | null {
  const installs = { alliance: new Set<string>(), horde: new Set<string>() };
  for (const row of rows) if (row.faction && row.installId.trim()) installs[row.faction].add(row.installId.trim());
  const [a, h] = [installs.alliance.size, installs.horde.size];
  return a >= k && h >= k ? "both" : a >= k && h === 0 ? "alliance" : h >= k && a === 0 ? "horde" : null;
}

/**
 * The rows a quest's side counts under a recheck cut-off: when the rows before it gave a side, only the rows after.
 * A side is not one agreed value (Both is two), so `recheckRows`' one-winner test does not fit it.
 */
export function sideRows<T extends { installId: string; faction?: "alliance" | "horde"; capturedAt?: string }>(rows: readonly T[], since: string | null | undefined, asOf?: string | null): { rows: T[]; recheck: boolean } {
  const cut = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(cut)) return { rows: [...rows], recheck: false };
  const now = asOf ? Date.parse(asOf) : NaN;
  const time = (r: T) => {
    const t = r.capturedAt ? Date.parse(r.capturedAt) : NaN;
    return Number.isFinite(t) ? (Number.isFinite(now) ? Math.min(t, now) : t) : null;
  };
  if (questSide(rows.filter((r) => { const t = time(r); return t !== null && t < cut; })) === null) return { rows: [...rows], recheck: false };
  return { rows: rows.filter((r) => { const t = time(r); return t !== null && t > cut; }), recheck: true };
}

export function formatQuestPage(page: QuestPage): string {
  const lines = [page.title ? `Quest ${page.questId} — ${page.title}` : `Quest ${page.questId}`];
  if (!page.title) lines.push("No agreed title yet. A title needs 3 installs reporting the same one.");
  lines.push(page.level === null ? "No agreed level. A level needs 3 installs reporting the same one." : `Level ${page.level}`);
  lines.push(page.giverNpcId === null ? "No agreed giver." : `Giver NPC ${page.giverNpcId}`);
  lines.push(page.turnInNpcId === null ? "No agreed turn-in." : `Turn-in NPC ${page.turnInNpcId}`);
  lines.push(page.rewards.length === 0 ? "No agreed rewards." : `Rewards: ${page.rewards.join(", ")}`);
  return lines.join("\n");
}

export function handleQuestPage(args: { questId: number }, facts: WorldFacts = EMPTY): string {
  if (!Number.isInteger(args.questId) || args.questId < 1) return "Name a quest id.";
  return formatQuestPage(questPage(args.questId, facts));
}

export function vendorPage(vendorNpcId: number, facts: WorldFacts): VendorPage {
  const grouped = new Map<string, { itemId: number; priceCopper: number; installs: Map<string, number | undefined> }>();
  const scopes = facts.recheck ?? NO_SCOPES;
  const valid = facts.vendors.filter((row) => row.vendorNpcId === vendorNpcId && row.installId.trim()
    && Number.isInteger(row.itemId) && row.itemId >= 1 && Number.isInteger(row.priceCopper) && row.priceCopper >= 0);
  // An item under a recheck scope whose price was agreed before it counts only the rows after it, for its stock too.
  const zone = scopes.length ? zonesFor(facts.npcs).get(vendorNpcId) ?? null : null;
  const rows = scopes.length ? [...groupRows(valid, (row) => row.itemId)].flatMap(([itemId, list]) =>
    recheckRows(list, scopeSince(scopes, { types: ["vendors"], zones: [zone], ids: [vendorNpcId, itemId] }), { value: (row) => row.priceCopper }).rows) : valid;
  for (const row of rows) {
    const key = `${row.itemId}|${row.priceCopper}`;
    const group = grouped.get(key) ?? { itemId: row.itemId, priceCopper: row.priceCopper, installs: new Map() };
    group.installs.set(row.installId.trim(), row.limitedStock);
    grouped.set(key, group);
  }
  const offers = [...grouped.values()]
    .filter((group) => group.installs.size >= WORLD_AGREEMENT)
    .map((group) => {
      const stocks = new Map<number, number>();
      let noLimit = 0;
      for (const stock of group.installs.values()) {
        if (stock === undefined) noLimit += 1;
        else if (Number.isInteger(stock) && stock > 0) stocks.set(stock, (stocks.get(stock) ?? 0) + 1);
      }
      const agreed = [...stocks.entries()].filter(([, count]) => count >= WORLD_AGREEMENT);
      return {
        itemId: group.itemId,
        priceCopper: group.priceCopper,
        limitedStock: agreed.length === 1 ? agreed[0]![0] : null,
        unlimited: noLimit >= WORLD_AGREEMENT,
        reporters: group.installs.size,
      };
    })
    .sort((a, b) => a.itemId - b.itemId || a.priceCopper - b.priceCopper);
  return { vendorNpcId, offers };
}

export function stockLabel(offer: VendorOffer): string {
  if (offer.limitedStock !== null) return `stock ${offer.limitedStock}`;
  return offer.unlimited ? "not limited" : "stock unrecorded";
}

export function formatVendorPage(page: VendorPage): string {
  const lines = [
    `Vendor NPC ${page.vendorNpcId}`,
    "An item is listed when 3 installs agree on that item and its copper price.",
  ];
  if (page.offers.length === 0) {
    lines.push("Goods unrecorded. A price needs 3 installs agreeing.");
    return lines.join("\n");
  }
  for (const offer of page.offers) {
    const stock = stockLabel(offer);
    lines.push(`Item ${offer.itemId}  ${formatCopper(offer.priceCopper)}  ${stock}  ${offer.reporters} reporters`);
  }
  return lines.join("\n");
}

export function handleVendorPage(args: { vendorNpcId: number }, facts: WorldFacts = EMPTY): string {
  if (!Number.isInteger(args.vendorNpcId) || args.vendorNpcId < 1) return "Name a vendor id.";
  return formatVendorPage(vendorPage(args.vendorNpcId, facts));
}

/** The NPC page's facts: the world facts and the pending loot count. */
export function npcFactsFromRecords(records: unknown[], recheck: readonly RecheckScope[] = NO_SCOPES): WorldFacts {
  return { ...worldFactsFromRecords(records, recheck), pending: pendingLootFromRecords(records) };
}

export function worldFactsFromRecords(records: unknown[], recheck: readonly RecheckScope[] = NO_SCOPES): WorldFacts {
  const facts: WorldFacts = { npcs: [], quests: [], vendors: [], ...(recheck.length ? { recheck } : {}) };
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.installId !== "string") continue;
    const when = typeof row.capturedAt === "string" && Number.isFinite(Date.parse(row.capturedAt)) ? { capturedAt: row.capturedAt } : {};
    if (
      row.kind === "npc_sighting" &&
      typeof row.npcId === "number" &&
      typeof row.name === "string" &&
      typeof row.mapId === "number" &&
      typeof row.x === "number" &&
      typeof row.y === "number"
    ) {
      facts.npcs.push({ installId: row.installId, npcId: row.npcId, name: row.name, mapId: row.mapId, x: row.x, y: row.y,
        ...(POSITION_KINDS.includes(row.positionKind as PositionKind) ? { positionKind: row.positionKind as PositionKind } : {}),
        ...(row.positionKind === "interaction" && NPC_ROLES.includes(row.role as NpcRole) ? { role: row.role as NpcRole } : {}),
        ...(typeof row.level === "number" && Number.isInteger(row.level) && row.level > 0 ? { level: row.level } : {}),
        ...(NPC_REACTIONS.includes(row.reaction as NpcReaction) ? { reaction: row.reaction as NpcReaction } : {}),
        ...(typeof row.creatureType === "string" && NPC_CREATURE_TYPES.includes(row.creatureType) ? { creatureType: row.creatureType } : {}),
        ...(NPC_RANKS.includes(row.rank as NpcRank) ? { rank: row.rank as NpcRank } : {}), ...when });
    }
    if (row.kind === "quest" && typeof row.questId === "number" && typeof row.title === "string" && typeof row.level === "number") {
      facts.quests.push({
        installId: row.installId,
        questId: row.questId,
        title: row.title,
        level: row.level,
        ...(typeof row.giverNpcId === "number" ? { giverNpcId: row.giverNpcId } : {}),
        ...(typeof row.turnInNpcId === "number" ? { turnInNpcId: row.turnInNpcId } : {}),
        rewardItemIds: Array.isArray(row.rewardItemIds) ? row.rewardItemIds.filter((id): id is number => typeof id === "number") : [],
        ...(typeof row.category === "string" && row.category.trim() ? { category: row.category.trim() } : {}),
        ...(row.faction === "alliance" || row.faction === "horde" ? { faction: row.faction } : {}),
        ...(typeof row.suggestedGroup === "number" && Number.isInteger(row.suggestedGroup) && row.suggestedGroup > 1 ? { suggestedGroup: row.suggestedGroup } : {}),
        ...(QUEST_TAGS.includes(row.tag as QuestTag) ? { tag: row.tag as QuestTag } : {}),
        ...when,
      });
    }
    if (row.kind === "vendor" && typeof row.vendorNpcId === "number" && Array.isArray(row.items)) {
      for (const item of row.items) {
        if (!item || typeof item !== "object") continue;
        const offer = item as { itemId?: unknown; priceCopper?: unknown; limitedStock?: unknown };
        if (typeof offer.itemId !== "number" || typeof offer.priceCopper !== "number") continue;
        facts.vendors.push({
          installId: row.installId,
          vendorNpcId: row.vendorNpcId,
          itemId: offer.itemId,
          priceCopper: offer.priceCopper,
          ...(typeof offer.limitedStock === "number" ? { limitedStock: offer.limitedStock } : {}),
          ...when,
        });
      }
    }
  }
  return facts;
}
