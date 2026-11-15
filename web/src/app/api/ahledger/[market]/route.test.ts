import { afterEach, expect, test, vi } from "vitest";
import { GET } from "./route";

const tooltip = {
  market: { slug: "forever/pvp/horde/us", label: "PvP Horde US" },
  items: [{ id: 2589, name: "Linen Cloth", icon: "https://render.worldofwarcraft.com/x.jpg", median: 43, minBuyout: 20, quantity: 9085, observedAt: "2026-11-15T15:03:06.000Z", salesPerDay: 18095.4 }],
};
const call = (market: string, query: string, headers: Record<string, string> = {}) =>
  GET(new Request(`https://everloot.app/api/ahledger/${market}${query}`, { headers }), { params: Promise.resolve({ market }) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("reads AH Ledger's tooltip with the key and answers the price fields with AH Ledger's lifetimes and credit", async () => {
  vi.stubEnv("AHLEDGER_API_KEY", "ahlk_test");
  const fetchImpl = vi.fn(async () => Response.json(tooltip, { headers: { "Cache-Control": "public, max-age=300, s-maxage=600" } }));
  vi.stubGlobal("fetch", fetchImpl);
  const res = await call("forever.pvp.horde.us", "?items=2589", { "sec-fetch-site": "same-origin" });
  expect(res.status).toBe(200);
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.ahledger.com/v1/tooltip/forever.pvp.horde.us?items=2589");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer ahlk_test");
  expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  expect(res.headers.get("cdn-cache-control")).toBe("max-age=600");
  expect(await res.json()).toEqual({
    ok: true, market: "forever.pvp.horde.us", label: "PvP Horde",
    prices: [{ itemId: 2589, minBuyout: 20, median: 43, quantity: 9085, salesPerDay: 18095.4, observedAt: "2026-11-15T15:03:06.000Z" }],
    credit: { text: "Prices from AHledger", url: "https://ahledger.com" },
  });
});

test("without a key it still reads, unauthenticated; an answer AH Ledger marks private is not cached", async () => {
  const fetchImpl = vi.fn(async () => Response.json(tooltip, { headers: { "Cache-Control": "private, max-age=60" } }));
  vi.stubGlobal("fetch", fetchImpl);
  const res = await call("forever.pvp.horde.us", "?items=2589");
  const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(init.headers).has("authorization")).toBe(false);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("cdn-cache-control")).toBeNull();
});

test("bad markets, bad items and other sites' pages are refused before AH Ledger is called", async () => {
  const fetchImpl = vi.fn();
  vi.stubGlobal("fetch", fetchImpl);
  expect((await call("forever.hardcore.horde.us", "?items=2589")).status).toBe(400);
  expect((await call("forever.pvp.horde.us", "?items=0")).status).toBe(400);
  expect((await call("forever.pvp.horde.us", "")).status).toBe(400);
  expect((await call("forever.pvp.horde.us", "?items=2589", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("AH Ledger busy is a 503 with its Retry-After; a failure is a 502; neither is cached", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429, headers: { "Retry-After": "12" } })));
  const busy = await call("forever.pvp.horde.us", "?items=2589");
  expect(busy.status).toBe(503);
  expect(busy.headers.get("retry-after")).toBe("12");
  expect(busy.headers.get("cache-control")).toBe("no-store");
  for (const answer of [async () => new Response("oops", { status: 500 }), async () => new Response("not json"), async () => { throw new TypeError("fetch failed"); }]) {
    vi.stubGlobal("fetch", vi.fn(answer));
    const res = await call("forever.pvp.horde.us", "?items=2589");
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  }
});
