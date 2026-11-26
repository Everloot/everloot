import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const data = vi.hoisted(() => ({ shown: true, titles: new Map<number, { name: string; wikiPage: string }>() }));
const TIP = {
  name: "Tough Jerky", color: "#ffffff", quality: "Common", icon: null, partial: false, label: "found in game files, unconfirmed · build 1.60.1.71139",
  lines: ["This Item Begins a Quest", "Item Level 5"], why: [], level: 5, required: 1,
};

vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: vi.fn(async () => ({ uploads: 0, dataAsOf: "2026-10-28T00:00:00.000Z", records: [] })) },
}));
vi.mock("@/lib/shown-item-names", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/shown-item-names")>();
  return {
    ...real,
    loadShownNames: async () => ({
      ...(await real.loadShownNames()),
      matched: { version: "1.60.1.71139", wiki: { name: "Warcraft Wiki", url: "" }, names: new Map([[117, { name: "Tough Jerky", color: "#ffffff", wikiPage: null, source: "files" as const }]]) },
      showsTip: (id: number) => data.shown && id === 117,
    }),
  };
});
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
  loadItemTips: async () => new Map([[117, TIP]]),
  loadQuestNames: async () => ({ version: "1.60.1.71139", wiki: { name: "Warcraft Wiki", url: "" }, names: data.titles }),
}));
vi.mock("@/data/game-data/client-quest-starts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/game-data/client-quest-starts")>()),
  questStartedBy: (itemId: number) => (itemId === 117 ? 900 : undefined),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: () => {} }) }));

import ItemPage from "./page";

const html = async () => renderToStaticMarkup(await ItemPage({ params: Promise.resolve({ id: "117" }) }));
const fact = (out: string, label: string) => new RegExp(`>${label}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1] ?? "";

beforeEach(() => {
  data.shown = true;
  data.titles = new Map([[900, { name: "The Hungry Traveller", wikiPage: "https://warcraft.wiki.gg/wiki/Quest:900" }]]);
});

test("an item the game files say begins a quest names and links that quest, from the game files", async () => {
  const out = await html();
  const starts = fact(out, "Starts a quest");
  expect(starts).toMatch(/<a href="\/database\/quests\/900">The Hungry Traveller<\/a>/);
  expect(starts).toContain("Found in game files, unconfirmed");
  // The tooltip's own line opens the quest too.
  expect(out).toMatch(/<a href="\/database\/quests\/900"[^>]*>This Item Begins a Quest<\/a>/);
});

test("a quest the title rule holds back, or an item whose tooltip may not show, gets no quest line", async () => {
  data.titles = new Map();
  const held = await html();
  expect(held).not.toContain(">Starts a quest</dt>");
  expect(held).not.toContain("/database/quests/900");
  data.titles = new Map([[900, { name: "The Hungry Traveller", wikiPage: "" }]]);
  data.shown = false;
  const hidden = await html();
  expect(hidden).not.toContain(">Starts a quest</dt>");
  expect(hidden).not.toContain("/database/quests/900");
});
