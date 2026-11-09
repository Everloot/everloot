import { z } from "zod";
import { STANDING_NAMES } from "../../../kb/src/completion";
import type { CollectionsData, GearRow, GearSlot, ProfessionRow, PvpData, RaidsData, ReputationRow, Section, ShowcaseInput, StatsData } from "./character-showcase";
import type { StoredFact } from "./private-sync-store";
import { keepStat, STAT_KEYS, type StatKey } from "./private-sync";

/**
 * A linked character's synced facts (private sync, showcase plan S5 and S6) as the showcase's own sections. Pure:
 * the reads happen in the page (character-view.ts) and the owner's preview, which pass the facts and the names in.
 * A category with no fact adds nothing, so its section stays `empty`; nothing is estimated and nothing is a zero
 * in place of a missing value. A stored shape this file does not know is left out the same way.
 */

/** What the facts are named with, read only for the categories a page has. */
export interface FactNames {
  /** An item's name when 3 installs agree on it, else null ("Item <id>"). */
  item: (id: number) => string | null;
  /** The completion catalog entries 3 installs agree on; null when it could not be read. */
  catalog: {
    achievements: ReadonlyMap<number, { points: number }>;
    factions: ReadonlyMap<number, { name: string; major: boolean }>;
    titles: ReadonlyMap<number, { name: string }>;
  } | null;
  /** The character's class's talent trees and which tree each node is in; null when the class has no catalog. */
  talentTrees: { trees: readonly { id: number; name: string }[]; nodeTree: ReadonlyMap<number, number> } | null;
}

/** The sections the facts fill. Talents carry only the in-game trees: the planned builds come from the page. */
export interface FactSections {
  gear?: Section<GearRow[]>;
  stats?: Section<StatsData>;
  pvp?: Section<PvpData>;
  talents?: { asOf: string; trees: { name: string; points: number }[] };
  professions?: Section<ProfessionRow[]>;
  reputations?: Section<ReputationRow[]>;
  raids?: Section<RaidsData>;
  collections?: Section<CollectionsData>;
}

/** The addon's slot names, in the character window's order, with the page's words for them. */
const SLOTS: Record<string, GearSlot> = {
  HeadSlot: "head", NeckSlot: "neck", ShoulderSlot: "shoulders", BackSlot: "back", ChestSlot: "chest", ShirtSlot: "shirt",
  TabardSlot: "tabard", WristSlot: "wrists", HandsSlot: "hands", WaistSlot: "waist", LegsSlot: "legs", FeetSlot: "feet",
  Finger0Slot: "finger1", Finger1Slot: "finger2", Trinket0Slot: "trinket1", Trinket1Slot: "trinket2",
  MainHandSlot: "mainHand", SecondaryHandSlot: "offHand", RangedSlot: "ranged",
};
const SLOT_ORDER = Object.keys(SLOTS);

type StatGroup = StatsData[number]["group"];
/** The character window's stats: the group and words the page uses, and whether the number is a percentage. */
export const STAT_LABELS: Record<StatKey, { group: StatGroup; label: string; percent: boolean }> = {
  strength: { group: "Attributes", label: "Strength", percent: false },
  agility: { group: "Attributes", label: "Agility", percent: false },
  stamina: { group: "Attributes", label: "Stamina", percent: false },
  intellect: { group: "Attributes", label: "Intellect", percent: false },
  spirit: { group: "Attributes", label: "Spirit", percent: false },
  meleeAttackPower: { group: "Melee", label: "Attack power", percent: false },
  meleeHit: { group: "Melee", label: "Hit", percent: true },
  meleeCrit: { group: "Melee", label: "Crit", percent: true },
  meleeHaste: { group: "Melee", label: "Haste", percent: true },
  expertise: { group: "Melee", label: "Expertise", percent: true },
  rangedAttackPower: { group: "Ranged", label: "Attack power", percent: false },
  rangedHit: { group: "Ranged", label: "Hit", percent: true },
  rangedCrit: { group: "Ranged", label: "Crit", percent: true },
  rangedHaste: { group: "Ranged", label: "Haste", percent: true },
  spellPower: { group: "Spell", label: "Spell power", percent: false },
  healing: { group: "Spell", label: "Healing", percent: false },
  spellHit: { group: "Spell", label: "Hit", percent: true },
  spellCrit: { group: "Spell", label: "Crit", percent: true },
  spellHaste: { group: "Spell", label: "Haste", percent: true },
  armor: { group: "Defense", label: "Armor", percent: false },
  defense: { group: "Defense", label: "Defense", percent: false },
  dodge: { group: "Defense", label: "Dodge", percent: true },
  parry: { group: "Defense", label: "Parry", percent: true },
  block: { group: "Defense", label: "Block", percent: true },
};
const statValue = (key: StatKey, n: number) => (STAT_LABELS[key].percent ? `${n.toFixed(2)}%` : Math.round(n).toLocaleString("en-US"));

// The stored shapes, as private-sync.ts builds them. Read back defensively: a row of any other shape is left out.
const gearData = z.object({ equipped: z.array(z.object({ slot: z.string(), itemId: z.number().int().positive(), itemLevel: z.number().int().positive() })) });
const statsData = z.object({ stats: z.record(z.string(), z.number().finite()) });
const pvpNumber = z.number().int().min(0).nullish();
const pvpFact = z.object({ rank: pvpNumber, rankPoints: pvpNumber, rankThreshold: pvpNumber, rankMax: pvpNumber, season: pvpNumber, honorableKills: pvpNumber });
const talentData = z.object({ nodes: z.array(z.object({ nodeId: z.number().int(), ranks: z.number().int().min(1) })) });
const professionData = z.object({ professions: z.array(z.object({ name: z.string().min(1), rank: z.number().int().min(0), maxRank: z.number().int().min(1) })) });
const reputationData = z.object({
  factions: z.array(z.object({ factionId: z.number().int(), reaction: z.number().int(), standing: z.number().int(), floor: z.number().int(), ceiling: z.number().int() })),
});
const raidData = z.object({
  lockouts: z.array(z.object({
    instance: z.string().min(1), difficulty: z.string().nullable(), killed: z.number().int().min(0), total: z.number().int().min(1), resetAt: z.string().datetime({ offset: true }),
  })),
});
const achievementData = z.object({ achievements: z.array(z.object({ id: z.number().int() })), titleIds: z.array(z.number().int()) });

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const shown = <T>(fact: StoredFact, data: T): Section<T> => ({ state: "shown", asOf: day(fact.capturedAt), data });

export function factSections(facts: readonly StoredFact[], names: FactNames, now: Date): FactSections {
  const out: FactSections = {};
  for (const fact of facts) {
    switch (fact.category) {
      case "gear": {
        const d = gearData.safeParse(fact.data);
        if (!d.success) break;
        const rank = (slot: string) => { const i = SLOT_ORDER.indexOf(slot); return i < 0 ? SLOT_ORDER.length : i; };
        // A slot the page has no place for is left out; quality and icon are filled by the page's item rules.
        out.gear = shown(fact, [...d.data.equipped].sort((a, b) => rank(a.slot) - rank(b.slot)).flatMap((e): GearRow[] => {
          const slot = SLOTS[e.slot];
          return slot ? [{ slot, itemId: e.itemId, name: names.item(e.itemId), quality: null, itemLevel: e.itemLevel }] : [];
        }));
        break;
      }
      case "stats": {
        const d = statsData.safeParse(fact.data);
        if (!d.success) break;
        // Page order; an unknown key is dropped, and so is a zero outside the attributes (the game hides it too).
        const groups = new Map<StatGroup, { label: string; value: string }[]>();
        for (const key of STAT_KEYS) {
          const n = d.data.stats[key];
          if (n === undefined || !keepStat(key, n)) continue;
          const { group, label } = STAT_LABELS[key];
          groups.set(group, [...(groups.get(group) ?? []), { label, value: statValue(key, n) }]);
        }
        if (groups.size) out.stats = shown(fact, [...groups].map(([group, stats]) => ({ group, stats })));
        break;
      }
      case "pvp": {
        const d = pvpFact.safeParse(fact.data);
        if (!d.success) break;
        const v = d.data;
        // Nothing to draw (no rank above 0, no points toward a next rank, no season, no kill count): no section, not
        // an empty card. Rank 0 is unranked, as the PvP section reads it.
        const ranked = v.rank != null && v.rank > 0;
        const points = v.rankPoints != null && v.rankThreshold != null && v.rankThreshold > 0;
        if (!ranked && !points && v.season == null && v.honorableKills == null) break;
        out.pvp = shown(fact, {
          rank: v.rank ?? null, rankPoints: v.rankPoints ?? null, rankThreshold: v.rankThreshold ?? null,
          rankMax: v.rankMax ?? null, season: v.season ?? null, honorableKills: v.honorableKills ?? null,
        });
        break;
      }
      case "talents": {
        const d = talentData.safeParse(fact.data);
        const trees = names.talentTrees;
        // Every node must be one the class's catalog places; otherwise the split by tree would be a guess.
        if (!d.success || !trees || !d.data.nodes.every((n) => trees.nodeTree.has(n.nodeId))) break;
        const points = new Map<number, number>();
        for (const n of d.data.nodes) {
          const tree = trees.nodeTree.get(n.nodeId)!;
          points.set(tree, (points.get(tree) ?? 0) + n.ranks);
        }
        out.talents = { asOf: day(fact.capturedAt), trees: trees.trees.map((t) => ({ name: t.name, points: points.get(t.id) ?? 0 })) };
        break;
      }
      case "professions": {
        const d = professionData.safeParse(fact.data);
        if (d.success) out.professions = shown(fact, d.data.professions.map((p) => ({ name: p.name, rank: p.rank, maxRank: p.maxRank })));
        break;
      }
      case "reputations": {
        const d = reputationData.safeParse(fact.data);
        const catalog = names.catalog;
        if (!d.success || !catalog) break;
        // Only factions the catalog agrees on (3 installs); a standing outside the eight is not drawn as one.
        const rows = d.data.factions.flatMap((f): ReputationRow[] => {
          const entry = catalog.factions.get(f.factionId);
          if (!entry) return [];
          if (entry.major) return [{ faction: entry.name, renown: true }];
          const standing = STANDING_NAMES[f.reaction - 1];
          if (!standing || f.ceiling <= f.floor) return [];
          return [{ faction: entry.name, standing, value: Math.max(0, f.standing - f.floor), max: f.ceiling - f.floor }];
        });
        out.reputations = shown(fact, rows);
        break;
      }
      case "raids": {
        const d = raidData.safeParse(fact.data);
        if (!d.success) break;
        // A lockout that has reset since the capture is gone this week.
        const live = d.data.lockouts.filter((l) => Date.parse(l.resetAt) > now.getTime());
        out.raids = shown(fact, {
          lockouts: live.map((l) => ({ instance: l.instance, difficulty: l.difficulty ?? "Raid", killed: l.killed, total: l.total, resets: day(l.resetAt), bosses: [] })),
          guildKills: null,
        });
        break;
      }
      case "achievements": {
        const d = achievementData.safeParse(fact.data);
        const catalog = names.catalog;
        if (!d.success || !catalog) break;
        out.collections = shown(fact, {
          achievements: d.data.achievements.length,
          // The points the catalog agrees on; an achievement it does not list yet adds none.
          points: d.data.achievements.reduce((sum, a) => sum + (catalog.achievements.get(a.id)?.points ?? 0), 0),
          titles: d.data.titleIds.flatMap((id) => { const t = catalog.titles.get(id); return t ? [t.name] : []; }).sort((a, b) => a.localeCompare(b)),
          // Not synced yet: earned dates, per-category totals and the quest count. Empty lists and a null, never zeros.
          recent: [], categories: [], quests: null,
        });
        break;
      }
    }
  }
  return out;
}

/**
 * The page's input with the facts' sections in place. Talents keep the planned builds the page already found, beside
 * the synced trees, and take the synced capture's date. The header's date becomes the newest of the link's last
 * upload and the facts' captures.
 */
export function withFacts(input: ShowcaseInput, sections: FactSections): ShowcaseInput {
  const out: ShowcaseInput = { ...input };
  const dates = [input.lastUpload];
  for (const key of ["gear", "stats", "pvp", "professions", "reputations", "raids", "collections"] as const) {
    const s = sections[key];
    if (!s) continue;
    (out as unknown as Record<string, unknown>)[key] = s;
    if (s.state === "shown") dates.push(s.asOf);
  }
  if (sections.talents) {
    const planned = input.talents.state === "shown" ? input.talents.data.planned : [];
    out.talents = { state: "shown", asOf: sections.talents.asOf, data: { trees: sections.talents.trees, code: null, planned } };
    dates.push(sections.talents.asOf);
  }
  out.lastUpload = dates.reduce((a, b) => (b > a ? b : a));
  return out;
}
