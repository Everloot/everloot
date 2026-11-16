import { afterEach, expect, test, vi } from "vitest";
import { GET } from "./route";
const call = (query = "", headers: Record<string, string> = {}) => GET(new Request(`https://everloot.app/api/ahledger/economy${query}`, { headers }));
afterEach(() => vi.unstubAllGlobals());

test("economy exposes only listed value comparisons and credit, with public cache headers", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ markets: [{ market: "forever.pvp.horde.us", current: { value: 30, topItems: [] }, weekAgo: { value: 20 } }], daily: [], attribution: { url: "https://ahledger.com/economy" } }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } }));
  vi.stubGlobal("fetch", fetchImpl);
  const res = await call();
  expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe("https://api.ahledger.com/v1/economy");
  expect(res.headers.get("CDN-Cache-Control")).toBe("max-age=300");
  expect(await res.json()).toEqual({ ok: true, markets: [{ market: "forever.pvp.horde.us", current: 30, weekAgo: 20 }], credit: { text: "Prices from AHledger", url: "https://ahledger.com/economy" } });
});

test("economy refuses query params and other sites before reading upstream", async () => {
  const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
  expect((await call("?market=bad")).status).toBe(400);
  expect((await call("", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("a malformed economy answer is a failed read, not an empty market list", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "unavailable" })));
  const res = await call();
  expect(res.status).toBe(502);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
});
