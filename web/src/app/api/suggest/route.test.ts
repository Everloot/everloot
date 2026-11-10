import { expect, test, vi } from "vitest";

const quota = vi.hoisted(() => ({ mcp: vi.fn() }));
const mocks = vi.hoisted(() => ({ names: { items: new Map([[2, "Thrall's Blade"]]), npcs: new Map([[77, "Thrall"]]), quests: new Map<number, string>() } }));
const loadNames = vi.hoisted(() => vi.fn(async () => mocks.names));
vi.mock("@/lib/names", () => ({ loadNames }));
// The real search, watched, so a test can tell whether one ran.
const search = vi.hoisted(() => ({ suggest: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("@/lib/site-search", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/site-search")>();
  search.suggest = vi.fn(real.suggest);
  return { ...real, suggest: search.suggest };
});
vi.mock("@/lib/objects", () => ({ loadObjectFacts: async () => ({ rates: [], measuredZeros: [], names: [], unreachable: false }) }));

vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { mcp: quota.mcp, api: vi.fn(), market: vi.fn() } }));

import { beforeEach } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  quota.mcp.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  loadNames.mockClear();
  search.suggest.mockClear();
});

const get = (query: string) => GET(new Request(`https://everloot.app/api/suggest${query}`));

test("answers up to 8 pages for what is typed, cached at the edge for a minute", async () => {
  const res = await get("?q=thrall");
  expect(res.headers.get("cache-control")).toContain("s-maxage=60");
  expect(res.headers.get("cdn-cache-control")).toBe("max-age=60");
  const body = await res.json();
  expect(body.results.map((r: { href: string }) => r.href)).toEqual(["/database/npcs/77", "/database/items/2"]);
  expect((await (await get("?q=thrall&in=item")).json()).results).toHaveLength(1);
  expect((await (await get("?q=")).json()).results).toEqual([]);
});

test("a wrong scope or an overlong query is a 400 that is not cached", async () => {
  for (const q of ["?q=a&in=zone", `?q=${"x".repeat(300)}`]) {
    const res = await get(q);
    expect(res.status, q).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  }
});

test("the query is trimmed and lower-cased, so the answer matches the edge key", async () => {
  const body = await (await get("?q=%20Thrall%20")).json();
  expect(body.q).toBe("thrall");
  expect(body.results.map((r: { href: string }) => r.href)).toEqual(["/database/npcs/77", "/database/items/2"]);
});

test("a caller over the per-IP quota gets a 429 with Retry-After that is not cached, and no search runs", async () => {
  quota.mcp.mockResolvedValue({ allowed: false, retryAfter: 90 });
  const res = await get("?q=thrall");
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("90");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(search.suggest).not.toHaveBeenCalled();
  expect(loadNames).not.toHaveBeenCalled();
  // The same query admitted does search, so the spies are wired to what the route calls.
  quota.mcp.mockResolvedValue({ allowed: true, retryAfter: 0 });
  expect((await get("?q=thrall")).status).toBe(200);
  expect(search.suggest).toHaveBeenCalledWith("thrall", undefined);
  expect(loadNames).toHaveBeenCalled();
});
