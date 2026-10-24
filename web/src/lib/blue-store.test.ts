import { afterEach, expect, it, vi } from "vitest";
import posts from "../../../kb/changes/blue-posts.json";

vi.mock("./upload-store", () => ({
  r2Config: () => ({ r2AccountId: "test", r2Bucket: "test" }),
  r2Client: () => ({ sign: async (url: string, init: RequestInit) => new Request(url, init) }),
}));
import { readBlueStore, writeBlueStore } from "./blue-store";

afterEach(() => { vi.unstubAllGlobals(); });

it("seeds missing objects from bundled posts and empty fetch state", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  const store = await readBlueStore();
  expect(store.posts.map((post) => post.id)).toEqual(posts.posts.map((post) => post.id));
  expect(store.fetched).toEqual({});
});

it("refuses to seed over an unreadable R2 object", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  await expect(readBlueStore()).rejects.toThrow("Blue store read failed (503)");
});

it("reads posts and fetch state back from R2", async () => {
  const fetched = { bluesky: { at: "2026-10-24T12:00:00.000Z" } };
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => Response.json(
    request.url.endsWith("blue-posts.json") ? { posts: [] } : { fetched },
  )));
  expect(await readBlueStore()).toEqual({ posts: [], fetched });
});

it("saves posts before advancing the fetch state", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  await writeBlueStore({ posts: [], fetched: {} });
  const requests = fetcher.mock.calls as unknown as [Request][];
  expect(requests.map(([request]) => new URL(request.url).pathname)).toEqual([
    "/test/changes/blue-posts.json", "/test/changes/blue-fetch-state.json",
  ]);
  expect(await requests[0][0].json()).toEqual({ posts: [] });
  expect(await requests[1][0].json()).toEqual({ fetched: {} });
});

it("does not advance fetch state when the posts write fails", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(writeBlueStore({ posts: [], fetched: {} })).rejects.toThrow("Blue store write failed (503)");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
