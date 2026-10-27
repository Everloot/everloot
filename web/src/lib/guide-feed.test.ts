// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { GuideFrontMatter } from "../../../kb/src/guides/guide";
import current from "@/data/game-data/changes/wowf-70630.json";
import { PUBLISHED_CHANGES } from "./talents/freshness-records";
import { encodeBuild } from "./talents/share";
import { projectGuideFeed, renderGuideFeed } from "./guide-feed";

// Synthetic review/authority fixtures, not game advice or publication records.
const build = "1.0.0.1";
const code = (b = build, classSlug = "mage") => encodeBuild({ classSlug, specId: 0, build: b, ranks: {} });
const review = { by: "Reviewer", on: "2026-01-02", build };
function guide(extra: Record<string, unknown> = {}) {
  return { id: 7, slug: "test-mage", version: 2, status: "published", title: "Test <Mage> & friends", summary: "Current summary must never pretend to be historical",
    classSlug: "mage", activity: "leveling", roles: ["damage"], levels: { from: 10, to: 60 }, code: code(), author: "Author", reviewed: review, sources: [],
    history: [{ ...review, version: 1, on: "2026-01-01", note: "First <note> & \"quoted\" 'text'" }, { ...review, version: 2, note: "Second review" }], ...extra };
}
const authority = (extra: Record<string, unknown> = {}) => ({ ...current, build: { ...current.build, version: build }, live: true, spoiler: false, talents: null, ...extra });
const project = (items: unknown[] = [guide()], records: unknown[] = [authority()]) => projectGuideFeed(items, records);
afterEach(() => vi.useRealTimers());

test("strict published revisions keep their real notes, UTC dates and stable non-permalink IDs", () => {
  expect(GuideFrontMatter.safeParse(guide()).success).toBe(true);
  const items = project();
  expect(items.map((x) => x.id)).toEqual(["guide:7:v2", "guide:7:v1"]);
  const xml = renderGuideFeed(items, { baseUrl: "https://example.test" });
  expect(xml).toContain('<guid isPermaLink="false">guide:7:v1</guid>');
  expect(xml).toContain("https://example.test/guides/test-mage#version-1");
  expect(xml).toContain("Thu, 01 Jan 2026 00:00:00 GMT");
  expect(xml).toContain("First &lt;note&gt; &amp; &quot;quoted&quot; &apos;text&apos;");
  expect(xml).toContain("Test &lt;Mage&gt; &amp; friends");
  expect(xml).not.toContain("Current summary");
  expect(new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror")).toBeNull();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-08-09"));
  expect(renderGuideFeed(project(), { baseUrl: "https://example.test" })).toBe(xml);
});

test.each([ { status: "draft" }, { status: "withdrawn" }, { reviewed: null }, { history: [] }, { code: "bad" }, { surprise: true }, { reviewed: { ...review, on: "2026-02-30" }, history: [{ ...review, on: "2026-02-30", version: 1, note: "bad date" }], version: 1 } ])("refuses malformed or unpublished guide %j", (extra) => {
  expect(project([guide(extra)])).toEqual([]);
});

test.each([ { live: false }, { spoiler: true }, { live: undefined }, { schema: "bad" }, { talents: { classesAdded: [{ classId: 8, className: "Mage", spoiler: true }], classesRemoved: [], added: [], removed: [], moved: [], ranks: [], gates: [], prereqs: [], replaced: [], spellValues: [], pointLevels: [] } } ])("fails closed for unreadable/non-live/spoiler authority %j", (extra) => {
  const xml = renderGuideFeed(project([guide()], [authority(extra)]), { baseUrl: "https://example.test" });
  for (const secret of ["guide:7", "test-mage", "First", "Second", build, "<item>", "lastBuildDate"]) expect(xml).not.toContain(secret);
});

test("unknown, conflicting authority and unsafe current review/plan builds exclude every revision", () => {
  expect(project([guide()], [])).toEqual([]);
  expect(project([guide()], [authority(), authority({ live: false })])).toEqual([]);
  expect(project([guide({ code: code("9.9.9.9") })])).toEqual([]);
  expect(project([guide({ code2: code("9.9.9.9") })])).toEqual([]);
  expect(project([guide({ reviewed: { ...review, build: "9.9.9.9" }, history: [{ ...review, build: "9.9.9.9", version: 1, note: "private" }], version: 1 })])).toEqual([]);
});

test("current committed non-live retail authority grants no revision and leaks nothing", () => {
  expect(current.live).toBe(false);
  expect(current.spoiler).toBe(true);
  expect(project([guide({ code: code(current.build.version), reviewed: { ...review, build: current.build.version }, version: 1, history: [{ ...review, build: current.build.version, version: 1, note: "Hidden sentinel" }] })], [...PUBLISHED_CHANGES])).toEqual([]);
});

test("excludes an unsafe predecessor without fabricating historical bodies", () => {
  const g = guide();
  g.history[0].build = "9.9.9.9";
  expect(project([g]).map((x) => x.id)).toEqual(["guide:7:v2"]);
});

test("class filtering precedes newest 50 cap, with numeric ID/version ties deterministic", () => {
  const guides = Array.from({ length: 55 }, (_, i) => guide({ id: i + 1, slug: `test-${i + 1}` }));
  const all = project(guides);
  expect(all).toHaveLength(50);
  expect(all[0].id).toBe("guide:1:v2");
  expect(project([...guides].reverse())).toEqual(all);
  const warrior = guide({ id: 99, slug: "warrior", classSlug: "warrior", code: code(build, "warrior") });
  expect(projectGuideFeed([...guides, warrior], [authority()], "warrior").map((x) => x.id)).toEqual(["guide:99:v2", "guide:99:v1"]);
});

test("withdrawal/removal drops all history, empty feed has no made-up date or counts", () => {
  expect(project([guide({ status: "draft" })])).toEqual([]);
  const xml = renderGuideFeed(project([]), { baseUrl: "https://example.test/?a=1&b=2" });
  expect(xml).toContain('<rss version="2.0"');
  expect(xml).toContain("&amp;b=2");
  expect(xml).not.toMatch(/<item>|pubDate|lastBuildDate|count/i);
});

test("XML stays parseable with forbidden control characters in editorial text", () => {
  const xml = renderGuideFeed(project([guide({ title: "Test\u0001title" })]), { baseUrl: "https://example.test" });
  expect(new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror")).toBeNull();
  expect(xml).not.toContain("\u0001");
});

test("same-day revision ties use numeric ID then descending version; hidden revisions add no public counts", () => {
  const g = guide();
  g.history[0].on = review.on;
  const items = project([guide({ id: 10, slug: "ten" }), g, guide({ id: 2, slug: "two" }), guide({ id: 900, slug: "hidden", code: code("9.9.9.9"), title: "Hidden title sentinel" })]);
  expect(items.slice(0, 4).map((x) => x.id)).toEqual(["guide:2:v2", "guide:7:v2", "guide:7:v1", "guide:10:v2"]);
  const xml = renderGuideFeed(items, { baseUrl: "https://example.test" });
  expect(xml).not.toMatch(/hidden|guide:900|9\.9\.9\.9|count/i);
  expect(xml).toContain(`<lastBuildDate>Fri, 02 Jan 2026 00:00:00 GMT</lastBuildDate>`);
});
