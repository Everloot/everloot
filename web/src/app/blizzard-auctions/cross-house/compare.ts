import type { BlizzardHouseItem } from "@/lib/blizzard-auctions";
import { BLIZZARD_HOUSES } from "@/lib/blizzard-houses";
import { auctionCut } from "@kb/disenchant";

const HOUR = 3_600_000;

export function blackwaterHouse(factionHouse: number): number | null {
  const faction = BLIZZARD_HOUSES.get(factionHouse);
  if (!faction || faction.faction === "blackwater") return null;
  return [...BLIZZARD_HOUSES].find(([, house]) => house.ruleset === faction.ruleset && house.faction === "blackwater")?.[0] ?? null;
}

export function factionHouseForComparison(houseId: number): number {
  const house = BLIZZARD_HOUSES.get(houseId);
  if (house && house.faction !== "blackwater") return houseId;
  return [...BLIZZARD_HOUSES].find(([, target]) => target.ruleset === house?.ruleset && target.faction === "alliance")?.[0] ?? 110;
}

function recent(row: BlizzardHouseItem, now: number): boolean {
  const age = now - Date.parse(row.snapshotAt);
  return age >= 0 && age <= 3 * HOUR && row.quantity > 0 && row.auctions > 0 &&
    Number.isSafeInteger(row.minUnit) && row.minUnit > 0 &&
    Number.isSafeInteger(row.typicalUnit) && row.typicalUnit >= row.minUnit;
}

export function crossHousePrices(
  factionRows: readonly BlizzardHouseItem[],
  blackwaterRows: readonly BlizzardHouseItem[],
  now: number,
  deposit: number | null,
) {
  const key = (row: BlizzardHouseItem) => `${row.itemId}:${row.kind}`;
  const blackwater = new Map(blackwaterRows.filter((row) => recent(row, now)).map((row) => [key(row), row]));
  const opportunities = factionRows.flatMap((faction) => {
    const neutral = blackwater.get(key(faction));
    if (!neutral || !recent(faction, now) || Math.abs(Date.parse(faction.snapshotAt) - Date.parse(neutral.snapshotAt)) > 1.5 * HOUR) return [];
    return ([
      [faction, neutral, "blackwater"],
      [neutral, faction, "faction"],
    ] as const).flatMap(([buy, sell, to]) => {
      const cut = auctionCut(to === "blackwater" ? "Neutral" : "Alliance");
      const paid = buy.minUnit + (deposit ?? 0);
      const keptPercent = Math.round((1 - cut) * 100);
      if (paid > Number.MAX_SAFE_INTEGER / 100 || sell.typicalUnit > Number.MAX_SAFE_INTEGER / 100) return [];
      const net = Math.floor(sell.typicalUnit * keptPercent / 100) - paid;
      if (net <= 0) return [];
      return [{
        itemId: buy.itemId, kind: buy.kind, to, buy: buy.minUnit, resale: sell.typicalUnit, cut,
        net, breakEven: Math.ceil(paid * 100 / keptPercent),
        buyAt: buy.snapshotAt, sellAt: sell.snapshotAt, buyQuantity: buy.quantity, sellQuantity: sell.quantity,
      }];
    });
  });
  return opportunities.sort((a, b) => b.net - a.net || a.itemId - b.itemId || a.kind.localeCompare(b.kind));
}
