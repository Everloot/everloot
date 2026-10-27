import { afterEach, expect, test, vi } from "vitest";
import { encodeBuild } from "@/lib/talents/share";
import current from "@/data/game-data/changes/wowf-70630.json";
const state = vi.hoisted(() => ({ guides: new Map(), records: [] as unknown[] }));
vi.mock("@/lib/guides", async (original) => ({ ...await original<typeof import("@/lib/guides")>(), loadGuides: () => state.guides }));
vi.mock("@/lib/talents/freshness-records", () => ({ PUBLISHED_CHANGES: state.records }));
import { GET } from "./route";
import { GET as globalGET } from "../../../guides/feed.xml/route";
afterEach(() => { state.guides.clear(); state.records.length = 0; });
const request = new Request("https://example.test/classes/mage/feed.xml?draft=1&spoilers=1&private=1");
const get = (slug: string) => GET(request, { params: Promise.resolve({ class: slug }) });

test.each(["unknown", "constructor", "toString", "__proto__", "Mage"])("unknown/prototype class %s is 404", async (slug) => {
  const response = await get(slug);
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain("<rss");
});

test("empty class feed is valid and no query grants draft/spoiler access", async () => {
  expect((await get("mage")).status).toBe(200);
  expect(await (await get("mage")).text()).not.toMatch(/<item>|lastBuildDate/);
});

test("global and class routes share published projection, filter classes, and drop withdrawn/removed history", async () => {
  const build = "1.0.0.1";
  state.records.push({ ...current, build: { ...current.build, version: build }, live: true, spoiler: false, talents: null });
  for (const [id, classSlug] of [[7, "mage"], [8, "warrior"]] as const) {
    const reviewed = { by: "Reviewer", on: "2026-01-01", build };
    state.guides.set(classSlug, { id, slug: classSlug, version: 1, status: "published", classSlug, title: `${classSlug} sentinel`, summary: "Not a historical body", code: encodeBuild({ classSlug, specId: 0, build, ranks: {} }), author: "Author", activity: "leveling", roles: ["damage"], levels: { from: 10, to: 60 }, reviewed, sources: [], history: [{ ...reviewed, version: 1, note: `${classSlug} history` }], blocks: [] });
  }
  const global = await globalGET().text();
  const mage = await (await get("mage")).text();
  expect(global).toContain("guide:7:v1");
  expect(global).toContain("guide:8:v1");
  expect(mage.match(/<item>[\s\S]*?<\/item>/g)).toEqual(global.match(/<item>[\s\S]*?<\/item>/g)?.filter((x) => x.includes("guide:7:")));
  expect(mage).not.toContain("warrior sentinel");
  state.guides.get("mage").status = "draft";
  expect(await (await get("mage")).text()).not.toContain("mage history");
  state.guides.delete("warrior");
  expect(await globalGET().text()).not.toContain("<item>");
  state.guides.get("mage").status = "published";
  state.records[0] = current;
  expect(await (await get("mage")).text()).not.toContain("guide:7");
});
