import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const github = vi.hoisted(() => ({ polestarLive: vi.fn() }));
vi.mock("@/lib/polestar-github", () => github);
const rollup = vi.hoisted(() => ({ loadPopularAddons: vi.fn(), loadItemFacts: async () => ({ rates: [], names: [], npcs: [], unreachable: false }), loadWorldFacts: async () => ({ npcs: [], quests: [], vendors: [], unreachable: false }), loadInstanceFacts: async () => ({ entrances: [], encounters: [], sightings: [], unreachable: false, dataAsOf: null }) }));
vi.mock("@/lib/rollup-compute", () => rollup);
vi.mock("../../lib/rollup-compute", () => rollup);
// The committed star history, or none when a test sets `history.none`.
const history = vi.hoisted(() => ({ none: false }));
vi.mock("@/lib/ecosystem", async (load) => {
  const real = await load<typeof import("@/lib/ecosystem")>();
  return { ...real, get starHistory() { return history.none ? {} : real.starHistory; } };
});
vi.mock("@/components/AccountControls", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import AddonsPage, { metadata as addonsMeta } from "./page";
import PolestarPage, { metadata as polestarMeta } from "./polestar/page";
import PacksPage, { metadata as packsMeta } from "./polestar/packs/page";
import WantedPage, { metadata as wantedMeta } from "./polestar/wanted/page";
import sitemap from "@/lib/site-sitemap";
import { loadEcosystem, starHistory } from "@/lib/ecosystem";
import { boardRows } from "@/lib/addon-board";
import Footer from "@/components/Footer";
import Header from "@/components/Header";

const html = async (page: () => ReactNode | Promise<ReactNode>) => renderToStaticMarkup(await page());
const addons = async (search: Record<string, string> = {}) => renderToStaticMarkup(await AddonsPage({ searchParams: Promise.resolve(search) }));
const popular = (list: { name: string; installs: number }[], unreachable = false) =>
  rollup.loadPopularAddons.mockResolvedValue({ addons: list, reportingInstalls: 9, unreachable, dataAsOf: "2026-10-17T12:00:00.000Z" });
/** Where each project's name first appears, so the order on the page can be compared. */
const order = (page: string, ids: string[]) => ids.map((id) => page.indexOf(`#addon-${id}"`));
const ascending = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

beforeEach(() => {
  github.polestarLive.mockReset().mockResolvedValue(null);
  rollup.loadPopularAddons.mockReset();
  popular([]);
  history.none = false;
  vi.unstubAllEnvs();
});

test("/addons is a leaderboard ranked by GitHub stars, with logos and a change column from the star history", async () => {
  const expected = boardRows(await loadEcosystem(), starHistory).map((r) => r.project.id);
  const page = await addons();
  expect(ascending(order(page, expected))).toBe(true);
  expect(page).toMatch(/aria-sort="descending"[^>]*><a[^>]*>Stars</);
  expect(page).toContain('src="https://github.com/fitzforge.png?size=64"');
  expect(page).toContain('loading="lazy"');
  expect(page).toContain(">Change<");
  expect(page).toMatch(/Change: stars since \d{4}-\d{2}-\d{2}/);
  expect(addonsMeta.alternates?.canonical).toBe("/addons");
});

test("each ranking view and column header re-sorts the board through ?sort=", async () => {
  const page = await addons({ sort: "name" });
  expect(ascending(order(page, ["everloot", "forever-ref", "olympus", "polestar"]))).toBe(true);
  expect(page).toMatch(/aria-sort="ascending"[^>]*><a[^>]*>Addon</);
  expect(page).toContain('href="/addons?sort=-commits"');
  expect(page).toContain('href="/addons?sort=-release"');
  // The default ranking is the plain URL.
  expect(page).toMatch(/href="\/addons"[^>]*>GitHub stars</);
});

test("the type filter keeps only addons or tools", async () => {
  const page = await addons({ kind: "tool" });
  expect(page).toContain("#addon-forever-ref");
  expect(page).not.toContain("#addon-polestar");
});

test("view=cards shows one card per project, with description, tags, links and metrics; the tabs switch views", async () => {
  const page = await addons({ view: "cards", sort: "-commits" });
  for (const id of ["everloot", "polestar", "olympus", "forever-ref"]) expect(page).toContain(`id="addon-${id}"`);
  expect(page).toContain("Leveling guides for 1 to 60");
  expect(page).toContain('href="https://github.com/fitzforge/polestar"');
  expect(page).toContain('href="https://www.curseforge.com/wow/addons/polestar-guides"');
  expect(page).toMatch(/rel="noopener noreferrer nofollow"/);
  expect(page).toContain('href="/addons/polestar"');
  expect(page).toContain('href="/addon"');
  expect(page).toContain(">Tool<");
  expect(page).toContain("Commits, 4 wk");
  expect(page).toMatch(/href="\/addons\?sort=-commits"[^>]*>Leaderboard/);
  expect(page).toMatch(/href="\/addons\?view=cards&amp;sort=-commits"[^>]*>Cards/);
  expect(page).not.toContain("<table");
});

test("Everloot is one entry among the others, and the page links the other addon pages", async () => {
  const page = await addons({ view: "cards" });
  expect(page.match(/id="addon-everloot"/g)).toHaveLength(1);
  expect(page).toContain("listed like any other");
  expect(page).toContain('href="/addons/popular"');
  expect(page).toContain('href="/addons/ecosystem"');
});

test("without star history the change column and ranking are left out, and the page says so", async () => {
  history.none = true;
  const page = await addons();
  expect(page).not.toContain(">Change<");
  expect(page).not.toContain("Stars gained");
  expect(page).toContain("No star history yet");
  // A link asking for the missing ranking falls back to stars.
  expect(await addons({ sort: "-change" })).toMatch(/aria-sort="descending"[^>]*><a[^>]*>Stars</);
});

test("installs show only when the counts can be read", async () => {
  popular([{ name: "Polestar", installs: 7 }]);
  expect(await addons()).toContain(">Installs<");
  popular([], true);
  expect(await addons()).not.toContain(">Installs<");
});

test("at build, the Polestar page renders every static fact with GitHub down", async () => {
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  const page = await html(PolestarPage);
  for (const text of [
    "https://www.curseforge.com/wow/addons/polestar-guides", "https://github.com/fitzforge/polestar/releases",
    "https://discord.gg/vMbee6F2e9", "/polestar packs", "LICENSE-EXCEPTION.md",
    'href="/addons/polestar/packs"', 'href="/addons/polestar/wanted"', "author%3ACDVolvik",
    "Live details from GitHub are unavailable right now",
  ]) expect(page).toContain(text);
  expect(polestarMeta.alternates?.canonical).toBe("/addons/polestar");
});

test("the Polestar page shows the live release and help-wanted issues when GitHub answers", async () => {
  github.polestarLive.mockResolvedValue({
    release: { tag: "v0.2.3", date: "2026-10-14", url: "https://github.com/fitzforge/polestar/releases/tag/v0.2.3" },
    openIssues: 40, bugReports: 12,
    helpWanted: [{ number: 10, title: "Navigation: help us map caves", url: "https://github.com/fitzforge/polestar/issues/10" }],
  });
  const page = await html(PolestarPage);
  expect(page).toContain("v0.2.3");
  expect(page).toContain("2026-10-14");
  expect(page).toContain("Navigation: help us map caves");
  expect(page).toContain("12 open bug reports");
  expect(page).toContain("label%3Abug");
  expect(page).not.toContain("unavailable right now");
});

test("after the build, a failed GitHub refresh throws so the cache keeps the last good page", async () => {
  await expect(PolestarPage()).rejects.toThrow("keep the last good page");
});

test("counts of one read in the singular", async () => {
  github.polestarLive.mockResolvedValue({
    release: { tag: "v0.2.3", date: "2026-10-14", url: "https://github.com/fitzforge/polestar/releases/tag/v0.2.3" },
    openIssues: 1, bugReports: 1, helpWanted: [],
  });
  const page = await html(PolestarPage);
  expect(page).toContain("1 open bug report</a>");
  expect(page).toContain("1 open issue in all");
});

test("the packs page lists Polestar Guides with its manifest fields and the independence notice", async () => {
  const page = await html(PacksPage);
  for (const text of ["Polestar Guides", "GPL-3.0-only", "Polestar_Guides", "neither Polestar nor Everloot", "mailto:hello@everloot.app"]) {
    expect(page).toContain(text);
  }
  expect(packsMeta.alternates?.canonical).toBe("/addons/polestar/packs");
});

test("the wanted page cites a reason for each idea and links the pack handbook", async () => {
  const page = await html(WantedPage);
  expect(page).toContain("solo");
  expect(page).toContain("https://github.com/fitzforge/polestar/blob/next/docs/PACKS.md");
  expect(page).toContain("polestar new");
  expect(page).toContain("https://github.com/fitzforge/polestar/issues/10");
  expect(wantedMeta.alternates?.canonical).toBe("/addons/polestar/wanted");
});

test("the sitemap, header and footer reach the addons pages", async () => {
  const urls = (await sitemap())!.map((entry) => new URL(entry.url).pathname);
  for (const path of ["/addons", "/addons/popular", "/addons/polestar", "/addons/polestar/packs", "/addons/polestar/wanted"]) expect(urls).toContain(path);
  expect(renderToStaticMarkup(<Header />)).toContain('href="/addons"');
  expect(renderToStaticMarkup(<Footer />)).toContain('href="/addons"');
});
