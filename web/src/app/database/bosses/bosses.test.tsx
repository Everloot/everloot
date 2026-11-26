import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));
vi.mock("@/components/ui/OpenData", () => ({ default: ({ text, report }: { text: string; report?: { type: string; id: number } }) => <pre data-open-data data-report={report ? `${report.type} ${report.id}` : ""}>{text}</pre> }));
// Storage is down unless a test hands in sightings: the page is then the game files' encounter alone.
const state = vi.hoisted(() => ({ seen: { unreachable: true } as Record<string, unknown>, loot: new Map<string, unknown>() }));
vi.mock("@/lib/rollup-compute", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rollup-compute")>()),
  loadLootTables: async () => ({ tables: { sources: state.loot, leftOut: 0 }, unreachable: false, dataAsOf: "2026-11-05T00:00:00Z" }),
  loadItemFacts: async () => ({ rates: [], names: [], npcs: [], unreachable: false }),
  loadWorldFacts: async () => ({ npcs: [], quests: [], vendors: [], unreachable: false }),
}));
vi.mock("@/lib/instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/instances")>()),
  loadSightings: async () => state.seen,
}));
const clears = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/progression", () => ({ loadInstanceClears: async () => clears.value }));
const renders = vi.hoisted(() => ({ npcs: new Map<number, { url: string; size: number }>() }));
vi.mock("@/lib/game-renders", () => ({ loadRenders: async () => ({ npcs: renders.npcs, items: new Map() }) }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
}));

import BossPage, { generateMetadata } from "./[boss]/page";
import BossListPage from "./page";

const page = async (segment: string) => renderToStaticMarkup(await BossPage({ params: Promise.resolve({ boss: segment }) }));
const list = async (search: Record<string, string> = {}) => renderToStaticMarkup(await BossListPage({ searchParams: Promise.resolve(search) }));
const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
const panel = (html: string, id: string) => html.split(`data-tab-panel="${id}"`)[1]?.split("data-tab-panel=")[0] ?? "";

// SYNTHETIC: three installs killed Oggleflint in Ragefire Chasm and tie creature 11517 to it.
const INSTALLS = ["install-a", "install-b", "install-c"];
const killed = INSTALLS.map((installId) => ({ installId, encounterId: 2732, name: "Oggleflint", instanceMapId: 389, success: true, npcIds: [11517], capturedAt: "2026-11-04T20:00:00Z" }));
const reported = () => { state.seen = { unreachable: false, asOf: new Date("2026-11-05T00:00:00Z"), instances: { entrances: [], encounters: killed } }; };

afterEach(() => { state.seen = { unreachable: true }; state.loot = new Map(); clears.value = null; renders.npcs = new Map(); });

test("a boss page from the game files alone: its name marked unconfirmed, its instance linked, its place in the files' order", async () => {
  const html = await page("2733-taragaman-the-hungerer");
  expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  expect(html).toMatch(/<h1[^>]*>Taragaman the Hungerer<\/h1>/);
  expect(html).toMatch(/data-entity-meta[^>]*>.*Dungeon boss.*Encounter 2733.*data-badge="files"/);
  expect(html).toContain('href="/database/instances/389-ragefire-chasm"');
  expect(text(html)).toMatch(/\|Order\|2 of 4\|/);
  // Storage down: the loot is unrecorded, not empty. Up with no report: no creature, so no loot, saying why.
  expect(text(panel(html, "loot"))).toContain("Storage unreachable.");
  state.seen = { unreachable: false, asOf: new Date("2026-11-05T00:00:00Z"), instances: { entrances: [], encounters: [] } };
  expect(text(panel(await page("2733-taragaman-the-hungerer"), "loot"))).toContain("no creature is tied to this boss");
  // The other bosses of the instance, in order, this one not linked to itself.
  const others = panel(html, "instance");
  expect(others).toContain('href="/database/bosses/2732-oggleflint"');
  expect(others).toContain('href="/database/bosses/2735-bazzalan"');
  expect(others).not.toContain('href="/database/bosses/2733-taragaman-the-hungerer"');
  expect(text(html)).toContain("Found in game files, unconfirmed");
  expect(html).toContain('data-report="Boss 2733"');
});

test("a boss 3 installs report: kills, installs, the creature linked, its loot table and its model picture", async () => {
  reported();
  state.loot = new Map([["npc:11517", {
    windows: 6, installs: new Set(INSTALLS), first: "2026-11-03T20:00:00Z", last: "2026-11-04T20:00:00Z",
    items: new Map([[14149, { windows: 6, installs: new Set(INSTALLS) }]]),
  }]]);
  renders.npcs = new Map([[11517, { url: "https://a.test/renders/x.webp", size: 512 }]]);
  const html = await page("2732-oggleflint");
  expect(text(html)).toMatch(/\|Kills reported\|3\|/);
  expect(html).toContain('href="/database/npcs/11517"');
  const loot = panel(html, "loot");
  expect(loot).toContain('href="/database/items/14149"');
  expect(text(loot)).toContain("confirmed by 3 players");
  expect(html).toContain('src="https://a.test/renders/x.webp"');
});

test("linked characters' kills of the boss are counts only, with no character named", async () => {
  const { instanceClears } = await import("@/lib/dungeon-clears");
  const k = (encounterId: number, killCount: number) => ({ instanceMapId: 389, encounterId, difficulty: 1, firstKillAt: "2026-11-10T00:00:00Z", lastKillAt: "2026-11-20T00:00:00Z", killCount });
  clears.value = instanceClears(389, [
    { region: "us", slug: "mira-dawn", name: "Mira", surname: "Dawn", kills: [k(2732, 2)] },
    { region: "eu", slug: "tavi-reed", name: "Tavi", surname: "Reed", kills: [k(2732, 5), k(2733, 1)] },
  ]);
  const html = await page("2732-oggleflint");
  const kills = text(panel(html, "kills"));
  expect(kills).toContain("2 linked characters have killed this boss, 7 kills in all.");
  for (const name of ["Mira", "Tavi"]) expect(html).not.toContain(name);
  clears.value = null;
  expect(await page("2732-oggleflint")).not.toContain('data-tab-panel="kills"');
});

test("an id that is no boss of a listed instance is a 404; a wrong slug redirects to the canonical address", async () => {
  await expect(page("999999")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page("abc")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page("2732")).rejects.toThrow("REDIRECT /database/bosses/2732-oggleflint");
  const meta = await generateMetadata({ params: Promise.resolve({ boss: "2732-oggleflint" }) });
  expect(meta.title).toBe("Oggleflint – WoW Forever boss");
  expect(meta.robots).toEqual({ index: false, follow: true }); // storage down: not indexed
});

test("the list: every boss with its instance and order, filtered by name or id", async () => {
  const html = await list();
  expect(html).toContain('href="/database/bosses/2732-oggleflint"');
  expect(html).toContain('href="/database/instances/389-ragefire-chasm"');
  expect(text(html)).toContain("found in game files, unconfirmed");
  const found = await list({ q: "oggle" });
  expect(found).toContain("Oggleflint");
  expect(found).not.toContain("Bazzalan");
  expect(await list({ q: "2735" })).toContain('href="/database/bosses/2735-bazzalan"');
});
