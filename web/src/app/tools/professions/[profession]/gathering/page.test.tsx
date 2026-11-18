import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { trailFor } from "@/lib/breadcrumbs";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
// A tooltip with an icon for each item the page may show one for; no names from the files.
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
  loadItemNames: async () => ({ version: "1.60.1.70707", wiki: { name: "Warcraft Wiki", url: "" }, names: new Map() }),
  loadItemTips: async (_assets: unknown, ids: readonly number[]) => new Map(ids.map((id) => [id, {
    name: `Tip ${id}`, color: "#1eff00", quality: "Common", icon: `https://icons.test/${id}.jpg`, lines: [`Tip line ${id}`], partial: false, why: [], label: "", level: 0, required: 0, binding: 0,
  }])),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`308 ${to}`); },
}));

import GatheringPage, { generateMetadata } from "./page";

const render = async (profession = "herbalism") => renderToStaticMarkup(await GatheringPage({ params: Promise.resolve({ profession }) }));
const section = (html: string, name: string) => { const at = html.indexOf(`data-section="${name}"`); return html.slice(at, html.indexOf("</section>", at)); };
// The rollups are memoized by upload count, record count and date, so each corpus gets its own date.
let stamp = 0;
const corpusOf = (records: unknown[]) => ({ uploads: 3, records, dataAsOf: `2026-11-18T00:00:${String(stamp++ % 60).padStart(2, "0")}.000Z` });
const at = "2026-11-18T00:00:00.000Z";
// Herb object 1617 opened in Elwynn Forest (UiMap 1429), yielding herb item 765.
const herb = (installs: string[]) => installs.map((installId, i) => ({
  kind: "loot", eventId: `${installId}:h`, installId, capturedAt: at, sourceEvidence: "loot-api",
  sourceObjectId: 1617, gatherKind: "herb", lootType: "gather", mapId: 1429, x: 40 + i * 0.1, y: 60, items: [{ itemId: 765, count: 1 }],
}));
// Trainer NPC 1218 opened for Herbalism, placed by the window's position.
const trainer = (installs: string[]) => installs.flatMap((installId) => [
  { kind: "trainer_seen", eventId: `${installId}:t`, installId, capturedAt: at, profession: "Herbalism", skillLineId: 182, recipe: "Herbalism", requiredRank: 1, trainerNpcId: 1218 },
  { kind: "npc_sighting", eventId: `${installId}:s`, installId, capturedAt: at, positionKind: "interaction", npcId: 1218, name: "Test Trainer", mapId: 1429, x: 39.8, y: 48.2 },
]);
const three = ["install-aaaa", "install-bbbb", "install-cccc"];

beforeEach(() => { store.loadCorpus.mockReset(); });

test("at 3 installs: the zone card with its herb chip and installs, the herb's zone, and the trainer with a position", async () => {
  store.loadCorpus.mockResolvedValue(corpusOf([...herb(three), ...trainer(three)]));
  const html = await render();
  expect(html).toMatch(/<h1[^>]*>Herbalism gathering<\/h1>/);
  const zones = section(html, "zones");
  expect(zones).toContain('data-zone="1429"');
  expect(zones).toMatch(/href="\/database\/zones\/1429-[^"]*"/);
  expect(zones).toContain("1 spot · 3 installs agree");
  expect(zones).toContain('data-herb="765"');
  expect(zones).toContain('href="/database/items/765"');
  expect(zones).toContain("https://icons.test/765.jpg");
  expect(zones).toContain("data-item-tip");
  const herbs = section(html, "herbs");
  expect(herbs).toContain("Herbs: 45, 1 gathered in a zone");
  expect(herbs).not.toContain("data-empty-state");
  const trainers = section(html, "trainers");
  expect(trainers).toContain('href="/database/npcs/1218"');
  expect(trainers).toContain(">Test Trainer<");
  expect(trainers).toContain("39.8, 48.2");
  expect(trainers).toContain("faction is not recorded");
  // No install id ever reaches the page.
  expect(html).not.toContain("install-aaaa");
});

test("below 3 installs every section has its own empty state, the rule shows as a badge, and there are no skill sections", async () => {
  store.loadCorpus.mockResolvedValue(corpusOf([...herb(three.slice(0, 2)), ...trainer(three.slice(0, 2))]));
  const html = await render();
  expect(section(html, "zones")).toContain("No herb zones yet");
  expect(section(html, "herbs")).toContain("No herb gathered in a zone yet");
  expect(section(html, "herbs")).toContain("Herbs: 45, 0 gathered in a zone");
  expect(section(html, "trainers")).toContain("No Herbalism trainers yet");
  expect(html).toMatch(/data-badge="neutral"[^>]*>3 installs</);
  expect(section(html, "skill")).toContain("do not say which skill each herb needs");
  expect(html).not.toMatch(/Skill \d+–\d+/);
});

test("storage down says so in each section instead of claiming nothing was gathered", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: null, unreachable: true });
  const html = await render();
  for (const name of ["zones", "herbs", "trainers"]) expect(section(html, name)).toContain('role="status"');
  expect(html).not.toContain("No herb zones yet");
});

test("only Herbalism has a gathering guide; other professions and unknown slugs are a 404", async () => {
  store.loadCorpus.mockResolvedValue(corpusOf([]));
  await expect(render("mining")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(render("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(render("182")).rejects.toThrow("NEXT_NOT_FOUND");
});

test("the trail runs through the Herbalism page, and the metadata names the guide", async () => {
  expect(trailFor("/tools/professions/herbalism/gathering")!.map((c) => c.path)).toEqual(["/", "/tools/professions", "/tools/professions/herbalism", "/tools/professions/herbalism/gathering"]);
  // The Herbalism page keeps its own trail.
  expect(trailFor("/tools/professions/herbalism")!.at(-1)).toEqual({ name: "Herbalism", path: "/tools/professions/herbalism" });
  const metadata = await generateMetadata({ params: Promise.resolve({ profession: "herbalism" }) });
  expect(metadata.title).toContain("Herbalism Gathering Guide");
  expect(String(metadata.alternates?.canonical)).toContain("/tools/professions/herbalism/gathering");
});
