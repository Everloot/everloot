import { afterEach, expect, test, vi } from "vitest";
vi.mock("@/lib/upload-store", () => ({ r2Config: () => ({ r2AccountId: "synthetic", r2Bucket: "synthetic" }), r2Client: () => ({ sign: async (url: string) => url }) }));
import { markOpsFreshness, readOpsContributorHints, readOpsSummary } from "./store";
import type { OpsSummary } from "./types";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test("page reads preserve source time and mark old good values stale", () => {
  const summary = { sources: { receipts: { status: "fresh", asOf: "2026-11-12T12:00:00Z", detail: "synthetic" } } } as unknown as OpsSummary;
  expect(markOpsFreshness(summary, Date.parse("2026-11-12T15:00:00Z")).sources.receipts).toMatchObject({ status: "stale", asOf: "2026-11-12T12:00:00Z" });
});
test("partial sources become stale after 90 minutes while preserving their coverage limitation", () => {
  const summary = { sources: { receipts: { status: "partial", asOf: "2026-11-12T12:00:00Z", detail: "Truncated; counts are lower bounds" } } } as unknown as OpsSummary;
  const source = markOpsFreshness(summary, Date.parse("2026-11-12T15:00:00Z")).sources.receipts;
  expect(source).toMatchObject({ status: "stale", asOf: "2026-11-12T12:00:00Z" });
  expect(source.detail).toContain("Truncated; counts are lower bounds");
  expect(source.detail).toContain("coverage remains partial");
});
test("exclusion changes hide previously computed contributor values until recomputation", async () => {
  vi.stubEnv("EVERLOOT_OPS_HMAC_SECRET", "synthetic-stable-secret");
  vi.stubEnv("EVERLOOT_OPS_EXCLUDED_INSTALLS", "[]");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), exclusionVersion: "old-config", sources: {}, contributors: [{ id: "a".repeat(64) }], activity: { today: 10 }, daily: [{ day: "synthetic" }], historical: { contributors: 10 } }))));
  const summary = await readOpsSummary();
  expect(summary?.activity.today).toBeNull();
  expect(summary?.contributors).toEqual([]);
  expect(summary?.sources.receipts.status).toBe("unavailable");
  expect(summary?.sources.receipts.detail).toContain("recomputation pending");
});
test("hint reads reject oversized objects and discard unexpected identity fields", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { headers: { "content-length": "1048577" } })));
  expect(await readOpsContributorHints()).toBeNull();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 1, generatedAt: "2026-11-12T12:00:00Z", contributors: [{ id: "a".repeat(64), realms: ["CAMWOW US1 Realm 4 PvP"], kinds: ["quest"], name: "must never join snapshot" }] }))));
  const hints = await readOpsContributorHints();
  expect(hints?.contributors[0]).not.toHaveProperty("name");
  expect(hints?.contributors[0].id).toBe("a".repeat(64));
});
