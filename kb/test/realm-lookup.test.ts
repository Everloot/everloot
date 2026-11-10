import { MCP_TOOLS } from "@everloot/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { auctionHistory, handleAuctionHistory, type AuctionSighting } from "../src/auction-history.js";
import { openDb, type DB } from "../src/db.js";
import { emptyMarket, foldMarket, handleMarketValue, resolveRealm, type MarketState } from "../src/market.js";
import { createToolHandlers, type ToolOptions } from "../src/mcp-server.js";

/**
 * market_value and auction_history read a realm name the same way (resolveRealm), and list the same public full-scan
 * days. The fixture is the audit's case: Linen Cloth on CAMWOW US1 Realm 4 PvP, scanned by one of Everloot's own installs.
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
    reporter: "0123456789abcdef", scanId: `s-${daysAgo}`, part: 1, parts: 1, items: [item],
  };
}

/** Four days of one trusted install's full scans of Linen on `realm`. */
const fourDays = (realm: string) => [5, 4, 3, 2].map((n) => snapshot(realm, n, [LINEN, 40, 5000 + n * 100, 13 + n, 25]));

function market(...realms: string[]): MarketState {
  return foldMarket(emptyMarket(), realms.flatMap(fourDays), now, {}, undefined, new Set([OWN]));
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
