import { expect, test } from "vitest";
import type { RecheckScope } from "@kb/coverage";
import { worldFactsFromRecords } from "@kb/world-pages";
import { npcRows, publicQuests, publicVendors } from "./world-lists";

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
const rows = (n: number, from: number, at: number, make: () => Record<string, unknown>) =>
  Array.from({ length: n }, (_, i) => ({ installId: `install-${from + i}`, capturedAt: day(at), ...make() }));
const npc = (name: string) => () => ({ kind: "npc_sighting", npcId: 10, name, mapId: 1429, x: 40, y: 60, positionKind: "npc", level: 5 });
const quest = (title: string) => () => ({ kind: "quest", questId: 20, title, level: 5, giverNpcId: 10, rewardItemIds: [] });
const vendor = (priceCopper: number) => () => ({ kind: "vendor", vendorNpcId: 10, items: [{ itemId: 30, priceCopper }] });

// Five installs before a patch, three after it with the changed value.
const records = [
  ...rows(5, 0, 0, npc("Marshal Dughan")), ...rows(3, 10, 25, npc("Marshal Dughan the Elder")),
  ...rows(5, 0, 0, quest("A Threat Within")), ...rows(3, 10, 25, quest("A Threat Without")),
  ...rows(5, 0, 0, vendor(100)), ...rows(3, 10, 25, vendor(150)),
];
const scopes: RecheckScope[] = [{ since: day(20), source: "https://example.test/patch-notes", zones: [1429] }];

test("the list pages apply the recheck scopes the world facts carry", () => {
  const plain = worldFactsFromRecords(records);
  const scoped = { ...plain, recheck: scopes };
  expect(publicQuests(plain).map((q) => q.title)).toEqual([null]);
  expect(publicQuests(scoped).map((q) => q.title)).toEqual(["A Threat Without"]);
  expect(npcRows(plain, []).map((r) => r.name)).toEqual([null]);
  expect(npcRows(scoped, []).map((r) => r.name)).toEqual(["Marshal Dughan the Elder"]);
  expect(publicVendors(plain)[0]!.offers.map((o) => o.priceCopper)).toEqual([100, 150]);
  expect(publicVendors(scoped)[0]!.offers.map((o) => o.priceCopper)).toEqual([150]);
});
