import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { QuestRow } from "@/lib/world-lists";

const store = vi.hoisted(() => ({
  facts: { npcs: [], quests: [], vendors: [], unreachable: false } as Record<string, unknown>,
  quests: [] as unknown[],
  wiki: null as { version: string; names: Map<number, { name: string }> } | null,
}));
vi.mock("@/lib/rollup-compute", () => ({ loadWorldFacts: async () => store.facts }));
vi.mock("@/lib/upload-store", () => ({ STORAGE_UNREACHABLE: "Storage unavailable" }));
vi.mock("@/lib/world-lists", async (original) => ({
  ...(await original<typeof import("@/lib/world-lists")>()),
  publicQuests: () => store.quests,
}));
vi.mock("@/lib/names", () => ({ npcNames: () => new Map([[101, "Npc Giver"]]) }));
vi.mock("@/lib/game-assets", () => ({
  loadQuestNames: async () => store.wiki,
  loadSiteAssets: async () => null,
  loadItemTips: async () => new Map(),
}));
vi.mock("@/lib/shown-item-names", () => ({ loadShownNames: async () => null }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => "/database/quests",
  useRouter: () => ({ push: () => {} }),
}));

import QuestListPage, { generateMetadata } from "./page";
import { bareQuestRow } from "@/lib/world-lists";

// Made-up titles and ids only (docs/DATA_POLICY.md).
const quest = (over: Partial<QuestRow> & { questId: number }): QuestRow => ({ ...bareQuestRow(over.questId), ...over });
const html = async (search: Record<string, string> = {}) => renderToStaticMarkup(await QuestListPage({ searchParams: Promise.resolve(search) }));

beforeEach(() => {
  store.facts = { npcs: [], quests: [], vendors: [], unreachable: false };
  store.quests = [quest({ questId: 301, title: "Quest Alpha", level: 10, giverNpcId: 101, rewards: [501] })];
  store.wiki = { version: "0.0.0", names: new Map([[302, { name: "Quest From Wiki" }]]) };
});

test("the list is titled Quests and links each quest, its giver and its rewards", async () => {
  const meta = await generateMetadata({});
  expect(meta.title).toBe("WoW Forever Quest Lookup");
  expect(meta.alternates?.canonical).toBe("/database/quests");
  const page = await html();
  expect(page).toContain(">Quests<");
  expect(page).toContain('<a href="/database/quests/301">Quest Alpha</a>');
  expect(page).toContain('<a href="/database/npcs/101">Npc Giver</a>');
  expect(page).toContain('<a href="/database/items/501">Item 501</a>');
  expect(page).toContain('aria-label="Quest filters"');
});

test("a quest the game files list but players have not reported is listed with the wiki's title", async () => {
  const page = await html();
  expect(page).toMatch(/<a href="\/database\/quests\/302">Quest From Wiki<\/a><span class="sr-only">/);
});

test("a filter matching no quest says so, and an id search offers that quest's page", async () => {
  const page = await html({ q: "999" });
  expect(page).toContain("No quests match these filters.");
  expect(page).toContain('<a href="/database/quests/999">Open quest 999</a>');
});

test("with no quest reported and no wiki titles the page says how one gets listed and links the addon", async () => {
  store.quests = [];
  store.wiki = null;
  const page = await html();
  expect(page).toContain("No quest has agreed facts yet; each shows here once 3 installs report it.");
  expect(page).toContain('href="/addon"');
});

test("with storage unreachable the page says so instead of an empty list", async () => {
  store.facts = { npcs: [], quests: [], vendors: [], unreachable: true };
  store.wiki = null;
  const page = await html();
  expect(page).toContain("Storage unavailable");
  expect(page).not.toContain("No quest has agreed facts yet");
  expect(page).not.toContain('href="/database/quests/301"');
});

test("a filter value the list does not know is a 404", async () => {
  await expect(html({ side: "x" })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html({ page: "9" })).rejects.toThrow("NEXT_NOT_FOUND");
});
