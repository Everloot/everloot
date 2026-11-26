import type { ObjectFacts } from "@kb/object-page";
import { agreedGatherKinds, gatherSkillRanges, objectSpawns, type GatherKind, type SkillRange } from "@kb/object-spawns";
import { zoneByMapId, type ZoneSummary } from "./zones";
import { computeRollups, loadInstanceFacts, loadItemFacts } from "./rollup-compute";

/** Object facts from the shared aggregates: the drop rollup, the agreed names, minimap sightings and pending windows, no second scan. */
export async function loadObjectFacts(): Promise<ObjectFacts & { unreachable: boolean; dataAsOf: string | null }> {
  const [rollup, items, seen] = await Promise.all([computeRollups(), loadItemFacts(), loadInstanceFacts()]);
  const unreachable = rollup.stats.unreachable || items.unreachable;
  return {
    rates: unreachable ? [] : rollup.rates,
    measuredZeros: unreachable ? [] : rollup.measuredZeros,
    names: unreachable ? [] : items.names,
    objects: unreachable ? [] : items.objects,
    sightings: unreachable ? [] : seen.sightings,
    pending: unreachable ? undefined : items.pending,
    unreachable,
    dataAsOf: rollup.stats.dataAsOf,
  };
}

/** What the object is, in words: how 3 installs agree it is opened. */
export const OBJECT_KIND_LABELS: Record<GatherKind, string> = { herb: "Herb", ore: "Ore vein", chest: "Chest", fishing: "Fishing pool", other: "Other" };

/**
 * What players agree on about one object: its kind (`agreedGatherKinds`), the skill players had when they gathered
 * it, for a herb or ore only (`gatherSkillRanges`: what they had, never what the game requires), and the released
 * zones of its spots. A zone counts once 3 installs placed a spot there, from loot windows (where the player stood)
 * or minimap sightings, each source clustered on its own; fishing is never a spot. Each is null or empty until agreed.
 */
export interface ObjectTraits { kind: GatherKind | null; skill: SkillRange | null; zones: ZoneSummary[] }

export function objectTraits(facts: Pick<ObjectFacts, "objects" | "sightings" | "recheck">, only?: number): Map<number, ObjectTraits> {
  const mine = <T extends { objectId: number }>(rows: readonly T[] | undefined) => (rows ?? []).filter((r) => only === undefined || r.objectId === only);
  // Loot rows carry no capture time; minimap sightings do (object-spawns.ts), so the two are kept apart here.
  const looted = mine(facts.objects).filter((r) => r.capturedAt === undefined);
  const kinds = agreedGatherKinds(looted);
  const skills = new Map([...gatherSkillRanges(looted, "herb"), ...gatherSkillRanges(looted, "ore")]);
  const recheck = facts.recheck ?? [];
  const pins = [...objectSpawns(looted, [], undefined, recheck).pins, ...objectSpawns(mine(facts.sightings), [], undefined, recheck).pins];
  const zones = new Map<number, Map<number, ZoneSummary>>();
  for (const pin of pins) {
    const zone = zoneByMapId(pin.mapId);
    if (zone) zones.set(pin.objectId, (zones.get(pin.objectId) ?? new Map()).set(zone.mapId, zone));
  }
  const out = new Map<number, ObjectTraits>();
  for (const id of new Set([...kinds.keys(), ...zones.keys()])) {
    out.set(id, { kind: kinds.get(id) ?? null, skill: skills.get(id) ?? null, zones: [...(zones.get(id)?.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name)) });
  }
  return out;
}

/** "1 lowest · 15 middle · 3 installs": the skill range as the facts box reads it. */
export function skillRangeText(skill: SkillRange): string {
  return `${skill.min} lowest · ${skill.median} middle · ${skill.installs} installs`;
}
