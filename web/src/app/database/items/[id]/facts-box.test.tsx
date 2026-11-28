import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

// The quick facts beside the tooltip read like a database's facts box: item level, required level, binding and sell
// price, each from the game file tooltip the page already shows.
const TIP = {
  name: "Ashen Sabatons", color: "#a335ee", quality: "Epic", icon: null, partial: false, label: "found in game files, unconfirmed · build 1.60.1.71139",
  lines: ["Binds when picked up", "Feet", "Item Level 66", "Requires Level 60", "Sell Price: 3g 12s 40c"], why: [], level: 66, required: 60,
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
      matched: { version: "1.60.1.71139", wiki: { name: "Warcraft Wiki", url: "" }, names: new Map([[117, { name: "Ashen Sabatons", color: "#a335ee", wikiPage: null, source: "files" as const }]]) },
      showsTip: (id: number) => id === 117,
    }),
  };
});
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
  loadItemTips: async () => new Map([[117, TIP]]),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: () => {} }) }));

import ItemPage from "./page";

const fact = (out: string, label: string) => new RegExp(`>${label}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1] ?? null;

test("the quick facts give item level, required level, binding and sell price from the tooltip", async () => {
  const out = renderToStaticMarkup(await ItemPage({ params: Promise.resolve({ id: "117" }) }));
  expect(fact(out, "Item level")).toMatch(/66/);
  expect(fact(out, "Req. level")).toMatch(/60/);
  expect(fact(out, "Binding")).toMatch(/Binds when picked up/);
  expect(fact(out, "Sell price")).toMatch(/3g 12s 40c/);
  // In that order, ahead of the sell price.
  expect(out.indexOf(">Item level</dt>")).toBeLessThan(out.indexOf(">Req. level</dt>"));
  expect(out.indexOf(">Binding</dt>")).toBeLessThan(out.indexOf(">Sell price</dt>"));
});
