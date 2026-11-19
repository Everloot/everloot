import encounters from "../../web/src/data/game-data/client-encounters.json";
import map from "../../web/src/data/game-data/map.json";
import names from "../../addon/data/instance-map-names.json";
import agreed from "../../addon/data/agreed-instances.json";
import type { InstanceFacts } from "./instances.js";

export const PROGRESSION_GROUPS = ["Dungeons", "Raids", "World bosses"] as const;
export const PROGRESSION_BUILD = encounters.build.version;
export type ProgressionState = "cleared" | "partial" | "none" | "no data";
export interface ProgressionInstance {
  id: number; name: string; group: typeof PROGRESSION_GROUPS[number];
  unconfirmed: boolean;
  /** False where the files give no instance type; the dungeon section holds these unclassified rows. */
  typeKnown: boolean;
  bosses: { id: number; name: string }[];
  availability: "open" | "not seen open yet" | "unknown";
}
export interface ProgressionKill { instanceMapId: number; encounterId: number; lastKillAt: string }
export interface CharacterProgress extends ProgressionInstance {
  killed: number | null; total: number; newestKillDay: string | null; state: ProgressionState;
}

// Same world-boss map ids as build-instance-data.ts. File order is map id, then encounter order;
// keep every client entry, including test maps. The addon's agreement filter is intentionally not used.
const WORLD_BOSSES = new Set([2789, 2791, 2804, 2832]);

/**
 * File presence is never a release promise. One public upload of an entrance or successful encounter
 * establishes observed availability, not three-install agreement on its name, location or bosses.
 * null facts means storage failed: absence of evidence cannot then be asserted.
 */
export function progressionCatalogue(facts: InstanceFacts | null): ProgressionInstance[] {
  const open = new Set([
    ...(facts?.entrances ?? []).map((r) => r.instanceMapId),
    ...(facts?.encounters ?? []).filter((r) => r.success).map((r) => r.instanceMapId),
  ]);
  const rows = Object.entries(encounters.instances).map(([key, bosses]): ProgressionInstance => {
    const id = Number(key);
    const place = map.entrances.find((r) => r.mapId === id) ?? names.instances.find((r) => r.id === id);
    const entrance = (agreed.entrances as { instanceMapId: number; instanceType: string }[]).find((r) => r.instanceMapId === id);
    const world = WORLD_BOSSES.has(id);
    return {
      id, name: place?.name ?? `Instance ${id}`,
      group: world ? "World bosses" : (place?.raid ?? entrance?.instanceType === "raid") ? "Raids" : "Dungeons",
      typeKnown: world || place !== undefined || entrance !== undefined,
      unconfirmed: world || (!entrance && !agreed.bosses.some((r) => r.instanceMapId === id)),
      bosses: [...new Map(bosses.map((b) => [b.id, { id: b.id, name: b.name }])).values()],
      availability: facts === null ? "unknown" : open.has(id) ? "open" : "not seen open yet",
    };
  });
  return rows.sort((a, b) => PROGRESSION_GROUPS.indexOf(a.group) - PROGRESSION_GROUPS.indexOf(b.group) || a.id - b.id);
}

/** Lifetime unique encounters, across difficulties; null is unavailable history, [] is known empty history. */
export function characterProgression(catalogue: readonly ProgressionInstance[], kills: readonly ProgressionKill[] | null): CharacterProgress[] {
  return catalogue.map((instance) => {
    const ids = new Set(instance.bosses.map((b) => b.id));
    const mine = (kills ?? []).filter((k) => k.instanceMapId === instance.id && ids.has(k.encounterId));
    const killed = kills === null ? null : new Set(mine.map((k) => k.encounterId)).size;
    const days = mine.flatMap((k) => Number.isFinite(Date.parse(k.lastKillAt)) ? [new Date(k.lastKillAt).toISOString().slice(0, 10)] : []).sort();
    return {
      ...instance, killed, total: ids.size, newestKillDay: days.at(-1) ?? null,
      state: killed === null ? "no data" : killed === 0 ? "none" : killed === ids.size ? "cleared" : "partial",
    };
  });
}

/** The caller supplies only histories it may read. Member identifiers are opaque and kept in input order. */
export function rosterProgression<Member>(catalogue: readonly ProgressionInstance[], roster: readonly { member: Member; kills: readonly ProgressionKill[] | null }[]) {
  const rows = roster.map(({ member, kills }) => ({ member, progress: characterProgression(catalogue, kills) }));
  return catalogue.map((instance, i) => {
    const members: Record<ProgressionState, Member[]> = { cleared: [], partial: [], none: [], "no data": [] };
    for (const row of rows) members[row.progress[i]!.state].push(row.member);
    return { ...instance, total: instance.bosses.length, cleared: members.cleared.length, partial: members.partial.length, members };
  });
}
