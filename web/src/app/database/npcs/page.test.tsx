import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { NpcRow } from "@/lib/world-lists";

const store = vi.hoisted(() => ({
  facts: { npcs: [], quests: [], vendors: [], unreachable: false } as Record<string, unknown>,
  npcs: [] as unknown[],
  quests: [] as { giverNpcId: number | null; turnInNpcId: number | null }[],
  wiki: null as { version: string; names: Map<number | string, { name: string; wikiPage: string }> } | null,
}));
vi.mock("@/lib/wiki-entity-names", async (original) => ({
  ...(await original<typeof import("@/lib/wiki-entity-names")>()),
  loadWikiEntityNames: async () => store.wiki,
}));
vi.mock("@/lib/rollup-compute", () => ({
  loadWorldFacts: async () => store.facts,
  computeRollups: async () => ({ rates: [], measuredZeros: [], stats: {} }),
}));
vi.mock("@/lib/upload-store", () => ({ STORAGE_UNREACHABLE: "Storage unavailable" }));
vi.mock("@/lib/world-lists", async (original) => ({
  ...(await original<typeof import("@/lib/world-lists")>()),
  npcRows: () => store.npcs,
  publicQuests: () => store.quests,
  publicVendors: () => [],
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => "/database/npcs",
  useRouter: () => ({ push: () => {} }),
}));

import NpcListPage, { generateMetadata } from "./page";
import { bareNpcRow } from "@/lib/world-lists";

// Made-up names and ids only (docs/DATA_POLICY.md).
const npc = (over: Partial<NpcRow> & { npcId: number }): NpcRow => ({ ...bareNpcRow(over.npcId), ...over });
const html = async (search: Record<string, string> = {}) => renderToStaticMarkup(await NpcListPage({ searchParams: Promise.resolve(search) }));

beforeEach(() => {
  store.facts = { npcs: [], quests: [], vendors: [], unreachable: false };
  store.npcs = [npc({ npcId: 101, name: "Npc Alpha", level: 12 }), npc({ npcId: 102, name: "Npc Beta", level: 30 })];
  store.quests = [{ giverNpcId: 202, turnInNpcId: null }];
  store.wiki = null;
});

test("the list is titled NPCs and links each NPC's page, a quest giver with no agreed facts by its id", async () => {
  const meta = await generateMetadata({});
  expect(meta.title).toBe("WoW Forever NPC Lookup");
  expect(meta.alternates?.canonical).toBe("/database/npcs");
  const page = await html();
  expect(page).toContain(">NPCs<");
  expect(page).toContain('<a href="/database/npcs/101">Npc Alpha</a>');
  expect(page).toContain('<a href="/database/npcs/102">Npc Beta</a>');
  expect(page).toContain('<a href="/database/npcs/202">NPC 202</a>');
  expect(page).toContain('aria-label="NPC filters"');
});

test("a filter matching no NPC says so, and an id search offers that NPC's page", async () => {
  const page = await html({ q: "303" });
  expect(page).toContain("No NPCs match these filters.");
  expect(page).toContain('<a href="/database/npcs/303">Open NPC 303</a>');
  expect(page).not.toContain('href="/database/npcs/101"');
});

test("with no NPC reported yet the page says how one gets listed, links the addon, and shows no filters", async () => {
  store.npcs = [];
  store.quests = [];
  const page = await html();
  expect(page).toContain("NPC shows here once 3 installs agree on it.");
  expect(page).toContain('href="/addon"');
  expect(page).not.toContain('aria-label="NPC filters"');
});

test("with storage unreachable the page says so instead of an empty list", async () => {
  store.facts = { npcs: [], quests: [], vendors: [], unreachable: true };
  const page = await html();
  expect(page).toContain("Storage unavailable");
  expect(page).not.toContain("installs agree on it");
  expect(page).not.toContain('href="/database/npcs/101"');
});

test("a filter value the list does not know is a 404", async () => {
  await expect(html({ react: "x" })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html({ page: "9" })).rejects.toThrow("NEXT_NOT_FOUND");
});

test("a rank above normal is a badge and the zone links its page", async () => {
  store.npcs = [
    npc({ npcId: 101, name: "Npc Alpha", rank: "elite", zone: { mapId: 1426, name: "Synthetic Hills", continentId: 0, continentName: "Synthetic Continent" } }),
    npc({ npcId: 102, name: "Npc Beta", rank: "normal" }),
  ];
  const page = await html();
  expect(page).toMatch(/data-badge="neutral"[^>]*>Elite</);
  expect(page).not.toMatch(/data-badge="neutral"[^>]*>Normal</);
  expect(page).toContain(">Normal<");
  expect(page).toContain('<a href="/database/zones/1426-synthetic-hills">Synthetic Hills</a>');
});

test("an NPC its own page names from the Warcraft Wiki is listed, searched and sorted by that name, as on its page", async () => {
  // NPC 103: one install's unanimous name matches a wiki NPC name (the NPC page's rule, shownNpcName). NPC 104: a
  // report the wiki does not know stays "NPC 104", as on its page.
  store.facts = {
    npcs: [], quests: [], vendors: [], unreachable: false,
    agreedNpcs: new Map([[103, { npcId: 103, reportedName: "npc gamma" }], [104, { npcId: 104, reportedName: "npc unknown" }]]),
  };
  store.wiki = { version: "1", names: new Map([["npc gamma", { name: "Npc Gamma", wikiPage: "https://warcraft.wiki.gg/wiki/Npc_Gamma" }]]) };
  store.npcs = [npc({ npcId: 103, drops: 4 }), npc({ npcId: 104, drops: 2 })];
  const page = await html();
  expect(page).toMatch(/<a href="\/database\/npcs\/103">Npc Gamma<\/a>(?:<[^>]*>)*\s*\(name from the warcraft wiki\)/);
  expect(page).toContain('<a href="/database/npcs/104">NPC 104</a>');
  const found = await html({ q: "gamma" });
  expect(found).toContain('<a href="/database/npcs/103">Npc Gamma</a>');
  expect(found).not.toContain('href="/database/npcs/104"');
});
