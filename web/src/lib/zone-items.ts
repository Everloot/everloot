import { npcLootTable, objectLootRows, type LootTableRow, type LootTables } from "../../../kb/src/loot-tables";
import type { ZoneContents } from "./zones";

/** One item from one source standing in a zone: the loot-table row, with the source's name as players agree on it. */
export interface ZoneItem extends LootTableRow {
  from: { kind: "npc" | "object"; id: number; name: string | null };
}

/**
 * The items players looted from the NPCs and objects that have a confirmed pin in the zone (a treasure, or a herb or
 * ore spot 3 installs placed, passed as `gathered`), read from the same loot
 * tables as the item and NPC pages: a source shows its items once 3 installs looted it, with each number's windows
 * and installs, and a source short of that adds nothing. A zone nobody looted in is an empty list, never a zero.
 */
export function zoneItems(here: ZoneContents | undefined, tables: LootTables, gathered: readonly { id: number; name: string | null }[] = []): ZoneItem[] {
  if (!here) return [];
  const out: ZoneItem[] = [];
  const npcs = new Map(here.npcs.map((n) => [n.npcId, n.name]));
  for (const [id, name] of npcs) out.push(...npcLootTable(tables, id).rows.map((row) => ({ ...row, from: { kind: "npc" as const, id, name } })));
  const objects = new Map<number, string | null>();
  for (const [id, name] of [...here.treasures.map((t): [number, string | null] => [t.objectId, t.name]), ...gathered.map((g): [number, string | null] => [g.id, g.name])]) objects.set(id, objects.get(id) ?? name);
  for (const [id, name] of objects) out.push(...objectLootRows(tables, id).map((row) => ({ ...row, from: { kind: "object" as const, id, name } })));
  return out.sort((a, b) => b.withItem - a.withItem || b.rate - a.rate || a.itemId - b.itemId || a.from.id - b.from.id);
}
