import { expect, test } from "vitest";
import { emptyMarket, foldMarket } from "../../../kb/src/market";
import {
  SPARK_BOX, agreementSoFar, houseCounts, pendingRealms, houseParam, itemAcrossRealms, itemByHouse, itemIdParam, itemLabel, percent, priceMove, realmBoards,
  realmSlug, sitemapPaths, slugParam, sparkline, timeAgo,
} from "./auction-house";

const now = new Date("2026-10-20T12:00:00.000Z");
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
/** One full scan per install, by a Horde character; `items` are [itemId, unit market value] with 40 units each. */
const scans = (realm: string, daysAgo: number, items: [number, number][], installs = ["install-a", "install-b", "install-c"]) =>
  installs.map((installId) => ({
    kind: "auction_snapshot", installId, capturedAt: at(daysAgo), realm, faction: "Horde",
    items: items.map(([id, value]) => [id, 2, 40, value, value]),
  }));

const state = foldMarket(emptyMarket(), [
  ...scans("Forever", 0, [[2589, 205], [765, 33], [2592, 100]]),
  ...scans("Forever", 1, [[765, 30]]),
  ...scans("Forever", 7, [[2592, 80]]),
  ...scans("Forever", 30, [[4306, 950]]),
  ...scans("Mal'Ganis", 0, [[2589, 300]]),
  // Two reporters only: nothing public on Nightfall.
  ...scans("Nightfall", 0, [[2589, 999]], ["install-x", "install-y"]),
], now);

test("a realm's slug is lower case with apostrophes dropped, and only a slug-shaped segment is read", () => {
  expect(realmSlug("Mal'Ganis")).toBe("malganis");
  expect(realmSlug(" Argent  Dawn ")).toBe("argent-dawn");
  expect(realmSlug("Item")).toBe("item-realm");
  expect(slugParam("Argent-Dawn")).toBe("argent-dawn");
  expect(slugParam("a/b")).toBeNull();
  expect(slugParam("%E0%A4%A")).toBeNull();
  expect(itemIdParam("2589")).toBe(2589);
  expect(itemIdParam("0")).toBeNull();
  expect(itemIdParam("25x")).toBeNull();
});

test("only realms with a public value get a board; Nightfall's two reporters show on the meter, not as a realm", () => {
  const boards = realmBoards(state, now);
  expect(boards.map((b) => b.realm.slug)).toEqual(["forever", "malganis"]);
  const forever = boards[0]!;
  expect(forever.rows.map((r) => r.value.itemId).sort((a, b) => a - b)).toEqual([765, 2589, 2592, 4306]);
  expect(forever.reporters).toBe(3);
  expect(forever.updatedAt).toBe(Date.parse(at(0)));
  expect(agreementSoFar(state, "nightfall")).toBe(2);
  expect(agreementSoFar(state, "nightfall", 765)).toBe(0);
  // A public realm still reads at most 2: the meter is for what is below the gate.
  expect(agreementSoFar(state, "forever")).toBe(2);
});

test("moves compare the newest solid day with the day before, or a week before", () => {
  const rows = realmBoards(state, now)[0]!.rows;
  const moves = (span: 1 | 7) => rows.flatMap((r) => { const m = priceMove(r, span, now); return m ? [[r.value.itemId, percent(m.change)]] : []; });
  expect(moves(1)).toEqual([[765, "+10%"]]);
  expect(moves(7)).toEqual([[2592, "+25%"]]);
  // An item last scanned 30 days ago has no recent scan time.
  expect(rows.find((r) => r.value.itemId === 4306)!.updatedAt).toBeNull();
});

test("each house is its own board; All lists every house's rows apart, and the switch counts items per house", () => {
  const houses = foldMarket(emptyMarket(), [
    ...scans("Forever", 0, [[2589, 100]]).map((r) => ({ ...r, house: "Horde" })),
    ...scans("Forever", 0, [[2589, 300], [765, 30]]).map((r, i) => ({ ...r, installId: `alliance-${i}-x`, house: "Alliance" })),
  ], now);
  expect(realmBoards(houses, now).map((b) => [b.realm.slug, b.house, b.items, b.rows.length])).toEqual([["forever", null, 2, 3]]);
  // Never a blend: each house keeps its own price, named.
  expect(realmBoards(houses, now)[0]!.byItem.get(2589)!.map((r) => [r.house, r.value.market])).toEqual([["Alliance", 300], ["Horde", 100]]);
  const horde = realmBoards(houses, now, "Horde");
  expect(horde.map((b) => [b.realm.name, b.house])).toEqual([["Forever", "Horde"]]);
  expect(horde[0]!.byItem.get(2589)!.map((r) => r.value.market)).toEqual([100]);
  expect(realmBoards(houses, now, "Neutral")).toEqual([]);
  expect(itemByHouse(houses, now, "forever", 2589).map((r) => [r.house, r.value.market])).toEqual([["Alliance", 300], ["Horde", 100]]);
  expect([...houseCounts(houses, now, "forever")]).toEqual([[null, 2], ["Alliance", 2], ["Horde", 1], ["Neutral", 0]]);
  expect(houseParam(undefined)).toBeNull();
  expect(houseParam("all")).toBeNull();
  expect(houseParam("horde")).toBe("Horde");
  expect(houseParam("Horde")).toBeUndefined();
  expect(houseParam("goblin")).toBeUndefined();
});

test("scans whose house is unknown never reach a page: their values may mix houses", () => {
  const unknown = foldMarket(emptyMarket(), scans("Forever", 0, [[2589, 100]]).map(({ faction: _, ...r }) => r), now);
  expect(Object.keys(unknown.realms)).toEqual(["forever"]);
  expect(realmBoards(unknown, now)).toEqual([]);
  expect(itemByHouse(unknown, now, "forever", 2589)).toEqual([]);
  expect(agreementSoFar(unknown, "forever")).toBe(0);
  expect(pendingRealms(unknown, now)).toEqual([]);
});

test("a row carries its listings while its newest day is open", () => {
  const rows = realmBoards(state, now)[0]!.byItem;
  expect(rows.get(2589)![0]!.listings).toBe(2);
  // Its only day is 30 days old: closed, so no count is kept.
  expect(rows.get(4306)![0]!.listings).toBeNull();
});

test("the sparkline places the solid days of the last two weeks by day, and needs two of them", () => {
  const rows = realmBoards(state, now)[0]!.byItem;
  // 765: yesterday at 30, today at 33. Today is at the right edge, the higher value at the top.
  expect(sparkline(rows.get(765)![0]!.points, now)).toBe("58.2,15.0 63.0,1.0");
  expect(sparkline(rows.get(2589)![0]!.points, now)).toBeNull();
  // 2592 a week ago and today; 4306 only 30 days ago.
  expect(sparkline(rows.get(2592)![0]!.points, now)?.split(" ")).toHaveLength(2);
  expect(sparkline(rows.get(4306)![0]!.points, now)).toBeNull();
  expect(SPARK_BOX).toEqual({ width: 64, height: 16 });
});

test("the sitemap lists realms, items on a realm and items across realms, only with a market value", () => {
  const paths = sitemapPaths(realmBoards(state, now));
  expect(paths).toContain("/tools/auctions/forever");
  expect(paths).toContain("/tools/auctions/forever/2589");
  expect(paths).toContain("/tools/auctions/malganis/2589");
  expect(paths).toContain("/tools/auctions/item/2589");
  // Only a day 30 days back: no market value, so not indexed.
  expect(paths.filter((p) => p.endsWith("/4306"))).toEqual([]);
  expect(paths.some((p) => p.includes("nightfall"))).toBe(false);
  expect(new Set(paths).size).toBe(paths.length);
});

test("an item across realms, and its label until names are shown", () => {
  expect(itemAcrossRealms(realmBoards(state, now), 2589).map((r) => r.realm.name)).toEqual(["Forever", "Mal'Ganis"]);
  expect(itemLabel(2589)).toBe("Item 2589");
  expect(itemLabel(2589, new Map([[2589, "Linen Cloth"]]))).toBe("Linen Cloth");
});

test("ages read in minutes, hours and days", () => {
  const t = now.getTime();
  expect(timeAgo(t - 20_000, t)).toBe("just now");
  expect(timeAgo(t - 12 * 60_000, t)).toBe("12 min ago");
  expect(timeAgo(t - 3 * 3_600_000, t)).toBe("3 h ago");
  expect(timeAgo(t - 3 * 86_400_000, t)).toBe("3 days ago");
  expect(percent(-0.08)).toBe("−8%");
});

test("a realm with scans but no public price is pending, counted by upload address on its busiest item day", () => {
  const realm4 = "CAMWOW US1 Realm 4 PvP";
  const pending = foldMarket(emptyMarket(), [
    // Three installs behind one upload address count once; a second address makes two.
    ...scans(realm4, 0, [[2589, 100]], ["install-a1", "install-a2", "install-a3"]).map((r) => ({ ...r, reporter: "aaaaaaaaaaaaaaaa" })),
    ...scans(realm4, 0, [[2589, 120]], ["install-b1"]).map((r) => ({ ...r, reporter: "bbbbbbbbbbbbbbbb" })),
    // A third address on another item does not make 3 on one item day.
    ...scans(realm4, 0, [[765, 30]], ["install-c1"]).map((r) => ({ ...r, reporter: "cccccccccccccccc" })),
    ...scans("CAMWOW US1 Realm 9 RP", 1, [[2589, 100]], ["install-d1"]),
    // A realm with public prices is not pending, nor is a name that is not a realm off the realm list.
    ...scans("CAMWOW US1 Realm 2 PvE", 0, [[2589, 100]]),
    ...scans("Buy gold cheap", 0, [[2589, 100]], ["install-e1"]),
  ], now);
  expect(pendingRealms(pending, now)).toEqual([
    { realm: realm4, slug: "camwow-us1-realm-4-pvp", reporters: 2 },
    { realm: "CAMWOW US1 Realm 9 RP", slug: "camwow-us1-realm-9-rp", reporters: 1 },
  ]);
  // Never more than the limit, the closest first.
  expect(pendingRealms(pending, now, 1).map((p) => p.realm)).toEqual([realm4]);
  expect(pendingRealms(emptyMarket(), now)).toEqual([]);
  expect(JSON.stringify(pendingRealms(pending, now))).not.toMatch(/install-|aaaa/);
});

test("realm boards reuse each state, house and UTC day without changing their values", () => {
  const rollup = structuredClone(state);
  for (const house of [null, "Alliance", "Horde", "Neutral"] as const) {
    const first = realmBoards(rollup, now, house);
    expect(realmBoards(rollup, new Date(now.getTime() + 1000), house)).toBe(first);
    expect(first).toEqual(realmBoards(structuredClone(state), now, house));
    const tomorrow = new Date(now.getTime() + 86_400_000);
    const next = realmBoards(rollup, tomorrow, house);
    expect(next).not.toBe(first);
    expect(next).toEqual(realmBoards(structuredClone(state), tomorrow, house));
  }
});
