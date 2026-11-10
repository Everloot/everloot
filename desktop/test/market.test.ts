import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { writePricesAddon } from "../../companion/src/prices";
import { answerSuggestion } from "../src/renderer/format";
import { mergeSettings, defaultSettings } from "../src/main/settings";
import { characterRealms, fetchDropSources, itemIdFrom, listRealms, mergeRealms, ownRealms, priceRows, readDropsBlock, readPricesFile, refreshMarket, suggestedRealms } from "../src/main/market";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-market-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test("own scans come first, followed realms fill in, duplicates by case drop, and the cap holds", () => {
  const merged = mergeRealms(["Nightslayer", "  "], ["nightslayer", "Dreamscythe", "Doomhowl"]);
  expect(merged).toEqual([{ realm: "Nightslayer", source: "scan" }, { realm: "Dreamscythe", source: "followed" }, { realm: "Doomhowl", source: "followed" }]);
  const many = mergeRealms([], Array.from({ length: 25 }, (_, i) => `Realm${i}`));
  expect(many).toHaveLength(20);
});

/** One account file with only the gold rows the addon writes on login: no auction scan, nothing followed. */
const charactersOnly = (d: string) => {
  const sv = join(d, "Everloot.lua");
  writeFileSync(sv, `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "x", ["records"] = { ["gold_snapshot"] = {
    { ["character"] = "Arthas", ["realm"] = "Forever", ["capturedAt"] = "2026-10-18T10:00:00Z", ["currentCopper"] = 100, ["peakCopper"] = 100 },
    { ["character"] = "Jaina", ["realm"] = "forever", ["capturedAt"] = "2026-10-18T10:00:00Z", ["currentCopper"] = 100, ["peakCopper"] = 100 },
    { ["character"] = "Thrall", ["realm"] = "Bad<Realm>", ["capturedAt"] = "2026-10-18T10:00:00Z", ["currentCopper"] = 100, ["peakCopper"] = 100 } } } }`);
  return sv;
};
/** The house a price request asked for, as the site names it in its answer. */
const houseOf = (url: string) => ({ alliance: "Alliance", horde: "Horde", neutral: "Neutral" })[new URL(url).searchParams.get("house") ?? ""];
const pricesFor = (asked: string[]) => vi.fn(async (url: string) => {
  if (url.includes("/api/rollups/drops")) return new Response("", { status: 503 });
  const realm = new URL(url).searchParams.get("realm")!;
  asked.push(`${realm} ${houseOf(url)}`);
  return new Response(JSON.stringify({ ok: true, dataAsOf: "2026-10-18", realm, house: houseOf(url), fields: [], items: [[1, 10, 9, 11, 5, "2026-10-17", 3]] }));
}) as unknown as typeof fetch;

test("a character's realm is only suggested: nothing is fetched or written for it before the player follows", async () => {
  const d = dir();
  const sv = charactersOnly(d);
  // One name per realm, and a name the site would refuse (failing the whole refresh once followed) is left out.
  expect(characterRealms([sv, join(d, "missing.lua")])).toEqual(["Forever"]);
  const settings = defaultSettings();
  expect(suggestedRealms(characterRealms([sv]), ownRealms([sv]), settings.market.realms, settings.market.dismissed)).toEqual(["Forever"]);
  const asked: string[] = [];
  const r = await refreshMarket({ svFiles: [sv], followed: settings.market.realms, addonsDir: join(d, "AddOns"), endpoint: "https://everloot.app", send: pricesFor(asked) });
  expect(asked).toEqual([]);
  expect(r.realms).toEqual([]);
  expect(readPricesFile(join(d, "AddOns"))?.realms ?? []).toEqual([]);
});

test("after Follow the character's realm is fetched and written like any followed realm, and no longer suggested", async () => {
  const d = dir();
  const sv = charactersOnly(d);
  const before = mergeSettings(defaultSettings(), { market: { realms: ["Doomhowl"] } });
  const after = mergeSettings(before, answerSuggestion(before.market, ["Forever"], true));
  // Appended after the realms already followed, so the cap drops it first, as for a realm followed by hand.
  expect(after.market.realms).toEqual(["Doomhowl", "Forever"]);
  const asked: string[] = [];
  const r = await refreshMarket({ svFiles: [sv], followed: after.market.realms, addonsDir: join(d, "AddOns"), endpoint: "https://everloot.app", send: pricesFor(asked) });
  expect(asked).toEqual(["Doomhowl Alliance", "Doomhowl Horde", "Forever Alliance", "Forever Horde"]);
  expect(r.realms.map((x) => [x.realm, x.house, x.source])).toEqual([["Doomhowl", "Alliance", "followed"], ["Doomhowl", "Horde", "followed"], ["Forever", "Alliance", "followed"], ["Forever", "Horde", "followed"]]);
  expect(readPricesFile(join(d, "AddOns"))!.realms.map((x) => [x.realm, x.house])).toEqual([["doomhowl", "Alliance"], ["doomhowl", "Horde"], ["forever", "Alliance"], ["forever", "Horde"]]);
  // Unfollowed later, it stays answered: the suggestion does not come back.
  const unfollowed = mergeSettings(after, { market: { realms: ["Doomhowl"] } });
  expect(suggestedRealms(characterRealms([sv]), [], unfollowed.market.realms, unfollowed.market.dismissed)).toEqual([]);
});

test("a dismissed suggestion is not shown again and fetches nothing; a new character's realm still is", () => {
  const s = mergeSettings(defaultSettings(), answerSuggestion(defaultSettings().market, ["Forever"], false));
  expect(s.market).toEqual({ realms: [], dismissed: ["Forever"] });
  expect(suggestedRealms(["forever"], [], s.market.realms, s.market.dismissed)).toEqual([]);
  expect(suggestedRealms(["Forever", "Skull Rock"], [], s.market.realms, s.market.dismissed)).toEqual(["Skull Rock"]);
});

test("realms already scanned or followed are not suggested, whatever the case", () => {
  expect(suggestedRealms(["Nightslayer", "doomhowl", "Forever"], ["nightslayer"], ["Doomhowl"], [])).toEqual(["Forever"]);
  expect(suggestedRealms(["Nightslayer"], ["Nightslayer"], [], [])).toEqual([]);
});

test("the realm list comes from the site's market endpoint without a realm", async () => {
  const send = vi.fn(async (url: string) => {
    expect(url).toBe("https://everloot.app/api/market/prices");
    return new Response(JSON.stringify({ ok: true, dataAsOf: "2026-10-18", realms: ["Doomhowl", 7, "Nightslayer"] }));
  });
  expect(await listRealms("https://everloot.app", send as unknown as typeof fetch)).toEqual({ realms: ["Doomhowl", "Nightslayer"], dataAsOf: "2026-10-18" });
  const down = vi.fn(async () => new Response("", { status: 503 }));
  await expect(listRealms("https://everloot.app", down as unknown as typeof fetch)).rejects.toThrow(/503/);
});

test("a refresh fetches each house of the scanned and followed realms and writes the slot addon; an unreadable file is skipped", async () => {
  const d = dir();
  const sv = join(d, "Everloot.lua");
  // The player scanned a neutral (goblin) house on Nightslayer: that realm also gets the neutral house's prices.
  writeFileSync(sv, `EverlootDB = { ["version"] = "0.3.3", ["installId"] = "x", ["records"] = { ["auction_snapshot"] = { { ["realm"] = "Nightslayer", ["faction"] = "Horde", ["house"] = "Neutral" } } }, ["lastScans"] = { ["Nightslayer"] = { ["at"] = "2026-10-18T00:00:00Z" } } }`);
  const asked: string[] = [];
  const send = vi.fn(async (url: string) => {
    // The drop rates are down: the prices are written all the same.
    if (url.includes("/api/rollups/drops")) return new Response("", { status: 503 });
    const realm = new URL(url).searchParams.get("realm")!;
    asked.push(`${realm} ${houseOf(url)}`);
    return new Response(JSON.stringify({ ok: true, dataAsOf: "2026-10-18", realm, house: houseOf(url), fields: [], items: [[1, 10, 9, 11, 5, "2026-10-17", 3]] }));
  });
  expect(ownRealms([sv, join(d, "missing.lua")])).toEqual(["Nightslayer"]);
  const r = await refreshMarket({ svFiles: [sv], followed: ["Doomhowl"], addonsDir: join(d, "AddOns"), endpoint: "https://everloot.app", send: send as unknown as typeof fetch });
  expect(asked).toEqual(["Nightslayer Alliance", "Nightslayer Horde", "Nightslayer Neutral", "Doomhowl Alliance", "Doomhowl Horde"]);
  expect(r.realms.map((x) => [x.realm, x.house, x.source])).toEqual([["Nightslayer", "Alliance", "scan"], ["Nightslayer", "Horde", "scan"], ["Nightslayer", "Neutral", "scan"], ["Doomhowl", "Alliance", "followed"], ["Doomhowl", "Horde", "followed"]]);
  expect(readFileSync(join(d, "AddOns", "EverlootPrices", "EverlootPrices.toc"), "utf8")).toContain("EverlootPrices");
});

test("the prices file in the game reads back per realm and house, and one item comes back from every house that has it", () => {
  const addons = dir();
  expect(readPricesFile(addons)).toBeNull();
  writePricesAddon(addons, [
    { realm: "Forever", house: "Alliance", dataAsOf: "2026-10-20T06:30:00.000Z", items: [[2589, 205, 200, 190, 40, "2026-10-20", 3], [765, null, 30, 33, 900, "2026-10-05", 4], [25890, 1, 1, 1, 1, "2026-10-20", 3]] },
    { realm: "Forever", house: "Horde", dataAsOf: "2026-10-20T06:30:00.000Z", items: [[2589, 900, 880, 850, 12, "2026-10-20", 3]] },
    { realm: "Doomhowl", house: "Neutral", dataAsOf: null, items: [[2589, 300, 250, 280, 12, "2026-10-19", 5]] },
  ]);
  const file = readPricesFile(addons)!;
  expect(file.realms).toEqual([
    { realm: "forever", house: "Alliance", dataAsOf: "2026-10-20T06:30:00.000Z", items: 3 },
    { realm: "forever", house: "Horde", dataAsOf: "2026-10-20T06:30:00.000Z", items: 1 },
    { realm: "doomhowl", house: "Neutral", dataAsOf: null, items: 1 },
  ]);
  expect(priceRows(file, 2589).map((r) => [r.realm, r.house, r.market, r.min, r.historical, r.quantity, r.reporters]))
    .toEqual([["forever", "Alliance", 205, 200, 190, 40, 3], ["forever", "Horde", 900, 880, 850, 12, 3], ["doomhowl", "Neutral", 300, 250, 280, 12, 5]]);
  expect(priceRows(file, 765)[0]).toMatchObject({ market: null, min: 30, day: "2026-10-05" });
  // 258 is not 2589 or 25890: rows are matched whole.
  expect(priceRows(file, 258)).toEqual([]);
});

test("an older file keyed by realm alone still reads back, its block without a house so the page labels it", () => {
  const addons = dir();
  writePricesAddon(addons, []);
  const path = join(addons, "EverlootPrices", "EverlootPrices.lua");
  writeFileSync(path, `EverlootPricesDB = { ["realms"] = {\n  ["forever"] = { ["dataAsOf"] = "2026-10-20T06:30:00.000Z", ["data"] = "2589,205,200,190,40,2026-10-20,3", ["sum"] = 1 },\n} }\n`);
  const file = readPricesFile(addons)!;
  expect(file.realms).toEqual([{ realm: "forever", house: null, dataAsOf: "2026-10-20T06:30:00.000Z", items: 1 }]);
  expect(priceRows(file, 2589)).toMatchObject([{ realm: "forever", house: null, market: 205 }]);
});

test("an item is given by id, by a link pasted from game chat, or by its everloot.app address", () => {
  expect(itemIdFrom(" 2589 ")).toBe(2589);
  expect(itemIdFrom("|cffffffff|Hitem:2589::::::::60:::::|h[Linen Cloth]|h|r")).toBe(2589);
  expect(itemIdFrom("https://everloot.app/database/items/19019")).toBe(19019);
  expect(itemIdFrom("Linen Cloth")).toBeNull();
  expect(itemIdFrom("")).toBeNull();
});

const rate = (itemId: number, source: Record<string, number>, drops: number, kills: number, reporters: number) =>
  ({ itemId, ...source, drops, kills, reporters, rate: drops / kills, public: true });
const dropsPage = (rates: unknown[], next: string | null = null) =>
  new Response(JSON.stringify({ unreachable: false, dataAsOf: "2026-10-20T06:00:00.000Z", rates, measuredZeros: [{ sourceNpcId: 9, kills: 40, reporters: 3, public: true }], next }));

test("drop rates come from the public rollup, every page on the same site, three installs and one source each", async () => {
  const asked: string[] = [];
  const send = vi.fn(async (url: string) => {
    asked.push(url);
    if (!url.includes("offset")) {
      return dropsPage([rate(2589, { sourceNpcId: 116 }, 42, 340, 5), rate(2770, { sourceObjectId: 1731 }, 300, 310, 6),
        rate(1, { sourceNpcId: 2 }, 1, 9, 2), rate(1, { sourceNpcId: 2, sourceObjectId: 3 }, 1, 9, 3), rate(1, { sourceNpcId: 2 }, 1, 0, 3)],
      "https://everloot.app/api/rollups/drops?offset=500&limit=500");
    }
    return dropsPage([rate(12345, { sourceNpcId: 61 }, 1, 80, 3)], "https://elsewhere.example/api/rollups/drops?offset=1000");
  });
  const drops = await fetchDropSources("https://everloot.app", send as unknown as typeof fetch, new Date("2026-10-21T10:00:00Z"));
  expect(asked).toEqual(["https://everloot.app/api/rollups/drops", "https://everloot.app/api/rollups/drops?offset=500&limit=500"]);
  expect(drops).toEqual({
    dataAsOf: "2026-10-20T06:00:00.000Z", fetchedAt: "2026-10-21T10:00:00.000Z",
    rows: [[2589, "n", 116, 42, 340, 5], [2770, "o", 1731, 300, 310, 6], [12345, "n", 61, 1, 80, 3]].sort((a, b) => (b[4] as number) - (a[4] as number)),
  });
  const down = vi.fn(async () => new Response(JSON.stringify({ unreachable: true, rates: [] })));
  await expect(fetchDropSources("https://everloot.app", down as unknown as typeof fetch)).rejects.toThrow(/unreachable/);
});

test("a rate's source name is kept for the file, keyed by kind and id; a rate left out leaves its name out", async () => {
  const named = (r: ReturnType<typeof rate>, sourceName: unknown) => ({ ...r, sourceName });
  const send = vi.fn(async () => dropsPage([
    named(rate(2589, { sourceNpcId: 116 }, 42, 340, 5), "Defias Bandit"),
    named(rate(2770, { sourceObjectId: 1731 }, 300, 310, 6), "Copper Vein"),
    named(rate(1, { sourceNpcId: 2 }, 1, 9, 2), "Too Few Installs"),
    named(rate(3, { sourceNpcId: 4 }, 1, 9, 3), 42),
  ]));
  const drops = await fetchDropSources("https://everloot.app", send as unknown as typeof fetch, new Date("2026-10-21T10:00:00Z"));
  expect(drops.names).toEqual({ n116: "Defias Bandit", o1731: "Copper Vein" });
});

test("names written beside the rates are read back with them, so the daily carry-over keeps them", async () => {
  const d = dir();
  const addons = join(d, "AddOns");
  const send = vi.fn(async (url: string) => (url.includes("/api/rollups/drops")
    ? dropsPage([{ ...rate(2589, { sourceNpcId: 116 }, 42, 340, 5), sourceName: 'Defias "Bandit"\nTwo' }])
    : new Response(JSON.stringify({ ok: true, dataAsOf: "2026-10-18", realm: "Doomhowl", house: houseOf(url), fields: [], items: [] }))));
  await refreshMarket({ svFiles: [], followed: ["Doomhowl"], addonsDir: addons, endpoint: "https://everloot.app", send: send as unknown as typeof fetch, now: new Date("2026-10-21T10:00:00Z") });
  expect(readDropsBlock(addons)).toEqual({ dataAsOf: "2026-10-20T06:00:00.000Z", fetchedAt: "2026-10-21T10:00:00.000Z",
    rows: [[2589, "n", 116, 42, 340, 5]], names: { n116: 'Defias "Bandit" Two' } });
});

test("drop rates are fetched once a day; between fetches and after a failure the last good block is kept", async () => {
  const d = dir();
  const addons = join(d, "AddOns");
  let dropCalls = 0;
  let dropsUp = true;
  const send = vi.fn(async (url: string) => {
    if (url.includes("/api/rollups/drops")) {
      dropCalls++;
      return dropsUp ? dropsPage([rate(2589, { sourceNpcId: 116 }, 42, 340, 5)]) : new Response("", { status: 503 });
    }
    return new Response(JSON.stringify({ ok: true, dataAsOf: "2026-10-18", realm: "Doomhowl", house: houseOf(url), fields: [], items: [[1, 10, 9, 11, 5, "2026-10-17", 3]] }));
  });
  const run = (now: string) => refreshMarket({ svFiles: [], followed: ["Doomhowl"], addonsDir: addons, endpoint: "https://everloot.app", send: send as unknown as typeof fetch, now: new Date(now) });
  expect((await run("2026-10-21T10:00:00Z")).drops).toBe(1);
  expect((await run("2026-10-21T11:00:00Z")).drops).toBe(1);
  expect(dropCalls).toBe(1);
  dropsUp = false;
  expect((await run("2026-10-22T11:00:00Z")).drops).toBe(1);
  expect(dropCalls).toBe(2);
  expect(readDropsBlock(addons)).toEqual({ dataAsOf: "2026-10-20T06:00:00.000Z", fetchedAt: "2026-10-21T10:00:00.000Z", rows: [[2589, "n", 116, 42, 340, 5]] });
  // The drops block is never read back as a realm.
  expect(readPricesFile(addons)!.realms.map((r) => [r.realm, r.house])).toEqual([["doomhowl", "Alliance"], ["doomhowl", "Horde"]]);
});
