import { expect, test } from "vitest";
import { emptyMarket, foldMarket } from "../../../../../kb/src/market";
import { realmBoards } from "@/lib/auction-house";
import { ahHref, ahQuery, browseRows, categoryRow, categoryTree, inCategory, type AhQuery, type BrowseContext } from "./browse";

const now = new Date("2026-10-20T12:00:00.000Z");
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
/** Three installs scan the items; `items` are [itemId, unit price, units]. */
const scans = (daysAgo: number, items: [number, number, number][]) =>
  ["install-a", "install-b", "install-c"].map((installId) => ({
    kind: "auction_snapshot", faction: "Horde", installId, capturedAt: at(daysAgo), realm: "Forever",
    items: items.map(([id, value, units]) => [id, 3, units, value, value]),
  }));

// 2589 Linen Cloth and 765 Silverleaf are trade goods; 1366 and 1364 are leather legs and chest; 25 is a sword.
const state = foldMarket(emptyMarket(), [
  ...scans(0, [[2589, 120, 400], [765, 30, 900], [1366, 500, 10], [1364, 900, 12], [25, 2000, 6]]),
  ...scans(7, [[2589, 100, 300]]),
], now);
const rows = realmBoards(state, now)[0]!.rows;
const NAMES = new Map([[2589, "Linen Cloth"], [765, "Silverleaf"], [25, "Worn Shortsword"]]);
const LEVELS = new Map([[1366, { level: 5, required: 1 }], [1364, { level: 12, required: 7 }], [25, { level: 2, required: 1 }]]);
const ctx: BrowseContext = { now, name: (id) => NAMES.get(id), levels: (id) => LEVELS.get(id) };
const query = (search: Record<string, string>) => ahQuery(search)!;
const ids = (q: AhQuery) => browseRows(rows, q, ctx).map((b) => b.row.value.itemId);

test("region selection round-trips through URLs and rejects unsupported regions", () => {
  for (const region of ["us", "eu", "kr", "tw", "unknown"]) {
    const q = query({ region, house: "horde", sort: "-market", page: "2" });
    expect(q).toMatchObject({ region, house: "Horde", page: 2 });
    expect(ahHref("/tools/auctions", q)).toBe(`/tools/auctions?house=horde&region=${region}&sort=-market&page=2`);
    expect(categoryTree(rows, q, "/tools/auctions")[0].href).toContain(`region=${region}`);
  }
  expect(query({}).region).toBeUndefined();
  for (const region of ["US", "mars", "us,eu"]) expect(ahQuery({ region })).toBeNull();
});

test("the query string reads the house, the category path, the filters and the sort, and refuses what is not one", () => {
  const q = query({ house: "horde", class: "armor", sub: "leather", slot: "legs", quality: "poor", lvl: "1-10", moved: "1", sort: "-market", page: "2" });
  expect(q).toMatchObject({ house: "Horde", slot: "legs", quality: "poor", lvl: { min: 1, max: 10 }, moved: true, sort: { key: "market", desc: true }, page: 2 });
  expect([q.cls?.slug, q.sub?.slug]).toEqual(["armor", "leather"]);
  // One URL per view, in a fixed order.
  expect(ahHref("/tools/auctions/forever", q)).toBe("/tools/auctions/forever?house=horde&class=armor&sub=leather&slot=legs&quality=poor&lvl=1-10&moved=1&sort=-market&page=2");
  expect(ahHref("/tools/auctions", query({}))).toBe("/tools/auctions");
  for (const bad of [{ house: "goblin" }, { class: "weapon" }, { sub: "leather" }, { class: "weapons", sub: "leather" }, { class: "trade-goods", sub: "cloth", slot: "legs" },
    { quality: "shiny" }, { lvl: "0" }, { moved: "yes" }, { sort: "price" }, { page: "0" }]) {
    expect(ahQuery(bad), JSON.stringify(bad)).toBeNull();
  }
});

test("the category join reads class, subclass and slot from the game files", () => {
  expect(categoryRow(1366)).toEqual([1366, 4, 2, 7, 0]);
  expect(categoryRow(999_999_999)).toBeUndefined();
  const armor = query({ class: "armor" });
  expect(inCategory(1366, armor)).toBe(true);
  expect(inCategory(2589, armor)).toBe(false);
  expect(inCategory(1364, query({ class: "armor", sub: "leather", slot: "legs" }))).toBe(false);
  expect(ids(query({ class: "trade-goods", sub: "cloth" }))).toEqual([2589]);
  expect(ids(query({ class: "armor", sub: "leather", slot: "chest" }))).toEqual([1364]);
});

test("the tree lists the game's classes in its order with counts, opens the chosen class, and armour by slot", () => {
  const top = categoryTree(rows, query({}), "/tools/auctions/forever");
  expect(top.slice(0, 5).map((n) => [n.label, n.count])).toEqual([["Weapons", 1], ["Armor", 2], ["Containers", 0], ["Consumables", 0], ["Trade Goods", 2]]);
  expect(top.every((n) => !n.children)).toBe(true);
  const open = categoryTree(rows, query({ class: "armor", sub: "leather", sort: "market" }), "/tools/auctions/forever");
  const armor = open.find((n) => n.label === "Armor")!;
  // Only subclasses with prices, and the links keep the other filters but go back to page 1.
  expect(armor.children!.map((n) => [n.label, n.count, n.on])).toEqual([["Leather", 2, true]]);
  expect(armor.children![0]!.children!.map((n) => [n.label, n.href])).toEqual([
    ["Chest", "/tools/auctions/forever?class=armor&sub=leather&slot=chest&sort=market"],
    ["Legs", "/tools/auctions/forever?class=armor&sub=leather&slot=legs&sort=market"],
  ]);
});

test("filters: name or id, quality, required level and the week's movers", () => {
  expect(ids(query({ q: "cloth" }))).toEqual([2589]);
  expect(ids(query({ q: "#765" }))).toEqual([765]);
  expect(ids(query({ quality: "poor" })).sort()).toEqual([1364, 1366]);
  // Required level from the tooltip facts: an item that shows none never matches a level range.
  expect(ids(query({ lvl: "5-10" }))).toEqual([1364]);
  expect(ids(query({ lvl: "1" }))).toEqual([1366, 25]);
  const moved = browseRows(rows, query({ moved: "1" }), ctx);
  expect(moved.map((b) => [b.row.value.itemId, Math.round(b.move!.change * 100)])).toEqual([[2589, 20]]);
});

test("sorting: most units by default, any column either way, and rows without a value last", () => {
  expect(ids(query({}))).toEqual([765, 2589, 1364, 1366, 25]);
  expect(ids(query({ sort: "market" }))).toEqual([765, 2589, 1366, 1364, 25]);
  expect(ids(query({ sort: "-min" }))).toEqual([25, 1364, 1366, 2589, 765]);
  expect(ids(query({ sort: "name" }))).toEqual([2589, 765, 25, 1364, 1366]);
  expect(ids(query({ sort: "-name" }))).toEqual([25, 765, 2589, 1364, 1366]);
  expect(ids(query({ sort: "-ilvl" }))).toEqual([1364, 1366, 25, 765, 2589]);
  expect(ids(query({ sort: "-change" }))).toEqual([2589, 25, 765, 1364, 1366]);
});
