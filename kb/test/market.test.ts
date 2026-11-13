import { expect, test } from "vitest";
import {
  MARKET_LIMITS, MARKET_MAX_BYTES, MAX_PRICE_ROWS, OPEN_DAYS, THIN_UNITS, emptyMarket, foldMarket, handleMarketValue, itemListings, itemMarket,
  marketBytes, marketHouses, marketPrices, marketRealms, parseHouse, realmMarket, trimMarket, uploadScans, validRealm, type MarketState,
} from "../src/market.js";

const NOW = new Date("2026-10-20T12:00:00Z");

function snapshot(installId: string, day: string, items: number[][], extra: Record<string, unknown> = {}) {
  return {
    kind: "auction_snapshot", installId, eventId: `${installId}:${day}`, capturedAt: `${day}T10:00:00Z`,
    realm: "Forever", scanId: `${installId}-${day}`, part: 1, parts: 1, items, ...extra,
  };
}

// [itemId, auctions, quantity, minUnit, marketUnit]
const three = (day: string, coppers: [number, number, number]) => [
  snapshot("install-a", day, [[2589, 4, 80, coppers[0], coppers[0] + 10]]),
  snapshot("install-b", day, [[2589, 5, 100, coppers[1], coppers[1] + 10]]),
  snapshot("install-c", day, [[2589, 6, 120, coppers[2], coppers[2] + 10]]),
];

test("a day is public when 3 installs scanned the item; values are medians", () => {
  const state = foldMarket(emptyMarket(), three("2026-10-20", [100, 300, 500]), NOW);
  const { value, points } = itemMarket(state, "forever", 2589, NOW);
  expect(points).toEqual([{ day: "2026-10-20", min: 300, market: 310, quantity: 100, reporters: 3, thin: false }]);
  expect(value).toMatchObject({ itemId: 2589, market: 310, min: 300, historical: 310, quantity: 100, reporters: 3, ageDays: 0 });
});

test("listings per open public day are the median of the reporters' counts; closed and unagreed days have none", () => {
  const open = foldMarket(emptyMarket(), three("2026-10-20", [100, 300, 500]), NOW);
  expect(itemListings(open, "forever", 2589, NOW)).toEqual({ "2026-10-20": 5 });
  expect(itemListings(open, "Forever", 765, NOW)).toEqual({});
  expect(itemListings(foldMarket(emptyMarket(), three("2026-10-20", [100, 300, 500]).slice(0, 2), NOW), "Forever", 2589, NOW)).toEqual({});
  // A closed day keeps its prices, not its count.
  const closed = foldMarket(emptyMarket(), three("2026-10-10", [100, 300, 500]), NOW);
  expect(itemMarket(closed, "Forever", 2589, NOW).points).toHaveLength(1);
  expect(itemListings(closed, "Forever", 2589, NOW)).toEqual({});
});

test("two installs are not enough, and an unscanned item is unrecorded, never zero", () => {
  const state = foldMarket(emptyMarket(), three("2026-10-20", [100, 300, 500]).slice(0, 2), NOW);
  expect(itemMarket(state, "Forever", 2589, NOW)).toEqual({ value: null, points: [] });
  expect(handleMarketValue({ realm: "Forever", itemId: 2589 }, state, NOW)).toContain("No public market value");
  expect(handleMarketValue({ realm: "Forever", itemId: 2589 }, state, NOW)).not.toMatch(/\b0c\b/);
});

test("an install's last scan of the day wins", () => {
  const later = snapshot("install-a", "2026-10-20", [[2589, 1, 10, 900, 950]], { capturedAt: "2026-10-20T11:00:00Z", eventId: "a:late" });
  const earlier = snapshot("install-a", "2026-10-20", [[2589, 1, 10, 1, 1]], { capturedAt: "2026-10-20T09:00:00Z", eventId: "a:early" });
  const state = foldMarket(emptyMarket(), [later, earlier, ...three("2026-10-20", [100, 300, 500]).slice(1)], NOW);
  expect(itemMarket(state, "Forever", 2589, NOW).points[0]).toMatchObject({ min: 500, reporters: 3 });
});

test("market value weights recent days; historical is the median of 60 days", () => {
  const rows = [
    ...three("2026-10-20", [100, 100, 100]), // age 0, weight 15, market 110
    ...three("2026-10-10", [200, 200, 200]), // age 10, weight 5, market 210
    ...three("2026-09-01", [900, 900, 900]), // age 49: historical only
  ];
  const { value } = itemMarket(foldMarket(emptyMarket(), rows, NOW), "Forever", 2589, NOW);
  expect(value!.market).toBe(Math.round((110 * 15 + 210 * 5) / 20));
  expect(value!.historical).toBe(210);
  expect(value!.day).toBe("2026-10-20");
});

test("only old public days: historical stays, market is unrecorded", () => {
  const { value } = itemMarket(foldMarket(emptyMarket(), three("2026-09-25", [100, 200, 300]), NOW), "Forever", 2589, NOW);
  expect(value).toMatchObject({ market: null, historical: 210, ageDays: 25 });
});

test("days past 60 and far-future scans are dropped; folding prunes old state", () => {
  const old = foldMarket(emptyMarket(), three("2026-10-01", [1, 1, 1]), new Date("2026-10-02T00:00:00Z"));
  const pruned = foldMarket(old, three("2026-08-01", [5, 5, 5]).concat(three("2026-12-20", [7, 7, 7])), new Date("2026-12-15T00:00:00Z"));
  expect(itemMarket(pruned, "Forever", 2589, new Date("2026-12-15T00:00:00Z")).points).toEqual([]);
  expect(JSON.stringify(pruned)).not.toContain("2026-10-01");
});

test("realms match case-insensitively and keep the first display name", () => {
  const rows = three("2026-10-20", [100, 300, 500]).map((r, i) => ({ ...r, realm: i ? "forever" : "Forever " }));
  const state = foldMarket(emptyMarket(), rows, NOW);
  expect(realmMarket(state, "FOREVER", NOW).map((v) => v.itemId)).toEqual([2589]);
  expect(marketPrices(state, "forever", NOW)).toMatchObject({ realm: "Forever", items: [[2589, 310, 300, 310, 100, "2026-10-20", 3]] });
});

test("other kinds and malformed snapshots are ignored", () => {
  const bad = [
    { kind: "auction_scan", installId: "install-a", realm: "Forever", itemId: 1, copper: 5, capturedAt: "2026-10-20T00:00:00Z" },
    snapshot("install-a", "2026-10-20", [[2589, 1, 1, -5, 1]]),
    snapshot("install-b", "2026-10-20", [[0, 1, 1, 5, 5]]),
    snapshot("install-c", "2026-10-20", "not items" as unknown as number[][]),
    snapshot("install-d", "not-a-day", [[2589, 1, 1, 5, 5]]),
  ];
  expect(foldMarket(emptyMarket(), bad, NOW)).toEqual(emptyMarket());
});

test("a day older than the open window keeps only its public medians, and a day that never reached 3 is dropped", () => {
  const rows = [...three("2026-10-10", [100, 300, 500]), ...three("2026-10-11", [1, 1, 1]).slice(0, 2)];
  const state = foldMarket(emptyMarket(), rows, NOW);
  const text = JSON.stringify(state);
  expect(text).not.toContain("install-");
  expect(text).not.toContain("2026-10-11");
  expect(itemMarket(state, "Forever", 2589, NOW).points).toEqual([{ day: "2026-10-10", min: 300, market: 310, quantity: 100, reporters: 3, thin: false }]);
});

test("a late scan for a closed day is ignored; open days still take scans", () => {
  const closed = foldMarket(emptyMarket(), three("2026-10-10", [100, 300, 500]), NOW);
  const late = snapshot("install-d", "2026-10-10", [[2589, 1, 1, 9999, 9999]]);
  expect(foldMarket(closed, [late], NOW)).toEqual(closed);
  const open = foldMarket(emptyMarket(), three("2026-10-19", [100, 300, 500]).slice(0, 2), NOW);
  const third = foldMarket(open, three("2026-10-19", [100, 300, 500]).slice(2), NOW);
  expect(itemMarket(third, "Forever", 2589, NOW).points).toHaveLength(1);
});

test("capture times with offsets or fractions land on their UTC day", () => {
  const rows = three("2026-10-20", [100, 300, 500]).map((r, i) => ({
    ...r, capturedAt: ["2026-10-19T22:00:00-05:00", "2026-10-20T03:00:00.500Z", "2026-10-20T08:00:00+02:00"][i],
  }));
  expect(itemMarket(foldMarket(emptyMarket(), rows, NOW), "Forever", 2589, NOW).points).toMatchObject([{ day: "2026-10-20", reporters: 3 }]);
});

test("a day one ahead of the server clock counts as today", () => {
  const { value } = itemMarket(foldMarket(emptyMarket(), three("2026-10-21", [100, 100, 100]), NOW), "Forever", 2589, NOW);
  expect(value).toMatchObject({ market: 110, ageDays: 0 });
});

test("realm names are listed only once a realm has a public value", () => {
  const thin = foldMarket(emptyMarket(), three("2026-10-20", [1, 2, 3]).slice(0, 2).map((r) => ({ ...r, realm: "Visit Scam Site" })), NOW);
  expect(marketRealms(thin, NOW)).toEqual([]);
  expect(marketRealms(foldMarket(thin, three("2026-10-20", [1, 2, 3]), NOW), NOW)).toEqual(["Forever"]);
});

test("copper above 2 billion is kept: a 200k-gold listing is a real price", () => {
  const rich = ["install-a", "install-b", "install-c"].map((id) => snapshot(id, "2026-10-20", [[19019, 1, 1, 99_999_999_999, 99_999_999_999]]));
  expect(itemMarket(foldMarket(emptyMarket(), rich, NOW), "Forever", 19019, NOW).value).toMatchObject({ min: 99_999_999_999 });
});

test("realm view lists public items by quantity", () => {
  const rows = [
    ...three("2026-10-20", [100, 300, 500]),
    ...["install-a", "install-b", "install-c"].map((id) => snapshot(id, "2026-10-20", [[765, 2, 900, 30, 33]], { eventId: `${id}:herb` })),
  ];
  expect(realmMarket(foldMarket(emptyMarket(), rows, NOW), "Forever", NOW).map((v) => v.itemId)).toEqual([765, 2589]);
});

// --- Abuse limits: what a stranger's uploads can do to the rollup ---

const reporter = (n: number) => n.toString(16).padStart(16, "0");
/** Three reporters (three upload addresses) scan the item on a day, each at `unit` copper. */
const trio = (day: string, unit: number, itemId = 2589, extra: Record<string, unknown> = {}, quantity = 100) =>
  [1, 2, 3].map((n) => snapshot(`install-${n}-${itemId}`, day, [[itemId, 4, quantity, unit, unit]], { reporter: reporter(n), eventId: `r${n}:${day}:${itemId}`, ...extra }));
const dayBefore = (age: number) => new Date(NOW.getTime() - age * 86_400_000).toISOString().slice(0, 10);

test("realm names must be plain names: charset, length, and a bad name never reaches the rollup", () => {
  for (const bad of ["x", "a".repeat(41), "visit scam.example", "<b>Forever</b>", "https://spam", "Fore;ver", ""]) {
    expect(validRealm(bad)).toBe(false);
    expect(foldMarket(emptyMarket(), trio("2026-10-20", 100).map((r) => ({ ...r, realm: bad })), NOW)).toEqual(emptyMarket());
  }
  for (const good of ["Forever", "Doomhowl PvP", "Al'Akir", "Chromie-2"]) expect(validRealm(good)).toBe(true);
});

test("a realm name that is invalid in an older rollup is never published", () => {
  const state = foldMarket(emptyMarket(), trio("2026-10-20", 100), NOW);
  state.realms.forever!.name = "see scam.example";
  expect(marketRealms(state, NOW)).toEqual([]);
});

test("the realm cap: a new realm past the limit is dropped, known realms still take scans", () => {
  const rows = ["Aaa", "Bbb", "Ccc"].flatMap((realm) => trio("2026-10-20", 100).map((r) => ({ ...r, realm })));
  const state = foldMarket(emptyMarket(), rows, NOW, { realms: 2 });
  expect(Object.keys(state.realms)).toEqual(["aaa", "bbb"]);
  const again = foldMarket(state, trio("2026-10-20", 100, 765).map((r) => ({ ...r, realm: "Aaa" })), NOW, { realms: 2 });
  expect(Object.keys(again.realms.aaa!.items).sort()).toEqual(["2589", "765"]);
  expect(MARKET_LIMITS.realms).toBe(40);
});

test("an upload may name at most 3 realms; the rest of its parts are dropped", () => {
  const parts = ["Aaa", "Bbb", "Ccc", "Ddd", "Aaa"].map((realm, i) => snapshot("install-a", "2026-10-20", [[2589, 1, 1, 5, 5]], { realm, eventId: `p${i}` }));
  expect(uploadScans(parts).map((r) => r.realm)).toEqual(["Aaa", "Bbb", "Ccc", "Aaa"]);
  expect(uploadScans(parts, reporter(1), 1).map((r) => r.realm)).toEqual(["Aaa", "Aaa"]);
  expect(uploadScans(parts, reporter(1))[0]!.reporter).toBe(reporter(1));
});

test("the item cap per realm: a new item past the limit is dropped, known items still count", () => {
  const items = [1, 2, 3, 4].map((id) => [id, 1, 10, 5, 5]);
  const state = foldMarket(emptyMarket(), [snapshot("install-a", "2026-10-20", items)], NOW, { itemsPerRealm: 2 });
  expect(Object.keys(state.realms.forever!.items)).toEqual(["1", "2"]);
  const more = foldMarket(state, [snapshot("install-b", "2026-10-20", [[2, 1, 10, 6, 6], [9, 1, 10, 6, 6]])], NOW, { itemsPerRealm: 2 });
  expect(Object.keys(more.realms.forever!.items)).toEqual(["1", "2"]);
  expect(Object.keys(more.realms.forever!.items["2"]!.open["2026-10-20"]!)).toHaveLength(2);
});

test("the install cap per item day: scans past the limit are dropped, an install already counted can still update", () => {
  const rows = Array.from({ length: 5 }, (_, i) => snapshot(`install-${i}-x`, "2026-10-20", [[2589, 1, 10, 100 + i, 100 + i]]));
  const state = foldMarket(emptyMarket(), rows, NOW, { installsPerItemDay: 3 });
  expect(Object.keys(state.realms.forever!.items["2589"]!.open["2026-10-20"]!)).toEqual(["install-0-x", "install-1-x", "install-2-x"]);
  const update = snapshot("install-0-x", "2026-10-20", [[2589, 1, 10, 777, 777]], { capturedAt: "2026-10-20T11:00:00Z" });
  expect(foldMarket(state, [update], NOW, { installsPerItemDay: 3 }).realms.forever!.items["2589"]!.open["2026-10-20"]!["install-0-x"]![0]).toBe(777);
  expect(MARKET_LIMITS.installsPerItemDay).toBe(25);
});

test("the total entry cap bounds the rollup however many realms and items it holds", () => {
  const items = Array.from({ length: 50 }, (_, i) => [i + 1, 1, 10, 5, 5]);
  const rows = [1, 2, 3, 4].map((n) => snapshot(`install-${n}-x`, "2026-10-20", items));
  const state = foldMarket(emptyMarket(), rows, NOW, { entries: 120 });
  const entries = Object.values(state.realms.forever!.items).reduce((n, d) => n + Object.keys(d.open["2026-10-20"]!).length, 0);
  expect(entries).toBe(120);
  expect(marketBytes(state)).toBeLessThan(120 * 200);
  expect(MARKET_LIMITS.entries * 200).toBeLessThan(MARKET_MAX_BYTES * 2);
});

test("the entry cap counts open scans only: a realm's closed history cannot crowd out its new scans", () => {
  const history = foldMarket(emptyMarket(), [...three("2026-10-10", [100, 300, 500]), ...three("2026-10-11", [100, 300, 500])], NOW);
  expect(Object.keys(history.realms.forever!.items["2589"]!.closed)).toEqual(["2026-10-10", "2026-10-11"]);
  const stats = { dropped: 0 };
  const state = foldMarket(history, three("2026-10-20", [100, 300, 500]), NOW, { entries: 3 }, stats);
  expect(stats.dropped).toBe(0);
  expect(itemMarket(state, "Forever", 2589, NOW).points.map((p) => p.day)).toEqual(["2026-10-10", "2026-10-11", "2026-10-20"]);
});

test("scans a cap drops are counted, so a full rollup is reported rather than silent", () => {
  const stats = { dropped: 0 };
  foldMarket(emptyMarket(), three("2026-10-20", [100, 300, 500]), NOW, { entries: 2 }, stats);
  expect(stats.dropped).toBe(1);
  const items = [1, 2, 3, 4].map((id) => [id, 1, 10, 5, 5]);
  const byItems = { dropped: 0 };
  foldMarket(emptyMarket(), [snapshot("install-a", "2026-10-20", items)], NOW, { itemsPerRealm: 2 }, byItems);
  expect(byItems.dropped).toBe(2);
  const byRealms = { dropped: 0 };
  foldMarket(emptyMarket(), [snapshot("install-a", "2026-10-20", items), { ...snapshot("install-a", "2026-10-20", items), realm: "Other" }], NOW, { realms: 1 }, byRealms);
  expect(byRealms.dropped).toBe(4);
  // A late scan for a closed day is ignored by design, not dropped by a cap.
  const closed = foldMarket(emptyMarket(), three("2026-10-10", [100, 300, 500]), NOW);
  const late = { dropped: 0 };
  foldMarket(closed, [snapshot("install-d", "2026-10-10", [[2589, 1, 1, 9999, 9999]])], NOW, {}, late);
  expect(late.dropped).toBe(0);
});

test("past the size limit the oldest closed days go first, a day at a time, and open days never go", () => {
  const rows = [
    ...three("2026-10-10", [100, 300, 500]), ...three("2026-10-11", [100, 300, 500]), ...three("2026-10-12", [100, 300, 500]),
    ...three("2026-10-20", [100, 300, 500]),
  ];
  const state = foldMarket(emptyMarket(), rows, NOW);
  const closedDays = (s: typeof state) => Object.keys(s.realms.forever!.items["2589"]!.closed);
  expect(closedDays(state)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
  expect(trimMarket(state, marketBytes(state))).toEqual({ state, trimmedDays: 0 });
  const one = trimMarket(state, marketBytes(state) - 1);
  expect(one.trimmedDays).toBe(1);
  expect(closedDays(one.state)).toEqual(["2026-10-11", "2026-10-12"]);
  expect(closedDays(state)).toHaveLength(3);
  const all = trimMarket(state, 0);
  expect(all.trimmedDays).toBe(3);
  expect(closedDays(all.state)).toEqual([]);
  expect(Object.keys(all.state.realms.forever!.items["2589"]!.open["2026-10-20"]!)).toHaveLength(3);
  expect(marketBytes(all.state)).toBeGreaterThan(0);
});

test("a full rollup closes its oldest open day early to take a newer scan: that day's public values stay", () => {
  const older = foldMarket(emptyMarket(), three("2026-10-18", [100, 300, 500]), NOW);
  const stats = { dropped: 0, released: 0 };
  const state = foldMarket(older, three("2026-10-20", [100, 300, 500]), NOW, { entries: 3 }, stats);
  expect(stats).toEqual({ dropped: 0, released: 3 });
  expect(state.realms.forever!.items["2589"]!.closed).toEqual({ "2026-10-18": [300, 310, 100, 3] });
  expect(Object.keys(state.realms.forever!.items["2589"]!.open)).toEqual(["2026-10-20"]);
  expect(itemMarket(state, "Forever", 2589, NOW).points.map((p) => p.day)).toEqual(["2026-10-18", "2026-10-20"]);
});

test("an oldest open day that never reached 3 reporters is discarded to make room", () => {
  const pending = foldMarket(emptyMarket(), three("2026-10-18", [100, 300, 500]).slice(0, 2), NOW);
  const stats = { dropped: 0, released: 0 };
  const state = foldMarket(pending, three("2026-10-20", [100, 300, 500]), NOW, { entries: 3 }, stats);
  expect(stats).toEqual({ dropped: 0, released: 2 });
  expect(state.realms.forever!.items["2589"]!.closed).toEqual({});
  expect(itemMarket(state, "Forever", 2589, NOW).points.map((p) => p.day)).toEqual(["2026-10-20"]);
});

test("a full rollup never closes the day a scan is for, or a newer one: that scan is dropped", () => {
  const full = foldMarket(emptyMarket(), three("2026-10-20", [100, 300, 500]), NOW, { entries: 3 });
  const stats = { dropped: 0, released: 0 };
  const late = [snapshot("install-d", "2026-10-18", [[2589, 1, 1, 5, 5]]), snapshot("install-d", "2026-10-20", [[2589, 1, 1, 5, 5]])];
  const state = foldMarket(full, late, NOW, { entries: 3 }, stats);
  expect(stats).toEqual({ dropped: 2, released: 0 });
  expect(Object.keys(state.realms.forever!.items["2589"]!.open)).toEqual(["2026-10-20"]);
});

test("a dropped scan leaves nothing behind: no empty day, and no item held against the item cap", () => {
  const full = foldMarket(emptyMarket(), [snapshot("install-a", "2026-10-20", [[1, 1, 10, 5, 5]])], NOW, { entries: 1 });
  const stats = { dropped: 0 };
  const state = foldMarket(full, [snapshot("install-b", "2026-10-20", [[2, 1, 10, 5, 5]])], NOW, { entries: 1 }, stats);
  expect(stats.dropped).toBe(1);
  expect(Object.keys(state.realms.forever!.items)).toEqual(["1"]);
});

test("an empty open day an older fold left behind is removed, and its item with it", () => {
  const state = foldMarket(emptyMarket(), three("2026-10-20", [100, 300, 500]), NOW);
  state.realms.forever!.items["765"] = { open: { "2026-10-19": {} }, closed: {} };
  state.realms.forever!.items["2589"]!.open["2026-10-19"] = {};
  const next = foldMarket(state, [], NOW);
  expect(Object.keys(next.realms.forever!.items)).toEqual(["2589"]);
  expect(Object.keys(next.realms.forever!.items["2589"]!.open)).toEqual(["2026-10-20"]);
});

test("a reporter past its share makes room from its own oldest day, never from another reporter's", () => {
  const held = foldMarket(emptyMarket(), [
    snapshot("install-x", "2026-10-17", [[1, 1, 10, 5, 5], [2, 1, 10, 5, 5]], { reporter: reporter(1) }),
    snapshot("install-y", "2026-10-17", [[3, 1, 10, 5, 5]], { reporter: reporter(2) }),
    snapshot("install-x", "2026-10-18", [[1, 1, 10, 6, 6], [2, 1, 10, 6, 6]], { reporter: reporter(1) }),
  ], NOW, { entriesPerReporter: 4 });
  const stats = { dropped: 0, released: 0 };
  const state = foldMarket(held, [snapshot("install-x", "2026-10-20", [[1, 1, 10, 7, 7]], { reporter: reporter(1) })], NOW, { entriesPerReporter: 4 }, stats);
  expect(stats).toEqual({ dropped: 0, released: 2 });
  const items = state.realms.forever!.items;
  expect(Object.keys(items["1"]!.open)).toEqual(["2026-10-18", "2026-10-20"]);
  expect(Object.keys(items["2"]!.open)).toEqual(["2026-10-18"]);
  expect(Object.keys(items["3"]!.open)).toEqual(["2026-10-17"]);
  expect(MARKET_LIMITS.entriesPerReporter).toBe(20_000);
});

test("a reporter whose whole share is on one day is dropped there, and other reporters still fold", () => {
  const items = [1, 2, 3, 4, 5].map((id) => [id, 1, 10, 5, 5]);
  const stats = { dropped: 0, released: 0 };
  const state = foldMarket(emptyMarket(), [
    snapshot("install-x", "2026-10-20", items, { reporter: reporter(1) }),
    snapshot("install-y", "2026-10-20", [[1, 1, 10, 6, 6]], { reporter: reporter(2) }),
  ], NOW, { entriesPerReporter: 3, entries: 4 }, stats);
  expect(stats).toEqual({ dropped: 2, released: 0 });
  expect(Object.keys(state.realms.forever!.items).sort()).toEqual(["1", "2", "3"]);
  expect(Object.keys(state.realms.forever!.items["1"]!.open["2026-10-20"]!)).toEqual(["install-x", "install-y"]);
});

test("only well-formed auction parts are read: strings, floats, huge arrays and extra fields are dropped", () => {
  const bad = [
    snapshot("install-a", "2026-10-20", [[2589, 1, 10, 5.5, 5]]),
    snapshot("install-b", "2026-10-20", [["2589", 1, 10, 5, 5]] as unknown as number[][]),
    snapshot("install-c", "2026-10-20", [[2589, 1, 10, 5, 5, 7]]),
    snapshot("install-d", "2026-10-20", Array.from({ length: 1001 }, (_, i) => [i + 1, 1, 1, 5, 5])),
    snapshot("short", "2026-10-20", [[2589, 1, 10, 5, 5]]),
    snapshot("install-e", "2026-10-20", [[2589, 1, 10, 5, 5]], { reporter: "not-a-hash" }),
  ];
  expect(foldMarket(emptyMarket(), bad, NOW)).toEqual(emptyMarket());
});

test("installs behind one upload address vote once: ten installs from one address are not a public day", () => {
  const sybils = Array.from({ length: 10 }, (_, i) => snapshot(`install-${i}-s`, "2026-10-20", [[2589, 1, 10, 9_000_000, 9_000_000]], { reporter: reporter(99) }));
  const state = foldMarket(emptyMarket(), sybils, NOW);
  expect(itemMarket(state, "Forever", 2589, NOW)).toEqual({ value: null, points: [] });
  const withOneMore = foldMarket(state, trio("2026-10-20", 100).slice(0, 1), NOW);
  expect(itemMarket(withOneMore, "Forever", 2589, NOW).points).toEqual([]);
  const withThree = foldMarket(state, trio("2026-10-20", 100), NOW);
  // The ten share one voice: with three honest reporters the median stays at the honest price.
  expect(itemMarket(withThree, "Forever", 2589, NOW).points).toMatchObject([{ reporters: 4, market: 100 }]);
});

// --- Outliers and thin days ---

test("probe: 13 days at 1000c and 2 forged days at 9e15 leave the value near 1000c", () => {
  const rows = [
    ...Array.from({ length: 13 }, (_, i) => trio(dayBefore(i + 2), 1000)).flat(),
    ...trio(dayBefore(0), 9e15),
    ...trio(dayBefore(1), 9e15),
  ];
  const { value, points } = itemMarket(foldMarket(emptyMarket(), rows, NOW), "Forever", 2589, NOW);
  expect(points).toHaveLength(15);
  expect(value!.market).toBe(1000);
  expect(value!.historical).toBe(1000);
  // The newest published minimum is the newest trusted day, not a forged one.
  expect(value).toMatchObject({ min: 1000, day: dayBefore(2) });
});

test("a real price move shows once it is the usual price, and one day cannot swing a settled price", () => {
  const settled = Array.from({ length: 10 }, (_, i) => trio(dayBefore(i + 1), 1000)).flat();
  const spike = foldMarket(emptyMarket(), [...settled, ...trio(dayBefore(0), 2500)], NOW);
  // 2500 is within 3x of 1000: counted, but weighted as one day of eleven.
  expect(itemMarket(spike, "Forever", 2589, NOW).value!.market).toBeLessThan(1400);
  const wild = foldMarket(emptyMarket(), [...settled, ...trio(dayBefore(0), 4000)], NOW);
  expect(itemMarket(wild, "Forever", 2589, NOW).value!.market).toBe(1000);
});

test("with fewer than 5 solid days nothing can be trimmed, so the 3 reporters per day rule is the defence", () => {
  const rows = [...trio(dayBefore(2), 1000), ...trio(dayBefore(1), 1000), ...trio(dayBefore(0), 90_000)];
  expect(itemMarket(foldMarket(emptyMarket(), rows, NOW), "Forever", 2589, NOW).value!.market).toBeGreaterThan(5000);
});

test("a unit price of 0 is not a price: it is dropped, never published", () => {
  expect(foldMarket(emptyMarket(), trio("2026-10-20", 0), NOW)).toEqual(emptyMarket());
  const mixed = [snapshot("install-1-m", "2026-10-20", [[2589, 1, 10, 0, 0], [765, 1, 10, 5, 5]], { reporter: reporter(1) })];
  expect(Object.keys(foldMarket(emptyMarket(), mixed, NOW).realms.forever!.items)).toEqual(["765"]);
});

test("a thin day is labelled and kept out of the market value", () => {
  const rows = [...trio("2026-10-20", 100, 2589, {}, THIN_UNITS), ...trio("2026-10-19", 200, 2589, {}, THIN_UNITS + 1)];
  const { value, points } = itemMarket(foldMarket(emptyMarket(), rows, NOW), "Forever", 2589, NOW);
  expect(points.map((p) => [p.day, p.thin])).toEqual([["2026-10-19", false], ["2026-10-20", true]]);
  expect(value).toMatchObject({ market: 200, min: 100, thin: true, quantity: THIN_UNITS });
  const thinState = foldMarket(emptyMarket(), trio("2026-10-20", 100, 2589, {}, 1), NOW);
  const onlyThin = itemMarket(thinState, "Forever", 2589, NOW).value!;
  expect(onlyThin.market).toBeNull();
  expect(onlyThin).toMatchObject({ min: 100, thin: true });
  const thinHorde = foldMarket(emptyMarket(), trio("2026-10-20", 100, 2589, { house: "Horde" }, 1), NOW);
  const text = handleMarketValue({ realm: "Forever", itemId: 2589 }, thinHorde, NOW);
  expect(text).toContain("Horde auction house:");
  expect(text).toContain("unrecorded");
  expect(text).toContain("(thin");
});

// --- Late arrivals ---

test("a scan that reaches the site up to a week late still counts, and a day below 3 reporters is not published", () => {
  const late = dayBefore(OPEN_DAYS - 1);
  const first = foldMarket(emptyMarket(), trio(late, 100).slice(0, 2), NOW);
  expect(itemMarket(first, "Forever", 2589, NOW).points).toEqual([]);
  const third = foldMarket(first, trio(late, 100).slice(2), NOW);
  expect(itemMarket(third, "Forever", 2589, NOW).points).toMatchObject([{ day: late, reporters: 3 }]);
});

test("a scan older than the open window is ignored once its day has closed", () => {
  const old = dayBefore(OPEN_DAYS + 1);
  const closed = foldMarket(emptyMarket(), trio(old, 100), NOW);
  const lateOne = snapshot("install-9-late", old, [[2589, 1, 10, 9999, 9999]], { reporter: reporter(9) });
  expect(foldMarket(closed, [lateOne], NOW)).toEqual(closed);
});

// --- Size of the price file ---

test("a realm's price file carries at most the requested rows, the items with the most units", () => {
  const items = Array.from({ length: 30 }, (_, i) => [i + 1, 1, 100 - i, 10, 10]);
  const rows = [1, 2, 3].map((n) => snapshot(`install-${n}-p`, "2026-10-20", items, { reporter: reporter(n) }));
  const state = foldMarket(emptyMarket(), rows, NOW);
  expect(marketPrices(state, "Forever", NOW).items).toHaveLength(30);
  expect(marketPrices(state, "Forever", NOW, 5).items.map((r) => r[0])).toEqual([1, 2, 3, 4, 5]);
  expect(MAX_PRICE_ROWS).toBe(2000);
});

// --- Auction houses ---

test("scans that name their house make that house's own market and never a realm-wide blend", () => {
  const day = "2026-10-20";
  const rows = [
    ...trio(day, 100, 2589, { house: "Horde", faction: "Horde" }),
    ...[4, 5, 6].map((n) => snapshot(`install-${n}-a`, day, [[2589, 4, 100, 300, 300]], { reporter: reporter(n), eventId: `a${n}`, house: "Alliance", faction: "Alliance" })),
  ];
  const state = foldMarket(emptyMarket(), rows, NOW);
  expect(itemMarket(state, "Forever", 2589, NOW, "Horde").value).toMatchObject({ market: 100, reporters: 3 });
  expect(itemMarket(state, "forever", 2589, NOW, "Alliance").value).toMatchObject({ market: 300, reporters: 3 });
  expect(itemMarket(state, "Forever", 2589, NOW, "Neutral")).toEqual({ value: null, points: [] });
  // The realm-wide view holds only scans whose house is unknown: none here, so nothing mixes the two houses.
  expect(itemMarket(state, "Forever", 2589, NOW).value).toBeNull();
  expect(state.realms).toEqual({});
  expect(marketPrices(state, "Forever", NOW, MAX_PRICE_ROWS, "Horde")).toMatchObject({ realm: "Forever", house: "Horde", items: [[2589, 100, 100, 100, 100, day, 3]] });
  expect(marketPrices(state, "Forever", NOW)).toEqual({ realm: "Forever", items: [] });
  expect(marketHouses(state, NOW)).toEqual({ Forever: ["Alliance", "Horde"] });
  expect(marketRealms(state, NOW)).toEqual(["Forever"]);
  // market_value names each house and its own value.
  const text = handleMarketValue({ realm: "Forever", itemId: 2589 }, state, NOW);
  expect(text).toMatch(/Alliance auction house:\nMarket value: 3s 0c[\s\S]*Horde auction house:\nMarket value: 1s 0c/);
  expect(text).toContain("No public value yet in the Neutral auction house.");
});

test("a scan without a house counts for its scanner's faction only; one without either stays in the house-unknown view", () => {
  const day = "2026-10-20";
  const byFaction = foldMarket(emptyMarket(), trio(day, 100, 2589, { faction: "Horde" }), NOW);
  expect(itemMarket(byFaction, "Forever", 2589, NOW, "Horde").value).toMatchObject({ reporters: 3 });
  expect(itemMarket(byFaction, "Forever", 2589, NOW).value).toBeNull();
  const neutral = foldMarket(emptyMarket(), trio(day, 100, 2589, { faction: "Horde", house: "Neutral" }), NOW);
  expect(itemMarket(neutral, "Forever", 2589, NOW, "Horde").value).toBeNull();
  expect(itemMarket(neutral, "Forever", 2589, NOW, "Neutral").value).toMatchObject({ reporters: 3 });
  const old = foldMarket(emptyMarket(), trio(day, 100), NOW);
  expect(old.houses).toBeUndefined();
  expect(marketHouses(old, NOW)).toEqual({});
  expect(itemMarket(old, "Forever", 2589, NOW).value).toMatchObject({ reporters: 3 });
  // A house-unknown value is never presented as a house's price.
  expect(handleMarketValue({ realm: "Forever", itemId: 2589 }, old, NOW)).toContain("No public market value yet in any auction house");
  expect(marketRealms(old, NOW)).toEqual(["Forever"]);
});

test("a house needs its own 3 reporters, and closed house days collapse like realm days", () => {
  const day = dayBefore(OPEN_DAYS + 1);
  const rows = [...trio(day, 100).slice(0, 1), ...trio(day, 100, 2589, { house: "Horde" }).slice(1)];
  const state = foldMarket(emptyMarket(), rows, NOW);
  expect(itemMarket(state, "Forever", 2589, NOW).points).toEqual([]);
  expect(itemMarket(state, "Forever", 2589, NOW, "Horde").points).toEqual([]);
  expect(state).toEqual(emptyMarket());
  const horde = foldMarket(emptyMarket(), trio(day, 100, 2589, { house: "Horde" }), NOW);
  expect(itemMarket(horde, "Forever", 2589, NOW, "Horde").points).toMatchObject([{ day, reporters: 3 }]);
  expect(horde.houses!["forever|horde"]!.items["2589"]!.open).toEqual({});
});

test("each scan is stored once, in its house: house scans and house-unknown scans share the entry cap", () => {
  const rows = [...trio("2026-10-20", 100, 2589, { house: "Horde" }), ...trio("2026-10-20", 100, 765)];
  const state = foldMarket(emptyMarket(), rows, NOW, { entries: 4 });
  expect(itemMarket(state, "Forever", 2589, NOW, "Horde").value).toMatchObject({ reporters: 3 });
  expect(Object.keys(state.realms.forever!.items["765"]!.open["2026-10-20"]!)).toHaveLength(1);
});

test("a realm's houses share one place under the realm cap", () => {
  const rows = [
    ...trio("2026-10-20", 100, 2589, { house: "Horde" }), ...trio("2026-10-20", 100, 2589, { house: "Alliance" }),
    ...trio("2026-10-20", 100, 2589, { realm: "Nightfall", house: "Horde" }),
  ];
  const stats = { dropped: 0 };
  const state = foldMarket(emptyMarket(), rows, NOW, { realms: 1 }, stats);
  expect(Object.keys(state.houses!).sort()).toEqual(["forever|alliance", "forever|horde"]);
  expect(stats.dropped).toBe(3);
});

test("a fold over a stored realm-wide day from before houses were kept apart adds no new scan to it", () => {
  const day = "2026-10-20";
  const before: MarketState = { version: 3, realms: { forever: { name: "Forever", items: { "2589": { open: {}, closed: { "2026-10-12": [100, 200, 40, 6] } } } } } };
  const state = foldMarket(before, trio(day, 100, 2589, { house: "Horde" }), NOW);
  expect(state.realms.forever!.items["2589"]).toEqual({ open: {}, closed: { "2026-10-12": [100, 200, 40, 6] } });
  expect(itemMarket(state, "Forever", 2589, NOW, "Horde").value).toMatchObject({ reporters: 3, day });
});

test("uploadScans keeps the faction and house, and a house is named in any case", () => {
  const [kept] = uploadScans([snapshot("install-a", "2026-10-20", [[2589, 1, 1, 5, 5]], { faction: "Alliance", house: "Neutral" })], reporter(1));
  expect(kept).toMatchObject({ faction: "Alliance", house: "Neutral" });
  expect(uploadScans([snapshot("install-a", "2026-10-20", [[2589, 1, 1, 5, 5]], { house: "Goblin" })])).toEqual([]);
  expect(parseHouse(" HORDE ")).toBe("Horde");
  expect(parseHouse("goblin")).toBeNull();
});

test("a trusted install makes a day public on its own, labelled; strangers still need 3", () => {
  const day = "2026-10-20";
  const own = [snapshot("install-own", day, [[2589, 4, 80, 100, 110]], { reporter: "0123456789abcdef" })];
  // Untrusted, one reporter is not public.
  expect(itemMarket(foldMarket(emptyMarket(), own, NOW), "Forever", 2589, NOW).value).toBeNull();
  // Trusted, the same scan is public with one reporter.
  const trusted = new Set(["install-own"]);
  const state = foldMarket(emptyMarket(), own, NOW, {}, undefined, trusted);
  expect(itemMarket(state, "Forever", 2589, NOW).value).toMatchObject({ min: 100, reporters: 1 });
  expect(itemListings(state, "Forever", 2589, NOW)).toEqual({ [day]: 4 });
  const ownHorde = foldMarket(emptyMarket(), own.map((r) => ({ ...r, house: "Horde" })), NOW, {}, undefined, trusted);
  expect(handleMarketValue({ realm: "Forever", itemId: 2589 }, ownHorde, NOW)).toContain("1 reporter (includes Everloot's own scans)");
  // A scan stored before the install was trusted is re-marked by the next trusted fold, so its day survives closing.
  const closing = new Date("2026-10-30T12:00:00Z");
  const untrusted = foldMarket(emptyMarket(), own, NOW);
  expect(itemMarket(foldMarket(untrusted, [], closing), "Forever", 2589, closing).points).toEqual([]);
  expect(itemMarket(foldMarket(untrusted, [], closing, {}, undefined, trusted), "Forever", 2589, closing).points)
    .toEqual([{ day, min: 100, market: 110, quantity: 80, reporters: 1, thin: false }]);
  // Two strangers without a trusted install are still not public.
  const strangers = [snapshot("install-x", day, [[765, 1, 10, 5, 5]], { reporter: "1111111111111111" }), snapshot("install-y", day, [[765, 1, 10, 5, 5]], { reporter: "2222222222222222" })];
  expect(itemMarket(foldMarket(emptyMarket(), strangers, NOW, {}, undefined, trusted), "Forever", 765, NOW).value).toBeNull();
});
