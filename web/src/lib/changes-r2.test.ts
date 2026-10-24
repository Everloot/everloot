import { afterEach, expect, it, vi } from "vitest";
import { loadTimeline, buildTimeline, groupAnnouncements } from "./changes";
import posts from "../../../kb/changes/blue-posts.json";
import builds from "../../../kb/changes/builds.json";
import type { BlueStore } from "../../../kb/src/blue-posts";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const bundled = () => groupAnnouncements(buildTimeline((posts as unknown as BlueStore).posts, builds.builds));
function configure() {
  for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) vi.stubEnv(key, "test");
}

it("uses bundled posts without R2 configuration", async () => {
  vi.stubEnv("R2_ACCOUNT_ID", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(await loadTimeline()).toEqual(bundled());
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["network", "http", "json"])("falls back when the R2 read fails: %s", async (failure) => {
  configure();
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (failure === "network") throw new Error("offline");
    return new Response(failure === "json" ? "invalid" : "unavailable", { status: failure === "http" ? 503 : 200 });
  }));
  expect(await loadTimeline()).toEqual(bundled());
});

it("reads R2 posts through the blue tagged fetch cache", async () => {
  configure();
  const fetcher = vi.fn(async () => Response.json({ posts: [] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await loadTimeline()).toEqual(groupAnnouncements(buildTimeline([], builds.builds)));
  expect(fetcher).toHaveBeenCalledWith(expect.any(Request), { next: { tags: ["blue"], revalidate: 600 } });
});
