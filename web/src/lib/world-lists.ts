import { npcPage, npcTraits, questPage, questTraits, vendorPage, type NpcPage, type NpcRank, type NpcReaction, type QuestPage, type QuestSide, type QuestTag, type VendorPage, type WorldFacts } from "@kb/world-pages";
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

export function publicNpcs(facts: WorldFacts): NpcPage[] {
  return [...byId(facts.npcs, (r) => r.npcId)].map(([id, npcs]) => npcPage(id, { ...EMPTY, npcs, recheck: facts.recheck })).filter((p) => p.name !== null || p.pins.length > 0);
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
 * known only from what it dropped has a page too).
 */
export function npcRows(facts: WorldFacts, rates: readonly { sourceNpcId?: number; itemId: number; drops: number; public: boolean }[]): NpcRow[] {
  const drops = new Map<number, Set<number>>();
  for (const r of rates) if (r.public && r.drops > 0 && r.sourceNpcId !== undefined) drops.set(r.sourceNpcId, (drops.get(r.sourceNpcId) ?? new Set()).add(r.itemId));
  const groups = byId(facts.npcs, (r) => r.npcId);
  const ids = [...new Set([...groups.keys(), ...drops.keys()])].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  const zones = new Map(publicZones().map((z) => [z.mapId, z]));
  return ids.map((id) => {
    const sightings = groups.get(id) ?? [];
    const page = npcPage(id, { ...EMPTY, npcs: sightings, recheck: facts.recheck });
    const zone = page.pins.map((p) => zones.get(p.mapId)).find(Boolean) ?? null;
    return { ...page, ...npcTraits(sightings, facts.recheck), zone, drops: drops.get(id)?.size ?? 0 };
  }).filter((r) => r.name !== null || r.pins.length > 0 || r.level !== null || r.reaction !== null || r.drops > 0);
}

/** One row of the quest list: the page's facts and the category, side, group size and tag 3 installs agree on. */
export interface QuestRow extends QuestPage {
  category: string | null;
  side: QuestSide | null;
  suggestedGroup: number | null;
  tag: QuestTag | null;
}

export function publicQuests(facts: WorldFacts): QuestRow[] {
  return [...byId(facts.quests, (r) => r.questId)].map(([id, quests]) => ({ ...questPage(id, { ...EMPTY, quests, npcs: facts.npcs, recheck: facts.recheck }), ...questTraits(quests, facts) }))
    .filter((p) => p.title !== null || p.level !== null || p.giverNpcId !== null || p.turnInNpcId !== null || p.rewards.length > 0);
}

/** A quest or NPC row with no agreed facts, for an id the list knows from elsewhere: every cell reads "—". */
export const bareQuestRow = (questId: number): QuestRow => ({ ...questPage(questId, EMPTY), ...questTraits([]) });
export const bareNpcRow = (npcId: number): NpcRow => ({ ...npcPage(npcId, EMPTY), ...npcTraits([]), zone: null, drops: 0 });

export function publicVendors(facts: WorldFacts): VendorPage[] {
  return [...byId(facts.vendors, (r) => r.vendorNpcId)].map(([id, vendors]) => vendorPage(id, { ...EMPTY, vendors, npcs: facts.npcs, recheck: facts.recheck })).filter((p) => p.offers.length > 0);
}
