import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const NOTE = "[?] in a Use, Equip or Chance on hit line: a value the spell tables we read do not give.";
const TIP = {
  name: "Tough Jerky", color: "#ffffff", quality: "Common", icon: null, partial: true, label: "found in game files, unconfirmed · build 1.60.1.70658",
  lines: ["Item Level 5", "Use: Restores [?] health over 18 sec. Must remain seated while eating."], why: [NOTE],
  level: 5, required: 1,
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
      matched: { version: "1.60.1.70658", wiki: { name: "Warcraft Wiki", url: "" }, names: new Map([[117, { name: "Tough Jerky", color: "#ffffff", wikiPage: null, source: "files" as const }]]) },
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

test("the reason for a [?] sits under the game's tooltip, as on the hover card", async () => {
  const page = renderToStaticMarkup(await ItemPage({ params: Promise.resolve({ id: "117" }) }));
  const frameAt = page.indexOf("data-tooltip-frame");
  const notesAt = page.indexOf("data-card-notes");
  expect(frameAt).toBeGreaterThan(-1);
  expect(notesAt).toBeGreaterThan(frameAt);
  // The frame closes before the note opens: the note is not one of the tooltip's lines.
  const frame = page.slice(frameAt, notesAt);
  expect(frame).toContain("Restores [?] health");
  expect(frame).not.toContain("spell tables we read");
  expect(page.slice(notesAt)).toContain("spell tables we read do not give");
});

test("an item with no slot says so the way the lists do", async () => {
  const page = renderToStaticMarkup(await ItemPage({ params: Promise.resolve({ id: "117" }) }));
  expect(page).not.toMatch(/Slot<\/dt><dd[^>]*>None</);
});
