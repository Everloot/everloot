import { expect, test } from "vitest";
import { FEED, pageMetadata } from "./seo";
test("database pages advertise both feeds and other pages keep the changes feed", () => {
  const base = { title: "Test", description: "Test" };
  expect(pageMetadata({ ...base, path: "/database/items/42" }).alternates?.types).toEqual({ "application/rss+xml": [{ url: "/database/feed.xml", title: "New public database facts" }, { url: "/changes/feed.xml", title: "Game changes" }] });
  expect(pageMetadata({ ...base, path: "/about" }).alternates?.types).toEqual(FEED);
  expect(pageMetadata({ ...base, path: "/database/recent", feed: "/database/feed.xml" }).alternates?.types).toHaveProperty("application/rss+xml");
});
