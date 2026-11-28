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

test("Has rewards filters to the quests with agreed rewards, and is not offered while no quest has any", async () => {
  store.quests = [quest({ questId: 301, title: "Quest Alpha", level: 10, rewards: [501] }), quest({ questId: 303, title: "Quest Gamma", level: 12 })];
  const on = await html({ rewards: "1" });
  expect(on).toContain('href="/database/quests/301"');
  expect(on).not.toContain('href="/database/quests/303"');
  expect(await html()).toContain(">Has rewards<");

  store.quests = [quest({ questId: 303, title: "Quest Gamma", level: 12 })];
  const plain = await html();
  expect(plain).not.toContain(">Has rewards<");
  // An old link with the filter on says why nothing matches instead of a bare "no match".
  const old = await html({ rewards: "1" });
  expect(old).toContain("No quest has agreed rewards yet: a reward shows once 3 installs report the same item.");
});

test("the list opens by level, lowest first, with quests no level is agreed for after; the ID sort stays a header link", async () => {
  store.quests = [
    quest({ questId: 1, title: "Quest Test One" }),
    quest({ questId: 400, title: "Quest Late", level: 30 }),
    quest({ questId: 401, title: "Quest Early", level: 5 }),
  ];
  const page = await html();
  const order = [...page.matchAll(/href="\/database\/quests\/(\d+)"/g)].map((m) => Number(m[1]));
  expect(order.slice(0, 2)).toEqual([401, 400]);
  expect(order.indexOf(1)).toBeGreaterThan(1);
  expect(page).toMatch(/aria-sort="ascending"[^>]*>(?:<[^>]*>)*Level/);
  expect(page).toContain('href="/database/quests?sort=-id"');
});

test("a filter value the list does not know is a 404", async () => {
  await expect(html({ side: "x" })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html({ page: "9" })).rejects.toThrow("NEXT_NOT_FOUND");
});

test("under the title, the list says what its count holds: the quests players confirmed and the ones the files add", async () => {
  const header = (await html()).split("data-page-header")[1]?.split("</header>")[0] ?? "";
  expect(header).toMatch(/1 confirmed by players · 1 more from the game files, titled by the Warcraft Wiki where it has a title; others show their number/);
});

test("each quest menu counts what the list would hold with every other filter on", async () => {
  store.wiki = null;
  store.quests = [
    quest({ questId: 301, title: "Quest Alpha", level: 5, category: "Synthetic Vale", side: "alliance" }),
    quest({ questId: 303, title: "Quest Gamma", level: 25, category: "Synthetic Vale", side: "horde" }),
    quest({ questId: 304, title: "Quest Delta", level: 5, category: "Synthetic Marsh", side: "horde" }),
  ];
  const menuCount = (out: string, menu: string, label: string) => {
    const part = out.split(`data-filter="${menu}"`)[1]?.split("</details>")[0] ?? "";
    const at = part.split(`>${label}</span><span class="tabular-nums text-muted">`)[1];
    return at === undefined ? null : Number(at.split("<")[0].replace(/,/g, ""));
  };
  const low = await html({ level: "1-10" });
  expect(menuCount(low, "category", "Synthetic Vale")).toBe(1);
  expect(menuCount(low, "side", "Horde")).toBe(1);
  // The Level menu counts too, ignoring its own filter.
  expect(menuCount(low, "level", "21–30")).toBe(1);
  const horde = await html({ side: "horde", category: "Synthetic Vale" });
  expect(menuCount(horde, "level", "1–10")).toBeNull();
  expect(menuCount(horde, "side", "Alliance")).toBe(1);
  expect(menuCount(horde, "category", "Synthetic Marsh")).toBe(1);
});

test("each quest menu notes the rows it cannot hold, those with no value recorded, counted with the other filters on", async () => {
  store.wiki = null;
  store.quests = [
    quest({ questId: 301, title: "Quest Alpha", level: 5, category: "Synthetic Vale", side: "alliance" }),
    quest({ questId: 303, title: "Quest Gamma", level: null, category: null, side: "horde" }),
    quest({ questId: 304, title: "Quest Delta", level: null, category: null, side: null }),
    quest({ questId: 305, title: "Quest Epsilon", level: 25, category: "Synthetic Vale", side: "horde" }),
  ];
  const note = (out: string, menu: string) => /<li class="[^"]*">(Not recorded: [\d,]+)<\/li>/.exec(out.split(`data-filter="${menu}"`)[1]?.split("</details>")[0] ?? "")?.[1] ?? null;
  const all = await html();
  expect(note(all, "level")).toBe("Not recorded: 2");
  expect(note(all, "category")).toBe("Not recorded: 2");
  expect(note(all, "side")).toBe("Not recorded: 1");
  expect(all).toMatch(/>21–30<\/span><span class="tabular-nums text-muted">1</);
  // With Side on, the Level menu counts only the Horde quests: one has no level.
  expect(note(await html({ side: "horde" }), "level")).toBe("Not recorded: 1");
  // Every row has a value: no note.
  store.quests = [quest({ questId: 301, title: "Quest Alpha", level: 5, category: "Synthetic Vale", side: "alliance" })];
  expect(note(await html(), "level")).toBeNull();
});
