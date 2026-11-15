import type { RulesetSlug } from "@/lib/realms";

/**
 * Which ruleset and faction each Blizzard Forever auction house serves. The API cannot say: every ruleset in the
 * dynamic-forever index lists the same 15 houses, each named only "Alliance/Horde/Blackwater Auction House", and a
 * house answers the same whichever ruleset the path names (the kb refresh job reads each house once).
 *
 * Worked out 2026-11-15 by price, in both regions: each house's commodity medians were compared with the public
 * per-market price tables of AHledger (ahledger.com/developers), which name the ruleset and faction. Score: the median
 * absolute log ratio over 600 to 1,250 shared items. In the EU all eight Alliance and Horde houses scored 0.000 on one
 * market; in the US six did (124: 0.010), and the Roleplay houses 119 and 120 scored 0.12 and 0.21 on Roleplay against
 * 0.38 or more anywhere else. Every other market scored 0.25 or more. Blackwater houses have no market to match and
 * follow the same id order (116 = 110 + 6). Houses 112, 115 and 118 list nothing in either region. Only this mapping
 * is kept, none of AHledger's prices.
 */
export type BlizzardFaction = "alliance" | "horde" | "blackwater";
export interface BlizzardHouse {
  ruleset: Exclude<RulesetSlug, "hardcore" | "forever">;
  faction: BlizzardFaction;
}

const RULESET_LABEL: Record<BlizzardHouse["ruleset"], string> = { pvp: "PvP", normal: "Normal", rp: "Roleplay", "rp-pvp": "Roleplay PvP" };
const FACTION_LABEL: Record<BlizzardFaction, string> = { alliance: "Alliance", horde: "Horde", blackwater: "Blackwater" };

// [ruleset, alliance house, horde house, blackwater house]
const GROUPS: readonly [BlizzardHouse["ruleset"], number, number, number][] = [
  ["pvp", 110, 113, 116],
  ["normal", 111, 114, 117],
  ["rp", 119, 120, 121],
  ["rp-pvp", 123, 124, 125],
];

const FACTIONS: readonly BlizzardFaction[] = ["alliance", "horde", "blackwater"];

export const BLIZZARD_HOUSES: ReadonlyMap<number, BlizzardHouse> = new Map(
  GROUPS.flatMap(([ruleset, ...ids]) => ids.map((id, i): [number, BlizzardHouse] => [id, { ruleset, faction: FACTIONS[i] }])),
);

/** "PvP, Alliance" for a known house, else Blizzard's own name ("Alliance, house 112"). */
export function houseLabel(houseId: number, houseName: string): string {
  const house = BLIZZARD_HOUSES.get(houseId);
  if (house) return `${RULESET_LABEL[house.ruleset]}, ${FACTION_LABEL[house.faction]}`;
  return `${houseName.replace(/ Auction House$/, "")}, house ${houseId}`;
}

/** Sort order for a house: ruleset in GROUPS order, then Alliance, Horde, Blackwater; unknown houses last by id. */
export function houseOrder(houseId: number): number {
  const i = GROUPS.findIndex((g) => g.slice(1).includes(houseId));
  return i < 0 ? 1_000 + houseId : i * 3 + GROUPS[i].indexOf(houseId);
}
