import { MCP_TOOLS } from "@everloot/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { auctionHistory, handleAuctionHistory, type AuctionSighting } from "../src/auction-history.js";
import { openDb, type DB } from "../src/db.js";
import { emptyMarket, foldMarket, handleMarketValue, resolveRealm, type MarketState } from "../src/market.js";
import { createToolHandlers, type ToolOptions } from "../src/mcp-server.js";

/**
 * market_value and auction_history read a realm name the same way (resolveRealm), and list the same public full-scan
 * days. The fixture is the audit's case: Linen Cloth on CAMWOW US1 Realm 4 PvP, scanned by one of Everloot's own installs
 * at the Horde auction house (each house is its own market, and market_value reads houses, never a mix).
 */

const US = "CAMWOW US1 Realm 4 PvP";
const EU = "CAMWOW EU1 Realm 4 PvP";
const RPPVP = "CAMWOW US1 Realm 9 RP-PvP";
const LINEN = 2589;
const OWN = "install-own";
const now = new Date();
const dayAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

function snapshot(realm: string, daysAgo: number, item: [number, number, number, number, number], installId = OWN) {
  return {
    kind: "auction_snapshot", installId, eventId: `${installId}:${realm}:${daysAgo}`, capturedAt: dayAgo(daysAgo), realm,
    reporter: "0123456789abcdef", scanId: `s-${daysAgo}`, part: 1, parts: 1, house: "Horde", items: [item],
  };
}

/** Four days of one trusted install's full scans of Linen on `realm`. */
const fourDays = (realm: string) => [5, 4, 3, 2].map((n) => snapshot(realm, n, [LINEN, 40, 5000 + n * 100, 13 + n, 25]));

function market(...realms: string[]): MarketState {
  return foldMarket(emptyMarket(), realms.flatMap(fourDays), now, {}, undefined, new Set([OWN]));
}

/** Four days of one trusted install's full scans of Linen on `realm` in `house` (none: a scan that recorded no house), `units` listed. */
function houseScans(realm: string, house: "Alliance" | "Horde" | "Neutral" | null, units: number) {
  return [5, 4, 3, 2].map((n) => {
    const { house: _kept, ...scan } = snapshot(realm, n, [LINEN, 40, units, 13 + n, 25]);
    return { ...scan, eventId: `${scan.eventId}:${house ?? "none"}`, scanId: `${scan.scanId}-${house ?? "none"}`, ...(house ? { house } : {}) };
  });
}

function houseMarket(...scans: ReturnType<typeof houseScans>[]): MarketState {
  return foldMarket(emptyMarket(), scans.flat(), now, {}, undefined, new Set([OWN]));
}

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function handlers(state: MarketState, options: ToolOptions = {}) {
  const db = openDb(":memory:");
  databases.push(db);
  return createToolHandlers(db, { market: async () => ({ state, dataAsOf: "2026-11-10T07:50:00.000Z" }), ...options });
}

const MARKET_OUT = z.object(MCP_TOOLS.market_value.outputSchema);
const HISTORY_OUT = z.object(MCP_TOOLS.auction_history.outputSchema);

async function answerOf(h: ReturnType<typeof handlers>, tool: "market_value" | "auction_history", realm: string) {
  const answer = await h[tool]({ realm, itemId: LINEN });
  if (typeof answer === "string") throw new Error("expected a structured answer");
  return answer;
}

async function call(h: ReturnType<typeof handlers>, tool: "market_value", realm: string): Promise<{ text: string; structured: z.infer<typeof MARKET_OUT> }>;
async function call(h: ReturnType<typeof handlers>, tool: "auction_history", realm: string): Promise<{ text: string; structured: z.infer<typeof HISTORY_OUT> }>;
async function call(h: ReturnType<typeof handlers>, tool: "market_value" | "auction_history", realm: string) {
  const answer = await answerOf(h, tool, realm);
  return { text: answer.text, structured: (tool === "market_value" ? MARKET_OUT : HISTORY_OUT).parse(answer.structured) };
}

test("a name the rollup holds is exact, in any case", () => {
  expect(resolveRealm(market(US), "camwow us1 realm 4 pvp", now)).toEqual({ status: "exact", realm: US });
});

test("the end of exactly one realm's full name resolves to it", () => {
  expect(resolveRealm(market(US), "US1 Realm 4 PvP", now)).toEqual({ status: "alias", realm: US, asked: "US1 Realm 4 PvP" });
  expect(resolveRealm(market(US, EU), " us1 realm 4 PVP ", now)).toEqual({ status: "alias", realm: US, asked: "us1 realm 4 PVP" });
});

test("the end of several realms' names is ambiguous and reads neither", () => {
  const state = market(US, EU);
  expect(resolveRealm(state, "Realm 4 PvP", now)).toEqual({ status: "ambiguous", asked: "Realm 4 PvP", candidates: [EU, US] });
  const text = handleMarketValue({ realm: "Realm 4 PvP", itemId: LINEN }, state, now);
  expect(text).toContain(`Ambiguous realm "Realm 4 PvP"`);
  expect(text).toContain(`${EU}, ${US}`);
  expect(text).not.toMatch(/Market value:|No public market value/);
});

test("an unknown realm says so with the closest realms, never an empty market", () => {
  const state = market(US, RPPVP);
  // Not the end of a name in whole words, a single word, or another ruleset: none is an alias.
  for (const asked of ["Realm 4", "PvP", "Realm 9 PvP", "US1 Realm 4 PvE"]) {
    expect(resolveRealm(state, asked, now).status, asked).toBe("unknown");
  }
  const lookup = resolveRealm(state, "US1 Realm 4 PvE", now);
  expect(lookup).toMatchObject({ status: "unknown", candidates: [US, RPPVP] });
  const text = handleMarketValue({ realm: "US1 Realm 4 PvE", itemId: LINEN }, state, now);
  expect(text).toContain(`Unknown realm "US1 Realm 4 PvE"`);
  expect(text).toContain("not a measured empty market");
  expect(text).toContain(`Closest realms with public prices: ${US}, ${RPPVP}`);
  expect(text).not.toContain("No public market value");
  expect(resolveRealm(emptyMarket(), "Anything Here", now)).toEqual({ status: "unknown", asked: "Anything Here", candidates: [] });
});

test("market_value answers an alias with the full realm's figures and says how it read the name", async () => {
  const h = handlers(market(US, RPPVP));
  const exact = await call(h, "market_value", US);
  const alias = await call(h, "market_value", "US1 Realm 4 PvP");
  expect(exact.structured.page).toMatchObject({ realm: US, realmStatus: "exact" });
  expect(alias.structured.page).toMatchObject({ realm: US, realmStatus: "alias", askedRealm: "US1 Realm 4 PvP" });
  expect(alias.structured.page!.value).toEqual(exact.structured.page!.value);
  expect(alias.structured.page!.history).toHaveLength(4);
  expect(alias.structured.url).toBe(exact.structured.url);
  expect(alias.text).toContain(`Read "US1 Realm 4 PvP" as ${US}`);
  expect(alias.text).toContain("Market value: 25c");

  const unknown = await call(h, "market_value", "US1 Realm 4 PvE");
  expect(unknown.structured.page).toMatchObject({ realm: "US1 Realm 4 PvE", value: null, history: [], realmStatus: "unknown", candidates: [US, RPPVP] });
  expect(unknown.structured.url).toBeUndefined();
});

test("auction_history lists the same public days as market_value for the same realm and item", async () => {
  const sightings = [5, 4].map((n, i) => ({
    kind: "auction_scan", installId: OWN, eventId: `b-${i}`, capturedAt: dayAgo(n), realm: US, itemId: LINEN, copper: 20 + i, priceBasis: "unit",
  }));
  const h = handlers(market(US), { corpus: async () => ({ records: sightings, dataAsOf: "2026-11-10T07:50:00.000Z" }), trusted: new Set([OWN]) });
  for (const realm of [US, "US1 Realm 4 PvP"]) {
    const value = await call(h, "market_value", realm);
    const history = await call(h, "auction_history", realm);
    expect(history.structured.page!.scanDays, realm).toEqual(value.structured.page!.history);
    expect(history.structured.page!.scanDays).toHaveLength(4);
    expect(history.structured.page!.realm).toBe(US);
    // Every history line market_value prints, auction_history prints too.
    const valueLines = value.text.split("\n").filter((line) => /^\d{4}-\d{2}-\d{2} {2}value/.test(line));
    expect(valueLines).toHaveLength(4);
    for (const line of valueLines) expect(history.text).toContain(line);
    expect(history.text).toContain("1 reporter (includes Everloot's own scans)");
    expect(history.text).not.toContain("Price unrecorded");
  }
  // The browsing days follow the same trusted-install rule: one own install's day is public, labelled.
  const page = (await call(h, "auction_history", US)).structured.page!;
  expect(page.points).toEqual([{ day: dayAgo(5).slice(0, 10), copper: 20, reporters: 1 }, { day: dayAgo(4).slice(0, 10), copper: 21, reporters: 1 }]);
});

test("auction_history resolves the realm before reading the stored days, and an unknown realm is not an empty history", async () => {
  const stored = vi.fn(async () => ({ points: [], dataAsOf: null }));
  const h = handlers(market(US, EU), { auctionHistory: stored });
  await call(h, "auction_history", "US1 Realm 4 PvP");
  expect(stored).toHaveBeenLastCalledWith(US, LINEN);

  const unknown = await call(h, "auction_history", "Realm 4");
  expect(unknown.text).toContain(`Unknown realm "Realm 4"`);
  expect(unknown.text).not.toContain("Price unrecorded");
  expect(unknown.structured.page).toMatchObject({ realm: "Realm 4", points: [], realmStatus: "unknown" });

  const ambiguous = await call(h, "auction_history", "Realm 4 PvP");
  expect(ambiguous.structured.page).toMatchObject({ realmStatus: "ambiguous", candidates: [EU, US] });
});

test("an ambiguous realm returns no price from stored or corpus browsing history, for either tool", async () => {
  const ASKED = "Realm 4 PvP";
  const state = market(US, EU);
  // Browsing points exist under the literal input, public by the trusted-install rule.
  const sightings = [5, 4].map((n, i) => ({
    kind: "auction_scan", installId: OWN, eventId: `amb-${i}`, capturedAt: dayAgo(n), realm: ASKED, itemId: LINEN, copper: 25, priceBasis: "unit",
  }));
  const stored = vi.fn(async () => ({ points: [{ day: dayAgo(3).slice(0, 10), copper: 25, reporters: 3 }], dataAsOf: "2026-11-10T07:50:00.000Z" }));
  const paths = {
    stored: handlers(state, { auctionHistory: stored, trusted: new Set([OWN]) }),
    corpus: handlers(state, { corpus: async () => ({ records: sightings, dataAsOf: "2026-11-10T07:50:00.000Z" }), trusted: new Set([OWN]) }),
  };
  for (const [path, h] of Object.entries(paths)) {
    const history = await call(h, "auction_history", ASKED);
    expect(history.structured.page, path).toMatchObject({ realm: ASKED, points: [], scanDays: [], realmStatus: "ambiguous", candidates: [EU, US] });
    expect(history.structured.url, path).toBeUndefined();
    expect(history.text, path).toContain(`Ambiguous realm "${ASKED}"`);
    expect(history.text, path).not.toMatch(/\d+c|Price unrecorded|reporter/);

    const value = await call(h, "market_value", ASKED);
    expect(value.structured.page, path).toMatchObject({ realm: ASKED, value: null, history: [], realmStatus: "ambiguous", candidates: [EU, US] });
    expect(value.structured.url, path).toBeUndefined();
    expect(value.text, path).toContain(`Ambiguous realm "${ASKED}"`);
    expect(value.text, path).not.toMatch(/Market value:|\d+c/);
  }
  // The stored reader is never asked about a name that is not one realm's.
  expect(stored).not.toHaveBeenCalled();
});

test("browsing days a realm the rollup lacks still answer, without the unknown-realm note", async () => {
  const sightings = ["a", "b", "c"].map((installId, i) => ({
    kind: "auction_scan", installId, eventId: `x-${i}`, capturedAt: dayAgo(3), realm: "Browse Only", itemId: LINEN, copper: 30, priceBasis: "unit",
  }));
  const h = handlers(market(US), { corpus: async () => ({ records: sightings, dataAsOf: null }) });
  const answer = await call(h, "auction_history", "Browse Only");
  expect(answer.text).not.toContain("Unknown realm");
  expect(answer.structured.page!.points).toHaveLength(1);
});

test("a browsing day is public with one of Everloot's own installs, as in the market; strangers still need 3", () => {
  const day = (installId: string, copper: number): AuctionSighting => ({ installId, realm: "Forever", itemId: 1, copper, seenAt: "2026-11-05T12:00:00.000Z" });
  const trusted = new Set([OWN]);
  expect(auctionHistory("Forever", 1, [day(OWN, 10)]).points).toEqual([]);
  expect(auctionHistory("Forever", 1, [day(OWN, 10)], trusted).points).toEqual([{ day: "2026-11-05", copper: 10, reporters: 1 }]);
  expect(auctionHistory("Forever", 1, [day("x", 10), day("y", 20)], trusted).points).toEqual([]);
  expect(handleAuctionHistory({ realm: "Forever", itemId: 1 }, [day(OWN, 10)], trusted)).toContain("2026-11-05  10c  1 reporter (includes Everloot's own scans)");
});

test("both tools read the house with the most units listed, name it, and agree on its days", async () => {
  // Alliance 100 units a day, Horde 300: the Horde days are the ones both tools carry.
  const state = houseMarket(houseScans(US, "Alliance", 100), houseScans(US, "Horde", 300));
  const h = handlers(state);
  const value = await call(h, "market_value", US);
  const history = await call(h, "auction_history", US);
  const horde = value.structured.page!.history;
  expect(horde).toHaveLength(4);
  expect(horde.every((day) => day.quantity === 300)).toBe(true);
  expect(value.structured.page!.value).toMatchObject({ quantity: 300 });
  expect(history.structured.page!.scanDays).toEqual(horde);
  expect(history.text).toContain("in the Horde auction house");
  expect(history.text).not.toContain("in the Alliance auction house");
  // market_value's text still shows both houses, and says which one its page carries.
  expect(value.text).toContain("Alliance auction house:");
  expect(value.text).toContain("Horde auction house:");
  expect(value.text).toContain("The structured page carries the Horde auction house (most units listed");
});

test("a tie in units listed goes to Alliance, then Horde, then Neutral, in both tools", async () => {
  const state = houseMarket(houseScans(US, "Neutral", 200), houseScans(US, "Horde", 200), houseScans(US, "Alliance", 200));
  const h = handlers(state);
  const value = await call(h, "market_value", US);
  const history = await call(h, "auction_history", US);
  expect(value.text).toContain("The structured page carries the Alliance auction house");
  expect(history.text).toContain("in the Alliance auction house");
  expect(history.structured.page!.scanDays).toEqual(value.structured.page!.history);
  // Without Alliance the tie goes to Horde.
  const noAlliance = handlers(houseMarket(houseScans(US, "Neutral", 200), houseScans(US, "Horde", 200)));
  expect((await call(noAlliance, "market_value", US)).text).toContain("The structured page carries the Horde auction house");
  expect((await call(noAlliance, "auction_history", US)).text).toContain("in the Horde auction house");
});

test("scans that recorded no house are in no house's days, for either tool", async () => {
  // The house-less scans list 900 units, more than the Horde's 300, but they are no house's market.
  const state = houseMarket(houseScans(US, "Horde", 300), houseScans(US, null, 900));
  const h = handlers(state);
  const value = await call(h, "market_value", US);
  const history = await call(h, "auction_history", US);
  expect(value.structured.page!.value).toMatchObject({ quantity: 300 });
  expect(history.structured.page!.scanDays).toEqual(value.structured.page!.history);
  expect(value.structured.page!.history.every((day) => day.quantity === 300)).toBe(true);
  expect(history.text).toContain("in the Horde auction house");

  // A realm held only by house-less scans shows no days at all.
  const only = handlers(houseMarket(houseScans(US, null, 900)));
  const noValue = await call(only, "market_value", US);
  const noHistory = await call(only, "auction_history", US);
  expect(noValue.structured.page).toMatchObject({ value: null, history: [] });
  expect(noValue.text).toContain("No public market value yet in any auction house");
  expect(noValue.text).not.toContain("The structured page carries");
  expect(noHistory.structured.page!.scanDays).toEqual([]);
  expect(noHistory.text).toContain("No public day yet");
});

test("a realm held only by house-less scans is never an alias, an ambiguity or a candidate", async () => {
  // EU holds house-less scans only: no price is public there, so no name resolves to it, and none suggests it.
  const state = houseMarket(houseScans(US, "Horde", 300), houseScans(EU, null, 300));
  expect(resolveRealm(state, "Realm 4 PvP", now)).toEqual({ status: "alias", realm: US, asked: "Realm 4 PvP" });
  expect(resolveRealm(state, "EU1 Realm 4 PvP", now)).toMatchObject({ status: "unknown", candidates: [US] });
  const h = handlers(state);
  const answers = { market_value: await call(h, "market_value", "EU1 Realm 4 PvE"), auction_history: await call(h, "auction_history", "EU1 Realm 4 PvE") };
  for (const [tool, answer] of Object.entries(answers)) {
    expect(answer.structured.page, tool).toMatchObject({ realmStatus: "unknown", candidates: [US] });
    expect(answer.text, tool).not.toContain(EU);
  }
});
