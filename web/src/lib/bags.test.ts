import { expect, test } from "vitest";
import type { AuctionHouse } from "@everloot/protocol";
import { CLIENT_BAGS } from "@/data/game-data/client-bags";
import { BAG_SIZES, PLAIN_BAGS, bagSlotLine, bagsParam, cheapestBySize, pricedSizes, upgrades, withBagSlots } from "./bags";
import type { MarketRow, RealmBoard } from "./auction-house";

const realm = { key: "forever", name: "Forever", slug: "forever", ruleset: "forever" };
const row = (itemId: number, min: number, house: AuctionHouse = "Horde"): MarketRow => ({
  realm, house, points: [], listings: null, updatedAt: null,
  value: { itemId, market: min + 10, min, historical: min, quantity: 3, day: "2026-11-13", ageDays: 0, reporters: 3, thin: true },
});
// Plain bags of the committed file, picked by size so the test follows the build rather than item ids.
const plain = (slots: number) => [...PLAIN_BAGS].filter(([, s]) => s === slots).map(([id]) => id);

test("the committed file holds plain bags and profession bags, every one with slots, no names", () => {
  expect(CLIENT_BAGS.schema).toBe("everloot.client-bags/1");
  expect(PLAIN_BAGS.size).toBeGreaterThan(10);
  expect(Object.values(CLIENT_BAGS.bags).some((b) => b.subclass !== 0)).toBe(true);
  expect(CLIENT_BAGS.subclasses["0"]).toBe("Bag");
  expect(JSON.stringify(CLIENT_BAGS)).not.toMatch(/"name"|bonding|requiredLevel/i);
  expect(BAG_SIZES).toEqual([...BAG_SIZES].sort((a, b) => a - b));
});

test("bagSlotLine prints the slots and the files' subclass word; any other item gets none", () => {
  const [id, bag] = Object.entries(CLIENT_BAGS.bags).find(([, b]) => b.subclass === 0)!;
  expect(bagSlotLine(Number(id))).toBe(`${bag.slots} Slot Bag`);
  const [herbId, herb] = Object.entries(CLIENT_BAGS.bags).find(([, b]) => CLIENT_BAGS.subclasses[String(b.subclass)] === "Herb Bag")!;
  expect(bagSlotLine(Number(herbId))).toBe(`${herb.slots} Slot Herb Bag`);
  expect(bagSlotLine(2589)).toBeNull();
});

test("withBagSlots puts the slot line where the bare Bag slot line was, or under binding; other items are untouched", () => {
  const [id, bag] = Object.entries(CLIENT_BAGS.bags).find(([, b]) => b.subclass === 0)!;
  expect(withBagSlots(["Binds when equipped", "Bag", "Sell Price: 1s 0c"], Number(id))).toEqual(["Binds when equipped", `${bag.slots} Slot Bag`, "Sell Price: 1s 0c"]);
  expect(withBagSlots(["Binds when equipped", "Unique", "Sell Price: 1s 0c"], Number(id))).toEqual(["Binds when equipped", "Unique", `${bag.slots} Slot Bag`, "Sell Price: 1s 0c"]);
  expect(withBagSlots(["Bag"], 2589)).toEqual(["Bag"]);
});

test("cheapestBySize keeps the lowest minimum buyout per size, the lower id on a tie, and skips other items", () => {
  const sizes = BAG_SIZES.filter((s) => plain(s).length >= 2);
  const s = sizes[0]!;
  const [a, b] = plain(s).sort((x, y) => x - y);
  const out = cheapestBySize([row(b!, 500), row(a!, 900), row(2589, 1)]);
  expect([...out.keys()]).toEqual([s]);
  expect(out.get(s)!.value.itemId).toBe(b);
  expect(cheapestBySize([row(b!, 500), row(a!, 500)]).get(s)!.value.itemId).toBe(a);
});

test("upgrades: bigger than the smallest bag, cost per added slot, best value first", () => {
  const [small, mid, big] = [BAG_SIZES[0]!, BAG_SIZES[1]!, BAG_SIZES[2]!];
  const cheapest = new Map([[small, row(plain(small)[0]!, 100)], [mid, row(plain(mid)[0]!, 2_000)], [big, row(plain(big)[0]!, 1_000)]]);
  const out = upgrades(cheapest, [small, mid, mid, mid]);
  expect(out.map((u) => u.slots)).toEqual([big, mid]);
  expect(out[0]).toMatchObject({ added: big - small, perSlot: 1_000 / (big - small) });
  // An empty slot counts as 0, so every size is an upgrade, priced over its full size.
  expect(upgrades(cheapest, [0, small, small, small]).find((u) => u.slots === small)).toMatchObject({ added: small, perSlot: 100 / small });
});

test("pricedSizes reads every house's boards for which sizes exist on the market, never their prices", () => {
  const s = BAG_SIZES[0]!;
  const board = { byItem: new Map([[plain(s)[0]!, [row(plain(s)[0]!, 1, "Alliance")]], [2589, [row(2589, 1)]]]) } as unknown as RealmBoard;
  expect([...pricedSizes([board])]).toEqual([s]);
});

test("bagsParam: four slots, a size the files list or empty", () => {
  expect(bagsParam({ b1: String(BAG_SIZES[0]), b2: "7", b3: ["abc"], b4: undefined })).toEqual([BAG_SIZES[0], 0, 0, 0]);
});
