import type { ProgressionInstance, ProgressionKill } from "./progression.js";

// Blizzard's Forever overview: Onyxia 40, Barrow Deeps 10, Hyjal Summit 20.
// https://news.blizzard.com/en-us/article/24303009/world-of-warcraft-forever-raid-overviewlocations-raid-sizes-and-attunement
// Barrow Deeps and Hyjal Summit have no map ids in this encounter extract; do not invent mappings.
export const RAID_SIZES: Readonly<Record<number, { size: number | null; source: string }>> = {
  249: { size: 40, source: "Blizzard Forever raid overview" },
  309: { size: 20, source: "Classic Zul'Gurub fallback" },
  409: { size: 40, source: "Classic Molten Core fallback" },
  469: { size: 40, source: "Classic Blackwing Lair fallback" },
  509: { size: 20, source: "Classic Ruins of Ahn'Qiraj fallback" },
  531: { size: 40, source: "Classic Temple of Ahn'Qiraj fallback" },
  533: { size: 40, source: "Classic Naxxramas fallback (map 533 only)" },
  2856: { size: null, source: "Not in the overview; no unambiguous classic size" },
};

export interface GuildRosterProgression {
  /** One row per distinct roster character; unavailable histories are null. */
  kills: readonly ProgressionKill[] | null;
}
export interface GuildProgress extends ProgressionInstance {
  threshold: number | null;
  killed: number;
  total: number;
  state: "cleared" | "partial" | "none";
  newestKillDay: null;
}

export function guildThreshold(instance: ProgressionInstance): number | null {
  if (!instance.typeKnown) return null;
  return instance.group === "World bosses" ? 40 : instance.group === "Dungeons" ? 5 : RAID_SIZES[instance.id]?.size ?? null;
}

/** Each member holds a boss at most once, regardless of difficulty or repeated kills. */
export function guildProgression(catalogue: readonly ProgressionInstance[], rosterProgression: readonly GuildRosterProgression[]): GuildProgress[] {
  return catalogue.map((instance) => {
    const threshold = guildThreshold(instance);
    const bosses = new Set(instance.bosses.map((b) => b.id));
    const counts = new Map<number, number>();
    for (const member of rosterProgression) {
      const held = new Set((member.kills ?? []).filter((k) => k.instanceMapId === instance.id && bosses.has(k.encounterId)).map((k) => k.encounterId));
      for (const id of held) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const killed = threshold === null ? 0 : [...counts.values()].filter((n) => n >= threshold).length;
    const total = bosses.size;
    return { ...instance, threshold, killed, total, state: killed === 0 ? "none" : killed === total ? "cleared" : "partial", newestKillDay: null };
  });
}

/** Observed-open instances only: N per counted boss, plus total bosses x N for a clear. */
export function guildProgressionScore(catalogue: readonly ProgressionInstance[], rosterProgression: readonly GuildRosterProgression[]): number {
  return guildProgression(catalogue, rosterProgression).reduce((score, r) =>
    score + (r.availability === "open" && r.threshold !== null ? (r.killed + (r.state === "cleared" ? r.total : 0)) * r.threshold : 0), 0);
}
