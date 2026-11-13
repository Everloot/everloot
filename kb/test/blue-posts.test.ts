import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  bluePostsOf, emptyOverrides, isCandidate, ownWords, parseAbout, parseOverrides, parseTopicList, parseTopicView, staffIndex,
  type BlueOverrides,
} from "../src/blue-forum.js";
import {
  backfillBluePosts, emptyStore, excerptOf, gameOf, ingestBluePosts, loadFetchState, loadStore, mergePosts, parseBlueskyFeed,
  robotsAllows, saveFetchState, saveStore, withThread, type BluePost, type BlueStore, type Fetcher, type IngestOptions,
} from "../src/blue-posts.js";

const fixtureText = (name: string) => readFileSync(new URL(`./fixtures/blue/${name}`, import.meta.url), "utf8");
const feed = () => JSON.parse(fixtureText("bluesky-feed.json"));
const now = new Date("2026-10-17T12:00:00Z");
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

// ---- synthetic Discourse answers, shaped like the forum's ----

const about = (users = [
  { id: 101, username: "Linxy", name: "Linxy", title: "Community Manager" },
  { id: 102, username: "Rommax-244181", name: "", title: "WoW Developer" },
  { id: 103, username: "Modbot-1", name: "Modbot", title: "Forum Moderator" },
]) => ({ users, about: { moderator_ids: users.map((u) => u.id), admin_ids: [] } });

interface Listed { id: number; bumped: string; tracked?: string; posters?: number[]; pinned?: boolean; category?: number }
const list = (topics: Listed[], { perPage = 100, more = false } = {}) => ({
  users: [],
  topic_list: {
    per_page: perPage,
    ...(more ? { more_topics_url: "/en/wow/next" } : {}),
    topics: topics.map((t) => ({
      id: t.id, title: `Topic ${t.id}`, slug: `topic-${t.id}`, category_id: t.category ?? 347, bumped_at: t.bumped, last_posted_at: t.bumped,
      pinned: t.pinned ?? false, ...(t.tracked ? { first_tracked_post: { group: t.tracked, post_number: 1 } } : {}),
      posters: (t.posters ?? [9]).map((user_id) => ({ user_id, description: "Poster" })),
    })),
  },
});

interface Post { n: number; user: number; username: string; title?: string; cooked?: string; type?: number; version?: number; extra?: object }
const post = (topicId: number, p: Post) => ({
  id: topicId * 1000 + p.n, post_number: p.n, topic_id: topicId, user_id: p.user, username: p.username, name: p.username.replace(/-\d+$/, ""),
  user_title: p.title ?? "", created_at: new Date(Date.UTC(2026, 9, 16, 10, p.n)).toISOString(), updated_at: "2026-10-16T20:00:00.000Z",
  post_type: p.type ?? 1, version: p.version ?? 1, cooked: p.cooked ?? `<p>Post ${p.n}. Second sentence. Third sentence.</p>`, ...p.extra,
});
const topic = (id: number, opts: { category?: number; title?: string; tracked?: [string, number][]; posts: Post[] }) => ({
  id, slug: `topic-${id}`, title: opts.title ?? `Synthetic topic ${id}`, category_id: opts.category ?? 347,
  tracked_posts: (opts.tracked ?? []).map(([group, post_number]) => ({ group, post_number })),
  post_stream: { posts: opts.posts.map((p) => post(id, p)), stream: [] },
});
const chunk = (topicId: number, posts: Post[]) => ({ post_stream: { posts: posts.map((p) => post(topicId, p)) } });

const linxy = (n: number, extra: Partial<Post> = {}): Post => ({ n, user: 101, username: "Linxy", title: "Community Manager", ...extra });
const player = (n: number): Post => ({ n, user: 900 + n, username: `Player${n}-1234`, cooked: "<p>Player words should never be kept.</p>" });

const robots = fixtureText("robots.txt");
const staff = (overrides: BlueOverrides = emptyOverrides(), region: "us" | "eu" = "us") => staffIndex(region, parseAbout(about()), overrides);

// ---- parsers ----

test("about.json gives the staff roster with forum titles", () => {
  expect(parseAbout(about())).toEqual([
    { id: 101, username: "Linxy", title: "Community Manager" },
    { id: 102, username: "Rommax-244181", title: "WoW Developer" },
    { id: 103, username: "Modbot-1", title: "Forum Moderator" },
  ]);
  expect(() => parseAbout({ errors: ["x"] })).toThrow(/about.json/);
});

test("game filter: categories decide, per region; EU and US ids differ", () => {
  expect(gameOf(349)?.game).toBe("forever");
  expect(gameOf(347)?.category).toBe("WoW: Forever General Discussion");
  expect(gameOf(302)?.game).toBe("classic");
  expect(gameOf(350)?.game).toBe("classic");
  expect(gameOf(171)).toBeNull();
  expect(gameOf(undefined)).toBeNull();
  // US 348 is Forever Community Connections; EU 348 is Burning Crusade Classic, and EU 197 is a realm forum.
  expect(gameOf(348, "us")?.game).toBe("forever");
  expect(gameOf(348, "eu")?.game).toBe("classic");
  expect(gameOf(362, "eu")).toEqual({ game: "forever", category: "WoW: Forever Beta Discussion" });
  expect(gameOf(197, "eu")).toBeNull();
});

test("topic lists: a topic is worth opening when Blizzard tracks a post in it or a roster member posted; MVPs are players", () => {
  const { topics, full } = parseTopicList(list([
    { id: 1, bumped: "2026-10-17T11:00:00Z", tracked: "community-manager" },
    { id: 2, bumped: "2026-10-17T10:00:00Z", posters: [9, 102] },
    { id: 3, bumped: "2026-10-17T09:00:00Z", tracked: "wow-mvp" },
    { id: 4, bumped: "2026-10-17T08:00:00Z" },
  ]));
  expect(full).toBe(false);
  expect(topics.filter((t) => isCandidate(t, staff())).map((t) => t.id)).toEqual([1, 2]);
  expect(parseTopicList(list([{ id: 9, bumped: "2026-10-17T08:00:00Z" }], { perPage: 1, more: true })).full).toBe(true);
  expect(() => parseTopicList({ nope: 1 })).toThrow(/topic list/);
});

test("staff posts: tracked numbers and roster members are kept; players, MVPs, small actions and opted-out posts are not", () => {
  const view = parseTopicView(topic(500, {
    title: "Synthetic Forever Hotfixes", tracked: [["community-manager", 1], ["wow-mvp", 2], ["community-manager", 5]],
    posts: [
      linxy(1, { cooked: "<p>Fixed a bug. Second one! Third one?</p>" }),
      { n: 2, user: 950, username: "Helper-1", title: "MVP", cooked: "<p>MVP words.</p>" },
      player(3),
      { n: 4, user: 102, username: "Rommax-244181", title: "", version: 3 },
      linxy(5, { cooked: '<aside class="quote" data-username="Player3"><blockquote><p>Player question. More.</p></blockquote></aside><p>Our answer. Second. Third.</p>' }),
      linxy(6, { type: 2 }),
      linxy(7, { extra: { opted_out: true } }),
      linxy(8, { extra: { hidden: true } }),
    ],
  }));
  expect(view.tracked).toEqual([1, 5]);
  const posts = bluePostsOf("us", view, view.posts, staff(), now);
  expect(posts.map((p) => p.postNumber)).toEqual([1, 4, 5]);
  expect(posts[0]).toMatchObject({
    id: "forum:500001", source: "forum", region: "us", url: "https://us.forums.blizzard.com/en/wow/t/topic-500/500",
    title: "Synthetic Forever Hotfixes", author: "Linxy", role: "Community Manager", category: "WoW: Forever General Discussion",
    game: "forever", kind: "hotfix", excerpt: "Fixed a bug. Second one!", topicId: 500, topicSlug: "topic-500", postNumber: 1,
    startedThread: true, editedAt: null, firstSeen: now.toISOString(),
  });
  // A roster member with no forum title on the post gets the roster's title; an edited post has its edit time.
  expect(posts[1]).toMatchObject({ author: "Rommax", role: "WoW Developer", startedThread: false, editedAt: "2026-10-16T20:00:00.000Z", url: "https://us.forums.blizzard.com/en/wow/t/topic-500/500/4" });
  // The quoted player text never reaches the excerpt.
  expect(posts[2].excerpt).toBe("Our answer. Second.");
  expect(posts.some((p) => /Player|MVP/.test(p.excerpt))).toBe(false);
});

test("staff posts: overrides exclude a title or a person, include someone the forum does not list, and correct a title", () => {
  const view = parseTopicView(topic(600, {
    category: 172,
    posts: [
      { n: 1, user: 103, username: "Modbot-1", title: "Forum Moderator" },
      { n: 2, user: 700, username: "Kaivax", title: "" },
      linxy(3),
      { n: 4, user: 102, username: "Rommax-244181", title: "WoW Developer" },
    ],
  }));
  const overrides = parseOverrides({
    include: [{ region: "us", username: "kaivax", title: "Community Manager" }],
    exclude: [{ region: "us", username: "Linxy" }],
    excludeTitles: ["Forum Moderator"],
    titles: [{ region: "us", username: "Rommax-244181", title: "Senior Game Designer" }],
  });
  const posts = bluePostsOf("us", view, view.posts, staff(overrides), now);
  expect(posts.map((p) => [p.author, p.role, p.game])).toEqual([["Kaivax", "Community Manager", "classic"], ["Rommax", "Senior Game Designer", "classic"]]);
  // Overrides for one region do not touch the other.
  expect(bluePostsOf("eu", { ...view, topic: { ...view.topic, categoryId: 265 } }, view.posts, staff(overrides, "eu"), now).map((p) => [p.author, p.role])).toEqual([["Linxy", "Community Manager"], ["Rommax", "WoW Developer"]]);
});

test("staff posts: EU posts carry their region in id and link; a topic outside Forever and Classic keeps nothing", () => {
  const view = parseTopicView(topic(700, { category: 362, tracked: [["community-manager", 1]], posts: [linxy(1)] }));
  const [eu] = bluePostsOf("eu", view, view.posts, staff(emptyOverrides(), "eu"), now);
  expect(eu).toMatchObject({ id: "forum:eu:700001", region: "eu", url: "https://eu.forums.blizzard.com/en/wow/t/topic-700/700", category: "WoW: Forever Beta Discussion" });
  const retail = parseTopicView(topic(701, { category: 171, tracked: [["community-manager", 1]], posts: [linxy(1)] }));
  expect(bluePostsOf("us", retail, retail.posts, staff(), now)).toEqual([]);
});

test("overrides file: regions and titles are required", () => {
  expect(() => parseOverrides({ include: [{ username: "x", title: "y" }] })).toThrow(/region/);
  expect(() => parseOverrides({ include: [{ region: "us", username: "x" }] })).toThrow(/title/);
  expect(() => parseOverrides({ excludeTitles: "Forum Moderator" })).toThrow(/excludeTitles/);
  expect(parseOverrides({})).toEqual(emptyOverrides());
  // The committed file parses.
  expect(() => parseOverrides(JSON.parse(readFileSync(new URL("../curated/blue-accounts.json", import.meta.url), "utf8")))).not.toThrow();
});

test("ownWords drops quotes, nested quotes and link previews", () => {
  expect(ownWords('<aside class="quote"><aside class="quote">deep</aside>outer</aside><p>Mine.</p><aside class="onebox">preview</aside>')).not.toMatch(/deep|outer|preview/);
});

test("excerpt: at most two sentences, entities decoded, tags dropped", () => {
  expect(excerptOf("<p>One &amp; two. Three.</p> Four.")).toBe("One & two. Three.");
  expect(excerptOf("First sentence. Second one! Third one? Fourth.")).toBe("First sentence. Second one!");
  expect(excerptOf("Dungeons: a boss no longer resets early.&hellip;")).toBe("Dungeons: a boss no longer resets early.…");
  expect(excerptOf("")).toBe("");
});

test("excerpt: a sentence that starts in lowercase still counts as a sentence", () => {
  expect(excerptOf("Fixed a bug. we also changed a thing. more words here.")).toBe("Fixed a bug. we also changed a thing.");
  expect(excerptOf("Done. 70450 is out. Third.")).toBe("Done. 70450 is out.");
});

test("excerpt: common abbreviations, initials, list numbers and version numbers do not end a sentence", () => {
  expect(excerptOf("Use e.g. the ladder, it helps. Then rest. Third.")).toBe("Use e.g. the ladder, it helps. Then rest.");
  expect(excerptOf("Dr. Smith fixed it. Next one. Third.")).toBe("Dr. Smith fixed it. Next one.");
  expect(excerptOf("Ask J. Smith about it. Then wait. Third.")).toBe("Ask J. Smith about it. Then wait.");
  expect(excerptOf("1. Fix the boss. 2. Fix the door. 3. Done.")).toBe("1. Fix the boss. 2. Fix the door.");
  expect(excerptOf("Build 1.60.1.70450 is live. Restart now. Third.")).toBe("Build 1.60.1.70450 is live. Restart now.");
});

test("excerpt: a long sentence is cut at a word under 300 characters", () => {
  const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
  const out = excerptOf(long);
  expect(out.length).toBeLessThanOrEqual(300);
  expect(out).not.toMatch(/\s…$/);
  expect(out).toMatch(/word\d+…$/);
});

test("bluesky: the official account's own posts with a Forever or Classic signal; no reposts, replies, retail or bare words", () => {
  const posts = parseBlueskyFeed(feed(), now);
  expect(posts.map((p) => p.id)).toEqual(["bluesky:3synthetic6", "bluesky:3synthetic1", "bluesky:3synthetic5"]);
  const stream = posts.find((p) => p.id === "bluesky:3synthetic1")!;
  expect(stream).toMatchObject({
    source: "bluesky",
    url: "https://bsky.app/profile/worldofwarcraft.blizzard.com/post/3synthetic1",
    title: "Synthetic: WoW: Forever server stream is coming. Join us on the day!",
    author: "World of Warcraft",
    role: "Official account",
    game: "forever",
    kind: "post",
  });
  expect(stream.region).toBeUndefined();
  expect(posts.find((p) => p.id === "bluesky:3synthetic5")).toMatchObject({ game: "classic", kind: "hotfix" });
});

test("bluesky: a pinned post is kept when it links to a Forever page", () => {
  const pinned = parseBlueskyFeed(feed(), now).find((p) => p.id === "bluesky:3synthetic6")!;
  expect(pinned.game).toBe("forever");
  expect(pinned.postedAt).toBe("2026-09-01T10:00:00.000Z");
});

test("bluesky: the excerpt is what follows the title, never the title again", () => {
  const posts = parseBlueskyFeed(feed(), now);
  expect(posts.find((p) => p.id === "bluesky:3synthetic1")!.excerpt).toBe("More text on a later line.");
  expect(posts.find((p) => p.id === "bluesky:3synthetic5")!.excerpt).toBe("");
});

const forumSample = (): BluePost[] => {
  const view = parseTopicView(topic(500, { tracked: [["community-manager", 1], ["community-manager", 3]], posts: [linxy(1), player(2), linxy(3)] }));
  return bluePostsOf("us", view, view.posts, staff(), now);
};

test("merging adds new posts, keeps first-seen and a maintainer's summary, and sorts newest first", () => {
  const first = mergePosts(emptyStore(), forumSample());
  expect(first.added).toHaveLength(2);
  expect(first.store.posts.map((p) => p.id)).toEqual(["forum:500003", "forum:500001"]);
  const withSummary = { ...first.store, posts: first.store.posts.map((p) => (p.id === "forum:500001" ? { ...p, summary: "Beta restarts tonight." } : p)) };
  const again = mergePosts(withSummary, forumSample().map((p) => ({ ...p, firstSeen: minutes(360).toISOString() })));
  expect(again.added).toEqual([]);
  const kept = again.store.posts.find((p) => p.id === "forum:500001")!;
  expect(kept.summary).toBe("Beta restarts tonight.");
  expect(kept.firstSeen).toBe(now.toISOString());
});

test("robots: the forum's rules block category and topic .rss, search and group pages, and allow the JSON we read", () => {
  expect(robotsAllows(robots, "/en/wow/about.json")).toBe(true);
  expect(robotsAllows(robots, "/en/wow/c/wow-forever/346/l/latest.json?per_page=100&page=2")).toBe(true);
  expect(robotsAllows(robots, "/en/wow/t/123.json")).toBe(true);
  expect(robotsAllows(robots, "/en/wow/t/123/posts.json?post_number=4&asc=true")).toBe(true);
  expect(robotsAllows(robots, "/en/wow/c/wow-forever/346.rss")).toBe(false);
  expect(robotsAllows(robots, "/en/wow/t/some-topic/123.rss")).toBe(false);
  expect(robotsAllows(robots, "/en/wow/search?q=x")).toBe(false);
  // The forum's own "Blizz Tracker" page lives under /g/, which robots.txt closes.
  expect(robotsAllows(robots, "/en/wow/g/blizzard-tracker/activity/posts")).toBe(false);
  expect(robotsAllows(robots, "/en/wow/latest.rss")).toBe(true);
  expect(robotsAllows(robots, "/en/wow/anything?x=1&api_key=abc")).toBe(false);
});

test("robots: longest rule wins, Allow beats Disallow on a tie, a named group beats *, $ anchors", () => {
  expect(robotsAllows("User-agent: *\nDisallow: /a/\nAllow: /a/ok", "/a/ok")).toBe(true);
  expect(robotsAllows("User-agent: *\nDisallow: /a\nAllow: /a", "/a")).toBe(true);
  expect(robotsAllows("User-agent: *\nDisallow: /\n\nUser-agent: Everloot\nAllow: /", "/x")).toBe(true);
  expect(robotsAllows("User-agent: *\nDisallow: /x$", "/x")).toBe(false);
  expect(robotsAllows("User-agent: *\nDisallow: /x$", "/xy")).toBe(true);
  expect(robotsAllows("", "/anything")).toBe(true);
});

test("robots: an empty User-agent value names nobody, so it neither matches us nor widens the * group", () => {
  expect(robotsAllows("User-agent:\nDisallow: /", "/x")).toBe(true);
  expect(robotsAllows("User-agent: *\nDisallow: /secret\n\nUser-agent:\nAllow: /secret", "/secret")).toBe(false);
});

// ---- the polite fetcher, against a fake forum ----

interface Call { url: string; headers: Record<string, string> }
const jsonRes = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

type Route = (url: URL, n: number) => Response | undefined;

/** A fake US and EU forum plus Bluesky. Each route may be replaced; anything unrouted is a 404. */
function fakeServer(routes: Record<string, Route> = {}) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetcher: Fetcher = async (raw, init) => {
    calls.push({ url: raw, headers: init.headers });
    const url = new URL(raw);
    const region = url.host.startsWith("eu.") ? "eu" : "us";
    const kind = url.host.includes("bsky") ? "bluesky"
      : url.pathname === "/robots.txt" ? `robots:${region}`
      : url.pathname.endsWith("/about.json") ? `about:${region}`
      : url.pathname.includes("/l/latest.json") ? `list:${region}:${url.pathname.split("/")[4]}`
      : /\/t\/\d+\/posts\.json$/.test(url.pathname) ? `posts:${region}`
      : /\/t\/\d+(\/\d+)?\.json$/.test(url.pathname) ? `topic:${region}` : "other";
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    const custom = routes[kind]?.(url, n);
    if (custom) return custom;
    if (kind === "bluesky") return jsonRes(feed());
    if (kind.startsWith("robots")) return new Response(robots, { status: 200 });
    if (kind.startsWith("about")) return jsonRes(about());
    if (kind === "list:us:wow-forever") {
      return jsonRes(list([
        { id: 500, bumped: "2026-10-17T11:00:00.000Z", tracked: "community-manager" },
        { id: 501, bumped: "2026-10-17T10:00:00.000Z" },
        { id: 502, bumped: "2026-10-17T09:00:00.000Z", posters: [9, 102] },
      ]));
    }
    if (kind.startsWith("list")) return jsonRes(list([]));
    if (kind === "topic:us" && /\/500(\/\d+)?\.json$/.test(url.pathname)) {
      return jsonRes(topic(500, { tracked: [["community-manager", 1], ["community-manager", 30]], posts: [linxy(1), player(2), player(3)] }));
    }
    if (kind === "topic:us" && url.pathname.endsWith("/502.json")) return jsonRes(topic(502, { posts: [player(1), { n: 2, user: 102, username: "Rommax-244181" }] }));
    if (kind === "posts:us" && url.pathname.includes("/500/")) return jsonRes(chunk(500, [linxy(30), player(31)]));
    return new Response("not found", { status: 404 });
  };
  const of = (prefix: string) => calls.filter((c) => {
    const u = new URL(c.url);
    return prefix === "robots" ? u.pathname === "/robots.txt" : prefix === "about" ? u.pathname.endsWith("about.json")
      : prefix === "list" ? u.pathname.includes("/l/latest.json") : prefix === "topic" ? /\/t\/\d+(\/\d+)?\.json$/.test(u.pathname)
      : prefix === "posts" ? u.pathname.endsWith("/posts.json") : u.host.includes("bsky");
  });
  return { fetcher, calls, of };
}

const run = (server: ReturnType<typeof fakeServer>, extra: Partial<IngestOptions> = {}) =>
  ingestBluePosts({ store: emptyStore(), fetcher: server.fetcher, now, sleep: async () => {}, ...extra });
const forumIds = (store: BlueStore) => store.posts.filter((p) => p.source === "forum").map((p) => p.id).sort();

test("ingest: Bluesky, then per forum robots.txt first, the staff list, each topic list, and only topics with staff posts", async () => {
  const server = fakeServer();
  const result = await run(server);
  expect(result.errors).toEqual([]);
  expect(new URL(server.calls[0].url).host).toBe("public.api.bsky.app");
  expect(server.calls[1].url).toBe("https://us.forums.blizzard.com/robots.txt");
  expect(server.calls[2].url).toBe("https://us.forums.blizzard.com/en/wow/about.json");
  const euFirst = server.calls.findIndex((c) => c.url.startsWith("https://eu."));
  expect(server.calls[euFirst].url).toBe("https://eu.forums.blizzard.com/robots.txt");
  expect(server.of("list").map((c) => c.url.replace(/^https:\/\/(..)\.forums\.blizzard\.com\/en\/wow\//, "$1 "))).toEqual([
    "us c/wow-forever/346/l/latest.json?per_page=100", "us c/in-development/23/l/latest.json?per_page=100", "us c/wow-classic/197/l/latest.json?per_page=100",
    "eu c/wow-forever/359/l/latest.json?per_page=100", "eu c/in-development/21/l/latest.json?per_page=100", "eu c/wow-classic/249/l/latest.json?per_page=100",
  ]);
  // 501 has no staff post, so it is never opened; 500's tracked post 30 comes from one extra chunk.
  expect(server.of("topic").map((c) => new URL(c.url).pathname)).toEqual(["/en/wow/t/502.json", "/en/wow/t/500.json"]);
  expect(server.of("posts").map((c) => new URL(c.url).search)).toEqual(["?post_number=29&asc=true"]);
  expect(forumIds(result.store)).toEqual(["forum:500001", "forum:500030", "forum:502002"]);
  expect(result.requests).toEqual({ bluesky: 1, robots: 2, roster: 2, list: 6, topic: 2, posts: 1 });
  for (const call of server.calls) expect(call.headers["User-Agent"]).toBe("Everloot/1.0 (+https://everloot.app; hello@everloot.app)");
  expect(result.store.fetched["list:us:forever"].newestSeen).toBe("2026-10-17T11:00:00.000Z");
  expect(result.store.fetched["roster:us"].staff).toHaveLength(3);
});

test("ingest: staff posts deep in a long thread are found by following the forum's chain of tracked posts", async () => {
  // The topic view names only its first tracked post; every post names the next one (next_tracked_post).
  const next = (n: number, group = "wow-developer") => ({ extra: { next_tracked_post: { group, post_number: n } } });
  const dev = (n: number, after?: number): Post => ({ n, user: 102, username: "Rommax-244181", title: "WoW Developer", ...(after ? next(after) : {}) });
  const server = fakeServer({
    "list:us:wow-forever": () => jsonRes(list([{ id: 800, bumped: "2026-10-17T11:00:00.000Z", tracked: "community-manager" }])),
    "topic:us": () => jsonRes(topic(800, { tracked: [["community-manager", 2]], posts: [player(1), linxy(2, next(150)), player(3)] })),
    "posts:us": (url) => {
      const from = Number(url.searchParams.get("post_number"));
      // 151 links to an MVP's post (a player), whose own link leads on to 400: the chain runs through it.
      if (from === 149) return jsonRes(chunk(800, [dev(150, 151), { ...dev(151), ...next(300, "cs-mvp") }, player(152)]));
      if (from === 299) return jsonRes(chunk(800, [{ n: 300, user: 950, username: "Helper-1", title: "MVP", ...next(400) }]));
      if (from === 399) return jsonRes(chunk(800, [dev(400), { ...player(401), ...next(999) }]));
      return jsonRes(chunk(800, []));
    },
  });
  const result = await run(server, { regions: ["us"] });
  expect(result.errors).toEqual([]);
  expect(forumIds(result.store)).toEqual(["forum:800002", "forum:800150", "forum:800151", "forum:800400"]);
  // 150 and 151 come in one chunk; the MVP post is read for its link but not kept; 999 (gone) is asked for once.
  expect(server.of("posts").map((c) => new URL(c.url).searchParams.get("post_number"))).toEqual(["149", "299", "399", "998"]);
});

test("slugs with letters outside ASCII are kept percent-encoded; anything else odd becomes 'topic'", () => {
  const view = parseTopicView({ ...topic(9, { posts: [] }), slug: "dev-notes-–-updated" });
  expect(view.topic.slug).toBe("dev-notes-%E2%80%93-updated");
  expect(parseTopicView({ ...topic(9, { posts: [] }), slug: "already-%E2%80%93-encoded" }).topic.slug).toBe("already-%E2%80%93-encoded");
  expect(parseTopicView({ ...topic(9, { posts: [] }), slug: "../x" }).topic.slug).toBe("topic");
  const post = { ...forumSample()[0], topicId: undefined, url: "https://us.forums.blizzard.com/en/wow/t/dev-notes-%E2%80%93-updated/9/3" };
  expect(withThread(post)).toMatchObject({ topicSlug: "dev-notes-%E2%80%93-updated", topicId: 9, postNumber: 3 });
});

test("ingest: waits 1.5 s between two requests to the same host", async () => {
  const waits: number[] = [];
  const server = fakeServer();
  await run(server, { sleep: async (ms) => { waits.push(ms); } });
  // Bluesky 1, US 2 + 3 lists + 3 topic requests, EU 2 + 3 lists: every request after a host's first waits.
  expect(waits.every((w) => w === 1500)).toBe(true);
  expect(waits).toHaveLength(server.calls.length - 3);
});

test("ingest: the next run reads the staff list again only after a day, and opens only topics that changed", async () => {
  const first = await run(fakeServer());
  const later = fakeServer({
    "list:us:wow-forever": () => jsonRes(list([
      { id: 500, bumped: "2026-10-17T13:00:00.000Z", tracked: "community-manager" },
      { id: 502, bumped: "2026-10-17T09:00:00.000Z", posters: [9, 102] },
    ])),
    "topic:us": () => jsonRes(topic(500, { tracked: [["community-manager", 1], ["community-manager", 30], ["community-manager", 40]], posts: [linxy(1), player(2)] })),
    "posts:us": (url) => (url.searchParams.get("post_number") === "39" ? jsonRes(chunk(500, [linxy(40)])) : undefined),
  });
  const second = await run(later, { store: first.store, now: minutes(60) });
  expect(second.errors).toEqual([]);
  expect(later.of("about")).toHaveLength(0);
  // Only 500 changed. It is read from the last staff post kept (30), and only the chunk with 40 is asked for.
  expect(later.of("topic").map((c) => new URL(c.url).pathname)).toEqual(["/en/wow/t/500/30.json"]);
  expect(later.of("posts").map((c) => new URL(c.url).searchParams.get("post_number"))).toEqual(["39"]);
  expect(second.added.map((p) => p.id)).toEqual(["forum:500040"]);
  const nextDay = fakeServer();
  await run(nextDay, { store: second.store, now: minutes(60 * 25) });
  expect(nextDay.of("about")).toHaveLength(2);
});

test("ingest: a list is paged back to what the last run handled, and a list that changed too much reports the gap", async () => {
  const first = await run(fakeServer());
  const page = (n: number) => list(Array.from({ length: 100 }, (_, i) => ({ id: 10_000 + n * 100 + i, bumped: new Date(Date.UTC(2026, 9, 18, 12) - (n * 100 + i) * 60_000).toISOString() })), { more: true });
  const deep = fakeServer({ "list:us:wow-forever": (url) => jsonRes(page(Number(url.searchParams.get("page") ?? 0))) });
  const result = await run(deep, { store: first.store, now: minutes(60 * 30), regions: ["us"], maxListPages: 3 });
  expect(deep.of("list").filter((c) => c.url.includes("/346/")).map((c) => new URL(c.url).searchParams.get("page"))).toEqual([null, "1", "2"]);
  expect(result.skipped.some((s) => s.startsWith("list:us:forever: more than 3 pages changed"))).toBe(true);
  // A short second page that reaches the handled time ends the paging without a gap.
  const shallow = fakeServer({
    "list:us:wow-forever": (url) => jsonRes(url.searchParams.get("page") ? list([{ id: 1, bumped: "2026-10-17T10:00:00.000Z" }]) : page(0)),
  });
  const ok = await run(shallow, { store: first.store, now: minutes(60 * 30), regions: ["us"] });
  expect(shallow.of("list").filter((c) => c.url.includes("/346/"))).toHaveLength(2);
  expect(ok.skipped.some((s) => s.includes("more than"))).toBe(false);
});

test("ingest: a run stops at its request budget, and the next run opens the topics it did not reach", async () => {
  const many = () => jsonRes(list([
    { id: 500, bumped: "2026-10-17T11:00:00.000Z", tracked: "community-manager" },
    { id: 502, bumped: "2026-10-17T09:00:00.000Z", posters: [102] },
  ]));
  const tight = fakeServer({ "list:us:wow-forever": many });
  // Bluesky 1 + robots 1 + about 1 + list 1 + one topic = 5.
  const cut = await run(tight, { maxRequests: 5 });
  expect(tight.calls).toHaveLength(5);
  expect(forumIds(cut.store)).toEqual(["forum:502002"]);
  expect(cut.skipped.some((s) => s.startsWith("stopped: request budget of 5 spent"))).toBe(true);
  expect(cut.errors).toEqual([]);
  expect(cut.store.fetched["list:us:forever"].newestSeen).toBe("2026-10-17T09:00:00.000Z");
  const next = fakeServer({ "list:us:wow-forever": many });
  const done = await run(next, { store: cut.store, now: minutes(30) });
  expect(next.of("topic").map((c) => new URL(c.url).pathname)).toEqual(["/en/wow/t/500.json"]);
  expect(forumIds(done.store)).toEqual(["forum:500001", "forum:500030", "forum:502002"]);
});

test("ingest: a run stops at its time budget before the next request, saves its place, and the next run continues", async () => {
  const many = () => jsonRes(list([
    { id: 500, bumped: "2026-10-17T11:00:00.000Z", tracked: "community-manager" },
    { id: 502, bumped: "2026-10-17T09:00:00.000Z", posters: [102] },
  ]));
  const slow = fakeServer({ "list:us:wow-forever": many });
  // Each polite pause costs 2 s on a fake clock; the budget of 5 s lets the first requests of a host through and no more.
  let t = 0;
  const cut = await run(slow, { deadlineMs: 5_000, clock: () => t, sleep: async (ms) => { t += ms + 500; } });
  expect(slow.calls.length).toBeLessThan(5);
  expect(cut.skipped.some((s) => s.startsWith("stopped: time budget of 5 s spent"))).toBe(true);
  expect(cut.errors).toEqual([]);
  const next = fakeServer({ "list:us:wow-forever": many });
  const done = await run(next, { store: cut.store, now: minutes(30) });
  expect(forumIds(done.store)).toEqual(["forum:500001", "forum:500030", "forum:502002"]);
});

test("ingest: a list asked less than 25 minutes ago is skipped; Bluesky validators are sent back", async () => {
  const first = await run(fakeServer({ bluesky: () => jsonRes(feed(), { headers: { etag: '"v1"' } }) }));
  const quick = fakeServer();
  const soon = await run(quick, { store: first.store, now: minutes(10) });
  expect(quick.of("list")).toHaveLength(0);
  expect(quick.of("bluesky")).toHaveLength(0);
  expect(soon.skipped.filter((s) => s.includes("less than 25 minutes"))).toHaveLength(7);
  const later = fakeServer({ bluesky: () => new Response(null, { status: 304 }) });
  const result = await run(later, { store: first.store, now: minutes(60) });
  expect(later.of("bluesky")[0].headers["If-None-Match"]).toBe('"v1"');
  expect(result.errors).toEqual([]);
});

test("ingest: Bluesky follows its cursor, up to three pages", async () => {
  const blueskyPage = (n: number, cursor?: string) => ({
    ...(cursor ? { cursor } : {}),
    feed: Array.from({ length: 30 }, (_, i) => ({
      post: {
        uri: `at://did:plc:x/app.bsky.feed.post/p${n}x${i}`, author: { handle: "worldofwarcraft.blizzard.com", displayName: "World of Warcraft" },
        record: { createdAt: new Date(Date.UTC(2026, 9, 16, 12, 0, 0) - (n * 30 + i) * 60_000).toISOString(), text: `WoW: Forever note ${n}-${i}. Details.` },
      },
    })),
  });
  const three = fakeServer({ bluesky: (_url, n) => jsonRes(blueskyPage(n, `c${n}`)) });
  const result = await run(three, { regions: [] });
  expect(three.of("bluesky").map((c) => new URL(c.url).searchParams.get("cursor"))).toEqual([null, "c1", "c2"]);
  expect(result.store.posts).toHaveLength(90);
});

test("ingest: a 429 ends the forum pass, honours Retry-After on that forum, and the next run waits", async () => {
  const limited = fakeServer({ "list:us:wow-forever": () => new Response("slow down", { status: 429, headers: { "retry-after": "7200" } }) });
  const result = await run(limited);
  expect(result.errors.map((e) => e.source)).toEqual(["forum us"]);
  expect(limited.of("list")).toHaveLength(1);
  expect(limited.calls.some((c) => c.url.startsWith("https://eu."))).toBe(false);
  expect(result.skipped).toContain("forum eu: stopped after an earlier slow-down");
  expect(result.store.fetched["host:us"].notBefore).toBe("2026-10-17T14:00:00.000Z");
  expect(result.store.posts.every((p) => p.source === "bluesky")).toBe(true);
  // The state survives on its own file, and the US forum is left alone until the wait is over.
  const dir = mkdtempSync(join(tmpdir(), "blue-state-"));
  const statePath = join(dir, "state.json");
  saveFetchState(statePath, result.store.fetched);
  const next = fakeServer();
  const waited = await run(next, { store: { posts: [], fetched: loadFetchState(statePath) }, now: minutes(60) });
  expect(waited.skipped).toContain("forum us: asked to wait until 2026-10-17T14:00:00.000Z");
  expect(next.calls.some((c) => c.url.startsWith("https://us."))).toBe(false);
  expect(next.calls.some((c) => c.url.startsWith("https://eu."))).toBe(true);
  const after = fakeServer();
  await run(after, { store: { posts: [], fetched: loadFetchState(statePath) }, now: minutes(130) });
  expect(after.calls.some((c) => c.url.startsWith("https://us."))).toBe(true);
});

test("ingest: a topic that fails stops its list there, so the next run opens it again; a vanished topic is skipped", async () => {
  const broken = fakeServer({ "topic:us": (url) => (url.pathname.endsWith("/502.json") ? jsonRes({ oops: true }) : undefined) });
  const result = await run(broken, { regions: ["us"] });
  expect(result.errors.map((e) => e.source)).toEqual(["list:us:forever: topic 502"]);
  expect(broken.of("topic")).toHaveLength(1);
  expect(result.store.fetched["list:us:forever"].newestSeen).toBeUndefined();
  const gone = fakeServer({ "topic:us": (url) => (url.pathname.endsWith("/502.json") ? new Response("gone", { status: 404 }) : undefined) });
  const ok = await run(gone, { regions: ["us"] });
  expect(ok.errors).toEqual([]);
  expect(ok.skipped).toContain("list:us:forever: topic 502 is gone");
  expect(forumIds(ok.store)).toEqual(["forum:500001", "forum:500030"]);
});

test("ingest: a path robots.txt disallows is never requested, and an unreadable robots.txt means no forum requests", async () => {
  const closed = fakeServer({ "robots:us": () => new Response("User-agent: *\nDisallow: /en/wow/c/", { status: 200 }) });
  const result = await run(closed, { regions: ["us"] });
  expect(closed.of("list")).toHaveLength(0);
  expect(result.errors.filter((e) => e.error.includes("robots.txt disallows"))).toHaveLength(3);
  const down = fakeServer({ "robots:eu": () => new Response("down", { status: 404 }), "robots:us": () => new Response("x", { status: 403 }) });
  const r2 = await run(down);
  expect(r2.errors[0]).toEqual({ source: "forum us", error: "robots.txt: HTTP 403" });
  expect(down.calls.filter((c) => c.url.startsWith("https://us."))).toHaveLength(1);
  // A missing robots.txt allows everything.
  expect(down.of("list").filter((c) => c.url.startsWith("https://eu."))).toHaveLength(3);
});

test("ingest: a redirect is reported and not followed", async () => {
  const server = fakeServer({ "list:us:wow-forever": () => new Response(null, { status: 301, headers: { location: "https://elsewhere.example/x" } }) });
  const result = await run(server, { regions: ["us"] });
  expect(result.errors).toEqual([{ source: "list:us:forever", error: "HTTP 301 redirect not followed" }]);
  expect(server.calls.some((c) => c.url.includes("elsewhere"))).toBe(false);
});

test("ingest: a failed staff list read keeps the last one and still reads the forum by Blizzard's own marks", async () => {
  const server = fakeServer({ "about:us": () => new Response("nope", { status: 404 }) });
  const result = await run(server, { regions: ["us"] });
  expect(result.errors).toEqual([{ source: "roster:us", error: "about.json: not found" }]);
  // 500 is tracked, so it is still found; 502 only had a roster member, unknown without the list.
  expect(forumIds(result.store)).toEqual(["forum:500001", "forum:500030"]);
});

test("ingest: state from the per-account reader this replaced is dropped", async () => {
  const result = await run(fakeServer(), { store: { posts: [], fetched: { "forum:Linxy": { at: now.toISOString() } } } });
  expect(result.store.fetched["forum:Linxy"]).toBeUndefined();
});

test("backfill: walks every page of the Forever lists, opens every topic with a staff post, and leaves Classic alone", async () => {
  const pages = [
    list([{ id: 500, bumped: "2026-10-17T11:00:00.000Z", tracked: "community-manager" }, { id: 501, bumped: "2026-10-17T10:00:00.000Z" }], { perPage: 2, more: true }),
    list([{ id: 502, bumped: "2026-09-01T09:00:00.000Z", posters: [102] }], { perPage: 2 }),
  ];
  const server = fakeServer({ "list:us:wow-forever": (url) => jsonRes(pages[Number(url.searchParams.get("page") ?? 0)]) });
  const result = await backfillBluePosts({ store: emptyStore(), fetcher: server.fetcher, now, sleep: async () => {}, games: ["forever"], regions: ["us"], maxRequests: 100 });
  expect(result.errors).toEqual([]);
  expect(server.of("list").map((c) => c.url.split("/en/wow/")[1])).toEqual([
    "c/wow-forever/346/l/latest.json?per_page=100", "c/wow-forever/346/l/latest.json?per_page=100&page=1", "c/in-development/23/l/latest.json?per_page=100",
  ]);
  expect(server.of("bluesky")).toHaveLength(0);
  expect(forumIds(result.store)).toEqual(["forum:500001", "forum:500030", "forum:502002"]);
  expect(result).toMatchObject({ pages: 3, topics: 2 });
  // --since stops a list at older activity.
  const since = fakeServer({ "list:us:wow-forever": (url) => jsonRes(pages[Number(url.searchParams.get("page") ?? 0)]) });
  await backfillBluePosts({ store: emptyStore(), fetcher: since.fetcher, now, sleep: async () => {}, games: ["forever"], regions: ["us"], since: "2026-10-17T10:30:00.000Z" });
  expect(since.of("list").filter((c) => c.url.includes("/346/"))).toHaveLength(1);
});

test("backfill: stops cleanly at its budget", async () => {
  const server = fakeServer();
  const result = await backfillBluePosts({ store: emptyStore(), fetcher: server.fetcher, now, sleep: async () => {}, games: ["forever", "classic"], maxRequests: 4 });
  expect(server.calls).toHaveLength(4);
  expect(result.skipped).toEqual(["stopped: request budget of 4 spent"]);
});

test("the posts file never carries the fetch state", () => {
  const dir = mkdtempSync(join(tmpdir(), "blue-"));
  const path = join(dir, "blue-posts.json");
  const store: BlueStore = { posts: mergePosts(emptyStore(), parseBlueskyFeed(feed(), now)).store.posts, fetched: { bluesky: { at: now.toISOString(), etag: '"x"' } } };
  saveStore(path, store);
  expect(Object.keys(JSON.parse(readFileSync(path, "utf8")))).toEqual(["posts"]);
});

test("the store survives a write and a read, and a missing file is an empty store", () => {
  const dir = mkdtempSync(join(tmpdir(), "blue-"));
  const path = join(dir, "nested", "blue-posts.json");
  expect(loadStore(join(dir, "none.json"))).toEqual(emptyStore());
  const store = mergePosts(emptyStore(), [...parseBlueskyFeed(feed(), now), ...forumSample()]).store;
  saveStore(path, store);
  expect(loadStore(path)).toEqual(store);
});

test("posts stored before threads were kept get region, topic and post number from their link", () => {
  const old = { ...forumSample()[0], region: undefined, topicId: undefined, topicSlug: undefined, postNumber: undefined, startedThread: undefined, url: "https://us.forums.blizzard.com/en/wow/t/some-thread/2352687/14" };
  expect(withThread(old)).toMatchObject({ region: "us", topicId: 2352687, topicSlug: "some-thread", postNumber: 14, startedThread: false });
  expect(withThread({ ...old, url: "https://example.test/x" }).topicId).toBeUndefined();
  const bluesky = parseBlueskyFeed(feed(), now)[0];
  expect(withThread(bluesky)).toBe(bluesky);
});

test("loading a hand-edited store clamps every limit and drops what cannot be shown", () => {
  const dir = mkdtempSync(join(tmpdir(), "blue-"));
  const path = join(dir, "blue-posts.json");
  const good = forumSample()[0];
  writeFileSync(path, JSON.stringify({
    fetched: { bluesky: { at: "x" } },
    posts: [
      { ...good, excerpt: "One. Two. Three. Four. Five.", url: "javascript:alert(1)" },
      { ...good, id: "forum:bad-date", postedAt: "not a date" },
      { ...good, id: "forum:no-title", title: "" },
      { ...good, id: "forum:other-game", game: "retail" },
      "not an object",
    ],
  }));
  const loaded = loadStore(path);
  expect(loaded.fetched).toEqual({});
  expect(loaded.posts).toHaveLength(1);
  expect(loaded.posts[0].excerpt).toBe("One. Two.");
  expect(loaded.posts[0].url).toBeNull();
});
