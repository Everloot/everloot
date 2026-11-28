import { INDEPENDENT_INSTALLS } from "@kb/drop-rollup";
import { skillRange, type ObjectSpawnRow, type SkillRange } from "@kb/object-spawns";

export const GATHERING_GUIDE_SLUGS = new Set(["herbalism", "mining", "skinning", "fishing"]);
export type GatheringSearch = Record<string, string | string[] | undefined>;

export const GATHERING_RANKS = [
  { title: "Apprentice", cap: 75 }, { title: "Journeyman", cap: 150 }, { title: "Expert", cap: 225 }, { title: "Artisan", cap: 300 },
] as const;

/** Forever 1.60.1.71139 SpellEffect ranks, including the original rank spells and Forever skill-line variants. */
const RANK_SPELLS: Readonly<Record<string, readonly (readonly number[])[]>> = {
  herbalism: [[2366, 2372, 1240949], [2368, 2373, 1240960], [3570, 3571, 1240971], [11993, 11994, 1240984]],
  mining: [[2575, 2581, 1240951], [2576, 2582, 1240962], [3564, 3568, 1240973], [10248, 10249, 1240986]],
  skinning: [[8613, 8615, 1240952], [8617, 8619, 1240963], [8618, 8620, 1240974], [10768, 10769, 1240987]],
  fishing: [[7620, 7733, 1240948], [7731, 7734, 1240959], [7732, 7736, 1240970], [18248, 18249, 1240983]],
};

export function reportedTrainerRanks(slug: string, skillLineId: number, rows: readonly { trainerNpcId?: number; skillLineId?: number; spellId?: number; installId: string }[]): Map<number, string[]> {
  const ids = RANK_SPELLS[slug] ?? [];
  const reports = new Map<number, Map<number, Set<string>>>();
  for (const { trainerNpcId, spellId, skillLineId: rowLine, installId } of rows) {
    if (trainerNpcId === undefined || spellId === undefined || rowLine !== skillLineId || !installId.trim()) continue;
    const rank = ids.findIndex((spells) => spells.includes(spellId));
    if (rank < 0) continue;
    const trainer = reports.get(trainerNpcId) ?? new Map<number, Set<string>>();
    const installs = trainer.get(rank) ?? new Set<string>();
    installs.add(installId.trim());
    trainer.set(rank, installs);
    reports.set(trainerNpcId, trainer);
  }
  return new Map([...reports].map(([npcId, ranks]) => [npcId, GATHERING_RANKS.flatMap((rank, i) =>
    (ranks.get(i)?.size ?? 0) >= INDEPENDENT_INSTALLS ? [rank.title] : [],
  )]));
}

export function gatheringRank(input: GatheringSearch["skill"]): { rank: number | null; invalid: boolean } {
  if (input === undefined || input === "") return { rank: null, invalid: false };
  const value = typeof input === "string" && /^\d+$/.test(input.trim()) ? Number(input) : NaN;
  const invalid = !Number.isSafeInteger(value) || value < 1 || value > 500;
  return { rank: invalid ? null : value, invalid };
}

type Evidence = { installs: number; itemIds: number[] };
export type FishingZoneEvidence = Evidence & { mapId: number };
export type SkinningCreatureEvidence = Evidence & { npcId: number; skill: SkillRange | null };
export interface GatheringEvidence { fishing: FishingZoneEvidence[]; skinning: SkinningCreatureEvidence[] }

type Counts = { installs: Set<string>; itemInstalls: Map<number, Set<string>>; skills: Map<string, ObjectSpawnRow> };
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const coordinate = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

function evidenceFor(counts: Map<number, Counts>): (Evidence & { id: number; skill: SkillRange | null })[] {
  return [...counts].filter(([, count]) => count.installs.size >= INDEPENDENT_INSTALLS).sort(([a], [b]) => a - b).map(([id, count]) => ({
    id, installs: count.installs.size,
    itemIds: [...count.itemInstalls].filter(([, installs]) => installs.size >= INDEPENDENT_INSTALLS).map(([itemId]) => itemId).sort((a, b) => a - b),
    skill: skillRange([...count.skills.values()]),
  }));
}

/** Fishing has a zone but no effective Fishing skill. Skinning has an NPC and effective rank but no location. */
export function buildGatheringEvidence(records: readonly unknown[]): GatheringEvidence {
  const fishing = new Map<number, Counts>();
  const skinning = new Map<number, Counts>();
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.kind !== "loot" || row.sourceEvidence !== "loot-api" || typeof row.installId !== "string" || !row.installId.trim()) continue;
    const isFishing = row.lootType === "fishing" && positiveId(row.sourceObjectId) && coordinate(row.x) && coordinate(row.y);
    const isSkinning = row.lootType === "skinning";
    const id = isFishing ? row.mapId : isSkinning ? row.sourceNpcId : null;
    if (!positiveId(id) || !Array.isArray(row.items)) continue;
    const itemIds = row.items.flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || !('itemId' in item) || !positiveId(item.itemId)) return [];
      return [item.itemId];
    });
    if (!itemIds.length) continue;
    const counts = isFishing ? fishing : skinning;
    const count = counts.get(id) ?? { installs: new Set(), itemInstalls: new Map(), skills: new Map() };
    const installId = row.installId.trim();
    count.installs.add(installId);
    for (const itemId of itemIds) {
      const reporters = count.itemInstalls.get(itemId) ?? new Set<string>();
      reporters.add(installId);
      count.itemInstalls.set(itemId, reporters);
    }
    const previous = count.skills.get(installId)?.gatherSkill;
    if (isSkinning && positiveId(row.gatherSkill) && row.gatherSkill <= 500 && (previous === undefined || row.gatherSkill < previous)) {
      count.skills.set(installId, { installId, objectId: id, gatherSkill: row.gatherSkill });
    }
    counts.set(id, count);
  }
  return {
    fishing: evidenceFor(fishing).map(({ id, installs, itemIds }) => ({ mapId: id, installs, itemIds })),
    skinning: evidenceFor(skinning).map(({ id, ...row }) => ({ npcId: id, ...row })),
  };
}
