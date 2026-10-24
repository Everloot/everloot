import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/blue-store", () => ({ readBlueStore: vi.fn(), writeBlueStore: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("../../../../../../kb/src/blue-posts", () => ({ ingestBluePosts: vi.fn() }));
import { GET } from "./route";
import { readBlueStore, writeBlueStore } from "@/lib/blue-store";
import { revalidateTag } from "next/cache";
import { ingestBluePosts } from "../../../../../../kb/src/blue-posts";
import posts from "../../../../../../kb/changes/blue-posts.json";
import type { BluePost } from "../../../../../../kb/src/blue-posts";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

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
  expect(ingestBluePosts).toHaveBeenCalledWith(expect.objectContaining({ store, minIntervalMs: 480_000 }));
  expect(writeBlueStore).toHaveBeenCalledWith(store);
  expect(revalidateTag).toHaveBeenCalledTimes(added ? 1 : 0);
  if (added) expect(revalidateTag).toHaveBeenCalledWith("blue");
});

it("does not invalidate when storage fails", async () => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.mocked(readBlueStore).mockRejectedValueOnce(new Error("unavailable"));
  const response = await GET(new Request("https://everloot.app/api/cron/blue", { headers: { authorization: "Bearer test-secret" } }));
  expect(response.status).toBe(500);
  expect(writeBlueStore).not.toHaveBeenCalled();
  expect(revalidateTag).not.toHaveBeenCalled();
});
