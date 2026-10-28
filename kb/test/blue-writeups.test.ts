import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { loadStore } from "../src/blue-posts.js";
import { compileWriteups, parseWriteupFile, sanitizeWriteup, writeupsById } from "../src/blue-writeups.js";
import { postIdOfSegment, postPageId, postPath, renderFeed, buildTimeline } from "../src/changes.js";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const fixture = readFileSync(here("./fixtures/blue/writeups/us-70000001.md"), "utf8");

test("a post's page id comes from its stored id and reads back to it, whatever the slug", () => {
  expect(postPageId("forum:30553826")).toBe("us-30553826");
  expect(postPageId("forum:eu:6443686")).toBe("eu-6443686");
  expect(postPageId("bluesky:3mydklukhq22f")).toBe("bsky-3mydklukhq22f");
  expect(postPageId("build:wow_classic_beta:aaa")).toBeNull();
  for (const id of ["forum:30553826", "forum:eu:6443686", "bluesky:3mydklukhq22f"]) {
    expect(postIdOfSegment(postPageId(id)!)).toBe(id);
    expect(postIdOfSegment(`${postPageId(id)}-any-old-slug`)).toBe(id);
  }
  for (const bad of ["30553826", "us-", "us-abc", "xx-1", "bsky-", "forum:1", "eu-12/34"]) expect(postIdOfSegment(bad), bad).toBeNull();
  expect(postPath({ id: "forum:eu:6443686", title: "Claim Your World of Warcraft: Forever Character Names" }))
    .toBe("/changes/eu-6443686-claim-your-world-of-warcraft-forever-character-names");
  expect(postPath({ id: "bluesky:abc", title: "!!!" })).toBe("/changes/bsky-abc");
  expect(postPath({ id: "build:x", title: "WoW: Forever build 1" })).toBeNull();
});

test("every stored post has a page address, and no two posts share one", () => {
  const posts = loadStore(here("../changes/blue-posts.json")).posts;
  const paths = posts.map((p) => postPath(p));
  expect(paths.every((p) => p !== null)).toBe(true);
  expect(new Set(paths).size).toBe(posts.length);
  expect(posts.every((p) => postIdOfSegment(postPath(p)!.slice("/changes/".length)) === p.id)).toBe(true);
  // Every post page links the original.
  expect(posts.every((p) => p.url && /^https:\/\/(?:us|eu)\.forums\.blizzard\.com\/|^https:\/\/bsky\.app\//.test(p.url))).toBe(true);
});

test("a write-up file: front matter, our words, named by its page id", () => {
  const w = parseWriteupFile("us-70000001.md", fixture);
  expect(w).toEqual({
    postId: "forum:70000001",
    reviewed: { by: "Test Maintainer", on: "2026-10-21" },
    body: expect.stringMatching(/^The beta realms go down[\s\S]*\(https:\/\/everloot\.app\/changes\) for later posts\.$/),
  });
  expect(() => parseWriteupFile("eu-70000001.md", fixture)).toThrow("must be named us-70000001.md");
  expect(() => parseWriteupFile("us-70000001.md", "no front matter")).toThrow("no front matter");
  expect(() => parseWriteupFile("us-70000001.md", fixture.replace("2026-10-21", "October 21"))).toThrow("reviewed.on");
  expect(() => parseWriteupFile("us-70000001.md", fixture.replace("Nothing to prepare.", "<script>x</script>"))).toThrow("HTML");
  expect(() => parseWriteupFile("us-70000001.md", fixture.replace(/ {2}by: Test Maintainer\r?\n/, ""))).toThrow("reviewed.by");
  expect(() => parseWriteupFile("us-70000001.md", `${fixture}${"x".repeat(6001)}`)).toThrow("longer than");
  expect(() => compileWriteups([{ name: "us-70000001.md", text: fixture }], new Set(["forum:1"]))).toThrow("no stored post forum:70000001");
});

test("a draft is checked like a write-up but never bundled, so its page shows none of it", () => {
  const draft = fixture.replace(/reviewed:\r?\n {2}by: Test Maintainer\r?\n {2}on: 2026-10-21/, "draft: true");
  expect(parseWriteupFile("us-70000001.md", draft)).toEqual({ postId: "forum:70000001", draft: true, body: expect.stringMatching(/^The beta realms go down/) });
  expect(compileWriteups([{ name: "us-70000001.md", text: draft }], new Set(["forum:70000001"]))).toEqual([]);
  expect(() => compileWriteups([{ name: "us-70000001.md", text: draft }], new Set(["forum:1"]))).toThrow("no stored post forum:70000001");
  expect(() => parseWriteupFile("us-70000001.md", draft.replace("Nothing to prepare.", "<b>x</b>"))).toThrow("HTML");
  expect(() => parseWriteupFile("us-70000001.md", draft.replace("draft: true", "draft: yes"))).toThrow('draft is "true" or left out');
  expect(() => parseWriteupFile("us-70000001.md", fixture.replace("postId: forum:70000001", "postId: forum:70000001\ndraft: true"))).toThrow("a draft has no reviewed block");
});

test("the bundled store is re-checked on the way in", () => {
  const good = parseWriteupFile("us-70000001.md", fixture);
  expect(sanitizeWriteup(good)).toEqual(good);
  expect(sanitizeWriteup({ ...good, body: "<b>x</b>" })).toBeNull();
  expect(sanitizeWriteup({ ...good, postId: "build:x" })).toBeNull();
  expect(sanitizeWriteup({ ...good, reviewed: { by: "A", on: "2026-02-30" } })).toBeNull();
  expect([...writeupsById({ writeups: [good, { nope: 1 }] }).keys()]).toEqual(["forum:70000001"]);
  expect(writeupsById(null).size).toBe(0);
});

test("kb/curated/blue-writeups.json is what the Markdown folder compiles to, for posts the store holds", () => {
  const dir = here("../curated/blue-writeups/");
  const files = existsSync(dir) ? readdirSync(dir).map((name) => ({ name, text: readFileSync(`${dir}${name}`, "utf8") })) : [];
  const known = new Set(loadStore(here("../changes/blue-posts.json")).posts.map((p) => p.id));
  const bundled = JSON.parse(readFileSync(here("../curated/blue-writeups.json"), "utf8"));
  expect(bundled.writeups, "run: npm run kb -- blue-writeups").toEqual(compileWriteups(files, known));
});

test("RSS: a post links to its Everloot page and still names the original", () => {
  const post = { id: "forum:70000001", source: "forum", region: "us", url: "https://us.forums.blizzard.com/en/wow/t/x/9000001", title: "Synthetic notice", author: "A", role: "B", postedAt: "2026-10-16T22:00:00Z", category: "C", game: "forever", kind: "post", excerpt: "One. Two." };
  const xml = renderFeed(buildTimeline([post], []), { baseUrl: "https://everloot.app", now: new Date("2026-10-17T00:00:00Z") });
  expect(xml).toContain("<link>https://everloot.app/changes/us-70000001-synthetic-notice</link>");
  expect(xml).toContain("Original: https://us.forums.blizzard.com/en/wow/t/x/9000001</description>");
  expect(xml).toContain('<guid isPermaLink="false">forum:70000001</guid>');
});
