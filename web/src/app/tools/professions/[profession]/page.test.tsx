import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
// The rollup readers run for real unless a test makes one of them fail, so a page can see one read fail and another work.
const fail = vi.hoisted(() => ({ world: false, rollups: false }));
vi.mock("@/lib/rollup-compute", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rollup-compute")>();
  return {
    ...real,
    loadWorldFacts: async (...args: Parameters<typeof real.loadWorldFacts>) =>
      fail.world ? { npcs: [], quests: [], vendors: [], unreachable: true } : real.loadWorldFacts(...args),
    computeRollups: async (...args: Parameters<typeof real.computeRollups>) =>
      fail.rollups ? { rates: [], measuredZeros: [], rejected: [], stats: { uploads: 0, lootWindows: 0, records: 0, unreachable: true, dataAsOf: null } } : real.computeRollups(...args),
  };
});
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

beforeEach(() => { store.loadCorpus.mockReset(); fail.world = false; fail.rollups = false; });

test("the game file recipes show in skill brackets, labelled, with the item and its reagents", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await render();
  expect(html).toContain("Alchemy recipes");
  expect(html).toContain("Found in game files, unconfirmed, build 1.60.1.70790");
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

test("on a phone the recipe tables scroll sideways instead of hiding what a recipe makes and takes", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await render();
  const recipes = html.slice(html.indexOf('data-skill-group="1"'));
  expect(recipes).toContain("overflow-x-auto");
  expect(recipes).not.toContain("hidden sm:table-cell");
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

const three = ["install-aaaa", "install-bbbb", "install-cccc"];
const section = (html: string, kind: string) => { const at = html.indexOf(`data-gather="${kind}"`); return at < 0 ? null : html.slice(at, html.indexOf("</section>", at)); };

test("Herbalism lists the zones where 3 installs gathered from the same herb spot; Mining has none yet and says so", async () => {
  // Silverleaf (object 1617) opened as an herb in Elwynn Forest (1429), at the same spot by three installs.
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z",
    records: three.map((installId, i) => ({
      kind: "loot", eventId: `g${i}`, installId, capturedAt: "2026-10-10T00:00:00.000Z", sourceEvidence: "loot-api",
      sourceObjectId: 1617, gatherKind: "herb", lootType: "gather", mapId: 1429, x: 40 + i * 0.1, y: 60, items: [{ itemId: 765, count: 1 }],
    })),
  });
  const herbs = section(await render("herbalism"), "herb")!;
  expect(herbs).toContain("Where to gather herb");
  expect(herbs).toMatch(/href="\/database\/zones\/1429-[^"]*"/);
  expect(herbs).toContain("Spots");
  const ore = section(await render("mining"), "ore")!;
  expect(ore).toContain("No ore zones yet");
  expect(ore).not.toContain("<table");
  // A profession that gathers nothing has no such section.
  expect(await render("alchemy")).not.toContain("data-gather");
});

test("Skinning lists the zones whose mobs dropped leather, from the same rule as the farming page", async () => {
  const base = (installId: string, n: string) => ({ installId, eventId: `${installId}${n}`, capturedAt: "2026-10-10T00:00:00.000Z" });
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z",
    records: three.flatMap((i) => [
      { ...base(i, "s"), kind: "npc_sighting", positionKind: "npc", npcId: 600, name: "Mottled Boar", mapId: 1411, x: 40, y: 60, level: 5, reaction: "hostile" },
      { ...base(i, "l"), kind: "loot", sourceEvidence: "loot-api", sourceNpcId: 600, items: [{ itemId: 2318, count: 1 }] },
    ]),
  });
  const leather = section(await render("skinning"), "leather")!;
  expect(leather).toContain("Where to farm leather");
  expect(leather).toMatch(/href="\/database\/zones\/1411-[^"]*"/);
  expect(leather).toContain("Looted mobs");
});

// The rollups are memoized by upload count, record count and date, so each corpus below gets its own date.
let stamp = 0;
const corpusOf = (records: unknown[]) => ({ uploads: 3, records, dataAsOf: `2026-10-11T00:00:${String(stamp++ % 60).padStart(2, "0")}.000Z` });
const mob = (installs: string[], npcId: number, name: string, level: number, mapId: number, itemId: number) => installs.flatMap((installId) => [
  { installId, eventId: `${installId}:${npcId}:s`, capturedAt: "2026-10-10T00:00:00.000Z", kind: "npc_sighting", positionKind: "npc", npcId, name, mapId, x: 40, y: 60, level, reaction: "hostile" },
  { installId, eventId: `${installId}:${npcId}:l`, capturedAt: "2026-10-10T00:00:00.000Z", kind: "loot", sourceEvidence: "loot-api", sourceNpcId: npcId, items: [{ itemId, count: 1 }] },
]);
const herb = (installs: string[]) => installs.map((installId, i) => ({
  kind: "loot", eventId: `${installId}:h${i}`, installId, capturedAt: "2026-10-10T00:00:00.000Z", sourceEvidence: "loot-api",
  sourceObjectId: 1617, gatherKind: "herb", lootType: "gather", mapId: 1429, x: 40 + i * 0.1, y: 60, items: [{ itemId: 765, count: 1 }],
}));
const zonesIn = (part: string | null) => [...(part ?? "").matchAll(/href="\/database\/zones\/(\d+)-/g)].map((m) => Number(m[1]));
// Linen Cloth (2589) from a level 15 mob in Elwynn Forest (1429), Light Leather (2318) from a level 5 mob in Durotar (1411).
const clothAndLeather = () => corpusOf([...mob(three, 500, "Defias Bandit", 15, 1429, 2589), ...mob(three, 600, "Mottled Boar", 5, 1411, 2318)]);

test("Tailoring and First Aid list the same cloth zones; Skinning lists the leather ones", async () => {
  store.loadCorpus.mockResolvedValue(clothAndLeather());
  const tailoring = section(await render("tailoring"), "cloth");
  const firstAid = section(await render("first-aid"), "cloth");
  expect(tailoring).toContain("Where to farm cloth");
  expect(zonesIn(tailoring)).toEqual([1429]);
  // The same section, apart from the page's own links in the level menu.
  expect(firstAid?.replaceAll("/first-aid", "/tailoring")).toEqual(tailoring);
  expect(zonesIn(section(await render("skinning"), "leather"))).toEqual([1411]);
});

test("the mob-backed gathering pages read the corpus once", async () => {
  for (const profession of ["skinning", "tailoring", "first-aid", "herbalism"]) {
    store.loadCorpus.mockReset().mockResolvedValue(clothAndLeather());
    await render(profession);
    expect(store.loadCorpus, profession).toHaveBeenCalledTimes(1);
  }
});

test("one or two installs place nothing: gathering zones need 3", async () => {
  for (const installs of [three.slice(0, 1), three.slice(0, 2)]) {
    store.loadCorpus.mockResolvedValue(corpusOf([...herb(installs), ...mob(installs, 500, "Defias Bandit", 15, 1429, 2589)]));
    const herbs = section(await render("herbalism"), "herb")!;
    expect(herbs, `${installs.length} herb`).toContain("No herb zones yet");
    expect(herbs).not.toContain("<table");
    for (const profession of ["tailoring", "first-aid"]) {
      const cloth = section(await render(profession), "cloth")!;
      expect(cloth, `${installs.length} ${profession}`).toContain("No cloth zones yet");
      expect(cloth).not.toContain("<table");
    }
  }
});

test("a mob level range from the URL filters the leather and cloth zones, and the menu keeps the other parameters", async () => {
  store.loadCorpus.mockResolvedValue(clothAndLeather());
  // `level` belongs to the class context and filters nothing.
  const mid = await render("tailoring", { from: "5", mobs: "11-20", class: "mage", level: "3" });
  expect(zonesIn(section(mid, "cloth"))).toEqual([1429]);
  expect(section(mid, "cloth")).toContain('href="/tools/professions/tailoring?from=5&amp;class=mage&amp;level=3&amp;mobs=1-10#gather"');
  expect(section(mid, "cloth")).toContain('href="/tools/professions/tailoring?from=5&amp;class=mage&amp;level=3#gather"');
  const low = section(await render("first-aid", { mobs: "1-10" }), "cloth")!;
  expect(low).toContain("Nothing here for levels 1-10.");
  expect(low).not.toContain("No cloth zones yet");
  expect(zonesIn(section(await render("skinning", { mobs: "1-10" }), "leather"))).toEqual([1411]);
  // A malformed range is a 404 where the page filters by mob level; elsewhere the parameter means nothing.
  for (const profession of ["skinning", "tailoring", "first-aid"]) {
    for (const mobs of ["garbage", "20-10"]) await expect(render(profession, { mobs }), `${profession} ${mobs}`).rejects.toThrow("NEXT_NOT_FOUND");
  }
  expect(section(await render("herbalism", { mobs: "garbage" }), "herb")).not.toBeNull();
});

test("when the corpus reads but the world facts or the rollups do not, the section says storage is unreachable", async () => {
  for (const which of ["world", "rollups"] as const) {
    fail.world = which === "world";
    fail.rollups = which === "rollups";
    store.loadCorpus.mockResolvedValue(clothAndLeather());
    for (const [profession, kind] of [["tailoring", "cloth"], ["first-aid", "cloth"], ["skinning", "leather"]]) {
      const part = section(await render(profession), kind)!;
      expect(part, `${which} ${profession}`).toContain("Storage unreachable");
      expect(part).not.toContain("zones yet");
      expect(part).not.toContain("<table");
    }
  }
  // The corpus itself down: the same message, and the herb section too.
  fail.world = false; fail.rollups = false;
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  for (const [profession, kind] of [["tailoring", "cloth"], ["herbalism", "herb"]]) {
    expect(section(await render(profession), kind), profession).toContain("Storage unreachable");
  }
});
