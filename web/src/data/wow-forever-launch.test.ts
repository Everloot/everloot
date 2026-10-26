import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { DATES, POSTS, RULESETS, RULESETS_POST, hasLaunched, windowAt } from "./wow-forever-launch";
import { longDate } from "./wow-forever";

type Stored = { id: string; title: string; url: string; excerpt: string; postedAt: string };
const posts = (JSON.parse(readFileSync(new URL("../../../kb/changes/blue-posts.json", import.meta.url), "utf8")) as { posts: Stored[] }).posts;

test("every cited Blizzard post is stored, with its title, and its excerpt still says what we state", () => {
  for (const ref of Object.values(POSTS)) {
    const post = posts.find((p) => p.id === ref.id);
    expect(post, ref.id).toBeDefined();
    expect(post!.title).toBe(ref.title);
    expect(post!.url).toMatch(/^https:\/\/us\.forums\.blizzard\.com\//);
    for (const words of ref.says) expect(post!.excerpt, `${ref.id}: ${words}`).toContain(words);
  }
});

test("each date we state is the day the post gives", () => {
  const noYear = (iso: string) => longDate(iso).replace(", 2026", "");
  expect(noYear(DATES.namesOpen)).toBe("October 27");
  expect(noYear(DATES.namesClose)).toBe("November 3");
  expect(noYear(DATES.raids)).toBe("December 9");
  expect(noYear(DATES.betaClosed)).toBe("October 23");
  const names = posts.find((p) => p.id === POSTS.names.id)!;
  expect(names.excerpt).toContain(`${noYear(DATES.namesOpen)} through ${noYear(DATES.namesClose)}`);
  expect(posts.find((p) => p.id === POSTS.raids.id)!.excerpt).toContain(`on ${noYear(DATES.raids)}`);
  expect(posts.find((p) => p.id === POSTS.betaClosed.id)!.postedAt.slice(0, 10)).toBe(DATES.betaClosed);
});

test("the ruleset table matches the news post", () => {
  const md = readFileSync(new URL(`../../../kb/news/${RULESETS_POST.slug}.md`, import.meta.url), "utf8");
  expect(md).toContain(RULESETS_POST.blizzardUrl);
  expect(RULESETS.map((r) => r.name)).toEqual(["Normal", "PvP", "Roleplaying", "RP-PvP", "Hardcore"]);
  for (const s of ["PvP happens when you opt in", "one faction", "stay in character", "arrives at launch on November 4", "offer it during name reservations", "comes sometime after launch", "Death is permanent", "can move to another ruleset", "except Hardcore"]) {
    expect(md, s).toContain(s);
  }
});

test("windows and the launch switch follow the dates", () => {
  const w = (iso: string) => windowAt(new Date(iso), DATES.namesOpen, DATES.namesClose);
  expect(w("2026-10-26T20:00:00Z")).toBe("before");
  expect(w("2026-10-27T12:00:00Z")).toBe("open");
  expect(w("2026-11-03T12:00:00Z")).toBe("open");
  expect(w("2026-11-04T01:00:00Z")).toBe("closed");
  expect(hasLaunched(new Date("2026-11-04T22:59:59Z"))).toBe(false);
  expect(hasLaunched(new Date("2026-11-04T23:00:00Z"))).toBe(true);
});
