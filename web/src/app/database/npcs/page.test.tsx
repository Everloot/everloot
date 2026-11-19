import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { NpcRow } from "@/lib/world-lists";

const store = vi.hoisted(() => ({
  facts: { npcs: [], quests: [], vendors: [], unreachable: false } as Record<string, unknown>,
  npcs: [] as unknown[],
  quests: [] as { giverNpcId: number | null; turnInNpcId: number | null }[],
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
