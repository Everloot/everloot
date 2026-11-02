import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
  loadItemTips: async () => new Map(),
  loadSpellNames: async () => ({ version: "1.60.1.70707", names: new Map([[2329, "Elixir of Minor Strength"]]) }),
}));
vi.mock("@/lib/shown-item-names", () => ({
  loadShownNames: async () => ({
    facts: { unreachable: true }, agreed: new Map<number, string>(), named: { has: () => false },
    matched: { version: "1.60.1.70707", wiki: { name: "Warcraft Wiki", url: "" }, names: new Map([[2454, { name: "Elixir of Minor Strength", color: "#ffffff", wikiPage: null, source: "files" as const }]]) },
    showsTip: (id: number) => id === 2454,
  }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/components/EmailCapture", () => ({ default: () => null }));

import ProfessionPage from "./page";

const obs = (installId: string, rank: number, difficulty: string, recipe = "Lesser Healing Potion") => ({
  kind: "recipe_observed", eventId: `${installId}:${rank}`, installId, capturedAt: "2026-10-10T00:00:00.000Z",
  profession: "Alchemy", recipe, rank, difficulty, reagents: [],
});
const render = async (profession = "alchemy", search: Record<string, string> = {}) =>
  renderToStaticMarkup(await ProfessionPage({ params: Promise.resolve({ profession }), searchParams: Promise.resolve(search) }));
const empty = { uploads: 0, records: [], dataAsOf: "2026-10-10T00:00:00.000Z" };

beforeEach(() => store.loadCorpus.mockReset());

test("the game file recipes show in skill brackets, labelled, with the item and its reagents", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await render();
  expect(html).toContain("Alchemy recipes");
  expect(html).toContain("Found in game files, unconfirmed, build 1.60.1.70707");
  expect(html).toContain('data-skill-group="1"');
  expect(html).toContain("Skill 1–75");
  // The recipe spell links to its spell page, the item it makes to its item page under the name rule.
  expect(html).toContain('href="/database/spells/2329"');
  expect(html).toContain('href="/database/items/2454"');
  expect(html).toContain(">Elixir of Minor Strength<");
  // A reagent with no name under the rule stays "Item N", with its count.
  expect(html).toContain(">Item 2449<");
  expect(html).toContain("1×");
  expect(html).toContain('data-badge="files"');
});

test("an unknown profession is a 404", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  await expect(render("riding")).rejects.toThrow("NEXT_NOT_FOUND");
});

test("with no observations the player layer says ranges are unrecorded, not zero", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await render();
  expect(html).toContain("data-empty-state");
  expect(html).toContain("No recipe ranges for Alchemy yet");
  expect(html).not.toContain(">Players saw<");
});

test("three agreeing installs show the inferred range", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z",
    records: [obs("install-aaaa", 50, "optimal"), obs("install-bbbb", 60, "medium"), obs("install-cccc", 55, "medium")],
  });
  expect(await render()).toContain("Lesser Healing Potion (Alchemy), 3 installs: yellow from 51-55");
});

test("a range players agree on sits beside the game file recipe of the same name, labelled by its installs", async () => {
  const recipe = "Elixir of Minor Strength";
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z",
    records: [obs("install-aaaa", 50, "optimal", recipe), obs("install-bbbb", 60, "medium", recipe), obs("install-cccc", 55, "medium", recipe)],
  });
  const html = await render();
  expect(html).toContain(">Players saw<");
  expect(html).toContain("3 installs</span> yellow 51–55");
});

test("agreed reagents priced by auction scans show a cost per craft", async () => {
  const ids = ["install-aaaa", "install-bbbb", "install-cccc"];
  const reagents = [{ item: "Peacebloom", count: 2 }];
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z",
    records: [
      ...ids.map((id, i) => ({ ...obs(id, 50 + i, "optimal"), reagents })),
      ...ids.flatMap((id) => [
        { kind: "auction_scan", installId: id, capturedAt: "2026-10-10T00:00:00.000Z", realm: "Forever", itemId: 2447, copper: 30, priceBasis: "unit" },
        { kind: "item_seen", installId: id, itemId: 2447, name: "Peacebloom" },
      ]),
    ],
  });
  expect(await render()).toContain("Reagents: 2 Peacebloom. Estimated cost per craft: 60c.");
});

test("the path on the page routes through steps derived from colours and trainer ranks", async () => {
  const ids = ["install-aaaa", "install-bbbb", "install-cccc"];
  const reagents = [{ item: "Peacebloom", count: 1 }];
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z",
    records: [
      { ...obs(ids[0], 1, "optimal"), reagents }, { ...obs(ids[1], 10, "optimal"), reagents }, { ...obs(ids[2], 12, "medium"), reagents },
      ...ids.map((id) => ({ kind: "trainer_seen", installId: id, profession: "Alchemy", recipe: "Lesser Healing Potion", requiredRank: 1 })),
    ],
  });
  expect(await render("alchemy", { from: "1", to: "11" })).toContain("1–11  Lesser Healing Potion  10 crafts × 1");
});
