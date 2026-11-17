import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { bluePostsOf, emptyOverrides, parseTopicView, staffIndex } from "../src/blue-forum.js";
import { emptyStore, ingestBluePosts } from "../src/blue-posts.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/blue/${name}`, import.meta.url), "utf8");
const now = new Date("2026-11-17T10:00:00Z");

test.each(["refund", "xp"])("keeps the recorded November %s announcement", (name) => {
  const view = parseTopicView(JSON.parse(fixture(`november-${name}.json`)));
  const posts = bluePostsOf("us", view, view.posts, staffIndex("us", [], emptyOverrides()), now);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ game: "forever", author: "Kaivax", role: "Community Manager", postNumber: 1 });
});

test("a page cap resumes the missing older forum pages on the next run", async () => {
  const store = emptyStore();
  store.fetched["list:us:forever"] = { at: "2026-11-13T00:00:00Z", newestSeen: "2026-11-13T00:00:00.000Z" };
  const fetcher = async (url: string) => {
    if (url.endsWith("robots.txt")) return new Response("");
    if (url.endsWith("about.json")) return Response.json({ users: [] });
    if (url.includes("/t/2416343")) return Response.json(JSON.parse(fixture("november-xp.json")));
    if (!url.includes("/346/")) return Response.json({ topic_list: { topics: [] } });
    const older = new URL(url).searchParams.get("page") === "1";
    return Response.json({ topic_list: { per_page: 1, more_topics_url: older ? undefined : "/next", topics: [{
      id: older ? 2416343 : 999, bumped_at: older ? "2026-11-15T01:18:00Z" : "2026-11-16T01:00:00Z",
      ...(older ? { first_tracked_post: { group: "community-manager", post_number: 1 } } : {}),
    }] } });
  };
  const first = await ingestBluePosts({ store, fetcher, now, forumOnly: true, regions: ["us"], maxListPages: 1, sleep: async () => {} });
  const second = await ingestBluePosts({ store: JSON.parse(JSON.stringify(first.store)), fetcher, now: new Date(now.getTime() + 30 * 60_000), forumOnly: true, regions: ["us"], maxListPages: 1, sleep: async () => {} });
  expect(second.errors).toEqual([]);
  expect(second.store.posts.map((p) => p.title)).toContain("Player-Level Dungeon XP Adjustment - November 14");
});


test("the recorded refund category belongs to the Forever list and its staff post is ingested", async () => {
  const categories = JSON.parse(fixture("november-categories.json")).categories;
  expect(categories.find((c: { id: number }) => c.id === 352).parent_category_id).toBe(346);
  const refund = JSON.parse(fixture("november-refund.json"));
  const fetcher = async (url: string) => {
    if (url.endsWith("robots.txt")) return new Response("");
    if (url.endsWith("about.json")) return Response.json({ users: [] });
    if (url.includes("/t/2415068")) return Response.json(refund);
    return Response.json({ topic_list: { topics: url.includes("/346/") ? [{ id: refund.id,
      category_id: refund.category_id, bumped_at: "2026-11-14T01:36:48.839Z",
      first_tracked_post: { group: "community-manager", post_number: 1 } }] : [] } });
  };
  const result = await ingestBluePosts({ store: emptyStore(), fetcher, now, forumOnly: true, regions: ["us"], sleep: async () => {} });
  expect(result.errors).toEqual([]);
  expect(result.store.posts).toHaveLength(1);
  expect(result.store.posts[0]).toMatchObject({ title: refund.title, game: "forever", topicId: 2415068 });
});
