import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

// Pattern 6270 teaches spell 7630, which creates item 6240 (the committed client-recipe-items.json and client-recipes.json).
// The names and lines here are made up.
const label = "found in game files, unconfirmed · build 1.60.1.71139";
const TIPS = new Map([
  [6270, { name: "Synthetic Pattern", color: "#ffffff", quality: "Common", icon: null, partial: false, label, lines: ["Requires Tailoring (35)", "Sell Price: 50c"], why: [], level: 7, required: 0, binding: 1 }],
  [6240, { name: "Synthetic Vest", color: "#1eff00", quality: "Uncommon", icon: null, partial: true, label, lines: ["Chest · Cloth", "[?] Armor"], why: ["[?] armor: reason."], level: 12, required: 7, binding: 2 }],
]);
const gate = vi.hoisted(() => ({ shows: [6270, 6240], asked: [] as number[][] }));

vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: vi.fn(async () => ({ uploads: 0, dataAsOf: "2026-11-26T00:00:00.000Z", records: [] })) },
}));
vi.mock("@/lib/shown-item-names", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/shown-item-names")>();
  return {
    ...real,
    loadShownNames: async () => ({
      ...(await real.loadShownNames()),
      matched: {
        version: "1.60.1.71139", wiki: { name: "Warcraft Wiki", url: "" },
        names: new Map([[6270, { name: "Synthetic Pattern", color: "#ffffff", wikiPage: null, source: "files" as const }], [6240, { name: "Synthetic Vest", color: "#1eff00", wikiPage: null, source: "files" as const }]]),
      },
      showsTip: (id: number) => gate.shows.includes(id),
    }),
  };
});
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
  loadItemTips: async (_a: unknown, ids: number[]) => { gate.asked.push(ids); return new Map([...TIPS].filter(([id]) => ids.includes(id))); },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: () => {} }) }));

import ItemPage from "./page";

beforeEach(() => { gate.shows = [6270, 6240]; gate.asked = []; });

const box = (page: string) => page.slice(page.indexOf("data-tooltip-frame"), page.indexOf("</section>", page.indexOf("data-tooltip-frame")));

test("a recipe's box draws the item it teaches under its lines, linked to that item's page", async () => {
  const page = renderToStaticMarkup(await ItemPage({ params: Promise.resolve({ id: "6270" }) }));
  const frame = box(page);
  expect(frame).toContain("data-card-taught");
  expect(frame).toContain('href="/database/items/6240"');
  expect(frame).toContain("[?] Armor");
  // Before the recipe's own sell price.
  expect(frame.indexOf("data-card-taught")).toBeLessThan(frame.indexOf("Sell Price"));
});

test("a taught item its own page would not show is never read, and the recipe's box draws none of it", async () => {
  gate.shows = [6270];
  const page = renderToStaticMarkup(await ItemPage({ params: Promise.resolve({ id: "6270" }) }));
  expect(box(page)).not.toContain("data-card-taught");
  expect(page).not.toContain("[?] Armor");
  expect(gate.asked.flat()).not.toContain(6240);
});
