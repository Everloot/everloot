import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// The page reads the store's census rows, so these tests feed stored census rows in and check what reaches the HTML.
// The end-to-end path through the real store is in census-end-to-end.test.tsx.
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

import CensusPage, { metadata } from "./page";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { CLASSES, LAUNCH_AT, RACES } from "@/data/wow-forever";
import { CENSUS_CLASSES, CENSUS_LAUNCH, CENSUS_RACES } from "../../../../kb/src/census";

let n = 0;
/** `count` characters of one race and class, reported by three installs in turn. */
const crowd = (count: number, prefix: string, over: Record<string, unknown> = {}) =>
  Array.from({ length: count }, (_, i) => ({
    kind: "census_seen", installId: `install-${"abc"[i % 3]}`, reporter: `${"abc"[i % 3].charCodeAt(0).toString(16)}`.padStart(16, "0"), eventId: `install-x:census:${++n}`,
    capturedAt: "2026-11-15T10:00:00.000Z", characterKey: `${prefix}${i.toString(16).padStart(4, "0")}`, serverId: 4,
    race: "Gnome", class: "PRIEST", level: 20, faction: "Alliance", via: "target", ...over,
  }));
const RECORDS = [
  ...crowd(42, "a1", { race: "Human", class: "HUNTER" }),
  ...crowd(28, "a2", { race: "Human", class: "WARRIOR", level: 60 }),
  ...crowd(16, "a3"),
  ...crowd(22, "a4", { race: "Orc", class: "HUNTER", faction: "Horde" }),
  ...crowd(4, "a5", { race: "Gnome", class: "MAGE" }),
  ...crowd(30, "a6", { kind: "census_self", realm: "Forever", via: undefined, race: "Troll", class: "PRIEST", faction: "Horde", capturedAt: "2026-11-06T10:00:00.000Z" }),
];
// Each read gets its own data time and is a new object, so the page's rollup memo never serves an earlier test's rows.
let version = 0;
const corpus = (rows: unknown[]) => ({
  rows, dataAsOf: new Date(Date.UTC(2026, 10, 16, 12, version++)).toISOString(),
});
const html = async (window?: string) => renderToStaticMarkup(await CensusPage({ searchParams: Promise.resolve(window ? { window } : {}) }));
const text = (page: string) => page.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

beforeEach(() => store.loadCensus.mockReset());
afterEach(() => vi.unstubAllEnvs());

test("at launch, with nothing reported, the page is collecting: no table, no number, how to take part", async () => {
  store.loadCensus.mockResolvedValue(corpus([]));
  const page = await html();
  expect(page).not.toContain("<table");
  expect(text(page)).toContain("Still collecting");
  expect(text(page)).toContain("at least 10 characters reported by at least 3 installs");
  expect(page).toContain("/everloot census on");
  expect(page).toContain('href="/methodology#population"');
  expect(page).toContain('href="/upload"');
});

test("the top sentence says how many characters, from how many installs, in which window, and links how we count", async () => {
  store.loadCensus.mockResolvedValue(corpus(RECORDS));
  const page = text(await html());
  expect(page).toContain("About 110 characters were active in the last 7 days (2026-11-10 to 2026-11-16, UTC), counted from 3 installs");
  expect(page).toContain("How we count");
});

test("factions, classes, races and level bands show rounded counts; a hidden count reads not enough reports, explained", async () => {
  store.loadCensus.mockResolvedValue(corpus(RECORDS));
  const page = await html();
  const words = text(page);
  expect(words).toMatch(/Hunter 65 /);
  expect(words).toMatch(/Mage not enough reports/);
  expect(words).toMatch(/Alliance 90 /);
  expect(words).toMatch(/20–29 85 /);
  // A lone band at 60 would be the total minus the others: it is hidden along with the hidden ones.
  expect(words).toMatch(/At 60 not enough reports/);
  expect(words).toContain("“not enough reports” means fewer than 10 characters, fewer than 3 installs or fewer than 3 addresses, or hidden so that a small count can't be worked out from the others");
  expect(page).toMatch(/<th scope="col"[^>]*>Class<\/th>/);
  expect(page).toContain("Factions");
  expect(page).toContain("Level bands");
});

test("the race and class grid is Blizzard's table per faction, with counts in the playable cells", async () => {
  store.loadCensus.mockResolvedValue(corpus(RECORDS));
  const page = await html();
  const grids = page.match(/<table[^>]*>\s*<caption[^>]*>[^<]*(Horde|Alliance) races and classes[\s\S]*?<\/table>/g)!;
  expect(grids).toHaveLength(2);
  const alliance = grids.find((g) => g.includes("Alliance races"))!;
  expect(text(alliance)).toMatch(/Human Not playable 40 /);
  expect(alliance).toContain("Not playable");
  expect(alliance).toContain('<span class="sr-only">not enough reports</span>');
});

test("since launch is a second window, linked from the first and marked as the current one", async () => {
  store.loadCensus.mockResolvedValue(corpus(RECORDS));
  const week = await html();
  expect(week).toMatch(/<a href="\/census" [^>]*aria-current="page"/);
  const launch = await html("launch");
  expect(launch).toMatch(/<a href="\/census\?window=launch" [^>]*aria-current="page"/);
  expect(text(launch)).toContain("About 140 characters were seen since launch (2026-11-04 to 2026-11-16, UTC)");
});

test("the 7-day trend lists each day, and the bias line says how many were seen and how many are uploaders' own", async () => {
  store.loadCensus.mockResolvedValue(corpus(RECORDS));
  const words = text(await html("launch"));
  expect(words).toContain("2026-11-15 110");
  expect(words).toMatch(/2026-11-10 not enough reports/);
  expect(words).toContain("79% players seen by uploaders, 21% uploaders' own characters");
});

test("no character key, install id or event id reaches the page", async () => {
  store.loadCensus.mockResolvedValue(corpus(RECORDS));
  const page = (await html()) + (await html("launch"));
  expect(page).not.toContain("install-");
  expect(page).not.toMatch(/a[1-6]00[0-9a-f]{2}/);
  expect(page).not.toContain("census:");
});

test("before launch the page says the game has not launched: no window, no dates, no collecting", async () => {
  store.loadCensus.mockResolvedValue({ rows: crowd(30, "z1", { capturedAt: "2026-10-18T10:00:00.000Z" }), dataAsOf: "2026-10-18T12:00:00.000Z" });
  const page = await html();
  expect(text(page)).toContain("WoW: Forever hasn't launched yet. The census starts counting at launch, 2026-11-04 at 23:00 UTC");
  expect(text(page)).toContain("Not launched yet");
  expect(page).not.toContain("Still collecting");
  expect(page).not.toContain("<table");
  expect(page).not.toContain('aria-label="Census window"');
  expect(text(page)).not.toMatch(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
  expect(page).toContain("/everloot census on");
});

test("unreadable storage says so, never a collecting page or a zero", async () => {
  store.loadCensus.mockResolvedValue({ rows: [], dataAsOf: null, unreachable: true });
  const page = await html();
  expect(page).toContain(STORAGE_UNREACHABLE);
  expect(page).not.toContain("Still collecting");
  expect(page).not.toContain("<table");
});

test("with player pages on, the census offers the player lookup: a form to /players and the hide link", async () => {
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  store.loadCensus.mockResolvedValue(corpus(RECORDS));
  const page = await html();
  expect(page).toContain("Look up a player");
  expect(page).toMatch(/<form [^>]*action="\/players"[^>]*method="get"/);
  expect(page).toMatch(/<form [^>]*role="search"/);
  expect(page).toMatch(/<input [^>]*maxlength="40"/i);
  expect(page).toMatch(/<input [^>]*name="q"/);
  expect(page).toContain('href="/players/opt-out"');
  expect(text(page)).toContain("Race, class, level, guild and the day the addon last saw them. Nothing else.");
  // The lookup comes before the window tabs.
  expect(page.indexOf("Look up a player")).toBeLessThan(page.indexOf('aria-label="Census window"'));
});

test("with player pages off, the census says nothing about looking up players", async () => {
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "");
  store.loadCensus.mockResolvedValue(corpus(RECORDS));
  const page = await html();
  expect(page).not.toContain("Look up a player");
  expect(page).not.toContain('action="/players"');
  expect(page).not.toContain('href="/players/opt-out"');
});

test("the page has its own title, description and canonical", () => {
  expect(metadata.title).toBe("WoW Forever Census: Races, Classes and Levels");
  expect(metadata.description).toContain("10 characters");
  expect(metadata.alternates?.canonical).toBe("/census");
});

test("the rollup's race and class table and launch time are the ones /wow-forever shows", () => {
  expect(CENSUS_LAUNCH).toBe(new Date(LAUNCH_AT).toISOString());
  expect(CENSUS_CLASSES.map((c) => c.name)).toEqual([...CLASSES]);
  const fromRollup = CENSUS_RACES.map((r) => [r.faction, r.name, r.classes.map((c) => CENSUS_CLASSES.find((x) => x.token === c)!.name)]);
  const fromPage = Object.entries(RACES.factions).flatMap(([faction, rows]) => Object.entries(rows).map(([race, classes]) => [faction, race, [...classes]]));
  expect(fromRollup).toEqual(fromPage);
});
