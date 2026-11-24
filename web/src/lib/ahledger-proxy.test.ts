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
