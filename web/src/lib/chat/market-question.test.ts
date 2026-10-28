import { describe, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket, itemMarket, formatCopper as serverCopper } from "../../../../kb/src/market";
import { marketValueAnswer } from "../../../../kb/src/mcp-server";
import { FIXTURE_ANSWER, FIXTURE_ITEM, FIXTURE_LABEL, FIXTURE_REALM, FIXTURE_STRUCTURED, FIXTURE_URL } from "./market-fixture";
import { resolveItem } from "./items";
import { answerMarketQuestion, formatCopper, MARKET_ANSWER_BUDGET, MARKET_QUERY_BUDGET_MS, parseMarketQuestion, type MarketDeps } from "./market-question";

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
    // Polite prefixes are about a public item: the "me" in "tell me" is not the player's own goods.
    ["please tell me the price of Linen Cloth on Forever", { item: { name: "Linen Cloth" }, realm: "Forever" }],
    ["show me the price of 2589 on Forever", { item: { id: 2589 }, realm: "Forever" }],
    ["can you tell me the price of 2589 on Forever", { item: { id: 2589 }, realm: "Forever" }],
    ["could you show me the price of Linen Cloth on Forever", { item: { name: "Linen Cloth" }, realm: "Forever" }],
    ["Tell me what's Linen Cloth worth on Forever?", { item: { name: "Linen Cloth" }, realm: "Forever" }],
    ["hey show me the price of Linen Cloth in Nightslayer", { item: { name: "Linen Cloth" }, realm: "Nightslayer" }],
    // A whole item reference is read in full, so a long id is never cut to a shorter, different one.
    ["price item:9999999999 on Forever", { item: { id: 9999999999 }, realm: "Forever" }],
    // The candidate keeps its leading article: the item resolver tries the whole name first and drops a conversational article itself.
    ["price The Review Blade on Forever", { item: { name: "The Review Blade" }, realm: "Forever" }],
    ["The Review Blade price on Forever", { item: { name: "The Review Blade" }, realm: "Forever" }],
    ["how much is The Review Blade worth on Forever", { item: { name: "The Review Blade" }, realm: "Forever" }],
    ["what is the price of the Linen Cloth on Forever", { item: { name: "the Linen Cloth" }, realm: "Forever" }],
    ["price of a Linen Cloth on Forever", { item: { name: "a Linen Cloth" }, realm: "Forever" }],
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
    // Genuinely personal wording stays off the public route, polite or not.
    "show me the price of my gold",
    "tell me how much gold do I have",
    "please show me my Linen Cloth price on Forever",
    "tell me the price of Linen Cloth for me on Forever",
    "can you tell me what I paid, price of Linen Cloth on Forever",
  ])("passes %j through as not a price question", (question) => {
    expect(parseMarketQuestion(question)).toBeNull();
  });

  test.each([
    ["price item:0 on Forever", "0"],
    ["price |Hitem:0|h[Invalid]|h on Forever", "0"],
    ["price |Hitem:9007199254740993|h[Invalid]|h on Forever", "9007199254740993"],
    ["price https://everloot.app/database/items/9007199254740993 on Forever", "9007199254740993"],
    ["price item:10000000000 on Forever", "10000000000"],
    ["price item 0 on Forever", "0"],
    ["price item:02589 on Forever", "02589"],
    ["price 99999999999999999999 on Forever", "99999999999999999999"],
    ["price 0 on Forever", "0"],
  ])("%s is an invalid item reference, never a shorter or different id", (question, raw) => {
    expect(parseMarketQuestion(question)).toEqual({ item: { invalid: raw }, realm: "Forever" });
  });

  test("an id is only a bare number when price wording is present", () => {
    expect(parseMarketQuestion("2589")).toBeNull();
    expect(parseMarketQuestion("quest 2589 on Forever")).toBeNull();
  });

  test("a number too large to be an item id is not turned into one", () => {
    const intent = parseMarketQuestion("price 99999999999999999999 on Forever");
    expect(intent?.item).toEqual({ invalid: "99999999999999999999" });
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
    expect(d.lookup).toHaveBeenCalledWith("Forever", 2589, expect.any(AbortSignal));
    expect(d.resolveItem).not.toHaveBeenCalled();
  });

  test("a name that matches one item exactly is resolved to its id", async () => {
    const d = deps();
    const reply = await answerMarketQuestion("price of Linen Cloth on Forever", d);
    expect(d.resolveItem).toHaveBeenCalledWith("Linen Cloth", expect.any(AbortSignal));
    expect(d.lookup).toHaveBeenCalledWith("Forever", 2589, expect.any(AbortSignal));
    expect(reply!.text).toBe(FIXTURE_ANSWER);
  });

  describe("an item name that begins with an article, through the site's own resolver", () => {
    // A synthetic catalogue: a canonical label that starts with "The", and an ordinary one.
    const CATALOGUE = [{ type: "item", id: 2589, href: "/database/items/2589", label: "The Review Blade", quality: 3 }, { type: "item", id: 2590, href: "/database/items/2590", label: "Linen Cloth", quality: 1 }];
    const asked: string[] = [];
    const send = (async (url: string) => {
      const q = new URL(url, "http://x").searchParams.get("q")!;
      asked.push(q);
      return Response.json({ results: CATALOGUE.filter((r) => r.label.toLowerCase().includes(q.toLowerCase())) });
    }) as typeof fetch;
    const real = () => deps({ resolveItem: vi.fn((name: string, signal?: AbortSignal) => resolveItem(name, signal, send)) as never });

    test("a canonical name with its article is matched whole, in one search, to its own id", async () => {
      asked.length = 0;
      const d = real();
      const reply = await answerMarketQuestion("price The Review Blade on Forever", d);
      expect(asked).toEqual(["The Review Blade"]);
      expect(d.lookup).toHaveBeenCalledWith("Forever", 2589, expect.any(AbortSignal));
      expect(reply).toMatchObject({ kind: "connected", itemId: 2589 });
      expect(reply!.text).toContain("The Review Blade (item 2589)");
    });

    test("a conversational article is dropped by the resolver, after no exact name is found", async () => {
      asked.length = 0;
      const d = real();
      const reply = await answerMarketQuestion("what is the price of the Linen Cloth on Forever", d);
      expect(asked).toEqual(["the Linen Cloth", "Linen Cloth"]);
      expect(d.lookup).toHaveBeenCalledWith("Forever", 2590, expect.any(AbortSignal));
      expect(reply).toMatchObject({ itemId: 2590 });
    });
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
    expect(d.lookup).toHaveBeenLastCalledWith("Nightslayer", 2589, expect.any(AbortSignal));
    await answerMarketQuestion("price 2589 on Forever", d, { realm: "Nightslayer" });
    expect(d.lookup).toHaveBeenLastCalledWith("Forever", 2589, expect.any(AbortSignal));
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

  test.each([
    "price 99999999999999999999 on Forever",
    "price item:0 on Forever",
    "price |Hitem:0|h[Invalid]|h on Forever",
    "price |Hitem:9007199254740993|h[Invalid]|h on Forever",
    "price https://everloot.app/database/items/9007199254740993 on Forever",
    "price item:0",
  ])("%s is asked back: no item search, no lookup", async (question) => {
    const d = deps();
    const reply = await answerMarketQuestion(question, d);
    expect(reply).toMatchObject({ kind: "clarify", itemId: null });
    expect(reply!.text).toMatch(/item id is not valid/i);
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

  test("a thin newest day with no recent market says the market value is unrecorded, never zero, and does not blame the thin day", async () => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => ok({}, { market: null, thin: true, quantity: 3 })) as never }));
    expect(reply).toMatchObject({ kind: "thin" });
    expect(reply!.text).toMatch(/recent market value unrecorded/i);
    expect(reply!.text).toMatch(/newest public day is thin \(3 listed\)/i);
    expect(reply!.text).not.toMatch(/because/i);
    expect(reply!.text).not.toMatch(/market 0\b|\s0c each|\b0g\b/);
  });

  test("no recent market because the days are old is stale, not thin, and claims no cause it cannot know", async () => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => ok({}, { market: null, thin: false, ageDays: 11, day: "2026-10-09" })) as never }));
    expect(reply).toMatchObject({ kind: "stale" });
    expect(reply!.text).not.toMatch(/thin/i);
    expect(reply!.text).toMatch(/recent market value unrecorded/i);
    expect(reply!.text).not.toMatch(/no solid public day/i);
  });

  test("an old thin newest day is stale and says both things separately", async () => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => ok({}, { market: null, thin: true, quantity: 2, ageDays: 5, day: "2026-10-15" })) as never }));
    expect(reply).toMatchObject({ kind: "stale" });
    expect(reply!.text).toMatch(/recent market value unrecorded/i);
    expect(reply!.text).toMatch(/newest public day is thin \(2 listed\)/i);
    expect(reply!.text).toMatch(/5 days old/);
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
    ["a day that is not on the calendar (Feb 30)", ok({}, { day: "2026-02-30" })],
    ["a day with month 99", ok({}, { day: "2026-99-99" })],
    ["a day in month 0", ok({}, { day: "2026-00-10" })],
    ["April 31", ok({}, { day: "2026-04-31" })],
    ["one reporter, below the public minimum", ok({}, { reporters: 1 })],
    ["two reporters, below the public minimum", ok({}, { reporters: 2 })],
    ["no reporters", ok({}, { reporters: 0 })],
    ["a missing page", { connected: true, dataAsOf: null }],
    ["not an object", "oops"],
  ])("%s is unavailable, and says it is not a zero", async (_name, raw) => {
    const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => raw) as never }));
    expect(reply).toMatchObject({ kind: "unavailable" });
    expect(reply!.text).toMatch(/unrecorded, not zero|not zero/i);
  });

  test("the three-reporter minimum and a real calendar day are accepted, as is a leap day and the server's tolerated day ahead", async () => {
    for (const valueOver of [{ reporters: 3 }, { day: "2028-02-29" }, { day: "2026-10-21", ageDays: 0 }]) {
      const reply = await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => ok({}, valueOver)) as never }));
      expect(reply, JSON.stringify(valueOver)).toMatchObject({ kind: "connected" });
    }
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
    const max = Number.MAX_SAFE_INTEGER;
    const unrecorded = await answerMarketQuestion(long, deps({ lookup: vi.fn(async () => ok({ page: { realm } }, { market: null, min: max, historical: max, quantity: max, reporters: max, ageDays: max, thin: true })) as never }));
    expect(unrecorded!.text.length).toBeLessThanOrEqual(MARKET_ANSWER_BUDGET);
    expect(unrecorded!.text).toMatch(/recent market value unrecorded/);
    expect(unrecorded!.text).toMatch(/minimum .* historical /);
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

  // What the server really derives, fed back through the answer: the text must not claim more than the result says.
  const derived = async (closed: Record<string, [number, number, number, number]>) => {
    const own = emptyMarket();
    own.realms.forever = { name: FIXTURE_REALM, items: { [FIXTURE_ITEM]: { open: {}, closed } } };
    const { value, points } = itemMarket(own, FIXTURE_REALM, FIXTURE_ITEM, NOW);
    const raw = { connected: true, dataAsOf: NOW.toISOString(), page: { realm: FIXTURE_REALM, itemId: FIXTURE_ITEM, value, history: points } };
    return { value, reply: await answerMarketQuestion("price 2589 on Forever", deps({ lookup: vi.fn(async () => raw) as never })) };
  };

  test("an old solid day and a new thin one: no recent market, with the thin day described apart, not as the cause", async () => {
    const { value, reply } = await derived({ "2026-10-01": [100, 300, 100, 3], "2026-10-20": [100, 310, 3, 3] });
    expect(value).toMatchObject({ market: null, historical: 300, day: "2026-10-20", thin: true });
    expect(reply!.text).toMatch(/recent market value unrecorded/i);
    expect(reply!.text).toMatch(/newest public day is thin/i);
    expect(reply!.text).not.toMatch(/because/i);
  });

  test("an old solid run with a recent excluded outlier and a thin newest day claims neither a solid day nor a cause", async () => {
    const { value, reply } = await derived({
      "2026-10-01": [100, 300, 100, 3], "2026-10-02": [100, 300, 100, 3], "2026-10-03": [100, 300, 100, 3], "2026-10-04": [100, 300, 100, 3],
      "2026-10-19": [100, 30000, 100, 3], "2026-10-20": [100, 310, 3, 3],
    });
    expect(value?.market).toBeNull();
    expect(reply!.text).toMatch(/recent market value unrecorded/i);
    expect(reply!.text).not.toMatch(/no solid public day|because/i);
  });

  test("a day one day ahead of the server clock keeps its answer", async () => {
    const { value, reply } = await derived({ "2026-10-21": [100, 310, 100, 3] });
    expect(value).toMatchObject({ day: "2026-10-21", ageDays: 0 });
    expect(reply).toMatchObject({ kind: "connected" });
  });
});

describe("the query budget", () => {
  const stall = () => new Promise<never>(() => {});

  test("a name search that never settles ends as unavailable at the budget, with no lookup, though it ignores the signal", async () => {
    vi.useFakeTimers();
    try {
      const d = deps({ resolveItem: vi.fn(stall) as never });
      let reply: Awaited<ReturnType<typeof answerMarketQuestion>> | undefined;
      const pending = answerMarketQuestion("price of Linen Cloth on Forever", d).then((r) => { reply = r; });
      await vi.advanceTimersByTimeAsync(MARKET_QUERY_BUDGET_MS - 1);
      expect(reply).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(reply).toMatchObject({ kind: "unavailable", itemId: null, realm: "Forever", source: null });
      expect(reply!.text).toMatch(/unrecorded, not zero/);
      expect(d.lookup).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the budget covers the name search and the lookup together, not each", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const d = deps({
        resolveItem: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ id: FIXTURE_ITEM }), 20_000))) as never,
        lookup: vi.fn((_realm: string, _id: number, signal?: AbortSignal) => { seen = signal; return stall(); }) as never,
      });
      let reply: Awaited<ReturnType<typeof answerMarketQuestion>> | undefined;
      const pending = answerMarketQuestion("price of Linen Cloth on Forever", d).then((r) => { reply = r; });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(d.lookup).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(MARKET_QUERY_BUDGET_MS - 20_000 - 1);
      expect(reply).toBeUndefined();
      expect(seen?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(reply).toMatchObject({ kind: "unavailable", itemId: FIXTURE_ITEM, realm: "Forever", source: FIXTURE_URL });
      expect(seen?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a lookup that never settles is unavailable at the budget, and its own signal is aborted so the transport can clean up", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const d = deps({ lookup: vi.fn((_r: string, _i: number, signal?: AbortSignal) => { seen = signal; return stall(); }) as never });
      const pending = answerMarketQuestion("price 2589 on Forever", d);
      await vi.advanceTimersByTimeAsync(MARKET_QUERY_BUDGET_MS);
      expect(await pending).toMatchObject({ kind: "unavailable", itemId: 2589 });
      expect(seen?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the budget is thirty seconds", () => {
    expect(MARKET_QUERY_BUDGET_MS).toBe(30_000);
  });

  test("a caller's stop still ends the answer with the abort, even when the lookup ignores the signal", async () => {
    vi.useFakeTimers();
    try {
      const ctl = new AbortController();
      const d = deps({ lookup: vi.fn(stall) as never });
      const pending = answerMarketQuestion("price 2589 on Forever", d, { signal: ctl.signal });
      const outcome = pending.then(() => "reply", (err) => (err as Error).name);
      await vi.advanceTimersByTimeAsync(1_000);
      ctl.abort();
      expect(await outcome).toBe("AbortError");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a stop during the name search ends with the abort and never looks anything up", async () => {
    const ctl = new AbortController();
    const d = deps({ resolveItem: vi.fn(stall) as never });
    const pending = answerMarketQuestion("price of Linen Cloth on Forever", d, { signal: ctl.signal });
    const outcome = pending.then(() => "reply", (err) => (err as Error).name);
    ctl.abort();
    expect(await outcome).toBe("AbortError");
    expect(d.lookup).not.toHaveBeenCalled();
  });

  test("an answer that arrives in time leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      expect((await answerMarketQuestion("price 2589 on Forever", deps()))!.kind).toBe("connected");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
