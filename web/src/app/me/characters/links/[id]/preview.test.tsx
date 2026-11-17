import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
}));
const factNames = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/character-facts-names", () => ({ loadFactNames: factNames.load }));
const armory = vi.hoisted(() => ({ character: vi.fn() }));
vi.mock("@/lib/armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/armory-store")>()), armoryStore: () => ({ character: armory.character }) }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/game-assets")>()), loadSiteAssets: async () => null, loadItemTips: async () => new Map() }));

import { armoryCharacter } from "@/lib/armory.fixture";
import Page, { dynamic, metadata } from "./page";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const LINK_ID = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const props = (id = LINK_ID) => ({ params: Promise.resolve({ id }) });
const render = async (id = LINK_ID) => renderToStaticMarkup(await Page(props(id)));

const LINK = {
  id: LINK_ID, ruleset: "forever", name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", faction: "Horde", level: 60,
  status: "linked", last_upload_at: "2026-10-30T18:00:00+00:00", link_key: "a".repeat(64), completion_ref: "b".repeat(64),
  // Only raids is switched on for the public page.
  character_visibility: { page_public: true, show_gear: true, show_stats: false, show_talents: false, show_pvp: false, show_professions: false, show_reputations: false, show_raids: true, show_collections: false },
};
const OWN = [
  { category: "gear", consented: true, captured_at: "2026-10-31T09:00:00+00:00", data: { equipped: [{ slot: "HeadSlot", itemId: 16842, itemLevel: 66 }] } },
  { category: "stats", consented: true, captured_at: null, data: null },
  { category: "talents", consented: false, captured_at: null, data: null },
  { category: "pvp", consented: false, captured_at: null, data: null },
  { category: "professions", consented: true, captured_at: "2026-10-30T09:00:00+00:00", data: { professions: [{ name: "Mining", skillLine: null, rank: 280, maxRank: 300 }] } },
  { category: "reputations", consented: false, captured_at: null, data: null },
  { category: "raids", consented: true, captured_at: "2026-10-31T09:00:00+00:00", data: { lockouts: [{ instance: "Molten Core", difficulty: "40 Player", killed: 6, total: 10, resetAt: "2026-11-03T15:00:00.000Z" }] } },
  { category: "achievements", consented: false, captured_at: null, data: null },
];
const answer = (link: unknown[], own: unknown[] = OWN, armoryLinks: unknown[] = []) => auth.authQuery.mockImplementation(async (path: string) => {
  if (path.startsWith("character_links?")) return link;
  if (path === "rpc/own_character_facts") return own;
  if (path === "rpc/armory_own_links") return armoryLinks;
  throw new Error(`unexpected ${path}`);
});

beforeEach(() => {
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "1");
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset();
  factNames.load.mockReset().mockResolvedValue({ catalog: null });
  armory.character.mockReset();
  vi.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z"), toFake: ["Date"] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

test("never cached and never indexed", () => {
  expect(dynamic).toBe("force-dynamic");
  expect(metadata.robots).toEqual({ index: false, follow: false });
});

test("with the switch off it is a 404 and nothing is read", async () => {
  vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "");
  await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("signed out goes to sign in and back here; nothing is read", async () => {
  auth.getUser.mockResolvedValue(null);
  await expect(Page(props())).rejects.toThrow(/NEXT_REDIRECT .*%2Fme%2Fcharacters%2Flinks%2F/);
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("another account's link is a 404, exactly as an unknown id, and its facts are never asked for", async () => {
  answer([]);
  await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(Page(props("not-an-id"))).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.authQuery.mock.calls[0][0]).toContain(`user_id=eq.${USER.id}`);
  expect(auth.authQuery.mock.calls.some(([path]) => path === "rpc/own_character_facts")).toBe(false);
});

test("the owner sees every synced section, switched on or not, each kept category's sync and public state, and nothing secret", async () => {
  answer([LINK]);
  const html = await render();
  expect(html).toContain("Thrallina");
  expect(html).toContain("Only you see this preview");
  expect(html).toContain('data-section="raids"');
  expect(html).toContain("Molten Core");
  // Nothing synced yet: said so, never a zero.
  expect(html).toContain("Nothing synced for this yet.");
  // The settings list: sync, public and capture per kept category. Retired categories, stored until the migration, never show.
  expect(html).toContain('data-category="raids" data-sync="on" data-public="on"');
  expect(html).toContain('data-category="achievements" data-sync="off" data-public="off"');
  for (const retired of ["gear", "stats", "talents", "pvp", "professions", "reputations"]) {
    expect(html).not.toContain(`data-category="${retired}"`);
    expect(html).not.toContain(`data-section="${retired}"`);
  }
  expect(html).not.toContain("280 / 300");
  expect(html).not.toContain('data-part="armory"');
  expect(html).toContain('href="/characters/forever/forever-pioneer/thrallina"');
  expect(html).not.toMatch(/verified|owner|proven|✓/i);
  for (const secret of [USER.id, "a".repeat(64), "b".repeat(64), "Thrall#1"]) expect(html).not.toContain(secret);
});

test("a frozen link shows no synced section and says why", async () => {
  answer([{ ...LINK, status: "frozen" }], OWN.map((r) => ({ ...r, captured_at: null, data: null })));
  const html = await render();
  expect(html).toContain("frozen");
  expect(html).not.toContain('data-section="raids"');
  expect(html).not.toContain("Molten Core");
});

test("with the armory on, a connected character shows every part of Blizzard's data, labelled and credited", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const at = "2026-10-31T08:00:00.000Z";
  armory.character.mockResolvedValue(armoryCharacter({
    fetchedAt: at,
    details: { revision: 1, statistics: { asOf: at, rows: [{ label: "Intellect", value: 69, percent: false }] }, quests: { asOf: at, completed: [1, 2, 3] } },
  }));
  answer([LINK], OWN, [{ link_id: "another-link", region: "us", slug: "someone-else" }, { link_id: LINK_ID, region: "eu", slug: "thrallina-vale" }]);
  const html = await render();
  expect(armory.character).toHaveBeenCalledWith("eu", "thrallina-vale");
  expect(html).toContain('data-part="armory"');
  expect(html).toContain("From Blizzard&#x27;s API, 2026-10-31");
  expect(html).toContain("Data from Blizzard Entertainment");
  // Switched off publicly, still in the owner's preview.
  expect(html).toContain("Intellect");
  expect(html).toContain("Giantstalker");
  expect(html).toContain("completed quests");

  answer([LINK], OWN, [{ link_id: "another-link", region: "us", slug: "someone-else" }]);
  armory.character.mockClear();
  expect(await render()).not.toContain('data-part="armory"');
  expect(armory.character).not.toHaveBeenCalled();
});

test("storage failing says so on the page", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  const html = await render();
  expect(html).toContain("unavailable right now");
});
