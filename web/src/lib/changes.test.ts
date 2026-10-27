import { expect, test } from "vitest";
import { groupAnnouncements, postPathForUrl, type ChangeEntry } from "./changes";

const us: ChangeEntry = {
  id: "forum:30590866", type: "post", game: "forever", at: "2026-10-23T18:00:00.000Z", title: "Thank You For Testing the WoW Forever Beta",
  url: "https://us.forums.blizzard.com/en/wow/t/thank-you-for-testing-the-wow-forever-beta/2390465", author: "Kaivax", source: "forum", region: "us",
};
const eu: ChangeEntry = { ...us, id: "forum:eu:6448845", at: "2026-10-23T18:00:01.000Z", region: "eu", url: "https://eu.forums.blizzard.com/en/wow/t/thank-you-for-testing-the-wow-forever-beta/637227" };
const build: ChangeEntry = { id: "build:b", type: "build", game: "forever", at: "2026-10-22T06:00:00.000Z", title: "WoW: Forever build 1.60.1.70532", url: null, version: "1.60.1.70532" };
const timeline = groupAnnouncements([eu, us, build]);
const PAGE = "/changes/us-30590866-thank-you-for-testing-the-wow-forever-beta";

test("a link to a Blizzard post finds that post's page on Everloot, whichever copy it names", () => {
  expect(postPathForUrl(us.url!, timeline)).toBe(PAGE);
  // The EU copy is folded into the announcement, whose page is the US one.
  expect(postPathForUrl(eu.url!, timeline)).toBe(PAGE);
  // A trailing slash, a fragment or capitals do not hide it.
  expect(postPathForUrl(`${us.url}/#post-1`, timeline)).toBe(PAGE);
  expect(postPathForUrl(us.url!.toUpperCase(), timeline)).toBe(PAGE);
});

test("any other link has no page", () => {
  expect(postPathForUrl("https://news.blizzard.com/en-us/article/24302070/choose-your-ruleset", timeline)).toBeNull();
  expect(postPathForUrl("https://us.forums.blizzard.com/en/wow/t/thank-you-for-testing-the-wow-forever-beta/2390466", timeline)).toBeNull();
  expect(postPathForUrl("https://example.org", [])).toBeNull();
});
