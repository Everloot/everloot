/**
 * Game objects (chests, herbs, ore veins, fishing pools) from loot windows players opened on them. The
 * addon records the object's entry id from its GUID (`sourceObjectId`). A frequency is public after 3
 * install reports, as for NPCs. A name is public when 3 installs agree on it; the client's GameObjects table
 * holds no lootable objects, so an object without an agreed name is known by its id. Where players saw the object
 * on the minimap is a pin at 3 installs (object-spawns.ts), and loot windows the rates leave out are only counted
 * (pending-loot.ts).
 */
import { itemFactsFromRecords, lootWindowsFromRecords, recheckLootRecords, rollupDrops, type PublicDropRate, type ItemNameRow, type MeasuredZero } from "./drop-rollup.js";
import type { RecheckScope } from "./coverage.js";
import { formatMeasuredZero, itemPage } from "./item-page.js";
import { agreedObjectNames, objectSightingRowsFromRecords, objectSpawns, type ObjectSpawnRow } from "./object-spawns.js";
import { pendingForObject, pendingLine, pendingLootFromRecords, type PendingCount, type PendingLoot } from "./pending-loot.js";

/** `sightings`: where players saw objects on the minimap; `pending`: loot windows not yet in the rates. */
export interface ObjectFacts { rates: PublicDropRate[]; measuredZeros: MeasuredZero[]; names: ItemNameRow[]; objects?: ObjectSpawnRow[]; sightings?: ObjectSpawnRow[]; pending?: PendingLoot; recheck?: readonly RecheckScope[] }

export interface ObjectDrop { itemId: number; itemName: string | null; kills: number; drops: number; rate: number; reporters: number }
export interface ObjectPage {
  objectId: number;
  /** The name 3 installs agree on; null until then. */
  name: string | null;
  drops: ObjectDrop[];
  /** Public windows with no item at all. */
  zero: { kills: number; reporters: number } | null;
  /** Observations exist but fewer than 3 installs reported them. */
  queued: boolean;
  /** Loot windows reported but not yet in the rates; absent when there are none. */
  pendingLoot?: PendingCount;
  /** Where 3 installs saw it on the minimap, at its own position; absent when nowhere. */
  pins?: { mapId: number; x: number; y: number; reporters: number }[];
}

const NO_SCOPES: readonly RecheckScope[] = [];

export function objectFactsFromRecords(records: unknown[], recheck: readonly RecheckScope[] = NO_SCOPES): ObjectFacts {
  const { rates, measuredZeros } = rollupDrops(lootWindowsFromRecords(recheckLootRecords(records, recheck)));
  const items = itemFactsFromRecords(records, recheck);
  return { rates, measuredZeros, names: items.names, objects: items.objects, sightings: objectSightingRowsFromRecords(records), pending: pendingLootFromRecords(records),
    ...(recheck.length ? { recheck } : {}) };
}

export function objectPage(objectId: number, facts: ObjectFacts): ObjectPage {
  const mine = facts.rates.filter((r) => r.sourceObjectId === objectId);
  const zeros = facts.measuredZeros.filter((z) => z.sourceObjectId === objectId);
  const nameOf = (itemId: number) => itemPage(itemId, { rates: [], names: facts.names, npcs: [] }).name;
  const drops = mine.filter((r) => r.public)
    .map((r) => ({ itemId: r.itemId, itemName: nameOf(r.itemId), kills: r.kills, drops: r.drops, rate: r.rate, reporters: r.reporters }))
    .sort((a, b) => b.rate - a.rate || a.itemId - b.itemId);
  const zero = zeros.find((z) => z.public);
  const pendingLoot = pendingForObject(facts.pending, objectId);
  const pins = objectSpawns((facts.sightings ?? []).filter((r) => r.objectId === objectId), [], undefined, facts.recheck ?? []).pins.map(({ mapId, x, y, reporters }) => ({ mapId, x, y, reporters }));
  return {
    objectId, name: agreedObjectNames(facts.objects ?? [], facts.recheck ?? []).get(objectId) ?? null, drops,
    zero: zero ? { kills: zero.kills, reporters: zero.reporters } : null,
    queued: !drops.length && !zero && (mine.length > 0 || zeros.length > 0),
    ...(pendingLoot ? { pendingLoot } : {}),
    ...(pins.length ? { pins } : {}),
  };
}

/** Objects with public observations, most-looted first. */
export function objectList(facts: ObjectFacts): { objectId: number; windows: number; items: number; reporters: number }[] {
  const byId = new Map<number, { objectId: number; windows: number; items: number; reporters: number }>();
  for (const r of facts.rates) {
    if (!r.public || r.sourceObjectId === undefined) continue;
    const o = byId.get(r.sourceObjectId) ?? { objectId: r.sourceObjectId, windows: r.kills, items: 0, reporters: r.reporters };
    o.items += 1;
    byId.set(r.sourceObjectId, o);
  }
  for (const z of facts.measuredZeros) {
    if (z.public && z.sourceObjectId !== undefined && !byId.has(z.sourceObjectId)) byId.set(z.sourceObjectId, { objectId: z.sourceObjectId, windows: z.kills, items: 0, reporters: z.reporters });
  }
  return [...byId.values()].sort((a, b) => b.windows - a.windows || a.objectId - b.objectId);
}

export function formatObjectPage(page: ObjectPage): string {
  const lines = [page.name ? `Object ${page.objectId} — ${page.name}` : `Object ${page.objectId}`];
  if (!page.name) lines.push("No agreed name yet. A name needs 3 installs reporting the same one.");
  if (page.zero) {
    lines.push(`${formatMeasuredZero(page.zero.kills)}  ${page.zero.reporters} reporters`);
  } else if (!page.drops.length) {
    lines.push("Loot observations unrecorded. Public frequencies need source observations from 3 install IDs.");
  } else {
    lines.push("Drops");
    for (const d of page.drops) {
      lines.push(`Item ${d.itemId}${d.itemName ? ` ${d.itemName}` : ""}  ${d.kills} observed loot windows  ${d.drops} windows with this item  ${(d.rate * 100).toFixed(1)}%  ${d.reporters} distinct install reports`);
    }
  }
  if (page.pendingLoot) lines.push(pendingLine(page.pendingLoot));
  for (const pin of page.pins ?? []) lines.push(`Seen on the minimap: map ${pin.mapId} at ${pin.x}, ${pin.y}  ${pin.reporters} reporters`);
  return lines.join("\n");
}

export function handleObjectPage(args: { objectId: number }, facts: ObjectFacts = { rates: [], measuredZeros: [], names: [] }): string {
  if (!Number.isInteger(args.objectId) || args.objectId < 1) return "Name an object id.";
  return formatObjectPage(objectPage(args.objectId, facts));
}
