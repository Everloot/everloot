/**
 * One table of typed relations between entities, from two kinds of evidence:
 *
 * - client: read from the game files of one build (labelled "found in game files, unconfirmed");
 * - observed: from players' uploads, public once 3 installs agree, the same rule the pages use.
 *
 * Every edge says where it came from, how many installs agree (observed) or which build (client), and
 * when it was first and last seen. Pages, the MCP tool, the API and the bulk file all read this shape.
 */
import { GAME_DATA_CREDIT, RELS, type EntityKind, type Rel } from "@everloot/protocol";
import { INDEPENDENT_INSTALLS, lootWindowsFromRecords, recheckLootRecords, rollupDrops } from "./drop-rollup.js";
import type { RecheckScope } from "./coverage.js";
import { recheckRows, tallyVotes } from "./fact-states.js";
import { npcZones, scopeSince } from "./recheck-scopes.js";
import { isPinPosition } from "./world-pages.js";

export const EDGE_SCHEMA = "everloot.edges/1";
export const CLIENT_LABEL = "Found in game files, unconfirmed";

export type EdgeKind = EntityKind;
export type Evidence = "client" | "observed";

/** In the order pages list them: what players saw first, then what the files say. */
export { RELS, type Rel };

export const REL_LABELS: Record<Rel, string> = {
  dropped_by: "Dropped by", sold_by: "Sold by", reward_from: "Reward from", located_in: "Located in",
  created_by: "Created by", reagent_for: "Reagent for", part_of_set: "Part of set", same_icon: "Same icon", in_skill_line: "Profession",
};

export interface Edge {
  fromKind: EdgeKind;
  fromId: number;
  rel: Rel;
  toKind: EdgeKind;
  toId: number;
  evidence: Evidence;
  /** Game build of a client edge; null for observed edges. */
  build: string | null;
  /** Distinct installs behind an observed edge; null for client edges. */
  installs: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

type Rows = Map<number, Record<string, unknown>>;
const list = (r: Rows | undefined) => [...(r?.values() ?? [])];
const id = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0);
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.map(id).filter(Boolean) : []);

/**
 * Edges from the client tables of one build. A table the build does not have adds nothing.
 * `same_icon` links each item to its icon file when at least two items share it, rather than every pair
 * (in 1.60.1.70450 one icon is shared by 1,141 items, and pairs would be 3.2 million rows).
 */
export function clientEdges(get: (table: string) => Rows | undefined, build: { version: string; extractedAt: string }): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];
  const add = (fromKind: EdgeKind, fromId: number, rel: Rel, toKind: EdgeKind, toId: number) => {
    if (!fromId || !toId) return;
    const key = `${fromKind}:${fromId}|${rel}|${toKind}:${toId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ fromKind, fromId, rel, toKind, toId, evidence: "client", build: build.version, installs: null, firstSeen: build.extractedAt, lastSeen: build.extractedAt });
  };
  // SPELL_EFFECT_CREATE_ITEM is effect 24; EffectItemType is the item it makes.
  for (const e of list(get("SpellEffect"))) if (e.Effect === 24) add("item", id(e.EffectItemType), "created_by", "spell", id(e.SpellID));
  for (const r of list(get("SpellReagents"))) for (const item of ids(r.Reagent)) add("item", item, "reagent_for", "spell", id(r.SpellID));
  for (const s of list(get("ItemSet"))) for (const item of ids(s.ItemID)) add("item", item, "part_of_set", "item_set", id(s.ID));
  const byIcon = new Map<number, number[]>();
  for (const i of list(get("Item"))) {
    const icon = id(i.IconFileDataID);
    if (icon) byIcon.set(icon, [...(byIcon.get(icon) ?? []), id(i.ID)]);
  }
  for (const [icon, items] of byIcon) if (items.length > 1) for (const item of items) add("item", item, "same_icon", "icon", icon);
  // Which profession teaches a spell: SkillLineAbility, kept to professions and secondary skills, a child tier
  // line (an expansion's) folded into its parent.
  for (const [spell, skill] of professionOfSpells(get)) add("spell", spell, "in_skill_line", "skill", skill);
  return out;
}

/** SkillLine.CategoryID of professions. */
export const PROFESSION_CATEGORY = 11;
/**
 * The secondary skills players call professions: Cooking, First Aid and Fishing. They share CategoryID 9 with
 * riding, racial lines, Poisons and Lockpicking, which nobody browses as professions, so these are named by id.
 */
export const SECONDARY_SKILLS = new Set([129, 185, 356]);
export const isProfession = (row: Record<string, unknown>) => Number(row.CategoryID) === PROFESSION_CATEGORY || SECONDARY_SKILLS.has(Number(row.ID));

/** spell id -> the top-level profession skill line that teaches it. */
export function professionOfSpells(get: (table: string) => Rows | undefined): Map<number, number> {
  const lines = new Map(list(get("SkillLine")).map((r) => [id(r.ID), r]));
  const top = (skill: number) => { const r = lines.get(skill); const parent = id(r?.ParentSkillLineID); return parent && lines.has(parent) ? parent : skill; };
  const out = new Map<number, number>();
  for (const a of list(get("SkillLineAbility"))) {
    const skill = top(id(a.SkillLine));
    const row = lines.get(skill);
    if (!row || !isProfession(row) || !id(a.Spell)) continue;
    if (!out.has(id(a.Spell))) out.set(id(a.Spell), skill);
  }
  return out;
}

/** Earliest and latest capture time, ignoring times after the data was current (one bad clock cannot set them). */
class Span {
  private min = Infinity;
  private max = -Infinity;
  constructor(private readonly ceiling: number) {}
  add(capturedAt: unknown) {
    const t = typeof capturedAt === "string" ? Date.parse(capturedAt) : NaN;
    if (!Number.isFinite(t) || t > this.ceiling) return;
    this.min = Math.min(this.min, t);
    this.max = Math.max(this.max, t);
  }
  get first() { return Number.isFinite(this.min) ? new Date(this.min).toISOString() : null; }
  get last() { return Number.isFinite(this.max) ? new Date(this.max).toISOString() : null; }
}

interface Group { rows: { installId: string; capturedAt?: string }[] }

/**
 * Edges from upload records, each public under the rule its page already uses: a drop once 3 installs
 * reported loot windows from the source, a vendor item once 3 agree on its price, a quest reward once 3
 * report it, an NPC's zone once 3 measured it there (NPC positions only, never the player's).
 */
export function observedEdges(records: unknown[], dataAsOf: string | Date, recheck: readonly RecheckScope[] = []): Edge[] {
  const ceiling = new Date(dataAsOf).getTime();
  // Loot rates settle on recheck scopes by dropping windows before the scope's date; names and places keep theirs.
  const source = recheck.length ? recheckLootRecords(records, recheck) : records;
  const groups = new Map<string, Group>();
  const touch = (key: string, installId: string, capturedAt: unknown) => {
    const g = groups.get(key) ?? { rows: [] };
    g.rows.push({ installId: installId.trim(), ...(typeof capturedAt === "string" ? { capturedAt } : {}) });
    groups.set(key, g);
  };
  for (const raw of source) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.installId !== "string" || !r.installId.trim()) continue;
    if (r.kind === "loot" && r.sourceEvidence === "loot-api" && Array.isArray(r.items)) {
      const sourceKey = id(r.sourceNpcId) ? `npc:${id(r.sourceNpcId)}` : id(r.sourceObjectId) ? `object:${id(r.sourceObjectId)}` : null;
      if (sourceKey) for (const it of r.items as { itemId?: unknown }[]) if (id(it?.itemId)) touch(`drop|${sourceKey}|${id(it.itemId)}`, r.installId, r.capturedAt);
    }
    if (r.kind === "vendor" && id(r.vendorNpcId) && Array.isArray(r.items)) {
      for (const o of r.items as { itemId?: unknown; priceCopper?: unknown }[]) {
        if (id(o?.itemId) && typeof o.priceCopper === "number" && Number.isInteger(o.priceCopper) && o.priceCopper >= 0) {
          touch(`sold|${id(r.vendorNpcId)}|${id(o.itemId)}|${o.priceCopper}`, r.installId, r.capturedAt);
        }
      }
    }
    if (r.kind === "quest" && id(r.questId)) for (const item of ids(r.rewardItemIds)) touch(`reward|${id(r.questId)}|${item}`, r.installId, r.capturedAt);
    if (r.kind === "npc_sighting" && isPinPosition(r.positionKind) && id(r.npcId) && typeof r.mapId === "number" && Number.isInteger(r.mapId) && r.mapId >= 0) {
      touch(`zone|${id(r.npcId)}|${r.mapId}`, r.installId, r.capturedAt);
    }
  }
  // A vendor offer counts where its vendor stands, a quest where its leading giver stands, a pin on its own map.
  const npcZone = new Map<number, number | null>(), npcRare = new Map<number, boolean>();
  const questZone = new Map<number, number | null>(), questRewards = new Map<number, Set<number>>();
  if (recheck.length) {
    const npcRows: { npcId: number; mapId: number; installId: string; pin: boolean; rank?: unknown }[] = [];
    const npcRowsById = new Map<number, typeof npcRows>();
    for (const raw of records) {
      const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      if (!r || r.kind !== "npc_sighting" || !id(r.npcId) || typeof r.mapId !== "number" || !Number.isInteger(r.mapId) || r.mapId < 0 || typeof r.installId !== "string") continue;
      const row = { npcId: id(r.npcId), mapId: r.mapId, installId: r.installId, pin: isPinPosition(r.positionKind), ...(r.rank === undefined ? {} : { rank: r.rank }) };
      npcRows.push(row);
      const list = npcRowsById.get(row.npcId);
      if (list) list.push(row); else npcRowsById.set(row.npcId, [row]);
    }
    for (const [npcId, zone] of npcZones(npcRows)) npcZone.set(npcId, zone);
    // A rare is its agreed rank, or with none agreed, any report of a rare rank, as `npcScope` counts it.
    const rare = (v: string) => v === "rare" || v === "rare_elite";
    for (const [npcId, rows] of npcRowsById) {
      const agreed = tallyVotes(rows.flatMap((r) => (r.rank === undefined ? [] : [{ installId: r.installId, value: String(r.rank) }]))).winner?.value;
      npcRare.set(npcId, agreed !== undefined ? rare(String(agreed)) : rows.some((r) => typeof r.rank === "string" && rare(r.rank)));
    }
    const questLeads = new Map<number, { installId: string; giverNpcId?: number; turnInNpcId?: number }[]>();
    for (const raw of records) {
      const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      if (!r || r.kind !== "quest" || !id(r.questId)) continue;
      const questId = id(r.questId);
      const rewards = questRewards.get(questId) ?? new Set<number>();
      for (const item of ids(r.rewardItemIds)) rewards.add(item);
      questRewards.set(questId, rewards);
      if (typeof r.installId !== "string") continue;
      const leads = questLeads.get(questId) ?? [];
      leads.push({
        installId: r.installId,
        ...(id(r.giverNpcId) ? { giverNpcId: id(r.giverNpcId) } : {}),
        ...(id(r.turnInNpcId) ? { turnInNpcId: id(r.turnInNpcId) } : {}),
      });
      questLeads.set(questId, leads);
    }
    // The leading giver by distinct-install votes, then the leading turn-in, where `questScope` places it.
    for (const [questId, rows] of questLeads) {
      const lead = (k: "giverNpcId" | "turnInNpcId") => {
        const voted = tallyVotes(rows.flatMap((r) => (r[k] === undefined ? [] : [{ installId: r.installId, value: r[k]! }]))).groups.sort((a, b) => b.voters.size - a.voters.size)[0]?.value;
        return typeof voted === "number" ? npcZone.get(voted) ?? null : null;
      };
      questZone.set(questId, lead("giverNpcId") ?? lead("turnInNpcId"));
    }
  }
  const scopeFor = (key: string): string | null => {
    if (!recheck.length) return null;
    const [kind, a, b] = key.split("|");
    if (kind === "sold") return scopeSince(recheck, { types: ["vendors"], zones: [npcZone.get(Number(a)) ?? null], ids: [Number(a), Number(b)] });
    if (kind === "reward") return scopeSince(recheck, { types: ["quests"], zones: [questZone.get(Number(a)) ?? null], ids: [Number(a), ...(questRewards.get(Number(a)) ?? [])] });
    if (kind === "zone") return scopeSince(recheck, { types: npcRare.get(Number(a)) ? ["pins", "rares"] : ["pins"], zones: [Number(b)], ids: [Number(a)] });
    return null;
  };
  const qualified = (key: string, rows: Group["rows"]) => {
    const since = scopeFor(key);
    const kept = since ? recheckRows(rows, since).rows : rows;
    const installs = new Set(kept.map((row) => row.installId));
    const span = new Span(ceiling);
    for (const row of kept) span.add(row.capturedAt);
    return { installs: installs.size, span };
  };
  const edge = (fromKind: EdgeKind, fromId: number, rel: Rel, toKind: EdgeKind, toId: number, installs: number, span: Span): Edge =>
    ({ fromKind, fromId, rel, toKind, toId, evidence: "observed", build: null, installs, firstSeen: span.first, lastSeen: span.last });
  const out: Edge[] = [];

  // Drops: exactly the public rates of the drop table, so the edge and the item page agree.
  for (const rate of rollupDrops(lootWindowsFromRecords(source)).rates) {
    if (!rate.public || rate.drops === 0) continue;
    const toKind: EdgeKind = rate.sourceNpcId !== undefined ? "npc" : "object";
    const toId = rate.sourceNpcId ?? rate.sourceObjectId!;
    const g = groups.get(`drop|${toKind}:${toId}|${rate.itemId}`);
    const span = g ? qualified(`drop|${toKind}:${toId}|${rate.itemId}`, g.rows).span : new Span(ceiling);
    out.push(edge("item", rate.itemId, "dropped_by", toKind, toId, rate.reporters, span));
  }
  // Vendors: recheck every price of one item together, then the price most installs agree on, at 3 or more.
  const vendorItems = new Map<string, { vendor: number; item: number; rows: (Group["rows"][number] & { price: number })[] }>();
  for (const [key, g] of groups) {
    const [kind, vendor, item, price] = key.split("|");
    if (kind !== "sold") continue;
    const k = `${vendor}|${item}`;
    const v = vendorItems.get(k) ?? { vendor: Number(vendor), item: Number(item), rows: [] };
    for (const row of g.rows) v.rows.push({ ...row, price: Number(price) });
    vendorItems.set(k, v);
  }
  const sold = new Map<string, { vendor: number; item: number; installs: number; span: Span }>();
  for (const [k, v] of vendorItems) {
    const since = scopeSince(recheck, { types: ["vendors"], zones: [npcZone.get(v.vendor) ?? null], ids: [v.vendor, v.item] });
    const kept = since ? recheckRows(v.rows, since, { value: (row) => row.price }).rows : v.rows;
    const byPrice = new Map<number, { installs: Set<string>; span: Span }>();
    for (const row of kept) {
      const g = byPrice.get(row.price) ?? { installs: new Set<string>(), span: new Span(ceiling) };
      g.installs.add(row.installId);
      g.span.add(row.capturedAt);
      byPrice.set(row.price, g);
    }
    let best: { installs: number; span: Span } | null = null;
    for (const [, g] of [...byPrice].sort((a, b) => a[0] - b[0])) {
      if (g.installs.size < INDEPENDENT_INSTALLS) continue;
      if (!best || g.installs.size > best.installs) best = { installs: g.installs.size, span: g.span };
    }
    if (best) sold.set(k, { vendor: v.vendor, item: v.item, installs: best.installs, span: best.span });
  }
  for (const s of sold.values()) out.push(edge("item", s.item, "sold_by", "npc", s.vendor, s.installs, s.span));
  for (const [key, g] of groups) {
    const q = qualified(key, g.rows);
    if (q.installs < INDEPENDENT_INSTALLS) continue;
    const [kind, a, b] = key.split("|");
    if (kind === "reward") out.push(edge("item", Number(b), "reward_from", "quest", Number(a), q.installs, q.span));
  }
  for (const [key, g] of groups) {
    const q = qualified(key, g.rows);
    if (q.installs < INDEPENDENT_INSTALLS) continue;
    const [kind, a, b] = key.split("|");
    if (kind === "zone") out.push(edge("npc", Number(a), "located_in", "zone", Number(b), q.installs, q.span));
  }
  return out;
}

/** The corpus fact builder for the MCP tool: times after now are ignored, and recheck scopes cut confirmed facts. */
export const observedEdgesFromRecords = (records: unknown[], recheck: readonly RecheckScope[] = []): Edge[] => observedEdges(records, new Date(), recheck);

export function edgesFrom(edges: readonly Edge[], kind: EdgeKind, entityId: number): Edge[] {
  return edges.filter((e) => e.fromKind === kind && e.fromId === entityId);
}

export function edgesTo(edges: readonly Edge[], kind: EdgeKind, entityId: number): Edge[] {
  return edges.filter((e) => e.toKind === kind && e.toId === entityId);
}

export function groupByRel(edges: readonly Edge[]): { rel: Rel; label: string; edges: Edge[] }[] {
  return RELS.map((rel) => ({ rel, label: REL_LABELS[rel], edges: edges.filter((e) => e.rel === rel) })).filter((g) => g.edges.length > 0);
}

/** The same relations read from the other end: what an NPC drops, what a spell creates. */
export const REVERSE_LABELS: Record<Rel, string> = {
  dropped_by: "Drops", sold_by: "Sells", reward_from: "Rewards", located_in: "Seen here",
  created_by: "Creates", reagent_for: "Uses reagent", part_of_set: "Set items", same_icon: "Items with this icon", in_skill_line: "Spells",
};

const NOUNS: Record<EdgeKind, string> = {
  item: "item", spell: "spell", npc: "NPC", object: "object", quest: "quest", zone: "zone", item_set: "item set", icon: "icon file", skill: "profession",
};
export const entityLabel = (kind: EdgeKind, entityId: number) => `${NOUNS[kind]} ${entityId}`;

/** How sure an edge is, in words: installs and last seen, or the build it was read from. */
export function evidenceLabel(e: Edge): string {
  if (e.evidence === "client") return `found in game files, unconfirmed; build ${e.build}`;
  return `${e.installs} installs${e.lastSeen ? `, last seen ${e.lastSeen.slice(0, 10)}` : ""}`;
}

export const RELATIONS_LIMIT = 25;

/**
 * The edges the text lists, as data: outgoing groups by relation, then incoming by relation, each group
 * cut to the limit, with how many were left out. The MCP tool's structured answer.
 */
export function entityRelationsStructured(
  args: { kind: EdgeKind; id: number; rel?: Rel; direction?: "from" | "to" | "both"; limit?: number },
  observed: readonly Edge[], client: readonly Edge[],
): { kind: EdgeKind; id: number; edges: Edge[]; notShown: number } {
  const all = [...observed, ...client].filter((e) => !args.rel || e.rel === args.rel);
  const direction = args.direction ?? "both";
  const limit = args.limit ?? RELATIONS_LIMIT;
  const edges: Edge[] = [];
  let notShown = 0;
  const take = (group: Edge[]) => {
    edges.push(...group.slice(0, limit));
    notShown += Math.max(0, group.length - limit);
  };
  if (direction !== "to") for (const g of groupByRel(edgesFrom(all, args.kind, args.id))) take(g.edges);
  if (direction !== "from" && args.kind !== "icon") {
    const incoming = edgesTo(all, args.kind, args.id);
    for (const rel of RELS) take(incoming.filter((e) => e.rel === rel));
  }
  return { kind: args.kind, id: args.id, edges, notShown };
}

/**
 * Text answer for the MCP tool: every relation of one entity, both directions unless asked, grouped by
 * relation. Observed edges carry our licence; file edges carry Blizzard's notice and their build.
 */
export function handleEntityRelations(
  args: { kind: EdgeKind; id: number; rel?: Rel; direction?: "from" | "to" | "both"; limit?: number },
  observed: readonly Edge[], client: readonly Edge[],
): string {
  if (!Number.isInteger(args.id) || args.id < 1) return "Name an entity id.";
  const all = [...observed, ...client].filter((e) => !args.rel || e.rel === args.rel);
  const direction = args.direction ?? "both";
  const limit = args.limit ?? RELATIONS_LIMIT;
  const title = entityLabel(args.kind, args.id);
  const lines = [title.charAt(0).toUpperCase() + title.slice(1)];
  const used = new Set<Evidence>();
  const section = (label: string, edges: Edge[], other: (e: Edge) => string) => {
    if (!edges.length) return;
    for (const e of edges.slice(0, limit)) {
      used.add(e.evidence);
      lines.push(`${label}: ${other(e)} (${evidenceLabel(e)})`);
    }
    if (edges.length > limit) lines.push(`${label}: ${edges.length - limit} more not shown`);
  };
  if (direction !== "to") {
    for (const g of groupByRel(edgesFrom(all, args.kind, args.id))) {
      section(g.label, g.edges, (e) => {
        if (e.rel !== "same_icon") return entityLabel(e.toKind, e.toId);
        const others = client.filter((o) => o.rel === "same_icon" && o.toId === e.toId && o.fromId !== args.id).map((o) => `item ${o.fromId}`);
        const shown = others.slice(0, 10).join(", ");
        return `icon file ${e.toId}, shared with ${shown}${others.length > 10 ? ` and ${others.length - 10} more` : ""}`;
      });
    }
  }
  if (direction !== "from" && args.kind !== "icon") {
    const incoming = edgesTo(all, args.kind, args.id);
    for (const rel of RELS) section(REVERSE_LABELS[rel], incoming.filter((e) => e.rel === rel), (e) => entityLabel(e.fromKind, e.fromId));
  }
  if (lines.length === 1) lines.push(`No relations recorded for ${title}. Player-observed relations need 3 installs; game-file relations come from the current build.`);
  if (used.has("client")) lines.push(GAME_DATA_CREDIT);
  return lines.join("\n");
}
