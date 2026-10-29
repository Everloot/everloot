import { afterEach, expect, it, vi } from "vitest";
import { loadTimeline, buildTimeline, groupAnnouncements, manualEntries } from "./changes";
import posts from "../../../kb/changes/blue-posts.json";
import builds from "../../../kb/changes/builds.json";
import manual from "../../../kb/curated/manual-changes.json";
import type { BlueStore } from "../../../kb/src/blue-posts";
import { latestForeverBuild } from "./changes-facts";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const bundled = () => groupAnnouncements([...buildTimeline((posts as unknown as BlueStore).posts, builds.builds), ...manualEntries(manual)]);
it("withholds the unverified source seed rather than publishing unsupported claims", () => {
  expect(manual.entries).toEqual([]);
});
it("retains current wowf 70685 as the latest Forever build with live posts and on fallback", async () => {
  vi.stubEnv("R2_ACCOUNT_ID", "");
  const fallback = await loadTimeline();
  expect(latestForeverBuild(fallback)?.version).toBe("1.60.1.70685");
  configure();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ posts: [] })));
  const live = await loadTimeline();
  expect(live.filter((e) => e.type === "build")).toEqual(fallback.filter((e) => e.type === "build"));
  expect(latestForeverBuild(live)?.version).toBe("1.60.1.70685");
});
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
  expect(await loadTimeline()).toEqual(groupAnnouncements([...buildTimeline([], builds.builds), ...manualEntries(manual)]));
  expect(fetcher).toHaveBeenCalledWith(expect.any(Request), { next: { tags: ["blue"], revalidate: 600 } });
});
