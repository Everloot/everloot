import { afterEach, beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), api: vi.fn(), computeRollups: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: store.loadCorpus } }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { api: store.api } }));

import { GET } from "./route";
import { ANON_PAGE } from "@/lib/data-guard";
import { dropsResponse } from "@everloot/protocol";

const req = (query = "") => new Request(`https://everloot.app/api/rollups/drops${query}`);

beforeEach(() => {
  store.api.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock("@/lib/rollup-compute"); });

test("the drop API reports when its data was current, not only when it answered", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-09T10:00:00.000Z" });
  const body = await (await GET(req())).json();
  expect(body.dataAsOf).toBe("2026-10-09T10:00:00.000Z");
  expect(body.stats.dataAsOf).toBe("2026-10-09T10:00:00.000Z");
});

test("an unreadable store has no data time", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const body = await (await GET(req())).json();
  expect(body.unreachable).toBe(true);
  expect(body.dataAsOf).toBeNull();
});

test("every answer carries the licence and credit line, in the body and the headers", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-09T10:00:00.000Z" });
  const res = await GET(req());
  expect((await res.json()).attribution).toMatchObject({ licence: "CC BY-SA 4.0", source: "https://everloot.app/database/drops" });
  expect(res.headers.get("x-everloot-credit")).toBe("Data from Everloot (https://everloot.app), CC BY-SA 4.0.");
  expect(store.api).not.toHaveBeenCalled();
});

test("guard on: the drop list is paged for anonymous callers and limited per IP", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  vi.resetModules();
  const rate = (i: number) => ({ itemId: i, public: true });
  vi.doMock("@/lib/rollup-compute", () => ({
    computeRollups: async () => ({
      rates: Array.from({ length: 400 }, (_, i) => rate(i)),
      measuredZeros: Array.from({ length: 400 }, (_, i) => ({ itemId: 1000 + i, public: true })),
      stats: { unreachable: false, dataAsOf: null },
    }),
  }));
  const { GET: paged } = await import("./route");
  const body = await (await paged(req())).json();
  // Rates and measured zeros share one page: together never more than the cap.
  expect(body.rates).toHaveLength(400);
  expect(body.measuredZeros).toHaveLength(ANON_PAGE - 400);
  expect(body).toMatchObject({ total: 800, totalRates: 400, totalMeasuredZeros: 400, offset: 0, limit: ANON_PAGE });
  expect(body.next).toBe(`https://everloot.app/api/rollups/drops?offset=${ANON_PAGE}&limit=${ANON_PAGE}`);
  const rest = await (await paged(req(`?offset=${ANON_PAGE}`))).json();
  expect(rest.rates).toHaveLength(0);
  expect(rest.measuredZeros).toHaveLength(800 - ANON_PAGE);
  expect(rest.measuredZeros[0].itemId).toBe(1000 + ANON_PAGE - 400);
  expect(rest.next).toBeNull();
  store.api.mockResolvedValue({ allowed: false, retryAfter: 60 });
  expect((await paged(req())).status).toBe(429);
});

test("the body is the protocol's dropsResponse", async () => {
  const body = await (await GET(req())).json();
  expect(() => dropsResponse.parse(body)).not.toThrow();
});

test("each rate names its source when the site knows the name, so the price file can name sources a player never met", async () => {
  vi.resetModules();
  vi.doMock("@/lib/rollup-compute", () => ({
    computeRollups: async () => ({
      rates: [
        { sourceNpcId: 3114, itemId: 2589, kills: 8, drops: 2, rate: 0.25, reporters: 3, public: true },
        { sourceObjectId: 106318, itemId: 118, kills: 6, drops: 4, rate: 4 / 6, reporters: 3, public: true },
        { sourceObjectId: 693674, itemId: 286012, kills: 3, drops: 3, rate: 1, reporters: 3, public: true },
      ],
      measuredZeros: [],
      stats: { uploads: 3, lootWindows: 17, records: 40, unreachable: false, dataAsOf: null },
    }),
  }));
  vi.doMock("@/lib/names", () => ({
    loadNames: async () => ({ npcs: new Map([[3114, "Razormane Battleguard"]]), objects: new Map([[106318, "Battered Chest"]]), items: new Map(), quests: new Map() }),
  }));
  const { GET: named } = await import("./route");
  const body = await (await named(req())).json();
  expect(body.rates.map((r: { sourceName?: string }) => r.sourceName)).toEqual(["Razormane Battleguard", "Battered Chest", undefined]);
  expect(() => dropsResponse.parse(body)).not.toThrow();
  expect(dropsResponse.parse(body).rates[0]).toHaveProperty("sourceName", "Razormane Battleguard");
  vi.doUnmock("@/lib/names");
});
