import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkNews, MIN_POST_WORDS, type NewsCheckContext, type NewsFile } from "../src/news/check.js";
import { publishedWikiSlugs, readNewsPosts } from "../src/news/data.js";
import { loadPrivatePathPattern } from "../src/wiki/data.js";
import { parsePost, PostFrontMatter } from "../src/news/post.js";

const ctx: NewsCheckContext = { wikiPages: new Set(["deadmines"]), privatePaths: loadPrivatePathPattern(), today: "2026-10-25" };

const PROSE = Array.from({ length: MIN_POST_WORDS }, (_, i) => ["stone", "river", "road", "hill", "mine"][i % 5]).join(" ");

const FRONT = `---
slug: launch-week
title: Launch week on Everloot
summary: "What the site does for players in the first week of WoW: Forever."
author: Everloot team
published: 2026-10-24
tags: [site]
sources: []
status: published
---`;

const file = (source: string, path = "news/launch-week.md"): NewsFile => ({ path, source });
const messages = (files: NewsFile[], c = ctx) => checkNews(files, c).problems.map((p) => p.message);

test("hero alt preserves the full weekly description and accepts up to 500 characters", () => {
  const weekly = readNewsPosts().find((f) => f.path.includes("wow-weekly-forever-name-reservations"))!;
  const data = parsePost(weekly.source).data;
  const hero = (data as { hero: { src: string; alt: string } }).hero;
  expect(hero.alt).toHaveLength(203);
  expect(PostFrontMatter.parse(data).hero?.alt).toBe(hero.alt);
  for (const length of [203, 499, 500]) {
    expect(PostFrontMatter.safeParse({ ...data, hero: { ...hero, alt: "a".repeat(length) } }).success).toBe(true);
  }
  for (const alt of ["", " ", "a".repeat(501)]) {
    expect(PostFrontMatter.safeParse({ ...data, hero: { ...hero, alt } }).success).toBe(false);
  }
});

test("a well-formed published post passes", () => {
  const result = checkNews([file(`${FRONT}\n\n${PROSE}\n\nSee [[deadmines]] and {item:2589}.\n`)], ctx);
  expect(result.problems).toEqual([]);
  expect(result.posts[0].fm.tags).toEqual(["site"]);
});

test("the slug must match the file name and be unique", () => {
  expect(messages([file(`${FRONT}\n\n${PROSE}`, "news/other.md")])).toEqual([expect.stringContaining('slug "launch-week" must match the file name (other.md)')]);
  expect(messages([file(`${FRONT}\n\n${PROSE}`), file(`${FRONT}\n\n${PROSE}`, "news/launch-week.md")])).toContainEqual(expect.stringContaining("already used by"));
});

test("a published post needs enough prose, a date not after today, and no # heading", () => {
  expect(messages([file(`${FRONT}\n\nShort.`)])).toContainEqual(expect.stringContaining(`at least ${MIN_POST_WORDS} words`));
  expect(messages([file(`${FRONT}\n\n> ${PROSE}`)])).toContainEqual(expect.stringContaining("words of its own prose; this one has 0"));
  expect(messages([file(`${FRONT.replace("2026-10-24", "2026-11-01")}\n\n${PROSE}`)])).toContainEqual(expect.stringContaining("after today"));
  expect(messages([file(`${FRONT}\n\n# Title again\n\n${PROSE}`)])).toContainEqual(expect.stringContaining("no # heading"));
  // A draft may be dated ahead and may be short: it is not built.
  expect(messages([file(`${FRONT.replace("2026-10-24", "2026-11-01").replace("status: published", "status: draft")}\n\nShort.`)])).toEqual([]);
});

test("links and tokens are checked", () => {
  expect(messages([file(`${FRONT}\n\n${PROSE} [[not-a-page]]`)])).toContainEqual(expect.stringContaining("[[not-a-page]] links to a wiki page that is not published"));
  expect(messages([file(`${FRONT}\n\n${PROSE} {spell:5}`)])).toContainEqual(expect.stringContaining('"{spell:5}" is not a token'));
});

test("updated cannot be before published, and AI credits are refused", () => {
  expect(messages([file(`${FRONT.replace("tags: [site]", "tags: [site]\nupdated: 2026-10-01")}\n\n${PROSE}`)])).toContainEqual(expect.stringContaining("updated (2026-10-01) is before published"));
  expect(messages([file(`${FRONT}\n\n${PROSE} Generated with ChatGPT.`)])).toContainEqual(expect.stringContaining("credits an AI tool"));
});

test("a file without front matter is one problem", () => {
  expect(messages([file("Just words.")])).toEqual(["the page must start with front matter between --- lines"]);
});

test("the committed posts pass, and a folder's README is not a post", () => {
  const dir = mkdtempSync(join(tmpdir(), "news-"));
  writeFileSync(join(dir, "README.md"), "# not a post");
  writeFileSync(join(dir, "launch-week.md"), `${FRONT}\n\n${PROSE}\n`);
  expect(readNewsPosts(dir).map((f) => f.path)).toEqual(["news/launch-week.md"]);
  const committed = checkNews(readNewsPosts(), { ...ctx, wikiPages: publishedWikiSlugs(), today: new Date().toISOString().slice(0, 10) });
  expect(committed.problems).toEqual([]);
});
