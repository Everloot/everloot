import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

// The pages read the store's census rows, so these tests feed stored census rows in and check what reaches the HTML.
const store = vi.hoisted(() => ({ loadCensus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCensus: store.loadCensus },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) => (
    <a href={href} className={className} aria-current={rest["aria-current"]}>{children}</a>
  ),
}));

import RankingsHub, { generateMetadata as hubMetadata } from "./page";
import RankingPage, { generateMetadata as rankingMetadata } from "./[slug]/page";
import { ONE_WEEK_LINE } from "./parts";
import { COLLECTING_LINE, START_LINE } from "@/lib/rankings";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

let n = 0;
const crowd = (count: number, prefix: string, at: string, over: Record<string, unknown> = {}) =>
  Array.from({ length: count }, (_, i) => ({
    kind: "census_seen", installId: `install-${"abc"[i % 3]}`, reporter: `${i % 3}`.padStart(16, "0"), eventId: `census_seen:x:${++n}`,
    capturedAt: at, characterKey: `${prefix}${i.toString(16).padStart(4, "0")}`, serverId: 4,
    race: "Human", class: "HUNTER", level: 20, faction: "Alliance", via: "target", ...over,
  }));
const week = (at: string, p: string, warriors = 28) => [
  ...crowd(42, `${p}1`, at, { class: "HUNTER" }),
  ...crowd(warriors, `${p}2`, at, { class: "WARRIOR" }),
  ...crowd(46, `${p}3`, at, { race: "Gnome", class: "PRIEST" }),
  ...crowd(22, `${p}4`, at, { race: "Orc", class: "HUNTER", faction: "Horde" }),
  ...crowd(6, `${p}5`, at, { race: "Gnome", class: "MAGE" }),
  ...crowd(5, `${p}6`, at, { race: "Gnome", class: "WARLOCK" }),
];
const WEEK1 = "2026-11-11T10:00:00.000Z";
const WEEK2 = "2026-11-18T10:00:00.000Z";

let minute = 0;
/** Each read is a new object with its own data time, so the rankings memo never serves an earlier test's rows. */
const read = (rows: unknown[], asOf: string) => {
  const at = new Date(Date.parse(asOf) + minute++ * 1000).toISOString();
  return { rows, dataAsOf: at };
};
const hub = async () => renderToStaticMarkup(await RankingsHub());
const ranking = async (slug: string, search: Record<string, string> = {}) =>
  renderToStaticMarkup(await RankingPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(search) }));
const meta = (slug: string, search: Record<string, string> = {}) => rankingMetadata({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(search) });
const text = (page: string) => page.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

beforeEach(() => store.loadCensus.mockReset());

test("before the first full week: the start line, no table, no chart, not indexed", async () => {
  store.loadCensus.mockResolvedValue(read(week("2026-11-06T10:00:00.000Z", "l"), "2026-11-07T00:00:00.000Z"));
  for (const page of [await hub(), await ranking("classes")]) {
    expect(text(page)).toContain(START_LINE);
    expect(text(page)).toContain("What will be here");
    expect(page).not.toContain("<table");
    expect(page).not.toContain("data-weekly-chart");
    expect(page).not.toContain("data-stacked-chart");
    expect(page).not.toContain("data-leaderboard");
  }
  expect(await hubMetadata()).toMatchObject({ robots: { index: false } });
  expect(await meta("classes")).toMatchObject({ robots: { index: false } });
});

test("with one week of numbers: rows without a change column, and an empty state in place of the chart", async () => {
  store.loadCensus.mockResolvedValue(read(week(WEEK1, "w"), "2026-11-15T12:00:00.000Z"));
  const page = await ranking("classes");
  expect(page).toContain("<table");
  expect(page).not.toMatch(/<th[^>]*>(?:<[^>]+>)*Change</);
  expect(text(page)).toContain(ONE_WEEK_LINE);
  expect(page).not.toContain("data-weekly-chart");
  expect(text(page)).toMatch(/1 Hunter .*65/);
  expect(page).toContain("data-class-mark");
  expect(text(await hub())).toContain(ONE_WEEK_LINE);
});

test("with two weeks: the weekly chart, the change column and the current week marked so far", async () => {
  store.loadCensus.mockResolvedValue(read([...week(WEEK1, "w"), ...week(WEEK2, "v", 80)], "2026-11-20T12:00:00.000Z"));
  const page = await ranking("classes");
  expect(page).toContain("data-weekly-chart");
  expect(page).toContain(">so far</text>");
  expect(page).toMatch(/<th[^>]*>(?:<[^>]+>)*Change</);
  // Last week: Hunter 65, Priest 45, Warrior 30. This week Warrior leads with 80.
  // The first cell carries the phone line (change · count · share), then the columns follow.
  expect(text(page)).toContain("1 Warrior ▲2 · 80 characters · 40% ▲2 up 2 80 40% 2026-11-20");
  expect(text(page)).toContain("2 Hunter ▼1 · 65 characters · 33% ▼1 down 1 65 33%");
  expect(text(page)).not.toContain(ONE_WEEK_LINE);
  // The hub: the stacked class chart with every class named, then each ranking's top rows with their change marks.
  const hubPage = await hub();
  expect(hubPage).toContain("data-stacked-chart");
  expect(hubPage).toContain("fill-class-warrior");
  expect(hubPage).toMatch(/aria-label="Legend"[^]*Warrior[^]*Hunter[^]*Priest/);
  expect(hubPage).toContain("data-leaderboard");
  expect(text(hubPage)).toMatch(/1 Warrior .*▲2 up 2/);
  expect(text(hubPage)).toMatch(/2 Hunter .*▼1 down 1/);
  for (const slug of ["classes", "races", "factions"]) expect(hubPage).toContain(`href="/rankings/${slug}"`);
});

test("a week under the thresholds says it is still collecting, with no number", async () => {
  store.loadCensus.mockResolvedValue(read(crowd(4, "s", WEEK1), "2026-11-15T12:00:00.000Z"));
  const page = await ranking("factions");
  expect(text(page)).toContain(COLLECTING_LINE);
  expect(page).not.toContain("<table");
});

test("unreachable storage says so, never empty rankings", async () => {
  store.loadCensus.mockResolvedValue({ rows: [], dataAsOf: null, unreachable: true });
  expect(text(await hub())).toContain(STORAGE_UNREACHABLE);
  expect(text(await ranking("races"))).toContain(STORAGE_UNREACHABLE);
});

test("the rail is plain links in one nav: a sideways bar on a phone that needs no JavaScript", async () => {
  store.loadCensus.mockResolvedValue(read(week(WEEK1, "w"), "2026-11-15T12:00:00.000Z"));
  const page = await ranking("races");
  const rail = page.match(/<nav aria-label="Rankings"[^>]*>[\s\S]*?<\/nav>/)![0];
  expect(rail).not.toMatch(/<button|<script|<details/);
  expect(rail).toContain("overflow-x-auto");
  expect(rail).toContain('href="/rankings/classes"');
  expect(rail).toMatch(/href="\/rankings\/races"[^>]*aria-current="page"/);
  expect(rail).toContain('href="/addons/popular"');
  expect(page).not.toMatch(/aria-label="Breadcrumb"/);
});

test("filters live in the URL; filtered and past-week pages are noindex with the unfiltered canonical", async () => {
  store.loadCensus.mockResolvedValue(read(week(WEEK1, "w"), "2026-11-15T12:00:00.000Z"));
  const page = await ranking("races", { faction: "horde" });
  expect(page).toContain('href="/rankings/races?faction=alliance"');
  expect(text(page)).toContain("Orc");
  expect(text(page)).not.toContain("Human");
  for (const search of [{ faction: "horde" }, { class: "hunter" }, { week: "2026-11-09" }] as Record<string, string>[]) {
    const m = await meta("races", search);
    expect(m.robots, JSON.stringify(search)).toMatchObject({ index: false });
    expect(m.alternates?.canonical).toBe("/rankings/races");
  }
  // Under 10 ranked rows the unfiltered page is not indexed either.
  expect(await meta("classes")).toMatchObject({ robots: { index: false } });
});

test("an unfiltered ranking with 10 ranked rows is indexable and carries an ItemList", async () => {
  const races = [["Orc", "Horde"], ["Tauren", "Horde"], ["Troll", "Horde"], ["Scourge", "Horde"], ["Skyborne", "Horde"], ["Dwarf", "Alliance"], ["Gnome", "Alliance"], ["Human", "Alliance"], ["NightElf", "Alliance"], ["Skyborne", "Alliance"]];
  store.loadCensus.mockResolvedValue(read(races.flatMap(([race, faction], i) => crowd(12, `r${i}`, WEEK1, { race, faction, class: "WARRIOR" })), "2026-11-15T12:00:00.000Z"));
  const m = await meta("races");
  expect(m.robots).toBeUndefined();
  expect(m.alternates?.canonical).toBe("/rankings/races");
  expect(await ranking("races")).toContain('"@type":"ItemList"');
  expect((await hubMetadata()).robots).toBeUndefined();
});

test("an unknown ranking is a 404", async () => {
  store.loadCensus.mockResolvedValue(read([], "2026-11-15T12:00:00.000Z"));
  await expect(ranking("gold")).rejects.toThrow();
  expect(await meta("gold")).toEqual({});
});
