import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { edgeDegraded } from "@/lib/cf-edge-cache";
import { emptyMarket, foldMarket } from "@kb/market";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), loadMarket: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadMarket: store.loadMarket },
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
// The game-file layer only: the item names file and a tooltip with an icon for each item the page may show one for.
// The players' names come from the real readers, the corpus path and the stored item view alike.
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
  loadItemNames: async () => ({ version: "1.60.1.70707", wiki: { name: "Warcraft Wiki", url: "" }, names: new Map([[2454, { name: "Elixir of Minor Strength", color: "#ffffff", wikiPage: null, source: "files" as const }]]) }),
  loadItemTips: async (_assets: unknown, ids: readonly number[]) => new Map(ids.map((id) => [id, {
    name: `Tip ${id}`, color: "#1eff00", quality: "Uncommon", icon: `https://icons.test/${id}.jpg`, lines: [`Tip line ${id}`], partial: false, why: [], label: "", level: 0, required: 0, binding: 0,
  }])),
  loadSpellNames: async () => ({ version: "1.60.1.70707", names: new Map([[2329, "Elixir of Minor Strength"]]) }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch }: { href: string; children: ReactNode; prefetch?: boolean }) => <a href={href} data-prefetch={prefetch === undefined ? undefined : String(prefetch)}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => null,
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`308 ${to}`); },
}));
vi.mock("@/components/EmailCapture", () => ({ default: () => null }));
// AH Ledger is read on the server for the crafting margins; no test reaches the real API.
const ledger = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/ahledger-proxy", () => ({ readAhledgerPage: ledger.read }));

import ProfessionPage, { generateMetadata } from "./page";
import { professionBySegment } from "@/lib/professions";

const obs = (installId: string, rank: number, difficulty: string, recipe = "Lesser Healing Potion") => ({
  kind: "recipe_observed", eventId: `${installId}:${rank}`, installId, capturedAt: "2026-10-10T00:00:00.000Z",
  profession: "Alchemy", recipe, rank, difficulty, reagents: [],
});
const render = async (profession = "alchemy", search: Record<string, string> = {}) =>
  renderToStaticMarkup(await ProfessionPage({ params: Promise.resolve({ profession }), searchParams: Promise.resolve(search) }));
const renderReference = (profession = "alchemy", search: Record<string, string> = {}) =>
  render(profession, { ...search, view: "reference" });
const empty = { uploads: 0, records: [], dataAsOf: "2026-10-10T00:00:00.000Z" };

beforeEach(() => {
  store.loadCorpus.mockReset(); fail.world = false; fail.rollups = false;
  store.loadMarket.mockReset().mockResolvedValue({ state: null, dataAsOf: null });
  ledger.read.mockReset().mockResolvedValue({ ok: false });
});

test("the game file recipes show in skill brackets, labelled, with the item and its reagents", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await renderReference();
  expect(html).toContain("Alchemy profession reference");
  expect(html).toContain("Found in game files, unconfirmed, build 1.60.1.71139");
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

test("the default planner renders its route and shopping list without reading either reference market", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const range = { from: "1", to: "150", realm: "CAMWOW US1 Realm 4 PvP", house: "Horde" };
  const html = await render("tailoring", range);
  expect(html).toContain("Tailoring leveling guide");
  expect(html).toContain("Copy shopping list");
  expect(html).toContain('href="/tools/professions/tailoring?from=1&amp;to=150&amp;realm=CAMWOW+US1+Realm+4+PvP&amp;house=Horde&amp;view=reference" data-prefetch="false"');
  expect(html).not.toContain('id="prof-recipes"');
  expect(html).not.toContain('id="ahledger-margins"');
  expect(html).not.toContain("Where to farm cloth");
  expect(store.loadMarket).not.toHaveBeenCalled();
  expect(ledger.read).not.toHaveBeenCalled();
  const reference = await renderReference("tailoring", range);
  expect(reference).toContain('id="prof-recipes"');
  expect(reference).toContain('id="ahledger-margins"');
  expect(reference).not.toContain("Copy shopping list");
  expect(reference).toContain('href="/tools/professions/tailoring?from=1&amp;to=150&amp;realm=CAMWOW+US1+Realm+4+PvP&amp;house=Horde"');
  expect(Buffer.byteLength(html)).toBeLessThan(Buffer.byteLength(reference));
});

test("a recipe row opens a shareable one-recipe shopping plan with the original filters", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  expect(await render("alchemy", { q: "Minor Strength" })).toContain("view=reference&amp;recipe=2329&amp;q=Minor+Strength#recipe-shopping");
  const html = await render("alchemy", { recipe: "2329", crafts: "3" });
  expect(html).toContain('id="recipe-shopping"');
  expect(html).toContain('value="3"');
  expect(html).toContain("Copy recipe shopping list");
  expect(html).toContain('href="/tools/auctions/activity?item=2454');
  expect(html).toContain("Auction activity for the finished item");
  expect(html).toContain("Alchemy profession reference");
  expect(html).not.toContain("Alchemy leveling guide");
  expect(await render("alchemy", { recipe: "3755" })).not.toContain('id="recipe-shopping"');
});

test("on a phone the recipe tables scroll sideways instead of hiding what a recipe makes and takes", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await renderReference();
  const recipes = html.slice(html.indexOf('data-skill-group="1"'));
  expect(recipes).toContain("overflow-x-auto");
  expect(recipes).not.toContain("hidden sm:table-cell");
  expect(recipes).not.toContain("dt-fold");
});

test("an unknown profession is a 404", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  await expect(render("riding")).rejects.toThrow("NEXT_NOT_FOUND");
});

test("the skill line id and the id-slug segments redirect for good to the slug page, keeping the query; an unknown id is a 404", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  await expect(render("171")).rejects.toThrow("308 /tools/professions/alchemy");
  await expect(render("171-alchemy")).rejects.toThrow("308 /tools/professions/alchemy");
  await expect(render("171-alchemy", { from: "1", to: "10" })).rejects.toThrow("308 /tools/professions/alchemy?from=1&to=10");
  await expect(render("762")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(render("762-riding")).rejects.toThrow("NEXT_NOT_FOUND");
  // The slug itself does not redirect.
  expect(await render("alchemy")).toContain("Alchemy profession guide");
});

test("with no observations the player layer says ranges are unrecorded, not zero", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await renderReference();
  expect(html).toContain("data-empty-state");
  expect(html).toContain("No recipe ranges for Alchemy yet");
  expect(html).not.toContain(">Players saw<");
});

test("three agreeing installs show the inferred range", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z",
    records: [obs("install-aaaa", 50, "optimal"), obs("install-bbbb", 60, "medium"), obs("install-cccc", 55, "medium")],
  });
  expect(await renderReference()).toContain("Lesser Healing Potion (Alchemy), 3 installs: yellow from 51-55");
});

test("a range players agree on sits beside the game file recipe of the same name, labelled by its installs", async () => {
  const recipe = "Elixir of Minor Strength";
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z",
    records: [obs("install-aaaa", 50, "optimal", recipe), obs("install-bbbb", 60, "medium", recipe), obs("install-cccc", 55, "medium", recipe)],
  });
  const html = await renderReference();
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
  expect(await renderReference()).toContain("Reagents: 2 Peacebloom. Estimated cost per craft: 60c.");
});

test("the planner keeps its skill range while the evidence lives in reference", async () => {
  const ids = ["install-aaaa", "install-bbbb", "install-cccc"];
  const reagents = [{ item: "Peacebloom", count: 1 }];
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z",
    records: [
      { ...obs(ids[0], 1, "optimal"), reagents }, { ...obs(ids[1], 10, "optimal"), reagents }, { ...obs(ids[2], 12, "medium"), reagents },
      ...ids.map((id) => ({ kind: "trainer_seen", installId: id, profession: "Alchemy", recipe: "Lesser Healing Potion", requiredRank: 1 })),
    ],
  });
  const html = await render("alchemy", { from: "1", to: "11" });
  expect(html).toContain("Shopping list");
  expect(html).not.toContain("Lesser Healing Potion (Alchemy), 3 installs");
  expect(html).toContain('value="11"');
  expect(html).not.toContain("install-aaaa");
  expect(await renderReference("alchemy", { from: "1", to: "11" })).toContain("Lesser Healing Potion (Alchemy), 3 installs");
});

const three = ["install-aaaa", "install-bbbb", "install-cccc"];
const section = (html: string, kind: string) => {
  const marker = kind === "herb" || kind === "ore" ? 'data-section="zones"' : `data-gather="${kind}"`;
  const at = html.indexOf(marker);
  return at < 0 ? null : html.slice(at, html.indexOf("</section>", at));
};

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
  expect(herbs).toContain("Herb zones");
  expect(herbs).toMatch(/href="\/database\/zones\/1429-[^"]*"/);
  expect(herbs).toContain("1 spot");
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
  const tailoring = section(await renderReference("tailoring"), "cloth");
  const firstAid = section(await renderReference("first-aid"), "cloth");
  expect(tailoring).toContain("Where to farm cloth");
  expect(zonesIn(tailoring)).toEqual([1429]);
  // The same section, apart from the page's own links in the level menu.
  expect(firstAid?.replaceAll("/first-aid", "/tailoring")).toEqual(tailoring);
  expect(zonesIn(section(await render("skinning"), "leather"))).toEqual([1411]);
});

test("the mob-backed gathering pages read the corpus once", async () => {
  // The item names come from the stored item view, as once the cron has written it; the other stored files are missing.
  const { buildItemView, forgetItemView } = await import("@/lib/item-view-store");
  for (const [key, value] of Object.entries({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "uploads" })) vi.stubEnv(key, value);
  try {
    for (const profession of ["skinning", "tailoring", "first-aid", "herbalism"]) {
      const corpus = clothAndLeather();
      const view = JSON.stringify(await buildItemView(corpus.dataAsOf, new Date(), corpus as unknown as import("@/lib/upload-store").Corpus));
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
        (input as Request).url.endsWith("snapshots/item-view.json") ? new Response(view) : new Response(null, { status: 404 })));
      forgetItemView();
      store.loadCorpus.mockReset().mockResolvedValue(corpus);
      await renderReference(profession);
      expect(store.loadCorpus, profession).toHaveBeenCalledTimes(1);
    }
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    forgetItemView();
  }
});

test("one or two installs place nothing: gathering zones need 3", async () => {
  for (const installs of [three.slice(0, 1), three.slice(0, 2)]) {
    store.loadCorpus.mockResolvedValue(corpusOf([...herb(installs), ...mob(installs, 500, "Defias Bandit", 15, 1429, 2589)]));
    const herbs = section(await render("herbalism"), "herb")!;
    expect(herbs, `${installs.length} herb`).toContain("No herb zones yet");
    expect(herbs).not.toContain("<table");
    for (const profession of ["tailoring", "first-aid"]) {
      const cloth = section(await renderReference(profession), "cloth")!;
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
  expect(section(mid, "cloth")).toContain('href="/tools/professions/tailoring?from=5&amp;class=mage&amp;level=3&amp;view=reference&amp;mobs=1-10#gather"');
  expect(section(mid, "cloth")).toContain('href="/tools/professions/tailoring?from=5&amp;class=mage&amp;level=3&amp;view=reference#gather"');
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
      const part = section(await renderReference(profession), kind)!;
      expect(part, `${which} ${profession}`).toContain("Storage unreachable");
      expect(edgeDegraded(await renderReference(profession)), `${which} ${profession}`).toBe(true);
      expect(part).not.toContain("zones yet");
      expect(part).not.toContain("<table");
    }
  }
  // The corpus itself down: the same message, and the herb section too.
  fail.world = false; fail.rollups = false;
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  for (const [profession, kind] of [["tailoring", "cloth"], ["herbalism", "herb"]]) {
    expect(section(await renderReference(profession), kind), profession).toContain("Storage unreachable");
  }
});

test.each(["alchemy", "herbalism", "mining", "tailoring", "skinning"])("stored %s facts give the same answer with zero corpus reads", async (profession) => {
  const { buildProfessions, encodeProfessions, forgetStoredProfessions } = await import("@/lib/profession-store");
  const { buildAggregates } = await import("@/lib/aggregate-set");
  const { encodeAggregates, forgetStoredAggregates } = await import("@/lib/aggregate-store");
  const { buildNpcFacts, forgetStoredNpcFacts, NPC_FACTS_KEY } = await import("@/lib/npc-facts-store");
  const { buildItemView, forgetItemView } = await import("@/lib/item-view-store");
  const forget = () => { forgetStoredProfessions(); forgetStoredAggregates(); forgetStoredNpcFacts(); forgetItemView(); };
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  forget();
  // Three installs name Earthroot (2449), a reagent of the Alchemy recipes, so the page shows a players' name and its icon.
  const named = three.map((installId, i) => ({ kind: "item_seen", eventId: `seen${i}`, installId, capturedAt: "2026-10-10T00:00:00.000Z", itemId: 2449, name: "Earthroot" }));
  const corpus = { ...clothAndLeather(), records: [...clothAndLeather().records, obs("a", 1, "optimal"), obs("b", 1, "optimal"), obs("c", 1, "optimal"), ...named] };
  store.loadCorpus.mockResolvedValue(corpus);
  const before = await renderReference(profession);
  if (profession === "alchemy") {
    expect(before).toContain(">Earthroot<");
    expect(before).toContain("https://icons.test/2449.jpg");
  }
  store.loadCorpus.mockClear();
  forget();
  const view = await buildItemView(corpus.dataAsOf, new Date(), corpus as unknown as import("@/lib/upload-store").Corpus);
  for (const [key, value] of Object.entries({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "uploads" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = (input as Request).url;
    return new Response(url.endsWith("snapshots/aggregates.json")
      ? encodeAggregates(buildAggregates(corpus as unknown as import("@/lib/upload-store").Corpus), "now")
      : url.endsWith(NPC_FACTS_KEY)
        ? JSON.stringify(buildNpcFacts(buildAggregates(corpus as unknown as import("@/lib/upload-store").Corpus)))
      : url.endsWith("snapshots/professions.json")
        ? encodeProfessions(buildProfessions(corpus), "now")
        : url.endsWith("snapshots/item-view.json") ? JSON.stringify(view) : "{}" );
  }));
  expect(await renderReference(profession)).toEqual(before);
  const served = vi.mocked(fetch).mock.calls.map(([input]) => (input as Request).url);
  expect(served.some((url) => url.endsWith("snapshots/item-view.json"))).toBe(true);
  expect(store.loadCorpus).not.toHaveBeenCalled();
});

test("Herbs lands on gathering before the new Forever crafts, including when no spots are confirmed", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await render("herbalism");
  expect(html).toMatch(/<h1[^>]*>Herbalism gathering<\/h1>/);
  const gathering = html.indexOf('id="gather"');
  const crafts = html.indexOf('data-recipes="herbalism"');
  expect(gathering).toBeGreaterThan(-1);
  expect(crafts).toBeGreaterThan(gathering);
  expect(html).toContain("Herbalism crafts (new in Forever)");
  expect(html.slice(gathering, crafts)).toContain("No herb zones yet");
  expect(html.slice(gathering, crafts)).toContain('href="/tools/professions/herbalism/gathering"');
  expect(html.slice(crafts)).toContain("Found in game files, unconfirmed");
  expect(html.slice(crafts)).toContain("/database/spells/");
  const metadata = await generateMetadata({ params: Promise.resolve({ profession: "herbalism" }) });
  expect(metadata.title).toContain("Herbalism Gathering");
  expect(metadata.description).toContain("gather herbs");
});

const recipesSection = (html: string) => {
  const start = html.indexOf('id="prof-recipes"');
  const end = html.indexOf('aria-labelledby="prof-ranges"', start);
  return html.slice(start, end === -1 ? html.indexOf('id="prof-contribute"', start) : end);
};
const spellLinks = (html: string) => recipesSection(html).match(/href="\/database\/spells\/\d+"/g)?.length ?? 0;

test("the recipe table is paged on the server: 50 rows by default, the size clamped to 25..200, a page past the end shows the last", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const all = professionBySegment("alchemy")!.recipes.length;
  expect(all).toBeGreaterThan(100);
  const first = await renderReference();
  expect(spellLinks(first)).toBe(50);
  expect(first).toContain(`${all.toLocaleString("en-US")}</span> recipes`);
  expect(first).toContain('href="/tools/professions/alchemy?view=reference&amp;page=2#prof-recipes"');
  // The duplicated client-side list and its search box are gone; the table's own search is a GET form.
  expect(first).not.toContain("Search recipes");
  expect(first).toContain('action="/tools/professions/alchemy#prof-recipes"');
  expect(spellLinks(await render("alchemy", { size: "1" }))).toBe(25);
  expect(spellLinks(await render("alchemy", { size: "100" }))).toBe(100);
  const most = await render("alchemy", { size: "5000" });
  expect(spellLinks(most)).toBe(Math.min(all, 200));
  expect(recipesSection(first).length).toBeLessThan(recipesSection(most).length / 2);
  const last = Math.ceil(all / 50);
  const past = await render("alchemy", { page: "999" });
  expect(spellLinks(past)).toBe(all - (last - 1) * 50);
  expect(past).toContain('aria-current="page"');
});

test("search and skill range filter on the server and keep the page's other parameters in their links", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const named = await render("alchemy", { q: "minor strength" });
  expect(spellLinks(named)).toBe(1);
  expect(named).toContain('href="/database/spells/2329"');
  expect(named).toContain("1</span> recipe");
  const ranged = await render("alchemy", { min: "76", max: "150", from: "1", to: "11" });
  expect([...ranged.matchAll(/data-skill-group="([^"]+)"/g)].map((m) => m[1])).toEqual(["76"]);
  expect(ranged).toContain('href="/tools/professions/alchemy?from=1&amp;to=11&amp;view=reference&amp;min=76&amp;max=150&amp;size=100#prof-recipes"');
  expect(ranged).toContain('type="hidden" name="min" value="76"');
  const none = await render("alchemy", { q: "no recipe is called this" });
  expect(spellLinks(none)).toBe(0);
  expect(none).toContain("No Alchemy recipes match these filters.");
});

test("the recipe tables' spell and item links load on click, not all at once as the page opens", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await renderReference();
  const links = [...html.matchAll(/<a href="\/database\/(?:spells|items)\/\d+"([^>]*)>/g)];
  expect(links.length).toBeGreaterThan(2);
  for (const [a, attrs] of links) expect(attrs, a).toContain('data-prefetch="false"');
});

// The recipe rows used to be some 4.4 kB of HTML each, and as much again in the page's RSC data (live alchemy: 901 kB).
const recipeRows = (html: string) => {
  const section = recipesSection(html);
  const tables = section.slice(section.indexOf("data-skill-group="));
  return { bytes: Buffer.byteLength(tables), rows: tables.match(/<tr class="dt-tr"/g)?.length ?? 0 };
};

test("a recipe row stays within a byte budget, with every link, icon, count and marker it showed before", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await render("alchemy", { size: "200" });
  const { bytes, rows } = recipeRows(html);
  const all = Math.min(professionBySegment("alchemy")!.recipes.length, 200);
  expect(rows).toBe(all);
  expect(bytes / rows).toBeLessThan(1700);
  // Nothing is lost: the spell and item links, the icons, the counts and the files marker with its tooltip.
  expect(spellLinks(html)).toBe(all);
  // (The icons themselves: the stored-facts test above shows Earthroot's.)
  expect(html).toMatch(/<span class="pf-q">2×<\/span><a[^>]*href="\/database\/items\/2449"[^>]*>[^<]+<\/a>/);
  expect(html).toContain('data-badge="files" title="From the game files, not yet confirmed by players"');
  expect(html).toContain('href="/tools/professions/alchemy?view=reference&amp;recipe=2329&amp;size=200#recipe-shopping"');
});

test("the recipe table's client data names each item once and carries ids, not markup", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const { default: RecipeTables } = await import("../recipe-table");
  const element = await ProfessionPage({ params: Promise.resolve({ profession: "alchemy" }), searchParams: Promise.resolve({ size: "200" }) });
  const found: { props: Parameters<typeof RecipeTables>[0] }[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const el = node as { type: unknown; props: { children?: unknown } };
    if (el.type === RecipeTables) found.push(el as never);
    walk(el.props.children);
  };
  walk(element);
  expect(found).toHaveLength(1);
  const props = found[0].props;
  const rows = props.groups.reduce((n, g) => n + g.rows.length, 0);
  expect(rows).toBe(Math.min(professionBySegment("alchemy")!.recipes.length, 200));
  expect(JSON.stringify(props).length / rows).toBeLessThan(400);
  // A reagent is an [item id, count] pair; Empty Vial (3371), a reagent of dozens of these recipes, is named once in `items`.
  const used = props.groups.flatMap((g) => g.rows).find((r) => r.reagents.length)!;
  expect(used.reagents[0]).toEqual([expect.any(Number), expect.any(Number)]);
  expect(props.items[3371]?.name).toBeTruthy();
});

const ledgerScans = (realm: string, house: string, installs = ["install-a", "install-b", "install-c"]) => installs.map((installId) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:${realm}:${house}`, capturedAt: new Date().toISOString(), realm,
  scanId: `${installId}-${realm}-${house}`, part: 1, parts: 1, items: [[2589, 1, 3, 100, 100]], house,
}));
const ledgerMarketText = (html: string) => /data-ahledger-market[^>]*>([^<]*)</.exec(html)?.[1];

test("the AH Ledger margins follow the realm and house picker: the realm's region and ruleset, the house's faction", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const state = foldMarket(emptyMarket(), [...ledgerScans("CAMWOW EU1 Realm 4 PvP", "Horde"), ...ledgerScans("CAMWOW EU1 Realm 4 PvP", "Alliance", ["install-d", "install-e", "install-f"]).slice(0, 2)], new Date());
  store.loadMarket.mockResolvedValue({ state, dataAsOf: null });
  // No house asked: the realm's busier faction house, Horde here.
  const html = await render("alchemy", { realm: "camwow-eu1-realm-4-pvp", sort: "-net" });
  expect(html).toContain("data-realm-house-picker");
  expect(ledgerMarketText(html)).toBe("AH Ledger market: PvP Horde");
  // The picker's links keep the page's other parameters and land back on the margins.
  expect(html).toContain('href="/tools/professions/alchemy?sort=-net&amp;view=reference&amp;realm=camwow-eu1-realm-4-pvp&amp;house=alliance#ahledger-margins"');
  expect(ledgerMarketText(await renderReference("alchemy", { realm: "CAMWOW EU1 Realm 4 PvP", house: "Alliance" }))).toBe("AH Ledger market: PvP Alliance");
  // The neutral house and a realm AH Ledger has no market for say so instead of reading a market.
  expect(ledgerMarketText(await renderReference("alchemy", { realm: "camwow-eu1-realm-4-pvp", house: "neutral" }))).toContain("no market for the neutral auction house");
  expect(ledgerMarketText(await renderReference("alchemy", { realm: "nowhere" }))).toBe("AH Ledger has no market for this realm.");
  // A profession AH Ledger has no margins for neither shows the picker nor reads the market.
  store.loadMarket.mockClear();
  expect(await render("fishing")).not.toContain("data-realm-house-picker");
  expect(store.loadMarket).not.toHaveBeenCalled();
});

test("an old margins link with ?market= still shows that market; with no realm or market the default", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  expect(ledgerMarketText(await render("alchemy", { market: "forever.rp.horde.eu" }))).toBe("AH Ledger market: RP Horde");
  expect(ledgerMarketText(await render("alchemy", { market: "forever.hardcore.horde.us" }))).toBe("AH Ledger market: PvE Alliance");
  expect(ledgerMarketText(await renderReference("alchemy"))).toBe("AH Ledger market: PvE Alliance");
  // A realm in the link wins over the old parameter, and the picker's links drop it.
  const state = foldMarket(emptyMarket(), ledgerScans("CAMWOW US1 Realm 2 PvP", "Alliance"), new Date());
  store.loadMarket.mockResolvedValue({ state, dataAsOf: null });
  const html = await render("alchemy", { market: "forever.rp.horde.eu", realm: "camwow-us1-realm-2-pvp" });
  expect(ledgerMarketText(html)).toBe("AH Ledger market: PvP Alliance");
  const pickerLinks = [...html.matchAll(/href="([^"]*#ahledger-margins)"/g)].map((m) => m[1]);
  expect(pickerLinks.length).toBeGreaterThan(0);
  for (const link of pickerLinks) expect(link).not.toContain("market=");
});

test("the AH Ledger margins are read once on the server for the chosen market and drawn into the page; a failed read is degraded", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const credit = { text: "Prices from AHledger", url: "https://ahledger.com/crafting" };
  ledger.read.mockResolvedValue({ ok: true, credit, value: { asOf: "2026-11-24T05:45:44.000Z", recipes: [
    { spellId: 2329, name: "Elixir of Minor Strength", skill: 1, cost: 10, netValue: 50, margin: 40, salesPerDay: 3, profitPerDay: 120 },
  ] } });
  const html = await render("alchemy", { market: "forever.rp.horde.eu", sort: "-margin" });
  expect(ledger.read).toHaveBeenCalledTimes(1);
  const [path, select] = ledger.read.mock.calls[0] as [string, (body: unknown) => unknown];
  expect(path).toBe("crafting/forever.rp.horde.eu?profession=Alchemy");
  // The page keeps only the margins and the time from AH Ledger's answer.
  expect(select({ pricesAsOf: "2026-11-24T05:45:44.000Z", recipes: [{ recipe: { spellId: 7, name: "Test", skillRequired: 40 }, cost: 1, reagents: [{ id: 1 }] }] }))
    .toEqual({ asOf: "2026-11-24T05:45:44.000Z", recipes: [{ spellId: 7, name: "Test", skill: 40, cost: 1, netValue: null, margin: null, salesPerDay: null, profitPerDay: null }] });
  expect(html).toContain('data-ahledger="ready"');
  expect(html).toContain("Prices as of");
  expect(html).toContain('href="https://ahledger.com/crafting"');
  expect(html).toContain('aria-sort="descending"');
  expect(edgeDegraded(html)).toBe(false);

  ledger.read.mockResolvedValue({ ok: false });
  const failed = await renderReference("alchemy");
  expect(failed).toContain('data-ahledger="failed"');
  expect(edgeDegraded(failed)).toBe(true);

  // No market, or a profession AH Ledger lacks: nothing is asked.
  ledger.read.mockClear();
  await render("fishing");
  await renderReference("alchemy", { realm: "nowhere" });
  expect(ledger.read).not.toHaveBeenCalled();
});

// Task 13: Everloot's own profit estimates, server-computed only for a validated realm and house in the link.
const alchemyScans = (realm: string, house: string, prices: [number, number][]) => ["install-a", "install-b", "install-c"].map((installId) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:${realm}:${house}:rank`, capturedAt: new Date().toISOString(), realm,
  scanId: `${installId}-${realm}-${house}-rank`, part: 1, parts: 1, items: prices.map(([id, copper]) => [id, 1, 40, copper, copper]), house,
}));
// Elixir of Minor Strength (2329): Earthroot 2449, Silverleaf 765 and Empty Vial 3371 make one 2454.
const ELIXIR: [number, number][] = [[2449, 50], [765, 30], [3371, 4], [2454, 500]];
const tableProps = async (search: Record<string, string>) => {
  const { default: RecipeTables } = await import("../recipe-table");
  const element = await ProfessionPage({ params: Promise.resolve({ profession: "alchemy" }), searchParams: Promise.resolve(search) });
  const found: unknown[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const el = node as { type: unknown; props: { children?: unknown } };
    if (el.type === RecipeTables) found.push(el.props);
    walk(el.props.children);
  };
  walk(element);
  return JSON.stringify(found[0]);
};

test("with no realm and house nothing is ranked and the recipe rows carry no estimate data", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const html = await render("alchemy", { size: "200" });
  expect(html).not.toContain("data-profit-ranking");
  expect(html).not.toContain("Everloot profit estimates");
  const props = await tableProps({ size: "200" });
  expect(props).not.toMatch(/"(profit|margin|output|quote|yield)"/);
  // A profession AH Ledger lacks reads no market without a realm and house.
  store.loadMarket.mockClear();
  await render("fishing");
  expect(store.loadMarket).not.toHaveBeenCalled();
});

test("a realm and house in the link rank the profession on the server, labelled apart from AH Ledger, with unchanged rows", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const state = foldMarket(emptyMarket(), alchemyScans("CAMWOW US1 Realm 2 PvP", "Horde", ELIXIR), new Date());
  store.loadMarket.mockResolvedValue({ state, dataAsOf: null });
  const search = { realm: "camwow-us1-realm-2-pvp", house: "horde", size: "200" };
  const html = await render("alchemy", search);
  expect(html).toContain('data-profit-ranking="horde"');
  expect(html).toContain("Everloot profit estimates: CAMWOW US1 Realm 2 PvP, Horde");
  expect(html).toContain("after the 5% auction cut");
  expect(html).toContain("Separate from AH");
  expect(html).not.toMatch(/data-profit-ranking[\s\S]*sales per day:/i);
  // 500 less the 5% cut is 475; materials 84: 391 a craft.
  const ranked = html.slice(html.indexOf('data-ranked="2329"'));
  expect(ranked).toContain("3s 91c");
  expect(ranked).toContain("84c");
  expect(html).toContain('href="/tools/professions/alchemy?realm=camwow-us1-realm-2-pvp&amp;house=horde&amp;recipe=2329&amp;size=200#recipe-shopping"');
  // The table's rows and items are byte for byte what they are with no market selected; only its link template
  // carries the realm and house on to a recipe's plan.
  const rowsOnly = (json: string) => { const { planHref, ...rest } = JSON.parse(json) as { planHref: string }; return { planHref, rest: JSON.stringify(rest) }; };
  const picked = rowsOnly(await tableProps(search)), plain = rowsOnly(await tableProps({ size: "200" }));
  expect(picked.rest).toBe(plain.rest);
  expect(picked.planHref).toBe("/tools/professions/alchemy?realm=camwow-us1-realm-2-pvp&house=horde&recipe=RECIPEID&size=200#recipe-shopping");
  // The neutral house takes 15%: 425 less 84 is 341.
  const neutral = foldMarket(emptyMarket(), alchemyScans("CAMWOW US1 Realm 2 PvP", "Neutral", ELIXIR), new Date());
  store.loadMarket.mockResolvedValue({ state: neutral, dataAsOf: null });
  const n = await render("alchemy", { realm: "camwow-us1-realm-2-pvp", house: "neutral" });
  expect(n).toContain("after the 15% auction cut");
  expect(n.slice(n.indexOf('data-ranked="2329"'))).toContain("3s 41c");
});

test("an unknown realm, a missing half or a repeated key ranks nothing, says why and still renders the page", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const state = foldMarket(emptyMarket(), alchemyScans("CAMWOW US1 Realm 2 PvP", "Horde", ELIXIR), new Date());
  store.loadMarket.mockResolvedValue({ state, dataAsOf: null });
  const nowhere = await render("alchemy", { realm: "not-a-realm", house: "horde" });
  expect(nowhere).not.toContain("data-ranked=");
  expect(nowhere).toContain("No Everloot market data for that realm");
  const half = await render("alchemy", { realm: "camwow-us1-realm-2-pvp" });
  expect(half).not.toContain("data-ranked=");
  expect(half).toContain("Pick an auction house");
  expect(half).toContain('href="/tools/professions/alchemy?realm=camwow-us1-realm-2-pvp&amp;house=neutral#profit-ranking"');
  const twice = renderToStaticMarkup(await ProfessionPage({ params: Promise.resolve({ profession: "alchemy" }), searchParams: Promise.resolve({ realm: "camwow-us1-realm-2-pvp", house: ["horde", "alliance"] }) }));
  expect(twice).not.toContain("data-ranked=");
  const elves = await render("alchemy", { realm: "camwow-us1-realm-2-pvp", house: "elves" });
  expect(elves).not.toContain("data-ranked=");
});

test("a selected recipe's card gets its link state, a bounded catalog of makes and nothing private", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const { default: RecipeShopping } = await import("../recipe-shopping");
  const element = await ProfessionPage({ params: Promise.resolve({ profession: "alchemy" }), searchParams: Promise.resolve({ recipe: "2329", crafts: "12", strategy: "cheapest", have: "2449:3,2449:4" }) });
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const el = node as { type: unknown; props: { children?: unknown } };
    if (el.type === RecipeShopping) found.push(el.props as Record<string, unknown>);
    walk(el.props.children);
  };
  walk(element);
  expect(found).toHaveLength(1);
  const props = found[0];
  expect(props.initial).toMatchObject({ recipe: 2329, crafts: 12, strategy: "cheapest", have: [] });
  expect(props.issues).toEqual(["The owned counts in the link were ignored: an item is listed twice."]);
  expect(props.market).toBeNull();
  expect(Array.isArray(props.catalog)).toBe(true);
  const json = JSON.stringify(props);
  expect(json.length).toBeLessThan(40_000);
  expect(json).not.toMatch(/installId|character|SavedVariables|auctionator|tsm/i);
  const html = await render("alchemy", { recipe: "2329", crafts: "12" });
  expect(html).toContain('value="12"');
  expect(await render("alchemy", { recipe: "2329", crafts: "10000" })).toContain('value="1"');
});
test("the selected card's props stay within 40 KiB for the real catalog's largest plan trees, and a cut catalog says so", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const { planCardCatalog } = await import("@/lib/crafting-catalog");
  const { CLIENT_PROFESSIONS } = await import("@/lib/professions");
  // Every recipe that takes materials, with pessimistic 60-character names: the largest catalogs the card can get.
  const long = (id: number) => `${"Very Long Item Name ".repeat(3)}${id}`;
  const sized = CLIENT_PROFESSIONS.flatMap((p) => p.recipes.filter((r) => r.reagents.length).map((r) => {
    const data = planCardCatalog(r, (id) => long(id), long);
    return { profession: p.slug, spellId: r.spellId, bytes: JSON.stringify(data).length, truncated: data.truncated };
  })).sort((a, b) => b.bytes - a.bytes);
  expect(sized.length).toBeGreaterThan(1000);
  for (const s of sized.slice(0, 5)) expect(s.bytes, `${s.profession} ${s.spellId}`).toBeLessThan(34 * 1024);
  // The page's real card props for the largest trees, in full.
  const { default: RecipeShopping } = await import("../recipe-shopping");
  for (const worst of sized.slice(0, 3)) {
    const element = await ProfessionPage({ params: Promise.resolve({ profession: worst.profession }), searchParams: Promise.resolve({ recipe: String(worst.spellId), crafts: "9999", strategy: "cheapest" }) });
    const found: Record<string, unknown>[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object" || !("props" in node)) return;
      const el = node as { type: unknown; props: { children?: unknown } };
      if (el.type === RecipeShopping) found.push(el.props as Record<string, unknown>);
      walk(el.props.children);
    };
    walk(element);
    expect(found, `${worst.profession} ${worst.spellId}`).toHaveLength(1);
    expect(JSON.stringify(found[0]).length, `${worst.profession} ${worst.spellId}`).toBeLessThan(40 * 1024);
    if (found[0].catalogTruncated) {
      expect(renderToStaticMarkup(element)).toContain("Only part of the catalog is listed");
    }
  }
});

test("a valid realm without a house reaches the card, which keeps it; ranking stays off", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const state = foldMarket(emptyMarket(), alchemyScans("CAMWOW US1 Realm 2 PvP", "Horde", ELIXIR), new Date());
  store.loadMarket.mockResolvedValue({ state, dataAsOf: null });
  const { default: RecipeShopping } = await import("../recipe-shopping");
  const element = await ProfessionPage({ params: Promise.resolve({ profession: "alchemy" }), searchParams: Promise.resolve({ recipe: "2329", realm: "camwow-us1-realm-2-pvp" }) });
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const el = node as { type: unknown; props: { children?: unknown } };
    if (el.type === RecipeShopping) found.push(el.props as Record<string, unknown>);
    walk(el.props.children);
  };
  walk(element);
  expect(found[0].market).toEqual({ realm: "camwow-us1-realm-2-pvp", realmName: "CAMWOW US1 Realm 2 PvP", house: null });
  expect(renderToStaticMarkup(element)).not.toContain("data-ranked=");
});

test("the selected recipe's recorded cooldown reaches the card", async () => {
  store.loadCorpus.mockResolvedValue(empty);
  const { default: RecipeShopping } = await import("../recipe-shopping");
  // Mooncloth (18560) records a 342,000,000 ms cooldown in the files.
  const element = await ProfessionPage({ params: Promise.resolve({ profession: "tailoring" }), searchParams: Promise.resolve({ recipe: "18560" }) });
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const el = node as { type: unknown; props: { children?: unknown } };
    if (el.type === RecipeShopping) found.push(el.props as Record<string, unknown>);
    walk(el.props.children);
  };
  walk(element);
  expect(found[0].rootCooldownMs).toBe(342_000_000);
});