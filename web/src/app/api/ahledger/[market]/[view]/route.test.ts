import { afterEach, expect, test, vi } from "vitest";
import { GET } from "./route";

const market = "forever.pvp.horde.us";
const history = { item: { id: 42, name: "Test item" }, attribution: { url: "https://ahledger.com/items/42", html: "discard" }, latest: { median7d: 10, median30d: 12, median90d: 14 }, sales: { estimatedPerDay: 3, windowDays: 7 }, series: [] };
const call = (view: string, query = "", headers: Record<string, string> = {}, m = market) => GET(new Request(`https://everloot.app/api/ahledger/${m}/${view}${query}`, { headers }), { params: Promise.resolve({ market: m, view }) });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("history requests exactly 30 days with key, timeout and private browser-only cache", async () => {
  vi.stubEnv("AHLEDGER_API_KEY", "test_read_key");
  const fetchImpl = vi.fn(async () => Response.json(history, { headers: { "Cache-Control": "private, max-age=60" } }));
  vi.stubGlobal("fetch", fetchImpl);
  const res = await call("history", "?item=42", { "sec-fetch-site": "same-origin" });
  expect(res.status).toBe(200);
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`https://api.ahledger.com/v1/prices/${market}/42?range=30d`);
  expect(init.cache).toBe("no-store");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(new Headers(init.headers).get("User-Agent")).toBe("Everloot (https://everloot.app)");
  expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test_read_key");
  expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
  expect(res.headers.has("CDN-Cache-Control")).toBe(false);
  expect(await res.json()).toEqual({ ok: true, history: { median7d: 10, median30d: 12, salesPerDay: 3, windowDays: 7, series: [] }, credit: { text: "Prices from AHledger", url: "https://ahledger.com/items/42" } });
});

test("crafting and deals have allow-listed paths and keep public lifetimes without extra fields", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ recipes: [], deals: [], ignored: true, attribution: { url: "https://evil.test" } }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } }));
  vi.stubGlobal("fetch", fetchImpl);
  for (const [view, query, path, field] of [["crafting", "?profession=First%20Aid", `crafting/${market}?profession=First%20Aid`, "recipes"], ["deals", "", `deals/${market}?pct=25&units=5`, "deals"]]) {
    const res = await call(view, query);
    expect((fetchImpl.mock.calls.at(-1) as unknown[])[0]).toBe(`https://api.ahledger.com/v1/${path}`);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("CDN-Cache-Control")).toBe("max-age=300");
    expect(await res.json()).toEqual({ ok: true, [field]: [], credit: { text: "Prices from AHledger", url: "https://ahledger.com" } });
  }
});

test("invalid input and cross-site requests never call upstream", async () => {
  const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
  for (const [view, query] of [["history", ""], ["history", "?item=0"], ["history", "?item=42,43"], ["history", "?item=42&range=90d"], ["history", "?item=42&item=43"], ["crafting", "?profession=Fishing"], ["crafting", "?profession=Enchanting&all=true"], ["deals", "?units=1"], ["tooltip", ""], ["../markets", ""]]) expect((await call(view, query)).status).toBe(400);
  expect((await call("history", "?item=42", {}, "bad")).status).toBe(400);
  for (const site of ["cross-site", "same-site", "none"]) expect((await call("history", "?item=42", { "sec-fetch-site": site })).status).toBe(403);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("busy responses retain Retry-After and all upstream failures stay uncached", async () => {
  for (const status of [429, 503]) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status, headers: { "Retry-After": "12" } })));
    const res = await call("deals");
    expect(res.status).toBe(503); expect(res.headers.get("Retry-After")).toBe("12");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  }
  for (const answer of [async () => new Response("oops", { status: 401 }), async () => new Response("not json"), async () => Response.json({ notice: "key needed" }), async () => { throw new DOMException("Timeout", "TimeoutError"); }]) {
    vi.stubGlobal("fetch", vi.fn(answer));
    const res = await call("history", "?item=42");
    expect(res.status).toBe(502); expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.has("CDN-Cache-Control")).toBe(false);
  }
});
