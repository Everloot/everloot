import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WorldFacts } from "@kb/world-pages";

const mocks = vi.hoisted(() => ({ world: vi.fn(), rollup: vi.fn(), items: vi.fn(), wiki: vi.fn(), renders: vi.fn(), sightings: vi.fn(), tips: vi.fn(), loot: vi.fn(), icons: new Map<number, string>(), names: null as unknown }));
vi.mock("@/lib/rollup-compute", () => ({
  loadWorldFacts: mocks.world, computeRollups: mocks.rollup, loadItemFacts: mocks.items,
  loadLootTables: async () => ({ tables: { sources: new Map(), leftOut: 0 }, dataAsOf: null }),
}));
vi.mock("@/lib/game-assets", () => ({
  loadSiteAssets: async () => null, loadItemTips: mocks.tips,
  readItemTips: async (assets: unknown, ids: number[]) => ({ tips: await mocks.tips(assets, ids), icons: mocks.icons, unreachable: false, degraded: false, indexed: true }),
}));
// The names the item lists and hover cards read: every id shown, no names file, unless a test hands the page some.
vi.mock("@/lib/item-view", () => ({
  loadListNames: async () => mocks.names ?? { agreed: new Map(), matched: null, showsTip: () => true, named: { has: () => false }, degraded: false, unreachable: false },
}));
// The real loot table unless a test hands the page one.
vi.mock("@kb/loot-tables", async (importOriginal) => {
  const real = await importOriginal<typeof import("@kb/loot-tables")>();
  return { ...real, npcLootTable: (...args: Parameters<typeof real.npcLootTable>) => mocks.loot(...args) ?? real.npcLootTable(...args) };
});
vi.mock("@/lib/game-renders", () => ({ loadRenders: mocks.renders }));
// The dungeon and raid reports: none unless a test ties this NPC to a boss.
vi.mock("@/lib/instances", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/instances")>()), loadSightings: mocks.sightings }));
vi.mock("@/lib/lore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/lore")>()), loreForEntity: async () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

vi.mock("@/lib/wiki-entity-names", async (original) => ({ ...await original<typeof import("@/lib/wiki-entity-names")>(), loadWikiEntityNames: mocks.wiki }));
import { EMPTY } from "../../entity";
import NpcPage, { generateMetadata } from "./page";
import VendorPage from "../../vendors/[id]/page";

const at = "2026-11-08T12:00:00Z";
let facts: WorldFacts & { unreachable: boolean };
const installs = ["one", "two", "three"];
const quest = (questId: number, role: "giverNpcId" | "turnInNpcId", count = 3) => installs.slice(0, count).map((installId) => ({
  installId, questId, title: `Quest ${questId} title`, level: 55, [role]: 1125, rewardItemIds: [], capturedAt: at,
}));
const goods = (count = 3) => installs.slice(0, count).map((installId) => ({ installId, vendorNpcId: 1125, itemId: 117, priceCopper: 12345, capturedAt: at }));
const html = async (search: Record<string, string> = {}) => renderToStaticMarkup(await NpcPage({ params: Promise.resolve({ id: "1125" }), searchParams: Promise.resolve(search) }));
const panel = (out: string, id: string) => out.split(`data-tab-panel="${id}"`)[1]?.split('role="tabpanel"')[0] ?? "";
const fact = (out: string, name: string) => new RegExp(`>${name}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1];

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.wiki.mockResolvedValue(null);
  mocks.renders.mockResolvedValue(null);
  mocks.tips.mockResolvedValue(new Map());
  mocks.loot.mockReturnValue(undefined);
  mocks.icons = new Map();
  mocks.names = null;
  mocks.sightings.mockResolvedValue({ unreachable: false, instances: { entrances: [], encounters: [] } });
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-10T12:00:00Z"));
  facts = {
    npcs: installs.map((installId) => ({ installId, npcId: 1125, name: installId, mapId: 0, x: 0, y: 0, level: 55, reaction: "friendly", creatureType: "Humanoid", rank: "normal", capturedAt: at })),
    quests: [], vendors: [], unreachable: false,
  };
  mocks.world.mockImplementation(async () => facts);
  mocks.rollup.mockResolvedValue({ rates: [], measuredZeros: [], stats: { unreachable: false } });
  mocks.items.mockResolvedValue({ rates: [], names: [], npcs: [], unreachable: false });
});

test("the tabs with rows link agreed goods and the quests it starts and ends with their evidence; the empty ones are left out", async () => {
  facts.vendors = goods();
  facts.quests = [...quest(10, "giverNpcId"), ...quest(11, "turnInNpcId"), ...quest(12, "giverNpcId").map((r) => ({ ...r, turnInNpcId: 1125 }))];
  const out = await html();
  // Sells, then the quests it starts, then the ones it ends.
  expect([...out.matchAll(/data-tab-panel="([a-z-]+)"/g)].map((m) => m[1])).toEqual(["sells", "starts", "ends"]);
  expect(out).toMatch(/role="tab"[^>]*>Sells<span[^>]*> \(1\)<\/span>/);
  expect(out).toMatch(/role="tab"[^>]*>Starts<span[^>]*> \(2\)<\/span>/);
  expect(out).toMatch(/role="tab"[^>]*>Ends<span[^>]*> \(2\)<\/span>/);
  // No drop and no agreed position: no "Drops (0)" or "Map (0)" before the tabs with rows.
  for (const id of ["drops", "map", "boss"]) expect(out).not.toContain(`data-tab-panel="${id}"`);
  expect(panel(out, "sells")).toContain('href="/database/vendors/1125"');
  expect(panel(out, "sells")).toContain('href="/database/items/117"');
  expect(panel(out, "sells")).toContain("1 gold 23 silver 45 copper");
  for (const id of [10, 12]) expect(panel(out, "starts")).toContain(`href="/database/quests/${id}"`);
  for (const id of [11, 12]) expect(panel(out, "ends")).toContain(`href="/database/quests/${id}"`);
  expect(panel(out, "starts")).not.toContain('href="/database/quests/11"');
  expect(panel(out, "ends")).not.toContain('href="/database/quests/10"');
  for (const id of ["sells", "starts", "ends"]) {
    expect(panel(out, id)).toContain("3 of 3 installs agree");
    expect(panel(out, id)).toContain(`last seen 2 days ago`);
  }
  expect(panel(out, "sells")).not.toContain(">Installs<");
  expect(out).toContain("1 goods and 3 quests");
  expect(panel(out, "sells")).toContain("This NPC sells goods.");
  expect(mocks.world).toHaveBeenCalledTimes(1);
  expect(mocks.items).toHaveBeenCalledTimes(1);
});

test("the summary counts the traits players agree on, and never says nobody reported an NPC it shows them for", async () => {
  const out = await html();
  expect(out).not.toContain("No player has reported it yet.");
  expect(out).toContain("Players agree on its level, type, reaction and rank.");
  facts.npcs = facts.npcs.slice(0, 2);
  expect(await html()).toContain("No player has reported it yet.");
});

test("one drop is counted in the singular", async () => {
  mocks.rollup.mockResolvedValue({ rates: [{ sourceNpcId: 1125, itemId: 117, kills: 10, drops: 1, rate: 0.1, reporters: 3, public: true }], measuredZeros: [], stats: { unreachable: false } });
  const out = await html();
  expect(out).toContain("Players reported 1 item drop.");
  facts.quests = quest(10, "giverNpcId");
  expect(await html()).toContain("Players reported 1 item drop and 1 quest.");
});

test("a mob with no agreed position takes its zone from where 3 installs looted its kills", async () => {
  facts.kills = installs.slice(0, 2).map((installId) => ({ installId, npcId: 1125, mapId: 1431 }));
  expect(fact(await html(), "Zone")).toBeUndefined();
  facts.kills.push({ installId: "three", npcId: 1125, mapId: 1431 });
  const out = await html();
  expect(fact(out, "Zone")).toContain('href="/database/zones/1431-duskwood"');
  expect(fact(out, "Zone")).toContain("where 3 installs looted its kills");
  expect(out).toContain("Killed in Duskwood");
});

test("empty and below-threshold tabs explain the three-install rule without publishing reports", async () => {
  for (const count of [0, 1, 2]) {
    facts.vendors = goods(count);
    facts.quests = quest(10, "giverNpcId", count);
    const out = await html();
    expect(out).not.toContain("12345");
    expect(out).not.toContain('href="/database/quests/10"');
    if (count === 0) {
      // Nothing reported anywhere: no strip, the one line of the first tab.
      expect(out).not.toContain('role="tab"');
      continue;
    }
    // Short of 3 installs the tab stays, with its meter and the rule.
    expect(panel(out, "sells")).toContain(EMPTY.goods);
    expect(panel(out, "starts")).toContain(EMPTY.quests);
    expect(panel(out, "sells")).toContain(`data-agreement="${count}"`);
    expect(panel(out, "starts")).toContain(`data-agreement="${count}"`);
  }
});

test("repeated rows from one install and conflicting quest relations stay private", async () => {
  facts.vendors = [goods(1)[0], goods(1)[0], goods(1)[0]];
  facts.quests = [...quest(10, "giverNpcId"), ...quest(10, "giverNpcId").map((r) => ({ ...r, giverNpcId: 999 }))];
  const out = await html();
  expect(panel(out, "starts")).toContain("No agreed quest yet.");
  expect(panel(out, "sells")).toContain("No agreed goods yet.");
});

test("unnamed NPC retains all agreed list traits, with unreported traits shown as unknown", async () => {
  const out = await html();
  expect(out).toMatch(/<h1[^>]*>NPC 1125<\/h1>/);
  expect(fact(out, "Level")).toBe("55");
  expect(fact(out, "Type")).toBe("Humanoid");
  expect(fact(out, "Reaction")).toBe("Friendly");
  expect(fact(out, "Rank")).toBe("Normal");
  facts.npcs = facts.npcs.slice(0, 2);
  const short = await html();
  // Short of 3 installs, the traits fold into the one Not yet reported row with its empty meter.
  expect(fact(short, "Not yet reported")).toMatch(/data-agreement="0"[\s\S]*level[\s\S]*type/);
  expect(short).not.toContain("Humanoid");
});

test("missing dates say not reported yet; stock without agreement never becomes zero", async () => {
  facts.vendors = goods().map(({ capturedAt: _, ...r }, i) => ({ ...r, limitedStock: i + 1 }));
  facts.quests = quest(10, "giverNpcId").map(({ capturedAt: _, ...r }) => r);
  const out = await html();
  expect(panel(out, "sells")).toContain("date not reported yet");
  expect(panel(out, "starts")).toContain("date not reported yet");
  expect(panel(out, "sells")).toContain("stock unrecorded");
});

test("named NPC uses only agreed quest names and counts each install once per relation", async () => {
  facts.npcs = facts.npcs.map((r) => ({ ...r, name: "A shopkeeper" }));
  facts.quests = quest(10, "giverNpcId").map((r) => ({ ...r, title: r.installId }));
  facts.quests.push({ ...facts.quests[0], installId: "four", capturedAt: "2026-11-10T00:00:00Z" }, facts.quests[0]);
  const out = await html();
  expect(out).toMatch(/<h1[^>]*>A shopkeeper<\/h1>/);
  expect(panel(out, "starts")).toContain('href="/database/quests/10"');
  expect(panel(out, "starts")).toContain("3 of 3 installs agree");
  expect(panel(out, "starts")).toContain("last seen 12 h ago");
  expect(panel(out, "starts")).not.toContain(">one<");
});

test("a recheck on a quest reward item also resets its NPC relation", async () => {
  facts.quests = quest(10, "giverNpcId").map((r) => ({ ...r, rewardItemIds: [117] }));
  facts.recheck = [{ source: "test", type: "quests", ids: [117], since: "2026-11-09T00:00:00Z" }];
  const out = await html();
  expect(out).not.toContain('href="/database/quests/10"');
  expect(out).not.toContain('data-tab-panel="starts"');
});

test("rechecks hide old agreements until three fresh installs agree", async () => {
  facts.vendors = goods();
  facts.quests = quest(10, "giverNpcId");
  facts.recheck = [{ source: "test", since: "2026-11-09T00:00:00Z", ids: [1125, 10] }];
  const old = await html();
  for (const id of ["sells", "starts"]) expect(old).not.toContain(`data-tab-panel="${id}"`);
  const fresh = "2026-11-10T00:00:00Z";
  facts.vendors.push(...goods().map((r) => ({ ...r, capturedAt: fresh })));
  facts.quests.push(...quest(10, "giverNpcId").map((r) => ({ ...r, capturedAt: fresh })));
  const out = await html();
  expect(panel(out, "sells")).toContain(`last seen 12 h ago`);
  expect(panel(out, "starts")).toContain(`last seen 12 h ago`);
});

test("unreachable storage shows unavailable panels rather than empty agreements", async () => {
  facts.unreachable = true;
  const out = await html();
  expect(panel(out, "sells")).not.toContain("No agreed goods");
  expect(panel(out, "starts")).not.toContain("No agreed quest");
});

test("vendor page keeps the same goods table after sharing it with NPC pages", async () => {
  facts.vendors = goods();
  const out = renderToStaticMarkup(await VendorPage({ params: Promise.resolve({ id: "1125" }) }));
  expect(out).toContain('href="/database/items/117"');
  expect(out).toContain("1 gold 23 silver 45 copper");
  // The vendor page now shows each offer's evidence, as the NPC page's Sells tab does.
  expect(out).toContain("3 of 3 installs agree");
});

test("short meters count agreement on one offer or relation, not unrelated reports", async () => {
  facts.vendors = goods(2).map((r, i) => ({ ...r, priceCopper: i + 1 }));
  facts.quests = [quest(10, "giverNpcId", 1)[0], quest(11, "giverNpcId", 2)[1]];
  const out = await html();
  expect(panel(out, "sells")).toContain('data-agreement="1"');
  expect(panel(out, "starts")).toContain('data-agreement="1"');
});

test("zone rechecks reset goods and quest relations at the NPC's reported zone", async () => {
  facts.npcs = facts.npcs.map((r) => ({ ...r, mapId: 1426, positionKind: "npc" }));
  facts.vendors = goods();
  facts.quests = quest(10, "giverNpcId");
  facts.recheck = [{ source: "test", zones: [1426], since: "2026-11-09T00:00:00Z" }];
  const out = await html();
  expect(out).not.toContain("1 gold 23 silver 45 copper");
  for (const id of ["sells", "starts"]) expect(out).not.toContain(`data-tab-panel="${id}"`);
});

test.each([1, 2])("%i agreeing reports plus a wiki match name all page surfaces without identities", async (count) => {
  facts.npcs = facts.npcs.slice(0, count).map((r, i) => ({ ...r, installId: `private-reporter-${i}`, name: "Hogger" }));
  mocks.wiki.mockResolvedValue({ version: "x", names: new Map([["hogger", { name: "Hogger", wikiPage: "https://warcraft.wiki.gg/wiki/Hogger" }]]) });
  const out = await html();
  expect(out).toContain('title="Name from the Warcraft Wiki"');
  expect(out).toContain('"name":"Hogger"');
  expect(out).toMatch(/<h1[^>]*>.*Hogger/);
  expect(out).not.toContain("private-reporter");
  expect(out).toContain('href="https://warcraft.wiki.gg/wiki/Hogger"');
  expect((await generateMetadata({ params: Promise.resolve({ id: "1125" }) })).title).toContain("Hogger");
  mocks.wiki.mockResolvedValue(null);
  expect(await html()).toMatch(/<h1[^>]*>NPC 1125<\/h1>/);
  facts.npcs = installs.map((installId) => ({ ...facts.npcs[0], installId, name: "Player name" }));
  const agreed = await html();
  expect(agreed).toMatch(/<h1[^>]*>Player name<\/h1>/);
  expect(agreed).not.toContain('title="Name from the Warcraft Wiki"');
});

test("disagreeing reports cannot borrow a wiki name", async () => {
  facts.npcs = facts.npcs.slice(0, 2).map((r, i) => ({ ...r, name: i ? "Other" : "Hogger" }));
  mocks.wiki.mockResolvedValue({ version: "x", names: new Map([["hogger", { name: "Hogger", wikiPage: "https://warcraft.wiki.gg/wiki/Hogger" }]]) });
  expect(await html()).toMatch(/<h1[^>]*>NPC 1125<\/h1>/);
});

const MODEL = { url: `https://assets.example.test/renders/${"a".repeat(32)}.webp`, size: 512 };

test("a named NPC with a model picture shows it in the side column: lazy, sized, its alt the name", async () => {
  facts.npcs = facts.npcs.map((r) => ({ ...r, name: "Hogger" }));
  mocks.renders.mockResolvedValue({ npcs: new Map([[1125, MODEL]]), items: new Map() });
  const out = await html();
  const sidebar = out.split("data-entity-sidebar")[1] ?? "";
  expect(sidebar).toMatch(new RegExp(`^[^>]*><div data-slot="media"><div data-model-picture[^>]*><img src="${MODEL.url}" alt="Model of Hogger" width="512" height="512" loading="lazy"`));
});

test("no picture for the NPC, or no renders.json: nothing in its place", async () => {
  facts.npcs = facts.npcs.map((r) => ({ ...r, name: "Hogger" }));
  mocks.renders.mockResolvedValue({ npcs: new Map([[9999, MODEL]]), items: new Map([[1125, MODEL]]) });
  expect(await html()).not.toContain("data-model-picture");
  mocks.renders.mockResolvedValue(null);
  expect(await html()).not.toContain("data-model-picture");
});

test("an NPC the page shows no name for gets no picture, and renders.json is not read", async () => {
  mocks.renders.mockResolvedValue({ npcs: new Map([[1125, MODEL]]), items: new Map() });
  // The installs disagree on the name: the page says "NPC 1125".
  const out = await html();
  expect(out).toContain("NPC 1125</h1>");
  expect(out).not.toContain("data-model-picture");
  facts.npcs = facts.npcs.map((r) => ({ ...r, name: "Hogger" }));
  facts.unreachable = true;
  expect(await html()).not.toContain("data-model-picture");
  expect(mocks.renders).not.toHaveBeenCalled();
});

test("an NPC 3 installs tie to a boss encounter links that boss's page; others name no boss", async () => {
  expect(fact(await html(), "Boss")).toBeUndefined();
  // SYNTHETIC: three installs killed Oggleflint in Ragefire Chasm and tie this NPC to it.
  const encounters = installs.map((installId) => ({ installId, encounterId: 2732, name: "Oggleflint", instanceMapId: 389, success: true, npcIds: [1125], capturedAt: at }));
  mocks.sightings.mockResolvedValue({ unreachable: false, asOf: new Date("2026-11-10T00:00:00Z"), instances: { entrances: [], encounters } });
  const out = await html();
  const boss = fact(out, "Boss");
  expect(boss).toContain('href="/database/bosses/2732-oggleflint"');
  expect(boss).toContain('href="/database/instances/389-ragefire-chasm"');
  // Its own tab too, linking the boss page and the instance.
  expect(out).toMatch(/role="tab"[^>]*>Boss<span[^>]*> \(1\)<\/span>/);
  expect(panel(out, "boss")).toContain('href="/database/bosses/2732-oggleflint"');
  expect(panel(out, "boss")).toContain('href="/database/instances/389-ragefire-chasm"');
});

test("the header reads level, rank badge, type, reaction and zone link from the agreed traits", async () => {
  facts.npcs = facts.npcs.map((r) => ({ ...r, mapId: 1426, x: 40, y: 60, positionKind: "npc", rank: "rare_elite", reaction: "hostile", creatureType: "Beast", level: 32 }));
  const header = (await html()).split("data-entity-header")[1]?.split("</header>")[0] ?? "";
  const meta = header.split("data-entity-meta")[1] ?? "";
  expect(meta).toContain("Level 32");
  expect(meta).toMatch(/data-badge="neutral"[^>]*>Rare elite</);
  expect(meta).toContain("Beast");
  expect(meta).toContain("Hostile");
  expect(meta).toMatch(/href="\/database\/zones\/1426-[a-z-]+"/);
  // A normal creature gets no badge; traits short of 3 installs are not in the header.
  facts.npcs = facts.npcs.map((r) => ({ ...r, rank: "normal" }));
  expect((await html()).split("</header>")[0]).not.toContain("data-badge");
  facts.npcs = facts.npcs.slice(0, 2);
  const short = (await html()).split("data-entity-meta")[1]?.split("</p>")[0] ?? "";
  for (const word of ["Level", "Beast", "Hostile"]) expect(short).not.toContain(word);
});

test("goods and drops show the item's icon and quality colour, and drops sort by their headers", async () => {
  const tip = (name: string, quality: string) => ({ name, quality, color: "#fff", icon: `https://assets.example.test/icons/${name}.png`, lines: [], partial: false, why: [] });
  mocks.tips.mockResolvedValue(new Map([[117, tip("Linen", "Epic")], [118, tip("Apple", "Poor")]]));
  facts.vendors = goods();
  const sells = panel(await html(), "sells");
  expect(sells).toMatch(/<img[^>]*src="https:\/\/assets.example.test\/icons\/Linen.png"/);
  expect(sells).toMatch(/class="[^"]*text-q-epic[^"]*"[^>]*>Linen</);
  facts.vendors = [];
  // SYNTHETIC: a rated table, Linen in 1 of 4 windows and Apple in 3 of 4.
  const row = (itemId: number, withItem: number) => ({ sourceNpcId: 1125, itemId, withItem, windows: 4, installs: 3, rate: withItem / 4, first: null, last: null });
  mocks.loot.mockReturnValue({ npcId: 1125, state: "rated", span: { windows: 4, installs: 3, first: null, last: null }, rows: [row(118, 3), row(117, 1)], missingInstalls: 0 });
  mocks.rollup.mockResolvedValue({ rates: [117, 118].map((itemId) => ({ itemId, sourceNpcId: 1125, reporters: 3 })), measuredZeros: [], stats: { unreachable: false } });
  const drops = panel(await html(), "drops");
  expect(drops).toMatch(/class="[^"]*text-q-poor[^"]*"[^>]*>Apple</);
  expect(drops).toContain('href="/database/npcs/1125?sort=item#drops"');
  expect(drops.indexOf(">Apple<")).toBeLessThan(drops.indexOf(">Linen<"));
  const byName = panel(await html({ sort: "-item" }), "drops");
  expect(byName.indexOf(">Linen<")).toBeLessThan(byName.indexOf(">Apple<"));
  expect(byName).toContain('aria-sort="descending"');
  const byRate = panel(await html({ sort: "rate" }), "drops");
  expect(byRate.indexOf(">Linen<")).toBeLessThan(byRate.indexOf(">Apple<"));
});

test("a drop row shows the name, icon, quality and unconfirmed mark the item's own page and hover card show", async () => {
  // SYNTHETIC ids. 990001: the files give only an icon (no tooltip, no name). 990002: named only by the names file's game
  // file name, quality 2. 990003: a tooltip, but no page shows the item (not reported, no name): nothing from the files.
  const row = (itemId: number) => ({ sourceNpcId: 1125, itemId, withItem: 1, windows: 4, installs: 3, rate: 0.25, first: null, last: null });
  mocks.loot.mockReturnValue({ npcId: 1125, state: "rated", span: { windows: 4, installs: 3, first: null, last: null }, rows: [990001, 990002, 990003].map(row), missingInstalls: 0 });
  mocks.rollup.mockResolvedValue({ rates: [990001, 990002, 990003].map((itemId) => ({ itemId, sourceNpcId: 1125, reporters: 1 })), measuredZeros: [], stats: { unreachable: false } });
  mocks.icons = new Map([[990001, "https://assets.example.test/icons/only.png"]]);
  mocks.tips.mockImplementation(async (_: unknown, ids: number[]) => new Map(ids.filter((id) => id === 990003).map((id) => [id, { name: "Hidden Blade", quality: "Epic", color: "#fff", icon: "https://assets.example.test/icons/hidden.png", lines: [], partial: false, why: [] }])));
  mocks.names = {
    agreed: new Map(), named: { has: () => true }, degraded: false, unreachable: false,
    matched: { version: "1", wiki: { name: "w", url: "u" }, names: new Map([[990002, { name: "Files Cloak", color: "#1eff00", quality: 2, wikiPage: null, source: "files" }]]) },
    showsTip: (id: number) => id !== 990003,
  };
  const drops = panel(await html(), "drops");
  expect(drops).toMatch(/<img[^>]*src="https:\/\/assets.example.test\/icons\/only.png"[^>]*\/><a [^>]*href="\/database\/items\/990001">Item 990001</);
  expect(drops).toMatch(/<a class="[^"]*text-q-uncommon[^"]*" href="\/database\/items\/990002">Files Cloak<\/a>(?:<[^>]*>)*<span data-badge="files"/);
  expect(drops).toContain(">Item 990003<");
  expect(drops).not.toContain("Hidden Blade");
  expect(drops).not.toContain("hidden.png");
});
