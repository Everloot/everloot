// @vitest-environment jsdom
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import type { Metadata } from "next";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

// Every class reads the made-up test tree, at the build a test sets and with the nodes it takes out; the change
// records are the ones a test puts in. Not game data.
const trees = vi.hoisted(() => ({ build: "1.0.0.1", without: [] as number[] }));
const records = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/talents/catalogs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/talents/catalogs")>();
  const { fixture } = await import("@/lib/talents/fixture");
  return {
    ...real,
    loadCatalog: async (slug: string) => ({
      ...fixture, classSlug: slug, className: slug[0].toUpperCase() + slug.slice(1), build: trees.build,
      nodes: fixture.nodes.filter((n) => !trees.without.includes(n.id)),
    }),
  };
});
vi.mock("@/lib/talents/freshness-records", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/talents/freshness-records")>()), PUBLISHED_CHANGES: records }));

import GuidesIndex, * as indexRoute from "./page";
import GuidePage, * as guideRoute from "./[slug]/page";
import GuideImage, * as imageRoute from "./[slug]/opengraph-image";
import GuidePlan, { guideAddonLink, guideCalculatorHref } from "@/components/guides/GuidePlan";
import { tokens } from "@/design/tokens";
import { guideFreshness } from "@/lib/guide-freshness";
import { loadGuides, publishedGuide } from "@/lib/guides";
import { fittedTitle } from "@/lib/og-card";
import { loadCatalog } from "@/lib/talents/catalogs";
import { classTalentChanges } from "@/lib/talents/freshness-records";
import { fixture } from "@/lib/talents/fixture";
import { importPlan, readPlanHash } from "@/lib/talents/import";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";
import type { Ranks } from "@/lib/talents/types";

/* ---------- Fixture guides ---------- */

// Set 1: 11 points, 21 taken once row 1 holds 5. Set 2: 7 points on the right, 52 once 6 are spent anywhere.
const RANKS: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 21: { rank: 1 } };
const ORDER = [11, 11, 11, 11, 11, 21, 12, 12, 12, 12, 12];
const RANKS2: Ranks = { 51: { rank: 5 }, 53: { rank: 1 }, 52: { rank: 1 } };
const ORDER2 = [51, 51, 51, 51, 51, 53, 52];
const code = (classSlug: string, ranks: Ranks, build = "1.0.0.1") => encodeBuild({ classSlug, specId: fixture.specId, build, ranks });
const PLANNED = encodeOrder(RANKS, ORDER, "planned")!;
const PLANNED2 = encodeOrder(RANKS2, ORDER2, "planned")!;
const PROVISIONAL = encodeOrder(RANKS, ORDER, "provisional")!;

const SECTIONS = ["Who it is for", "Why this plan", "How to play it", "What we do not know yet"];
// Test text, not advice: 12 words a sentence, 48 a section, 192 in all.
const FILLER = "This sentence is test text for the guide page, not game advice.";
const SOURCE = { title: "A Blizzard post", url: "https://news.blizzard.com/en-us/article/1/test-post", checkedOn: "2026-10-19" };

interface FixtureGuide {
  slug: string; title?: string; classSlug?: string; status?: "draft" | "published"; activity?: string; roles?: string; levels?: string; summary?: string;
  /** null leaves the order out. */
  order?: string | null;
  second?: boolean; reviewed?: boolean; versions?: 1 | 2; sources?: boolean; thin?: boolean; built?: string;
  /** The game build the shown version was reviewed against. */
  reviewedBuild?: string;
  /** A sentence of links, added to the second section. */
  links?: string;
}

function guideFile(g: FixtureGuide, id: number): string {
  const classSlug = g.classSlug ?? "mage";
  const published = (g.status ?? "published") === "published";
  const reviewed = g.reviewed ?? published;
  const build = g.reviewedBuild ?? "1.0.0.1";
  const history = !reviewed ? "[]" : g.versions === 2
    ? `[{ version: 1, on: 2026-09-01, by: Kai, build: 1.0.0.1, note: First published version. }, { version: 2, on: 2026-10-20, by: Kai, build: ${build}, note: The second set is added. }]`
    : `[{ version: 1, on: 2026-10-20, by: Kai, build: ${build}, note: First published version. }]`;
  const lines = [
    "---", `id: ${id}`, `slug: ${g.slug}`, `version: ${reviewed ? g.versions ?? 1 : 1}`, `status: ${published ? "published" : "draft"}`,
    `title: ${g.title ?? "Frost leveling"}`, `summary: "${g.summary ?? "A test guide summary for the fixture tree, long enough to stand as the page's meta description in search results."}"`,
    `classSlug: ${classSlug}`, `activity: ${g.activity ?? "leveling"}`, `roles: ${g.roles ?? "[damage]"}`, `levels: ${g.levels ?? "{ from: 10, to: 60 }"}`,
    `code: ${code(classSlug, RANKS, g.built)}`,
    ...(g.order === null ? [] : [`order: ${g.order ?? PLANNED}`]),
    ...(g.second ? [`code2: ${code(classSlug, RANKS2, g.built)}`, `order2: ${PLANNED2}`] : []),
    "author: Robin",
    `reviewed: ${reviewed ? `{ by: Kai, on: 2026-10-20, build: ${build} }` : "null"}`,
    `sources: ${g.sources ? `[{ title: ${SOURCE.title}, url: "${SOURCE.url}", checkedOn: ${SOURCE.checkedOn} }]` : "[]"}`,
    `history: ${history}`, "---", "",
  ];
  const body = SECTIONS.map((h, i) => `## ${h}\n\n${g.thin ? "Test words." : `${FILLER} ${FILLER} ${FILLER} ${FILLER}`}${i === 1 && g.sources ? ` [Blizzard's post](${SOURCE.url}) says so.` : ""}${i === 1 && g.links ? ` ${g.links}` : ""}\n`).join("\n");
  return `${lines.join("\n")}${body}`;
}

/** A fresh guides folder (the reader keeps one copy per folder), pointed at through GUIDES_DIR. */
function stubGuides(guides: FixtureGuide[]): void {
  const dir = mkdtempSync(join(tmpdir(), "guide-pages-"));
  writeFileSync(join(dir, "README.md"), "# not a guide");
  guides.forEach((g, i) => writeFileSync(join(dir, `${g.slug}.md`), guideFile(g, i + 1)));
  vi.stubEnv("GUIDES_DIR", dir);
}

const SOME: FixtureGuide[] = [
  { slug: "frost-leveling", second: true, versions: 2, sources: true },
  { slug: "fire-draft", title: "Fire draft", status: "draft", reviewed: false },
  { slug: "unreviewed", title: "Unreviewed", reviewed: false },
  { slug: "provisional", title: "Provisional order", order: PROVISIONAL },
  { slug: "arcane-dungeons", title: "Arcane in dungeons", activity: "dungeons", levels: "{ from: 40, to: 60 }", order: null },
  { slug: "warrior-tanking", title: "Warrior tanking", classSlug: "warrior", activity: "dungeons", roles: "[tank, damage]", levels: "{ from: 20, to: 60 }" },
];
const HIDDEN = ["fire-draft", "unreviewed", "provisional"];

// Change records in the build watch's shape (kb/src/build-watch/changes.ts), as freshness.test.ts makes them.
const EMPTY = { classesAdded: [], classesRemoved: [], added: [], removed: [], moved: [], ranks: [], gates: [], prereqs: [], replaced: [], spellValues: [], pointLevels: [] };
const ref = (version: string) => ({ version, buildId: Number(version.split(".").at(-1)), buildConfig: `config-${version}` });
const record = (build: string, previous: string, talents: Record<string, unknown[]> = {}) => ({
  schema: "everloot.game-changes/2", label: "found in game files, unconfirmed", id: `test-${ref(build).buildId}`, product: "test", live: true, spoiler: false,
  detectedAt: "2026-10-01T00:00:00.000Z", build: ref(build), previous: ref(previous), initial: false, encryptedBlocks: { total: 0, tables: [] },
  source: { definitions: null, library: "test", extractedAt: "2026-10-01T00:00:00.000Z" }, catalog: { classes: 9, nodes: 12 },
  talents: { ...EMPTY, ...talents }, raidBuffs: null, mapChanges: null, readSet: null, warnings: [],
});
const spellChange = (nodeId: number) => ({ classId: 8, className: "Mage", tree: "Left", nodeId, name: `Talent ${nodeId}`, spoiler: false, spellId: nodeId, spellName: null, changes: [{ field: "effect 1 basePoints", before: 1, after: 2 }] });

/* ---------- Rendering ---------- */

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const page = async (slug: string) => renderToStaticMarkup(await GuidePage(params(slug)));
const metadata = (slug: string) => guideRoute.generateMetadata(params(slug));
const index = async (search: Record<string, string> = {}) => renderToStaticMarkup(await GuidesIndex({ searchParams: Promise.resolve(search) }));
const indexMetadata = (search: Record<string, string> = {}) => indexRoute.generateMetadata({ searchParams: Promise.resolve(search) });

const visible = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue ?? "");
  return ` ${parts.join(" ")} `.replace(/\s+/g, " ");
};
const dom = (html: string) => new DOMParser().parseFromString(html, "text/html");
/** Every JSON-LD block in the markup, parsed. */
const jsonLd = (html: string) => [...dom(html).querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? "") as Record<string, any>);
/** The labels of the page's copy buttons. */
const copyLabels = (html: string) => [...dom(html).querySelectorAll("button [data-copy-labels] > span:first-child")].map((s) => s.textContent);

function complete(path: string, m: Metadata) {
  const title = String(m.title);
  expect(title, path).toMatch(/WoW Forever/);
  expect(m.alternates?.canonical, path).toBe(path);
  const og = m.openGraph as { title?: string; url?: string; description?: string; images?: { url: string }[] };
  const tw = m.twitter as { card?: string; title?: string; images?: { url: string }[] };
  expect(og.title, path).toBe(`${title} · Everloot`);
  expect(og.url, path).toBe(path);
  expect(og.description, path).toBe(m.description);
  expect(og.images?.length, path).toBeGreaterThan(0);
  expect(tw.card, path).toBe("summary_large_image");
  expect(tw.title, path).toBe(`${title} · Everloot`);
}

beforeEach(() => {
  trees.build = "1.0.0.1";
  trees.without = [];
  records.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  stubGuides([]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("a guide's page", () => {
  test("only published, reviewed guides are built; a draft, an unknown slug, an unreviewed file and a provisional order are a 404 on the page, its card and its metadata", async () => {
    stubGuides(SOME);
    // Rebuilt at most once an hour, so a guide's review age is read again; no address outside the built ones renders.
    expect(guideRoute.revalidate).toBe(3600);
    expect(guideRoute.dynamicParams).toBe(false);
    expect(guideRoute.generateStaticParams().map((p) => p.slug).sort()).toEqual(["arcane-dungeons", "frost-leveling", "warrior-tanking"]);
    expect(imageRoute.dynamicParams).toBe(false);
    expect(imageRoute.generateStaticParams().map((p) => p.slug).sort()).toEqual(["arcane-dungeons", "frost-leveling", "warrior-tanking"]);
    for (const slug of [...HIDDEN, "no-such-guide"]) {
      await expect(page(slug), slug).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(GuideImage(params(slug)), slug).rejects.toThrow("NEXT_NOT_FOUND");
      const m = await metadata(slug);
      expect(m.robots, slug).toEqual({ index: false, follow: true });
      expect(m.title, slug).toBeUndefined();
    }
    const card = await GuideImage(params("frost-leveling"));
    expect(card.headers.get("content-type")).toBe("image/png");
    expect(imageRoute.size).toEqual({ width: 1200, height: 630 });
  });

  test("shows the reviewed guide: who reviewed it against which build, its four sections, its plan, its sources and every version", async () => {
    stubGuides(SOME);
    const html = await page("frost-leveling");
    const text = visible(html);
    expect(dom(html).querySelector("h1")?.textContent).toBe("Frost leveling");
    expect(text).toContain("A test guide summary for the fixture tree");
    expect(dom(html).querySelector('[data-guide-state="current"]')?.textContent).toBe("Reviewed by Kai on 2026-10-20 against game build 1.0.0.1.");
    for (const heading of SECTIONS) expect([...dom(html).querySelectorAll("h2")].map((h) => h.textContent), heading).toContain(heading);
    expect(text).toContain(FILLER);
    expect(html).toContain(`href="${SOURCE.url}"`);
    expect(text).toContain("A Blizzard post · checked on 2026-10-19");
    // Every published version, newest first, each at its own stable anchor.
    const versions = [...dom(html).querySelectorAll('[id^="version-"]')];
    expect(versions.map((v) => v.id)).toEqual(["version-2", "version-1"]);
    expect(visible(versions[0].outerHTML)).toContain("Version 2 (this version) Reviewed by Kai on 2026-10-20 against game build 1.0.0.1. The second set is added.");
    expect(visible(versions[1].outerHTML)).toContain("Version 1 Reviewed by Kai on 2026-09-01 against game build 1.0.0.1. First published version.");
    expect(text).toContain("Author Robin");
    expect(html).toContain('href="/guides"');
    expect(html).toContain('href="/classes/mage"');
  });

  test("the plan labels a planned order and an unknown one, and opens in the calculator exactly as the guide stores it", async () => {
    stubGuides(SOME);
    const stored = publishedGuide(loadGuides(), "frost-leveling")!;
    const html = await page("frost-leveling");
    const sets = [...dom(html).querySelectorAll("[data-guide-set]")];
    expect(sets.map((s) => s.getAttribute("data-guide-set"))).toEqual(["1", "2"]);
    expect(visible(sets[0].outerHTML)).toContain("Planned order. The points in the order they were spent in the calculator. A plan, not a record of play.");
    expect(visible(sets[0].outerHTML)).toContain("11 talent points, the last at level 20.");
    expect(visible(sets[0].outerHTML)).toContain("All 11 points in order");
    expect(visible(sets[0].outerHTML)).toContain("Level 15: Talent 21, rank 1");

    // The calculator link carries the stored codes and orders byte for byte: nothing is re-encoded or re-stamped.
    const open = [...dom(html).querySelectorAll("a")].find((a) => a.textContent === "Open in the calculator")!;
    const href = open.getAttribute("href")!;
    expect(href.split("#")[0]).toBe("/tools/talents/mage");
    expect(readPlanHash(`#${href.split("#")[1]}`)).toEqual({ first: stored.code, second: stored.code2, firstOrder: stored.order, secondOrder: stored.order2 });
    // What the calculator loads from it is the plan the guide shows.
    const tree = await loadCatalog("mage");
    const opened = importPlan(tree, stored.code, stored.order!);
    expect(opened.ok && opened.set).toMatchObject({ ranks: RANKS, order: ORDER, orderOrigin: "planned" });
    expect(guideFreshness(stored, tree, classTalentChanges([], 8), "2026-10-27").sets[0].plan).toEqual(opened.ok && opened.set);

    const unordered = await page("arcane-dungeons");
    expect(visible(unordered)).toContain("Spend order unknown. The guide gives this set's talents without an order to take them in, so none is shown and none is guessed.");
    expect(visible(unordered)).not.toContain("points in order");
    const plain = [...dom(unordered).querySelectorAll("a")].find((a) => a.textContent === "Open in the calculator")!.getAttribute("href")!;
    expect(plain).not.toMatch(/order2?=/);
  });

  test("Copy for addon copies one set as a full calculator link under that set's own pair, and says how to import it and what addon 0.3.12 cannot do", async () => {
    stubGuides(SOME);
    const html = await page("frost-leveling");
    expect(copyLabels(html)).toEqual(["Copy set 1 for addon", "Copy set 2 for addon"]);
    expect(visible(html)).toContain("In the game: /everloot → Talents → paste → Import.");
    expect(visible(html)).toContain("Addon 0.3.12 loads the talents from the link but not the spend order, so spend each point yourself.");
    // Never a long link typed into a chat command.
    expect(html).not.toContain("/everloot plan");

    const stored = publishedGuide(loadGuides(), "frost-leveling")!;
    const tree = await loadCatalog("mage");
    const { sets } = guideFreshness(stored, tree, classTalentChanges([], 8), "2026-10-27");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await mount(<GuidePlan classSlug="mage" catalog={tree} sets={sets} />);
    await click("Copy set 1 for addon");
    await click("Copy set 2 for addon");
    const [[one], [two]] = writeText.mock.calls as [string][];
    expect(one).toBe(`https://everloot.app/tools/talents/mage#plan=${stored.code}&order=${stored.order}`);
    expect(two).toBe(`https://everloot.app/tools/talents/mage#plan2=${stored.code2}&order2=${stored.order2}`);
    // Set 2's link carries no first-set pair, so the addon's Import loads set 2, and so does the calculator's paste box.
    expect(readPlanHash(two)).toEqual({ first: null, second: stored.code2, firstOrder: null, secondOrder: stored.order2 });
    expect(two).not.toMatch(/[#&]plan=|[#&]order=/);
    const pasted = importPlan(tree, two);
    expect(pasted.ok && pasted.set).toMatchObject({ ranks: RANKS2, order: ORDER2, orderOrigin: "planned" });
    expect(readPlanHash(one)).toEqual({ first: stored.code, second: null, firstOrder: stored.order, secondOrder: null });
  });

  test("the copy has no second set to give when the guide has none, and refuses a provisional order or a set that no longer fits", async () => {
    stubGuides(SOME);
    const tree = await loadCatalog("mage");
    const guides = loadGuides();
    const one = guideFreshness(publishedGuide(guides, "warrior-tanking")!, await loadCatalog("warrior"), classTalentChanges([], 8), "2026-10-27");
    expect(guideAddonLink("warrior", one.sets[1])).toBeNull();
    expect(guideAddonLink("warrior", one.sets[0])).toMatch(/^https:\/\/everloot\.app\/tools\/talents\/warrior#plan=EL1-/);
    expect(copyLabels(await page("warrior-tanking"))).toEqual(["Copy set 1 for addon"]);

    // The reader never shows a published guide with a provisional order; read past it, the copy still refuses it.
    const provisional = { ...publishedGuide(guides, "frost-leveling")!, order: PROVISIONAL };
    const refused = guideFreshness(provisional, tree, classTalentChanges([], 8), "2026-10-27");
    expect(refused.state).toBe("broken");
    expect(guideAddonLink("mage", refused.sets[0])).toBeNull();
    expect(guideAddonLink("mage", { ...refused.sets[0], problems: [] })).toBeNull();
    await mount(<GuidePlan classSlug="mage" catalog={tree} sets={refused.sets} />);
    expect(container!.textContent).not.toContain("Copy set 1 for addon");
    expect(container!.textContent).toContain("Copy for addon is off for set 1 until the guide is reviewed again; the note above says why.");
    expect(guideCalculatorHref("mage", refused.sets)).toContain(`order=${PROVISIONAL}`);
  });

  test("a guide whose plan no longer fits the tree says what, offers no Copy for addon for that set, and stays out of search", async () => {
    stubGuides(SOME);
    trees.without = [53];
    const html = await page("frost-leveling");
    const note = dom(html).querySelector('[data-guide-state="broken"]')!;
    expect(note.querySelector("h2")?.textContent).toBe("Broken");
    expect(visible(note.outerHTML)).toContain("Its plan no longer fits the talent tree, so it cannot be followed as written until it is reviewed again:");
    expect(visible(note.outerHTML)).toContain("Set 2: 1 talent in the code is not in this tree and was left out: node 53 (1 point).");
    expect(copyLabels(html)).toEqual(["Copy set 1 for addon"]);
    expect(visible(html)).toContain("Copy for addon is off for set 2 until the guide is reviewed again; the note above says why.");
    expect((await metadata("frost-leveling")).robots).toEqual({ index: false, follow: true });
  });

  test("a stale guide says what the game files changed since its review and stays out of search; one due for review says why and stays in search", async () => {
    stubGuides(SOME);
    trees.build = "1.0.0.5";
    records.push(record("1.0.0.5", "1.0.0.1", { spellValues: [spellChange(12)] }));
    const stale = dom(await page("frost-leveling")).querySelector('[data-guide-state="stale"]')!;
    expect(stale.querySelector("h2")?.textContent).toBe("Stale");
    expect(visible(stale.outerHTML)).toContain("Since then the game files changed talents its plan uses, so parts of it may be out of date until it is reviewed again:");
    expect(visible(stale.outerHTML)).toContain("Set 1: Talent 12: its spell changed in build 1.0.0.5: 1 number.");
    expect((await metadata("frost-leveling")).robots).toEqual({ index: false, follow: true });

    records.length = 0;
    trees.build = "1.0.0.1";
    vi.setSystemTime(new Date("2027-01-05T12:00:00Z"));
    const due = dom(await page("frost-leveling")).querySelector('[data-guide-state="review-due"]')!;
    expect(due.querySelector("h2")?.textContent).toBe("Review due");
    expect(visible(due.outerHTML)).toContain("Last reviewed 77 days ago, on 2026-10-20; a guide is due for another review after 60 days.");
    expect((await metadata("frost-leveling")).robots).toEqual({ index: true, follow: true });
  });

  test("a stale guide's note lists only what changed after its review; a change its review saw is not under Since then", async () => {
    // Made on 1.0.0.1 and reviewed against 1.0.0.3; the records change Talent 11 in 1.0.0.3 and Talent 12 in 1.0.0.5.
    stubGuides([{ slug: "frost-leveling", second: true, reviewedBuild: "1.0.0.3" }]);
    trees.build = "1.0.0.5";
    records.push(record("1.0.0.3", "1.0.0.1", { spellValues: [spellChange(11)] }), record("1.0.0.5", "1.0.0.3", { spellValues: [spellChange(12)] }));
    const html = await page("frost-leveling");
    const note = dom(html).querySelector('[data-guide-state="stale"]')!;
    expect(visible(note.outerHTML)).toContain("against game build 1.0.0.3. Since then the game files changed talents its plan uses");
    expect([...note.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Set 1: Talent 12: its spell changed in build 1.0.0.5: 1 number.",
      "Set 1: Check these talents before you follow the plan.",
      "Game build 1.0.0.5 is live and newer than 1.0.0.3, the build this guide was reviewed against.",
    ]);
    // The stale set's plan does not repeat the note; the untouched set shows its own history under the plan.
    const [one, two] = [...dom(html).querySelectorAll("[data-guide-set]")];
    expect(one.querySelector("[data-guide-changes]")).toBeNull();
    expect(visible(two.querySelector("[data-guide-changes]")!.outerHTML)).toContain("Made on game build 1.0.0.1; this tree is build 1.0.0.5.");
    expect(html).not.toContain("Talent 11: its spell changed");
  });

  test("a guide links only to published guides: a link to a draft or a missing one is drawn as its words alone", async () => {
    const links = "See [the fire draft](/guides/fire-draft), [the draft by its address](https://everloot.app/guides/fire-draft/), "
      + "[a missing guide](/guides/no-such-guide), [warrior tanking](/guides/warrior-tanking) and [every guide](/guides).";
    stubGuides([
      { slug: "frost-leveling", links },
      { slug: "fire-draft", title: "Fire draft", status: "draft", reviewed: false },
      { slug: "warrior-tanking", title: "Warrior tanking", classSlug: "warrior" },
    ]);
    const html = await page("frost-leveling");
    expect(html).toContain('href="/guides/warrior-tanking"');
    expect(html).toContain('href="/guides"');
    // No draft slug reaches the page, as a link or at all.
    expect(html).not.toContain("fire-draft");
    expect(html).not.toContain("no-such-guide");
    const text = visible(html);
    for (const words of ["the fire draft", "the draft by its address", "a missing guide"]) expect(text, words).toContain(words);
    expect([...dom(html).querySelectorAll("a")].map((a) => a.textContent)).not.toContain("the fire draft");
  });

  test("a guide that cites no Blizzard post says what it rests on instead", async () => {
    stubGuides(SOME);
    const html = await page("warrior-tanking");
    const sources = dom(html).querySelector('section[aria-labelledby="sources"]')!;
    expect(visible(sources.outerHTML)).toContain("This guide cites no Blizzard post: its plan is checked against the talent tree from the game files, and the rest is its author's advice, reviewed before it was published.");
    expect(sources.querySelectorAll("a")).toHaveLength(0);
  });

  test("its structured data is an Article that says only what the page shows, with no rating, and its trail is Home, Guides, the guide", async () => {
    stubGuides(SOME);
    const html = await page("frost-leveling");
    const blocks = jsonLd(html);
    const article = blocks.find((b) => b["@type"] === "Article")!;
    expect(article).toMatchObject({
      headline: "Frost leveling",
      url: "https://everloot.app/guides/frost-leveling",
      mainEntityOfPage: "https://everloot.app/guides/frost-leveling",
      datePublished: "2026-09-01",
      dateModified: "2026-10-20",
      license: "https://creativecommons.org/licenses/by-sa/4.0/",
    });
    expect(article.headline).toBe(dom(html).querySelector("h1")?.textContent);
    // The page names its author, a person; the data names no Person, so it names no author at all. Everloot publishes.
    expect(article).not.toHaveProperty("author");
    expect(article.publisher).toEqual({ "@id": "https://everloot.app/#organization" });
    expect(visible(html)).toContain(article.description);
    for (const shown of [article.datePublished, article.dateModified]) expect(visible(html)).toContain(shown);
    expect(JSON.stringify(blocks)).not.toMatch(/Rating|review"|ratingValue|"Person"/);
    const trail = blocks.find((b) => b["@type"] === "BreadcrumbList")!;
    expect(trail.itemListElement.map((i: { name: string; item: string }) => [i.name, i.item])).toEqual([
      ["Home", "https://everloot.app"], ["Guides", "https://everloot.app/guides"], ["Frost leveling", "https://everloot.app/guides/frost-leveling"],
    ]);
  });

  test("a long title keeps to its lines on the guide's card, so it never runs into the line under it", async () => {
    // 90 characters, the longest title a guide may have, with spaces where a title has them.
    const long = "Practical Mage leveling talents with two sets and a detailed order for the whole long journey".slice(0, 90);
    // Wide letters, so three lines cannot hold it and it ends in an ellipsis.
    const wide = "WWW MMMM WWWWW MMMM WWW MMMMM WWWW MMMM WWWWW MMM WWWW MMMMM WWW MMMM WWWWW MMMM WWW MMMMMW".slice(0, 90);
    for (const [slug, title] of [["long-title", long], ["wide-title", wide]]) {
      expect(title, slug).toHaveLength(90);
      stubGuides([{ slug, title }]);
      const card = decodePng(new Uint8Array(await (await GuideImage(params(slug))).arrayBuffer()));
      expect([card.width, card.height], slug).toEqual([1200, 630]);
      // The title is drawn in the card's text colour and the line under it in the second one: every row of title ends
      // above the first row of that line.
      const drawn = rowsIn(card, tokens.dark.fg);
      const under = rowsIn(card, tokens.dark["fg-2"]);
      expect(drawn.length, slug).toBeGreaterThan(0);
      expect(under.length, slug).toBeGreaterThan(0);
      expect(Math.max(...drawn), slug).toBeLessThan(Math.min(...under));
    }
    // Over three lines at a smaller size, ending in an ellipsis past them; a short title keeps the card's full size.
    expect(fittedTitle(long)).toEqual({ fontSize: 64, lines: 3 });
    expect(fittedTitle("Frost leveling")).toEqual({ fontSize: 84, lines: 2 });
  });

  test("its title, description and social card are complete, and the card is the guide's own", async () => {
    stubGuides(SOME);
    const m = await metadata("frost-leveling");
    complete("/guides/frost-leveling", m);
    expect(m.title).toBe("Frost leveling · WoW Forever Mage guide");
    expect(m.description).toBe(publishedGuide(loadGuides(), "frost-leveling")!.summary);
    expect((m.openGraph as { images: { url: string }[]; type: string }).images[0].url).toBe("/guides/frost-leveling/opengraph-image");
    expect((m.openGraph as { type: string }).type).toBe("article");
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  test("a guide with too little prose of its own is shown but stays out of search", async () => {
    stubGuides([{ slug: "thin-guide", title: "Thin guide", thin: true }]);
    expect(visible(await page("thin-guide"))).toContain("Test words.");
    expect((await metadata("thin-guide")).robots).toEqual({ index: false, follow: true });
  });
});

describe("the guide index", () => {
  const listed = (html: string) => [...dom(html).querySelectorAll("[data-guide]")].map((li) => li.getAttribute("data-guide"));

  test("lists the published guides by class with the state of any that is not current, never a draft; an empty index says so and stays out of search", async () => {
    const empty = await index();
    expect(visible(empty)).toContain("No guide is reviewed yet.");
    expect((await indexMetadata()).robots).toEqual({ index: false, follow: true });

    stubGuides(SOME);
    const html = await index();
    expect(listed(html)).toEqual(["warrior-tanking", "frost-leveling", "arcane-dungeons"]);
    for (const hidden of HIDDEN) expect(html, hidden).not.toContain(hidden);
    expect(html).toContain('href="/guides/frost-leveling"');
    expect(visible(html)).toContain("Leveling · Levels 10–60 · Damage · Reviewed 2026-10-20");
    expect(dom(html).querySelectorAll("[data-guide-state]")).toHaveLength(0);
    expect((await indexMetadata()).robots).toEqual({ index: true, follow: true });

    trees.without = [53];
    const broken = dom(await index()).querySelector('[data-guide="frost-leveling"] [data-guide-state="broken"]');
    expect(broken?.textContent).toBe("Broken");
  });

  test("filters narrow by class, activity, role and level through the reader, and a filtered list stays out of search", async () => {
    stubGuides(SOME);
    expect(listed(await index({ class: "warrior" }))).toEqual(["warrior-tanking"]);
    expect(listed(await index({ activity: "dungeons" }))).toEqual(["warrior-tanking", "arcane-dungeons"]);
    expect(listed(await index({ role: "tank" }))).toEqual(["warrior-tanking"]);
    expect(listed(await index({ class: "mage", level: "25" }))).toEqual(["frost-leveling"]);
    expect(listed(await index({ class: "priest" }))).toEqual([]);
    expect(visible(await index({ class: "priest" }))).toContain("No reviewed guide matches these filters.");
    const filtered: Record<string, string>[] = [{ class: "warrior" }, { activity: "dungeons" }, { role: "tank" }, { level: "25" }, { class: "priest" }];
    for (const search of filtered) {
      const m = await indexMetadata(search);
      expect(m.robots, JSON.stringify(search)).toEqual({ index: false, follow: true });
      expect(m.alternates?.canonical, JSON.stringify(search)).toBe("/guides");
    }
    // A query the page does not read is not a filter.
    expect((await indexMetadata({ utm_source: "x" })).robots).toEqual({ index: true, follow: true });
    const bar = await index();
    for (const href of ["/guides?class=mage", "/guides?class=warrior", "/guides?activity=dungeons", "/guides?role=tank"]) expect(bar, href).toContain(`href="${href}"`);
  });

  test("a filter value that cannot be read is named, and narrows nothing", async () => {
    stubGuides(SOME);
    const html = await index({ class: "deathknight" });
    expect(visible(html)).toContain('"deathknight" is not one of the nine classes. This page shows every guide instead.');
    expect(listed(html)).toEqual(["warrior-tanking", "frost-leveling", "arcane-dungeons"]);
    expect(visible(await index({ activity: "pvp" }))).toContain('"pvp" is not an activity guides are written for: leveling, dungeons or raids.');
    expect(visible(await index({ level: "99" }))).toContain('"99" is not a level from 1 to 60.');
    expect((await indexMetadata({ class: "deathknight" })).robots).toEqual({ index: false, follow: true });
  });

  test("its title, description and card are complete, with guides and without", async () => {
    for (const guides of [[], SOME]) {
      stubGuides(guides);
      const m = await indexMetadata();
      complete("/guides", m);
      expect(m.title).toBe("WoW Forever Guides");
      expect(String(m.description).length).toBeGreaterThanOrEqual(120);
      expect(String(m.description).length).toBeLessThanOrEqual(160);
    }
  });

  test("its trail is Home, Guides", async () => {
    const trail = jsonLd(await index()).find((b) => b["@type"] === "BreadcrumbList")!;
    expect(trail.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Home", "Guides"]);
  });
});

/* ---------- The card's pixels ---------- */

/** A PNG's pixels, for the 8-bit RGBA files the card renderer writes. */
function decodePng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      expect([bytes[at + 16], bytes[at + 17], bytes[at + 20]], "8-bit RGBA, not interlaced").toEqual([8, 6, 0]);
    } else if (type === "IDAT") idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const corner = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      const p = left + up - corner;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter];
      rgba[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predicted) & 0xff;
    }
  }
  return { width, height, rgba };
}

/** The rows holding a pixel of exactly this colour: the inside of a glyph drawn in it, not its blended edge. */
function rowsIn(png: { width: number; height: number; rgba: Uint8Array }, hex: string): number[] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const rows: number[] = [];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      if (png.rgba[i] === r && png.rgba[i + 1] === g && png.rgba[i + 2] === b) {
        rows.push(y);
        break;
      }
    }
  }
  return rows;
}

/* ---------- In the browser ---------- */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(el: ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(el));
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function click(label: string) {
  const button = [...container!.querySelectorAll("button")].find((b) => b.querySelector("[data-copy-labels] > span:first-child")?.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
