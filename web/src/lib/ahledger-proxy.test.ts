import { afterEach, expect, test, vi } from "vitest";
import { readAhledgerPage } from "./ahledger-proxy";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("a page read asks AH Ledger with the key, no fetch cache and a timeout, and keeps only what it selects", async () => {
  vi.stubEnv("AHLEDGER_API_KEY", "test_read_key");
  const fetchImpl = vi.fn(async () => Response.json({ recipes: [1, 2], secret: true, attribution: { url: "https://ahledger.com/crafting" } }));
  vi.stubGlobal("fetch", fetchImpl);
  const read = await readAhledgerPage("crafting/forever.normal.alliance.us?profession=Alchemy", (body) => (body as { recipes: number[] }).recipes.length);
  expect(read).toEqual({ ok: true, value: 2, credit: { text: "Prices from AHledger", url: "https://ahledger.com/crafting" } });
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.ahledger.com/v1/crafting/forever.normal.alliance.us?profession=Alchemy");
  expect(init.cache).toBe("no-store");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test_read_key");
});

test("a busy, failed, unreachable or unreadable answer is a failed page read, never an empty one", async () => {
  const select = (body: unknown) => { if (!(body as { recipes?: unknown }).recipes) throw new Error("unreadable"); return 1; };
  for (const answer of [
    async () => new Response("busy", { status: 429 }),
    async () => new Response("down", { status: 500 }),
    async () => { throw new TypeError("network"); },
    async () => Response.json({ notice: "key required" }),
  ]) {
    vi.stubGlobal("fetch", vi.fn(answer));
    expect(await readAhledgerPage("crafting/forever.normal.alliance.us?profession=Alchemy", select)).toEqual({ ok: false });
  }
});

/** A Cache API stand-in: keeps what is put under the key's URL, with the stored copy's Cache-Control. */
function fakeStore() {
  const kept = new Map<string, Response>();
  return {
    kept,
    match: vi.fn(async (key: Request) => kept.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, value: Response) => { kept.set(key.url, value); }),
  };
}
const market = "crafting/forever.normal.alliance.us?profession=Alchemy";
const select = (body: unknown) => ({ recipes: (body as { recipes: number[] }).recipes, asOf: "2026-11-24T05:45:44.000Z" });

test("every sort, filter and page of one market shares one AH Ledger read, kept no longer than AH Ledger allows and at most 120 s", async () => {
  const store = fakeStore();
  const fetchImpl = vi.fn(async () => Response.json({ recipes: [1, 2], secret: true }, { headers: { "Cache-Control": "public, max-age=600, s-maxage=900" } }));
  vi.stubGlobal("fetch", fetchImpl);
  // Two renders of the same market (one sorted by margin, one on page 2) ask for the same upstream path.
  const first = await readAhledgerPage(market, select, store);
  const second = await readAhledgerPage(market, select, store);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(second).toEqual(first);
  expect(second).toEqual({ ok: true, value: { recipes: [1, 2], asOf: "2026-11-24T05:45:44.000Z" }, credit: { text: "Prices from AHledger", url: "https://ahledger.com" } });
  const [key, copy] = store.put.mock.calls[0];
  expect(key.url).toBe(`https://api.ahledger.com/v1/${market}`);
  expect(copy.headers.get("Cache-Control")).toBe("public, max-age=120");
  // Only what the page selects is kept, never the rest of the answer.
  expect(await copy.clone().text()).not.toContain("secret");

  // A shorter AH Ledger lifetime is kept as it is; another market is its own read.
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ recipes: [3] }, { headers: { "Cache-Control": "public, max-age=60" } })));
  await readAhledgerPage("crafting/forever.pvp.horde.eu?profession=Alchemy", select, store);
  expect(store.put.mock.calls[1][1].headers.get("Cache-Control")).toBe("public, max-age=60");
});

test("an answer AH Ledger says not to keep, and every failure, is never kept", async () => {
  for (const answer of [
    async () => Response.json({ recipes: [1] }, { headers: { "Cache-Control": "no-store" } }),
    async () => Response.json({ recipes: [1] }, { headers: { "Cache-Control": "private, max-age=300" } }),
    async () => Response.json({ recipes: [1] }),
    async () => new Response("busy", { status: 429, headers: { "Cache-Control": "public, max-age=300" } }),
    async () => Response.json({ notice: "key required" }, { headers: { "Cache-Control": "public, max-age=300" } }),
  ]) {
    const store = fakeStore();
    const fetchImpl = vi.fn(answer);
    vi.stubGlobal("fetch", fetchImpl);
    await readAhledgerPage(market, (body) => { if (!(body as { recipes?: unknown }).recipes) throw new Error("unreadable"); return 1; }, store);
    await readAhledgerPage(market, (body) => { if (!(body as { recipes?: unknown }).recipes) throw new Error("unreadable"); return 1; }, store);
    expect(store.put).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  }
});

test("a cache that cannot be read or written never changes the live answer", async () => {
  const broken = { match: vi.fn(async () => { throw new Error("cache down"); }), put: vi.fn(async () => { throw new Error("cache down"); }) };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ recipes: [1] }, { headers: { "Cache-Control": "public, max-age=300" } })));
  expect(await readAhledgerPage(market, select, broken)).toMatchObject({ ok: true, value: { recipes: [1] } });
});
