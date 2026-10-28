import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";
import { spyOnQueries } from "@/test/release-queries";
import { firstSentence, isIndexable, loreSlug, parseLoreSlug, renderBody, slugify } from "./lore";

describe("slugify", () => {
  test("lowercases and joins letter and digit runs with hyphens", () => {
    expect(slugify("Zeth'Kur")).toBe("zeth-kur");
    expect(slugify("Stones, Moss, and Tears")).toBe("stones-moss-and-tears");
    expect(slugify("Dongle/Core API")).toBe("dongle-core-api");
  });
  test("strips accents and drops anything that is not ASCII", () => {
    expect(slugify("Jaina Proudmoore – Élan")).toBe("jaina-proudmoore-elan");
    expect(slugify("Зул'Гуруб")).toBe("");
    expect(slugify("!!!")).toBe("");
  });
  test("caps the slug at 80 characters", () => {
    expect(slugify("a".repeat(200)).length).toBe(80);
  });
});

describe("loreSlug and parseLoreSlug", () => {
  test("round-trips a wiki page", () => {
    const slug = loreSlug({ extId: "291323", name: "Frostwhisper" });
    expect(slug).toBe("291323-frostwhisper");
    expect(parseLoreSlug(slug)).toEqual({ extId: "291323", nameSlug: "frostwhisper" });
  });
  test("keeps the id when the name slugifies to nothing", () => {
    const slug = loreSlug({ extId: "77", name: "Зул'Гуруб" });
    expect(slug).toBe("77-");
    expect(parseLoreSlug(slug)).toEqual({ extId: "77", nameSlug: "" });
    expect(parseLoreSlug("77")).toEqual({ extId: "77", nameSlug: "" });
  });
  test("a curated kebab id is the whole slug", () => {
    expect(loreSlug({ extId: "forever-launch-date", name: "WoW Forever launch date" })).toBe("forever-launch-date");
    expect(parseLoreSlug("forever-launch-date")).toEqual({ extId: "forever-launch-date", nameSlug: "" });
  });
  test("rejects empty, leading zeros, uppercase and spaces", () => {
    expect(parseLoreSlug("")).toBeNull();
    expect(parseLoreSlug("01-thrall")).toBeNull();
    expect(parseLoreSlug("291323-Frost whisper")).toBeNull();
    expect(parseLoreSlug("291323-frost/whisper")).toBeNull();
  });
});

describe("isIndexable", () => {
  test("needs 300 characters and no redirect", () => {
    expect(isIndexable("x".repeat(299))).toBe(false);
    expect(isIndexable("x".repeat(300))).toBe(true);
    expect(isIndexable(`#REDIRECT [[Thrall]] ${"x".repeat(300)}`)).toBe(false);
    expect(isIndexable(`A road that redirected travellers. ${"x".repeat(300)}`)).toBe(true);
  });
});

describe("renderBody", () => {
  test("splits paragraphs on blank lines and groups bullet lines", () => {
    expect(renderBody("Intro.\n\n * a\n * b\n\nEnd.")).toEqual([
      { type: "p", text: "Intro." },
      { type: "ul", items: ["a", "b"] },
      { type: "p", text: "End." },
    ]);
  });
  test("a body of only bullets is one list, and CRLF endings are fine", () => {
    expect(renderBody("* one\r\n* two\r\n")).toEqual([{ type: "ul", items: ["one", "two"] }]);
  });
  test("never emits empty blocks", () => {
    expect(renderBody("\n\n  \n\nOnly.\n\n\n")).toEqual([{ type: "p", text: "Only." }]);
  });
});

describe("firstSentence", () => {
  test("stops at the first sentence end", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("One.\nTwo.")).toBe("One.");
  });
  test("a bullet-first body reads as a list of its items, never a leading asterisk", () => {
    expect(firstSentence(" * Ras Frostwhisper - a boss lich\n * Frostwhisper Gorge - a subzone\n\nMore.")).toBe("Ras Frostwhisper - a boss lich; Frostwhisper Gorge - a subzone");
    expect(firstSentence("* only one")).toBe("only one");
  });
  test("cuts a long sentence on a word boundary with an ellipsis", () => {
    const out = firstSentence(`${"word ".repeat(100)}end`);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/ …$/);
  });
});

describe("with a release", () => {
  let release = "";

  beforeAll(async () => { release = await buildLoreRelease(); });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function lore(path = release) {
    vi.stubEnv("KB_SNAPSHOT_PATH", path);
    return import("./lore");
  }

  test("loreByExtId returns the row with its categories, or null", async () => {
    const { loreByExtId } = await lore();
    const page = await loreByExtId("1");
    expect(page).toMatchObject({ extId: "1", name: "Thrall", categories: ["Orcs", "Warchiefs"], revisionTimestamp: "2023-01-14T21:40:10Z", licence: "CC-BY-SA-4.0", retrievedAt: "2023-11-13", gameVersion: "lore", sourceId: "warcraft-wiki-2023" });
    expect(await loreByExtId("forever-launch-date")).toMatchObject({ gameVersion: "forever", sourceId: "curated", categories: [], revisionTimestamp: null });
    expect(await loreByExtId("999")).toBeNull();
  });

  test("loreForEntity matches the exact name within the type, any case, and gives the first paragraph", async () => {
    const { loreForEntity } = await lore();
    const thrall = await loreForEntity("npc", "thrall");
    expect(thrall).toMatchObject({ extId: "1", name: "Thrall" });
    expect(thrall !== "unavailable" && thrall?.intro.startsWith("Thrall is the former Warchief of the Horde.")).toBe(true);
    // Same name, two types: each type finds its own page.
    expect(await loreForEntity("npc", "Return to Sender")).toMatchObject({ extId: "4" });
    expect(await loreForEntity("quest", "Return to Sender")).toMatchObject({ extId: "5" });
  });

  test("loreForEntity finds nothing for a wrong type, a redirect, a partial name or an empty name", async () => {
    const { loreForEntity } = await lore();
    expect(await loreForEntity("item", "Thrall")).toBeNull();
    expect(await loreForEntity("npc", "Old Name")).toBeNull();
    expect(await loreForEntity("npc", "Thral")).toBeNull();
    expect(await loreForEntity("npc", "  ")).toBeNull();
  });

  test("loreForEntity answers from memory the second time and is unavailable without a release", async () => {
    const mod = await lore();
    const first = await mod.loreForEntity("npc", "Thrall");
    expect(await mod.loreForEntity("npc", "THRALL")).toBe(first);
    vi.resetModules();
    const missing = await lore(join(tmpdir(), "missing-release.sqlite"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await missing.loreForEntity("npc", "Thrall")).toBe("unavailable");
  });

  test("firstParagraph is the opening paragraph, cut on a word, and empty for a body that opens with a list", async () => {
    const { firstParagraph } = await lore();
    expect(firstParagraph("One short opening.\n\nSecond paragraph.")).toBe("One short opening.");
    expect(firstParagraph(`${"word ".repeat(200)}`, 40).endsWith("…")).toBe(true);
    expect(firstParagraph(" * a\n * b\n\nThen text.")).toBe("");
  });

  test("searchLore pages 20 at a time and knows when a next page exists", async () => {
    const { searchLore } = await lore();
    const first = await searchLore("grommash", 1);
    expect(first).not.toBe("unavailable");
    if (first === "unavailable") return;
    expect(first.hits).toHaveLength(20);
    expect(first.hasNext).toBe(true);
    expect(first.hits[0].extId).toMatch(/^1\d\d$/);
    const second = await searchLore("grommash", 2);
    expect(second).toMatchObject({ hasNext: false });
    expect(second !== "unavailable" && second.hits).toHaveLength(2);
    const third = await searchLore("grommash", 3);
    expect(third).toEqual({ hits: [], hasNext: false });
  });

  test("searchLore survives stopwords, FTS syntax, bad pages and long queries", async () => {
    const { searchLore } = await lore();
    await expect(searchLore("the", 1)).resolves.not.toThrow();
    await expect(searchLore('thrall OR * "', 1)).resolves.not.toThrow();
    expect(await searchLore("grommash", 0)).toMatchObject({ hasNext: true });
    expect(await searchLore("grommash", Number.NaN)).toMatchObject({ hasNext: true });
    await expect(searchLore("grommash ".repeat(100), 1)).resolves.not.toThrow();
  });

  test("searchLore caps the page number and never reaches huge LIMITs", async () => {
    const { searchLore, MAX_PAGE } = await lore();
    expect(MAX_PAGE).toBe(50);
    expect(await searchLore("grommash", 1e300)).toEqual({ hits: [], hasNext: false });
    expect(await searchLore("grommash", 51)).toEqual({ hits: [], hasNext: false });
  });

  test("searchLore returns lore pages only, never curated items", async () => {
    const { searchLore } = await lore();
    const result = await searchLore("grommash", 2);
    expect(result !== "unavailable" && result.hits.map((h) => h.kind)).not.toContain("item");
    expect(result !== "unavailable" && result.hits).toHaveLength(2);
  });

  test("the full-page count follows the 300-character, no-redirect rule", async () => {
    const { indexableCount } = await lore();
    expect(await indexableCount()).toBe(28);
  });

  test("indexableCount runs its scan once per opened release", async () => {
    const { indexableCount } = await lore();
    const { getRelease } = await import("./release");
    const spy = spyOnQueries((await getRelease())!.db);
    expect(await indexableCount()).toBe(28);
    expect(await indexableCount()).toBe(28);
    expect(spy.mock.calls.filter(([sql]) => /count\(\*\)/.test(String(sql)))).toHaveLength(1);
  });

  test("every lookup reports unavailable when the release cannot be opened", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { loreByExtId, searchLore, indexableCount } = await lore(join(tmpdir(), "missing.sqlite"));
    expect(await loreByExtId("1")).toBe("unavailable");
    expect(await searchLore("thrall", 1)).toBe("unavailable");
    expect(await indexableCount()).toBe("unavailable");
  });
});

describe("types, facets and browsing", () => {
  let release = "";
  beforeAll(async () => { release = await buildLoreRelease(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  async function lore(path = release) { vi.stubEnv("KB_SNAPSHOT_PATH", path); return import("./lore"); }

  test("parseLetter accepts a-z and # only", async () => {
    const { parseLetter } = await lore();
    expect(parseLetter(undefined)).toBe("a");
    expect(parseLetter("A")).toBe("a");
    expect(parseLetter("z")).toBe("z");
    expect(parseLetter("#")).toBe("#");
    expect(parseLetter("other")).toBe("#");
    for (const bad of ["é", "ab", "1", ""]) expect(parseLetter(bad)).toBeNull();
  });

  test("browse lists a type by letter, ordered by name, 50 per page", async () => {
    const { browse, BROWSE_PAGE_SIZE } = await lore();
    expect(BROWSE_PAGE_SIZE).toBe(50);
    const zones = await browse("zone", "z", {}, 1);
    expect(zones).not.toBe("unavailable");
    if (zones === "unavailable") return;
    expect(zones.rows).toHaveLength(22);
    expect(zones.rows[0].name).toBe("Zone 1");
    expect(zones.rows[1].name).toBe("Zone 10");
    expect(zones.hasNext).toBe(false);
    expect(await browse("zone", "r", {}, 1)).toMatchObject({ rows: [{ extId: "6", name: "Redirected Road" }] });
  });

  test("lettersWithRows lists only the letters a type has pages under", async () => {
    const { lettersWithRows } = await lore();
    expect(await lettersWithRows("npc")).toEqual(["r", "t", "z"]);
    expect(await lettersWithRows("quest")).toEqual(["r", "#"]);
    expect(await lettersWithRows("zone")).toEqual(["r", "z"]);
    expect(await lettersWithRows("item")).toEqual([]);
  });

  test("lettersWithRows reads the manifest without querying the release", async () => {
    const { lettersWithRows } = await lore();
    const { getRelease } = await import("./release");
    const spy = spyOnQueries((await getRelease())!.db);
    expect(await lettersWithRows("npc")).toEqual(["r", "t", "z"]);
    expect(spy).not.toHaveBeenCalled();
  });

  test("browse filters by one facet value, bound exactly", async () => {
    const { browse } = await lore();
    const legion = await browse("zone", "z", { expansion: "Legion" }, 1);
    expect(legion !== "unavailable" && legion.rows).toHaveLength(11);
    expect(await browse("npc", "z", { zone: "Zul'Gurub" }, 1)).toMatchObject({ rows: [{ extId: "7" }] });
    expect(await browse("quest", "#", {}, 1)).toMatchObject({ rows: [{ extId: "8", name: "100% Done" }] });
    expect(await browse("npc", "t", { race: "Tauren" }, 1)).toEqual({ rows: [], hasNext: false });
    expect(await browse("npc", "t", { race: "Orc" }, 1)).toMatchObject({ rows: [{ extId: "1" }] });
    expect(await browse("zone", "z", {}, 2)).toEqual({ rows: [], hasNext: false });
  });

  test("facetValues lists the values present for a type, memoized per release", async () => {
    const { facetValues } = await lore();
    const { getRelease } = await import("./release");
    const spy = spyOnQueries((await getRelease())!.db);
    const zone = await facetValues("zone");
    expect(zone !== "unavailable" && zone.expansion).toEqual(["Battle for Azeroth", "Legion"]);
    expect(zone !== "unavailable" && zone.race).toEqual([]);
    const npc = await facetValues("npc");
    expect(npc !== "unavailable" && npc.zone).toEqual(["Zul'Gurub"]);
    const before = spy.mock.calls.length;
    await facetValues("zone");
    expect(spy.mock.calls.length).toBe(before);
  });

  test("facetValues and coverage read the manifest summaries without scanning", async () => {
    const { facetValues, coverage } = await lore();
    const { getRelease } = await import("./release");
    const spy = spyOnQueries((await getRelease())!.db);
    const npc = await facetValues("npc");
    expect(npc !== "unavailable" && npc.race).toEqual(["Orc"]);
    expect(npc !== "unavailable" && npc.zone).toEqual(["Zul'Gurub"]);
    const c = await coverage();
    expect(c !== "unavailable" && c.facets.expansion).toEqual([{ value: "Battle for Azeroth", n: 11 }, { value: "Legion", n: 11 }]);
    expect(spy.mock.calls.some(([sql]) => String(sql).includes("json_each"))).toBe(false);
  });

  test("a typed release whose manifest has no facet totals is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = await buildLoreRelease({ facets: false });
    const { browse, facetValues, coverage } = await lore(broken);
    expect(await browse("zone", "z", {}, 1)).toBe("unavailable");
    expect(await facetValues("zone")).toBe("unavailable");
    expect(await coverage()).toBe("unavailable");
  });

  test("hasTypes and typeCounts read the manifest", async () => {
    const { hasTypes, typeCounts } = await lore();
    expect(await hasTypes()).toBe(true);
    expect(await typeCounts()).toEqual({ npc: 3, quest: 2, zone: 23, other: 4 });
  });

  test("searchLore can be limited to one type", async () => {
    const { searchLore } = await lore();
    const zones = await searchLore("grommash", 1, "zone");
    expect(zones !== "unavailable" && zones.hits.every((h) => /^1\d\d$/.test(h.extId))).toBe(true);
    expect(await searchLore("thrall", 1, "quest")).toEqual({ hits: [], hasNext: false });
    const thrall = await searchLore("thrall", 1, "npc");
    expect(thrall !== "unavailable" && thrall.hits.map((h) => h.extId)).toContain("1");
  });

  test("coverage summarises the release", async () => {
    const { coverage } = await lore();
    const c = await coverage();
    expect(c).not.toBe("unavailable");
    if (c === "unavailable") return;
    expect(c.types?.zone).toBe(23);
    expect(c.damaged).toBe(1);
    expect(c.indexable).toBe(28);
    expect(c.createdAt).toBe("2026-10-15T00:00:00.000Z");
    expect(c.facets.expansion).toEqual([{ value: "Battle for Azeroth", n: 11 }, { value: "Legion", n: 11 }]);
    expect(c.facets.race).toEqual([{ value: "Orc", n: 1 }]);
  });

  test("loreByExtId exposes type, facets and infobox", async () => {
    const { loreByExtId } = await lore();
    expect(await loreByExtId("1")).toMatchObject({ type: "npc", facets: { race: ["Orc"], class: ["Shaman"] }, infobox: { template: "npcbox", fields: { title: "Warchief" } } });
    expect(await loreByExtId("2")).toMatchObject({ type: null, facets: null, infobox: null });
  });

  test("a release without type data reports no types", async () => {
    const untyped = await buildLoreRelease({ typed: false });
    const { hasTypes, typeCounts, browse, coverage, lettersWithRows } = await lore(untyped);
    expect(await hasTypes()).toBe(false);
    expect(await lettersWithRows("zone")).toEqual([]);
    expect(await typeCounts()).toBeNull();
    expect(await browse("zone", "z", {}, 1)).toEqual({ rows: [], hasNext: false });
    const c = await coverage();
    expect(c !== "unavailable" && c.types).toBeNull();
    expect(c !== "unavailable" && c.facets.expansion).toEqual([]);
  });

  test("everything is unavailable without a release", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { browse, facetValues, hasTypes, lettersWithRows, typeCounts, coverage } = await lore(join(tmpdir(), "missing.sqlite"));
    expect(await browse("zone", "a", {}, 1)).toBe("unavailable");
    expect(await facetValues("zone")).toBe("unavailable");
    expect(await hasTypes()).toBe("unavailable");
    expect(await lettersWithRows("zone")).toBe("unavailable");
    expect(await typeCounts()).toBe("unavailable");
    expect(await coverage()).toBe("unavailable");
  });
});
