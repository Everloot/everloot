import { describe, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket, itemMarket, formatCopper as serverCopper } from "../../../../kb/src/market";
import { marketValueAnswer } from "../../../../kb/src/mcp-server";
import { FIXTURE_ANSWER, FIXTURE_ITEM, FIXTURE_LABEL, FIXTURE_REALM, FIXTURE_STRUCTURED, FIXTURE_URL } from "./market-fixture";
import { answerMarketQuestion, formatCopper, MARKET_ANSWER_BUDGET, parseMarketQuestion, type MarketDeps } from "./market-question";

const LINK = "|cffffffff|Hitem:2589::::::::60:::::|h[Linen Cloth]|h|r";

describe("parseMarketQuestion", () => {
  test.each([
    ["price 2589 on Forever", { item: { id: 2589 }, realm: "Forever" }],
    ["What is the price of Linen Cloth on Forever?", { item: { name: "Linen Cloth" }, realm: "Forever" }],
    ["how much does Runecloth cost in Nightslayer", { item: { name: "Runecloth" }, realm: "Nightslayer" }],
    ["how much is Linen Cloth worth on Forever", { item: { name: "Linen Cloth" }, realm: "Forever" }],
    ["Linen Cloth price on Forever", { item: { name: "Linen Cloth" }, realm: "Forever" }],
    ["what's Linen Cloth worth", { item: { name: "Linen Cloth" }, realm: null }],
    ["market value of item:2589 on Forever", { item: { id: 2589 }, realm: "Forever" }],
    ["price of Linen Cloth", { item: { name: "Linen Cloth" }, realm: null }],
    ["price check 2589 on Dawn's Reach", { item: { id: 2589 }, realm: "Dawn's Reach" }],
    ["  price   2589   on   Forever . ", { item: { id: 2589 }, realm: "Forever" }],
    [`price ${LINK} on Forever`, { item: { id: 2589, label: "Linen Cloth" }, realm: "Forever" }],
    ["price of https://everloot.app/database/items/2589 on Forever", { item: { id: 2589 }, realm: "Forever" }],
    ["price of [Linen Cloth] on Forever", { item: { name: "Linen Cloth" }, realm: "Forever" }],
    ["price of Linen Cloth in the auction house", { item: { name: "Linen Cloth" }, realm: null }],
  ])("%s", (question, expected) => {
    expect(parseMarketQuestion(question)).toEqual(expected);
  });

  test.each([
    "Where does Linen Cloth drop?",
    "Who is Thrall?",
    "What is Linen Cloth?",
    "How much gold do I have?",
    "What is the price of my gold?",
    "Is Linen Cloth worth farming?",
    "Does Hogger drop anything worth selling?",
    "Tell me about item 2589",
    "How much is Linen Cloth?",
    "",
    "price",
  ])("passes %j through as not a price question", (question) => {
    expect(parseMarketQuestion(question)).toBeNull();
  });

  test("an id is only a bare number when price wording is present", () => {
    expect(parseMarketQuestion("2589")).toBeNull();
    expect(parseMarketQuestion("quest 2589 on Forever")).toBeNull();
  });

  test("a number too large to be an item id is not turned into one", () => {
    const intent = parseMarketQuestion("price 99999999999999999999 on Forever");
    expect(intent?.item).toEqual({ name: "99999999999999999999" });
  });
});

const ok = (over: { page?: Record<string, unknown> } = {}, valueOver: Record<string, unknown> = {}) => ({
  ...FIXTURE_STRUCTURED,
  page: { ...FIXTURE_STRUCTURED.page, ...over.page, value: { ...FIXTURE_STRUCTURED.page.value, ...valueOver } },
});

function deps(over: Partial<MarketDeps> = {}): MarketDeps & { resolveItem: ReturnType<typeof vi.fn>; lookup: ReturnType<typeof vi.fn> } {
  return {
    resolveItem: vi.fn(async () => ({ id: FIXTURE_ITEM })),
    lookup: vi.fn(async () => FIXTURE_STRUCTURED),
    ...over,
  } as never;
}

describe("answerMarketQuestion", () => {
  test("a question that is not about a price is left alone: no lookup, no item search", async () => {
    const d = deps();
    expect(await answerMarketQuestion("Where does Linen Cloth drop?", d)).toBeNull();
    expect(d.resolveItem).not.toHaveBeenCalled();
    expect(d.lookup).not.toHaveBeenCalled();
  });

  test("an item id and a realm answer from the market result alone, within the game's budget", async () => {
    const d = deps();
    const reply = await answerMarketQuestion(`price ${LINK} on Forever`, d);
    expect(reply).toMatchObject({ kind: "connected", itemId: 2589, realm: "Forever", source: FIXTURE_URL });
    expect(reply!.text).toBe(FIXTURE_ANSWER);
    expect(reply!.text.length).toBeLessThanOrEqual(MARKET_ANSWER_BUDGET);
    expect(d.lookup).toHaveBeenCalledTimes(1);
    expect(d.lookup).toHaveBeenCalledWith("Forever", 2589, undefined);
    expect(d.resolveItem).not.toHaveBeenCalled();
  });

  test("a name that matches one item exactly is resolved to its id", async () => {
    const d = deps();
    const reply = await answerMarketQuestion("price of Linen Cloth on Forever", d);
    expect(d.resolveItem).toHaveBeenCalledWith("Linen Cloth", undefined);
    expect(d.lookup).toHaveBeenCalledWith("Forever", 2589, undefined);
    expect(reply!.text).toBe(FIXTURE_ANSWER);
  });

  test("an id given without a name is labelled by its id", async () => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps());
    expect(reply!.text.startsWith("Item 2589 on Forever, all houses:")).toBe(true);
  });

  test("several matching items ask which one and look nothing up", async () => {
    const d = deps({ resolveItem: vi.fn(async () => ({ query: "Linen" })) as never });
    const reply = await answerMarketQuestion("price of Linen on Forever", d);
    expect(reply).toMatchObject({ kind: "clarify", itemId: null });
    expect(reply!.text).toMatch(/several items/i);
    expect(reply!.text).toMatch(/item id|shift-click/i);
    expect(d.lookup).not.toHaveBeenCalled();
  });

  test("an unknown name says so and looks nothing up", async () => {
    const d = deps({ resolveItem: vi.fn(async () => null) as never });
    const reply = await answerMarketQuestion("price of Nothing Here on Forever", d);
    expect(reply).toMatchObject({ kind: "clarify" });
    expect(reply!.text).toContain("Nothing Here");
    expect(d.lookup).not.toHaveBeenCalled();
  });

  test("no realm asks for one instead of guessing, and lists only realms the caller offers", async () => {
    const d = deps({ realmChoices: ["Forever", "Nightslayer"] });
    const reply = await answerMarketQuestion("price 2589", d);
    expect(reply).toMatchObject({ kind: "clarify", realm: null });
    expect(reply!.text).toMatch(/which realm/i);
    expect(reply!.text).toContain("Forever, Nightslayer");
    expect(d.lookup).not.toHaveBeenCalled();
  });

  test("the realm context fills a missing realm, and a realm in the question wins over it", async () => {
    const d = deps();
    await answerMarketQuestion("price 2589", d, { realm: "Nightslayer" });
    expect(d.lookup).toHaveBeenLastCalledWith("Nightslayer", 2589, undefined);
    await answerMarketQuestion("price 2589 on Forever", d, { realm: "Nightslayer" });
    expect(d.lookup).toHaveBeenLastCalledWith("Forever", 2589, undefined);
  });

  test("a realm context that is not a realm name is ignored, not used", async () => {
    const d = deps();
    const reply = await answerMarketQuestion("price 2589", d, { realm: "https://spam.example" });
    expect(reply).toMatchObject({ kind: "clarify" });
    expect(d.lookup).not.toHaveBeenCalled();
  });

  test("an explicit realm that is not a realm name is refused before any lookup", async () => {
    const d = deps();
    const reply = await answerMarketQuestion("price 2589 on a;b", d);
    expect(reply).toMatchObject({ kind: "clarify" });
    expect(d.lookup).not.toHaveBeenCalled();
  });

  test("an oversized id is not looked up or searched as a name", async () => {
    const d = deps();
    const reply = await answerMarketQuestion("price 99999999999999999999 on Forever", d);
    expect(reply).toMatchObject({ kind: "clarify" });
    expect(d.resolveItem).not.toHaveBeenCalled();
    expect(d.lookup).not.toHaveBeenCalled();
  });

  test("an old newest day keeps its numbers and is called stale", async () => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => ok({}, { ageDays: 9, day: "2026-10-11" })) as never }));
    expect(reply).toMatchObject({ kind: "stale" });
    expect(reply!.text).toMatch(/market 3s 10c/);
    expect(reply!.text).toMatch(/stale/i);
    expect(reply!.text).toContain("9 days");
  });

  test("a thin newest day with no recent market says the market value is unrecorded, never zero", async () => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => ok({}, { market: null, thin: true, quantity: 3 })) as never }));
    expect(reply).toMatchObject({ kind: "thin" });
    expect(reply!.text).toMatch(/unrecorded/i);
    expect(reply!.text).toMatch(/thin/i);
    expect(reply!.text).not.toMatch(/market 0\b|\s0c each|\b0g\b/);
  });

  test("no recent market because the days are old is stale, not thin", async () => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => ok({}, { market: null, thin: false, ageDays: 11, day: "2026-10-09" })) as never }));
    expect(reply).toMatchObject({ kind: "stale" });
    expect(reply!.text).not.toMatch(/thin/i);
    expect(reply!.text).toMatch(/unrecorded/i);
  });

  test("no public value yet is missing data with the page link, not a price", async () => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => ({ ...FIXTURE_STRUCTURED, url: undefined, page: { ...FIXTURE_STRUCTURED.page, value: null, history: [] } })) as never }));
    expect(reply).toMatchObject({ kind: "no-public", source: FIXTURE_URL });
    expect(reply!.text).toMatch(/3 reporters/);
    expect(reply!.text).toMatch(/not a price of zero|not zero/i);
  });

  test.each([
    ["not connected", { connected: false, dataAsOf: null, reason: "Market values unavailable. They are unrecorded, not zero." }],
    ["a result for another realm", ok({ page: { realm: "Nightslayer" } })],
    ["a result for another item", ok({ page: { itemId: 765 } })],
    ["a value for another item", ok({}, { itemId: 765 })],
    ["a malformed value", ok({}, { market: "310" })],
    ["a negative price", ok({}, { min: -5 })],
    ["a missing page", { connected: true, dataAsOf: null }],
    ["not an object", "oops"],
  ])("%s is unavailable, and says it is not a zero", async (_name, raw) => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => raw) as never }));
    expect(reply).toMatchObject({ kind: "unavailable" });
    expect(reply!.text).toMatch(/unrecorded, not zero|not zero/i);
  });

  test("a failing lookup is unavailable, not an error", async () => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => { throw new Error("socket hang up"); }) as never }));
    expect(reply).toMatchObject({ kind: "unavailable" });
    expect(reply!.text).not.toContain("socket");
  });

  test("a stop ends the answer with the abort, not with a reply", async () => {
    const ctl = new AbortController();
    const d = deps({ lookup: vi.fn(async () => { ctl.abort(); throw new DOMException("aborted", "AbortError"); }) as never });
    await expect(answerMarketQuestion("price 2589 on Forever", d, { signal: ctl.signal })).rejects.toThrow();
    const done = new AbortController();
    done.abort();
    await expect(answerMarketQuestion("price of Linen Cloth on Forever", deps(), { signal: done.signal })).rejects.toThrow();
  });

  test("the answer never outgrows the budget, even for the longest realm and item label", async () => {
    const realm = "A".repeat(40);
    const long = `price |Hitem:2589|h[${"L".repeat(80)}]|h on ${realm}`;
    const reply = await answerMarketQuestion(long, deps({ lookup: vi.fn(async () => ok({ page: { realm } }, { ageDays: 9 })) as never }));
    expect(reply!.text.length).toBeLessThanOrEqual(MARKET_ANSWER_BUDGET);
  });
});

describe("the same values as the server's derivation", () => {
  const NOW = new Date("2026-10-20T12:00:00Z");
  const scans = [100, 300, 500].map((unit, i) => ({
    kind: "auction_snapshot", installId: `install-${i}`, eventId: `e:${i}`, capturedAt: "2026-10-20T10:00:00Z", realm: FIXTURE_REALM,
    scanId: `s-${i}`, part: 1, parts: 1, items: [[FIXTURE_ITEM, 4, 80 + i * 20, unit, unit + 10]], reporter: String(i + 1).padStart(16, "0"),
  }));
  const state = foldMarket(emptyMarket(), scans, NOW);

  test("the shared fixture is what market_value derives from three scans", async () => {
    // The tool reads the clock itself: freeze it at the moment the fixture describes.
    vi.useFakeTimers({ now: NOW });
    const real = await marketValueAnswer({ realm: FIXTURE_REALM, itemId: FIXTURE_ITEM }, async () => ({ state, dataAsOf: "2026-10-20T06:30:00.000Z" })).finally(() => vi.useRealTimers());
    const structured = real.structured as { page: { value: unknown; history: unknown } };
    expect(structured.page.value).toEqual(FIXTURE_STRUCTURED.page.value);
    expect(structured.page.history).toEqual(FIXTURE_STRUCTURED.page.history);
    expect(itemMarket(state, FIXTURE_REALM, FIXTURE_ITEM, NOW).value).toMatchObject({ market: 310, min: 300, historical: 310 });
  });

  test("copper formatting is the server's", () => {
    for (const n of [0, 5, 99, 100, 1010, 9999, 10000, 12345, 1234567]) expect(formatCopper(n)).toBe(serverCopper(n));
  });

  test("the fixture's answer is the one the shared module writes", async () => {
    const d = deps({ lookup: vi.fn(async () => FIXTURE_STRUCTURED) as never });
    const reply = await answerMarketQuestion(`price ${FIXTURE_LABEL} on Forever`, d);
    expect(reply!.text).toBe(FIXTURE_ANSWER);
  });
});
