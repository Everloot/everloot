import type { ItemFacts } from "../../../kb/src/item-page";
import type { WorldFacts } from "../../../kb/src/world-pages";
import type { InstanceRow } from "./instances";
import { itemNames } from "./names";
import { computeRollups, loadItemFacts, loadWorldFacts } from "./rollup-compute";
import { publicQuests } from "./world-lists";

/** Only existing public observations, joined by agreed NPC ids and exact quest categories. */
export function dungeonRecords(row: InstanceRow, items: ItemFacts & { unreachable?: boolean }, world: WorldFacts & { unreachable?: boolean }) {
  const unavailable = items.unreachable === true || world.unreachable === true;
  const names = itemNames(items);
  const loot = unavailable ? [] : row.bosses.filter((boss) => boss.reporters >= 3).flatMap((boss) =>
    items.rates.filter((rate) => rate.public && rate.reporters >= 3 && rate.sourceNpcId !== undefined && boss.npcIds.includes(rate.sourceNpcId))
      .map((rate) => ({ ...rate, encounterId: boss.encounterId, boss: boss.name ?? `Encounter ${boss.encounterId}`, itemName: names.get(rate.itemId) ?? null })),
  );
  const quests = unavailable || !row.name ? [] : publicQuests(world).filter((quest) => quest.category === row.name && quest.tag === "dungeon");
  return { loot, quests, unavailable };
}

export type DungeonRecords = ReturnType<typeof dungeonRecords> & { dataAsOf?: string | null };

export async function loadDungeonRecords(row: InstanceRow): Promise<DungeonRecords> {
  const [items, world, rollup] = await Promise.all([loadItemFacts(), loadWorldFacts(), computeRollups()]);
  return { ...dungeonRecords(row, items, world), dataAsOf: rollup.stats.unreachable ? null : rollup.stats.dataAsOf };
}
