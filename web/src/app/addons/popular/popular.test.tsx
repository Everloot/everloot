import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// The page reads the stored corpus through the same aggregates as the database pages, so these
// tests feed raw addon_seen records in and check what reaches the HTML.
const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import PopularAddonsPage, { metadata } from "./page";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import snapshot from "../../../../../kb/changes/ecosystem.json";

let n = 0;
const seen = (installId: string, name: string, title: string, capturedAt = "2026-10-17T08:00:00.000Z", loaded = true) => ({
  kind: "addon_seen", eventId: `${installId}:addon:${++n}`, installId, capturedAt, name, title, loaded,
});
// Each corpus gets its own data time: the aggregates are cached per corpus version.
let version = 0;
const corpus = (records: unknown[]) => ({
  uploads: records.length, records, dataAsOf: new Date(Date.UTC(2026, 9, 17, 12, version++)).toISOString(),
});
const html = async () => renderToStaticMarkup(await PopularAddonsPage());

beforeEach(() => store.loadCorpus.mockReset());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test("an addon three installs report is listed with its rank, counts, last day seen, share and a CurseForge search link", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...["install-aaa", "install-bbb", "install-ccc"].flatMap((id) => [
      seen(id, "DBM-Core", "Deadly Boss Mods", "2026-10-14T09:00:00.000Z"),
      seen(id, "DBM-Core", "Deadly Boss Mods", "2026-10-16T20:00:00.000Z"),
    ]),
    seen("install-ddd", "Bagnon", "Bagnon"),
  ]));
  const page = await html();
  expect(page).toContain("<table");
  expect(page).toContain("Deadly Boss Mods");
  expect(page).toContain('data-rank="1"');
  expect(page).toContain("2026-10-16");
  // Three of the four installs that reported their addons run it.
  expect(page).toContain("75%");
  expect(page).toContain("3 of 4");
  expect(page).toContain('href="https://www.curseforge.com/wow/search?search=Deadly%20Boss%20Mods"');
});

test("an addon only two installs report never renders, by title or folder name", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...["install-aaa", "install-bbb", "install-ccc"].map((id) => seen(id, "Questie", "Questie")),
    seen("install-aaa", "MyGuildTools", "My Guild Tools"),
    seen("install-bbb", "MyGuildTools", "My Guild Tools"),
  ]));
  const page = await html();
  expect(page).toContain("Questie");
  expect(page).not.toContain("MyGuildTools");
  expect(page).not.toContain("My Guild Tools");
});

test("one install cannot name an addon: a title fewer than three installs share shows the folder name", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    seen("install-aaa", "DBM-Core", "Deadly Boss Mods"),
    seen("install-bbb", "DBM-Core", "Deadly Boss Mods"),
    seen("install-ccc", "DBM-Core", "Visit my gold shop", "2026-10-17T09:00:00.000Z"),
  ]));
  const page = await html();
  expect(page).toContain(">DBM-Core<");
  expect(page).toContain('href="https://www.curseforge.com/wow/search?search=DBM-Core"');
  expect(page).not.toContain("gold shop");
  expect(page).not.toContain("Deadly Boss Mods");
});

test("one install cannot set the dates: a row from the future never shows", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...["install-aaa", "install-bbb", "install-ccc"].map((id) => seen(id, "Questie", "Questie", "2026-10-15T08:00:00.000Z")),
    seen("install-aaa", "Questie", "Questie", "2099-12-31T00:00:00.000Z"),
  ]));
  const page = await html();
  expect(page).toContain("2026-10-15");
  expect(page).not.toContain("2099");
});

test("dates show the UTC day, whatever offset the client wrote", async () => {
  store.loadCorpus.mockResolvedValue(corpus(
    ["install-aaa", "install-bbb", "install-ccc"].map((id) => seen(id, "Questie", "Questie", "2026-10-16T22:00:00-05:00")),
  ));
  const page = await html();
  expect(page).not.toContain("2026-10-16");
  expect(page).toMatch(/2026-10-17<\/td>/);
});

test("the CurseForge link is a full-size tap target", async () => {
  store.loadCorpus.mockResolvedValue(corpus(["install-aaa", "install-bbb", "install-ccc"].map((id) => seen(id, "Questie", "Questie"))));
  const link = /<a href="https:\/\/www\.curseforge\.com[^"]*"[^>]*class="([^"]*)"/.exec(await html());
  expect(link?.[1].split(" ")).toContain("min-h-11");
});

test("Everloot and its answers addon are never ranked", async () => {
  store.loadCorpus.mockResolvedValue(corpus(["install-aaa", "install-bbb", "install-ccc"].flatMap((id) => [
    seen(id, "Everloot", "Everloot"), seen(id, "EverlootAnswers", "Everloot Answers"), seen(id, "Questie", "Questie"),
  ])));
  const page = await html();
  const table = page.slice(page.indexOf("<table"), page.indexOf("</table>"));
  expect(table).toContain("Questie");
  expect(table).not.toContain("Everloot");
  expect(page).not.toContain("search=Everloot");
});

test("no install id reaches the page", async () => {
  store.loadCorpus.mockResolvedValue(corpus(["install-aaa", "install-bbb", "install-ccc"].map((id) => seen(id, "Questie", "Questie"))));
  const page = await html();
  expect(page).toContain("Questie");
  expect(page).not.toContain("install-");
});

test("an addon without a checked page gets a CurseForge search, never the API", async () => {
  store.loadCorpus.mockResolvedValue(corpus(["install-aaa", "install-bbb", "install-ccc"].flatMap((id) => [
    seen(id, "Questie", "Questie"), seen(id, "Details", "Details! Damage Meter"),
  ])));
  const links = [...(await html()).matchAll(/href="([^"]*curseforge[^"]*)"/g)].map((m) => m[1]);
  expect(links).toEqual([
    "https://www.curseforge.com/wow/search?search=Details!%20Damage%20Meter",
    "https://www.curseforge.com/wow/search?search=Questie",
  ]);
});

test("before three installs report an addon, the page says so and shows how to opt in", async () => {
  vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
  store.loadCorpus.mockResolvedValue(corpus([seen("install-aaa", "Questie", "Questie"), seen("install-bbb", "Questie", "Questie")]));
  const page = await html();
  expect(page).not.toContain("<table");
  expect(page).not.toContain("Questie");
  expect(page).toContain("No addon is listed yet");
  expect(page).toContain("three installs");
  expect(page).toContain("/everloot addons on");
  expect(page).toContain('href="/upload"');
});

test("unreadable storage says so, never an empty leaderboard", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const page = await html();
  expect(page).toContain(STORAGE_UNREACHABLE);
  expect(page).not.toContain("<table");
  expect(page).not.toContain("No addon is listed yet");
});

test("the page has its own title and canonical", () => {
  expect(metadata.title).toBe("Popular WoW Forever Addons");
  expect(metadata.description).toContain("three installs");
  expect(metadata.alternates?.canonical).toBe("/addons/popular");
});

test("before launch, an empty board says the game is not out yet", async () => {
  vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
  store.loadCorpus.mockResolvedValue(corpus([]));
  const page = await html();
  expect(page).toContain("WoW: Forever opens on November 4, 2026, so nobody runs an addon in it yet");
  expect(page).not.toContain("<table");
});

test("a tracked addon shows its GitHub stars and release from the snapshot, with its own CurseForge page, and no live call", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  store.loadCorpus.mockResolvedValue(corpus(["install-aaa", "install-bbb", "install-ccc"].map((id) => seen(id, "Polestar", "Polestar"))));
  const page = await html();
  const polestar = snapshot.projects.polestar as { stars: number; release: { tag: string; url: string } };
  expect(page).toMatch(new RegExp(`>${polestar.stars}</td>`));
  expect(page).toContain(`href="${polestar.release.url}"`);
  expect(page).toContain('href="https://github.com/fitzforge/polestar"');
  expect(page).toContain('href="https://www.curseforge.com/wow/addons/polestar-guides"');
  expect(page).not.toContain("search=Polestar");
  expect(fetch).not.toHaveBeenCalled();
});

test("week movement and the 8-week line come from the board as it stood each week", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    // Bagnon: listed two weeks before the data time. Questie: on four new installs this week, and now ahead.
    ...["install-aaa", "install-bbb", "install-ccc"].map((id) => seen(id, "Bagnon", "Bagnon", "2026-10-02T08:00:00.000Z")),
    ...["install-ddd", "install-eee", "install-fff", "install-ggg"].map((id) => seen(id, "Questie", "Questie", "2026-10-16T08:00:00.000Z")),
  ]));
  const page = await html();
  const rows = page.slice(page.indexOf("<tbody")).split("<tr").slice(1);
  expect(rows[0]).toContain("Questie");
  expect(rows[0]).toContain(">New<");
  expect(rows[0]).not.toContain("data-sparkline");
  expect(rows[1]).toContain("Bagnon");
  expect(rows[1]).toContain("places down");
  expect(rows[1]).toContain("data-sparkline");
});

test("a history that would show the loaded count growing one install at a time is not drawn", async () => {
  // Three installs report Questie from the start; it is loaded on one, then two, then all three.
  const ids = ["install-aaa", "install-bbb", "install-ccc"];
  store.loadCorpus.mockResolvedValue(corpus([
    ...ids.map((id) => seen(id, "Questie", "Questie", "2026-10-01T08:00:00.000Z", false)),
    seen(ids[0], "Questie", "Questie", "2026-10-02T08:00:00.000Z"),
    seen(ids[1], "Questie", "Questie", "2026-10-09T08:00:00.000Z"),
    seen(ids[2], "Questie", "Questie", "2026-10-16T08:00:00.000Z"),
  ]));
  const page = await html();
  expect(page).toContain("3 of 3");
  expect(page).not.toContain("data-sparkline");
  expect(page).not.toContain("places");
  expect(page).not.toContain(">New<");
});

test("in the first listed week nothing claims to be new", async () => {
  store.loadCorpus.mockResolvedValue(corpus(["install-aaa", "install-bbb", "install-ccc"].map((id) => seen(id, "Questie", "Questie"))));
  expect(await html()).not.toContain(">New<");
});
