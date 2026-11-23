import { agreedNpcsOf, npcPage, npcTraits, questPage, questTraits, vendorPage, type NpcPage, type NpcRank, type NpcReaction, type QuestPage, type QuestSide, type QuestTag, type VendorPage, type WorldFacts } from "@kb/world-pages";
import { publicZones, type ZoneSummary } from "./zones";

// The NPCs, quests and vendors that have at least one public fact (3 installs agree), for the list pages
// and the database search. Built from the same page functions as the detail pages, so a row here never
// shows more than its page does. Rows are grouped by id first: one pass, not one scan per id.

function byId<T>(rows: T[], id: (row: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const key = id(row);
    if (!Number.isInteger(key) || key < 1) continue;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return new Map([...groups].sort((a, b) => a[0] - b[0]));
}

const EMPTY: WorldFacts = { npcs: [], quests: [], vendors: [] };

/** The agreed NPC table (kb world-pages `agreedNpcsOf`), as the lists read it: the page facts, never the pending loot. */
const tableOf = (facts: WorldFacts): WorldFacts => ({ ...EMPTY, agreedNpcs: agreedNpcsOf(facts), ...(facts.recheck ? { recheck: facts.recheck } : {}) });
const npcIds = (facts: WorldFacts) => [...agreedNpcsOf(facts).keys()].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);

export function publicNpcs(facts: WorldFacts): NpcPage[] {
  const table = tableOf(facts);
  return npcIds(facts).map((id) => npcPage(id, table)).filter((p) => p.name !== null || p.pins.length > 0);
}

/** One row of the NPC list: the page's facts, the level and reaction 3 installs agree on, its zone and its public drops. */
export interface NpcRow extends NpcPage {
  level: number | null;
  reaction: NpcReaction | null;
  /** The creature type (Beast, Undead...) and rank (normal, elite, rare...) 3 installs agree on. */
  creatureType: string | null;
  rank: NpcRank | null;
  /** The released zone of its first agreed pin; null when it has none, or the zone is held back. */
  zone: ZoneSummary | null;
  /** Items with a public loot frequency from it. */
  drops: number;
}

/**
 * Every NPC with a public fact: an agreed name, pin, level or reaction, or a public loot frequency (an NPC
 * known only from what it dropped has a page too). `only` keeps the ids it holds (the search's matches).
 */
export function npcRows(facts: WorldFacts, rates: readonly { sourceNpcId?: number; itemId: number; drops: number; public: boolean }[], only?: ReadonlySet<number>): NpcRow[] {
  const drops = new Map<number, Set<number>>();
  for (const r of rates) if (r.public && r.drops > 0 && r.sourceNpcId !== undefined) drops.set(r.sourceNpcId, (drops.get(r.sourceNpcId) ?? new Set()).add(r.itemId));
  const table = tableOf(facts);
  const ids = [...new Set([...npcIds(facts), ...drops.keys()])].filter((id) => Number.isInteger(id) && id > 0 && (!only || only.has(id))).sort((a, b) => a - b);
  const zones = new Map(publicZones().map((z) => [z.mapId, z]));
  return ids.map((id) => {
    const page = npcPage(id, table);
    const { level, reaction, creatureType, rank } = table.agreedNpcs!.get(id) ?? npcTraits([]);
    const zone = page.pins.map((p) => zones.get(p.mapId)).find(Boolean) ?? null;
    return { ...page, level, reaction, creatureType, rank, zone, drops: drops.get(id)?.size ?? 0 };
  }).filter((r) => r.name !== null || r.pins.length > 0 || r.level !== null || r.reaction !== null || r.drops > 0);
}

/** One row of the quest list: the page's facts and the category, side, group size and tag 3 installs agree on. */
export interface QuestRow extends QuestPage {
  category: string | null;
  side: QuestSide | null;
  suggestedGroup: number | null;
  tag: QuestTag | null;
}

/** The side a quest is offered to, as the lists and the search overview print it. */
export const SIDE_LABEL: Record<QuestSide, string> = { alliance: "Alliance", horde: "Horde", both: "Both" };

export function publicQuests(facts: WorldFacts): QuestRow[] {
  const npcs = facts.agreedNpcs ? { agreedNpcs: facts.agreedNpcs } : {};
  return [...byId(facts.quests, (r) => r.questId)].map(([id, quests]) => ({ ...questPage(id, { ...EMPTY, quests, npcs: facts.npcs, recheck: facts.recheck, ...npcs }), ...questTraits(quests, facts) }))
    .filter((p) => p.title !== null || p.level !== null || p.giverNpcId !== null || p.turnInNpcId !== null || p.rewards.length > 0);
}

/** A quest or NPC row with no agreed facts, for an id the list knows from elsewhere: every cell reads "—". */
export const bareQuestRow = (questId: number): QuestRow => ({ ...questPage(questId, EMPTY), ...questTraits([]) });
export const bareNpcRow = (npcId: number): NpcRow => ({ ...npcPage(npcId, EMPTY), ...npcTraits([]), zone: null, drops: 0 });

export function publicVendors(facts: WorldFacts): VendorPage[] {
  const npcs = facts.agreedNpcs ? { agreedNpcs: facts.agreedNpcs } : {};
  return [...byId(facts.vendors, (r) => r.vendorNpcId)].map(([id, vendors]) => vendorPage(id, { ...EMPTY, vendors, npcs: facts.npcs, recheck: facts.recheck, ...npcs })).filter((p) => p.offers.length > 0);
}
