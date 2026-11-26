import { npcPage, questPage, type WorldFacts } from "@kb/world-pages";
import { zoneByMapId } from "./zones";

/**
 * What the world rollup says of a quest chain, each part only from what three installs agree on: the lowest and highest
 * agreed quest level, the agreed giver of the first quest, and the zone where three installs placed that giver.
 * Nothing is read from a quest's title or guessed from a neighbour.
 */
export interface ChainFacts {
  levels: { min: number; max: number } | null;
  startNpcId: number | null;
  zone: { mapId: number; name: string } | null;
}

export const NO_CHAIN_FACTS: ChainFacts = { levels: null, startNpcId: null, zone: null };

export function chainFacts(questIds: readonly number[], facts: (WorldFacts & { unreachable?: boolean }) | null): ChainFacts {
  if (!facts || facts.unreachable || questIds.length === 0) return NO_CHAIN_FACTS;
  const levels = questIds.flatMap((id) => {
    const level = questPage(id, facts).level;
    return level === null ? [] : [level];
  });
  const startNpcId = questPage(questIds[0]!, facts).giverNpcId;
  const pin = startNpcId === null ? undefined : npcPage(startNpcId, facts).pins.find((p) => zoneByMapId(p.mapId));
  const zone = pin ? zoneByMapId(pin.mapId)! : undefined;
  return {
    levels: levels.length ? { min: Math.min(...levels), max: Math.max(...levels) } : null,
    startNpcId,
    zone: zone ? { mapId: zone.mapId, name: zone.name } : null,
  };
}

/** "10–14", or "12" when the chain's agreed quests share one level. */
export const levelRange = (levels: { min: number; max: number }) => (levels.min === levels.max ? String(levels.min) : `${levels.min}–${levels.max}`);
