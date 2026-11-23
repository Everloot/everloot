import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/blue-store", async (actual) => ({ ...(await actual<object>()), readBlueStore: vi.fn(), writeBlueStore: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@kb/blue-posts", () => ({ ingestBluePosts: vi.fn() }));
import { GET } from "./route";
import { readBlueStore, STORE_TIMEOUT_MS, writeBlueStore } from "@/lib/blue-store";
import { CANCEL_MS, REQUEST_TIMEOUT_MS, RUN_BUDGET_MS, WORK_ENDS_MS, WRITE_RESERVE_MS } from "./budget";
import { revalidateTag } from "next/cache";
import { ingestBluePosts } from "@kb/blue-posts";
import posts from "../../../../../../kb/changes/blue-posts.json";
import type { BluePost } from "@kb/blue-posts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

const authorized = () => new Request("https://everloot.app/api/cron/blue", { headers: { authorization: "Bearer test-secret" } });

it("refuses to run without CRON_SECRET, even with a bearer", async () => {
  vi.stubEnv("CRON_SECRET", "");
  const response = await GET(new Request("https://everloot.app/api/cron/blue", { headers: { authorization: "Bearer undefined" } }));
  expect(response.status).toBe(503);
  expect(readBlueStore).not.toHaveBeenCalled();
});

it.each([undefined, "Bearer wrong"])("refuses unauthorized requests: %s", async (authorization) => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  const response = await GET(new Request("https://everloot.app/api/cron/blue", { headers: authorization ? { authorization } : {} }));
  expect(response.status).toBe(401);
  expect(readBlueStore).not.toHaveBeenCalled();
});

it.each([false, true])("persists both stores and invalidates only with added posts: %s", async (added) => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  const store = { posts: [], fetched: {} };
  vi.mocked(readBlueStore).mockResolvedValue(store);
  vi.mocked(ingestBluePosts).mockResolvedValue({ store, added: added ? [posts.posts[0] as BluePost] : [], skipped: [], errors: [], requests: { list: 8, robots: 2 } });
  const response = await GET(new Request("https://everloot.app/api/cron/blue", { headers: { authorization: "Bearer test-secret" } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, fetched: 10, added: added ? 1 : 0, requests: { list: 8, robots: 2 } });
  expect(ingestBluePosts).toHaveBeenCalledWith(expect.objectContaining({ store, minIntervalMs: 480_000, deadlineMs: WORK_ENDS_MS }));
  expect(writeBlueStore).toHaveBeenCalledWith(store, expect.any(Number));
  expect(revalidateTag).toHaveBeenCalledTimes(added ? 1 : 0);
  if (added) expect(revalidateTag).toHaveBeenCalledWith("blue");
});

it("passes a one-off rescanSince to the reader, and refuses one that is not a time", async () => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  const store = { posts: [], fetched: {} };
  vi.mocked(readBlueStore).mockResolvedValue(store);
  vi.mocked(ingestBluePosts).mockResolvedValue({ store, added: [], skipped: [], errors: [], requests: {} });
  const at = (query: string) => GET(new Request(`https://everloot.app/api/cron/blue${query}`, { headers: { authorization: "Bearer test-secret" } }));
  expect((await at("?rescanSince=2026-11-13")).status).toBe(200);
  expect(ingestBluePosts).toHaveBeenLastCalledWith(expect.objectContaining({ rescanSince: "2026-11-13T00:00:00.000Z" }));
  expect((await at("")).status).toBe(200);
  expect(vi.mocked(ingestBluePosts).mock.lastCall![0].rescanSince).toBeUndefined();
  const calls = vi.mocked(ingestBluePosts).mock.calls.length;
  expect((await at("?rescanSince=soon")).status).toBe(400);
  expect(ingestBluePosts).toHaveBeenCalledTimes(calls);
});

it("does not invalidate when storage fails", async () => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.mocked(readBlueStore).mockRejectedValueOnce(new Error("unavailable"));
  const response = await GET(new Request("https://everloot.app/api/cron/blue", { headers: { authorization: "Bearer test-secret" } }));
  expect(response.status).toBe(500);
  expect(writeBlueStore).not.toHaveBeenCalled();
  expect(revalidateTag).not.toHaveBeenCalled();
});

it("fits read, work, one late request and both writes under the cancel point", () => {
  // A read that succeeds ends before the work window does, so it can shorten the work but never the writes.
  expect(STORE_TIMEOUT_MS).toBeLessThan(WORK_ENDS_MS);
  expect(WORK_ENDS_MS + REQUEST_TIMEOUT_MS + WRITE_RESERVE_MS).toBe(RUN_BUDGET_MS);
  expect(RUN_BUDGET_MS).toBeLessThanOrEqual(CANCEL_MS - 5_000);
});

it.each([[9_000, WORK_ENDS_MS - 9_000], [STORE_TIMEOUT_MS, WORK_ENDS_MS - STORE_TIMEOUT_MS]])("a read of %i ms leaves %i ms of work and the writes their reserve", async (readMs, workMs) => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  const started = Date.now();
  const store = { posts: [], fetched: {} };
  vi.mocked(readBlueStore).mockImplementation(async () => { vi.advanceTimersByTime(readMs); return store; });
  // Worst case for the work: it uses its whole window, then waits out one request that started at the last moment.
  vi.mocked(ingestBluePosts).mockImplementation(async ({ deadlineMs }) => {
    vi.advanceTimersByTime(deadlineMs! + REQUEST_TIMEOUT_MS);
    return { store, added: [], skipped: [], errors: [], requests: {} };
  });
  let writeTime = 0;
  vi.mocked(writeBlueStore).mockImplementation(async () => { writeTime = Date.now(); });
  expect((await GET(authorized())).status).toBe(200);
  expect(vi.mocked(ingestBluePosts).mock.calls[0][0].deadlineMs).toBe(workMs);
  const deadline = vi.mocked(writeBlueStore).mock.calls[0][1]!;
  expect(deadline - started).toBe(RUN_BUDGET_MS);
  expect(deadline - writeTime).toBeGreaterThanOrEqual(WRITE_RESERVE_MS);
});
