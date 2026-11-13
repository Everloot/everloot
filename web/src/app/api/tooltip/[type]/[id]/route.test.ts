import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tooltipResponse } from "@everloot/protocol";

const mocks = vi.hoisted(() => ({
  items: vi.fn(), world: vi.fn(), reported: vi.fn(), objects: vi.fn(), assets: vi.fn(), tips: vi.fn(),
}));
vi.mock("@/lib/rollup-compute", () => ({ loadItemFacts: mocks.items, loadWorldFacts: mocks.world, loadReportedItemFacts: mocks.reported }));
vi.mock("@/lib/objects", () => ({ loadObjectFacts: mocks.objects }));
vi.mock("@/lib/game-assets", () => ({ loadSiteAssets: mocks.assets, loadItemTips: mocks.tips }));

import { GET, OPTIONS } from "./route";
import { itemTipText } from "@/lib/item-names";
import type { ItemRecord } from "../../../../../../../kb/src/assets/items";

const three = (make: (installId: string) => object) => ["a", "b", "c"].map(make);
const call = (type: string, id: string) => GET(new Request(`https://everloot.app/api/tooltip/${type}/${id}`), { params: Promise.resolve({ type, id }) });

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  mocks.items.mockReset().mockResolvedValue({
    rates: [], npcs: [], unreachable: false,
    names: [...three((installId) => ({ installId, itemId: 19019, name: "Thunderfury" })), { installId: "a", itemId: 5, name: "Lonely" }],
  });
  mocks.world.mockReset().mockResolvedValue({
    unreachable: false, vendors: [],
    npcs: three((installId) => ({ installId, npcId: 6, name: "Thrall", positionKind: "npc", mapId: 1, x: 40, y: 50 })),
    quests: three((installId) => ({ installId, questId: 9, title: "Cutting Teeth", level: 1, giverNpcId: 6, rewardItemIds: [] })),
  });
  mocks.objects.mockReset().mockResolvedValue({ rates: [], names: [], unreachable: false, dataAsOf: null, measuredZeros: [{ sourceObjectId: 7, kills: 12, reporters: 3, public: true }] });
  mocks.assets.mockReset().mockResolvedValue({ base: "https://assets.everloot.app/b", version: "70450", label: "Found in game files, unconfirmed" });
  mocks.tips.mockReset().mockResolvedValue(new Map());
  mocks.reported.mockReset().mockResolvedValue({ shown: [], contested: [], unreachable: false });
});

test("the numbers 3 installs' tooltips agree on fill the card; a contested line keeps its [?] and says why", async () => {
  const { WHY } = await import("@/lib/item-names");
  mocks.tips.mockResolvedValue(new Map([[19019, {
    name: "Thunderfury", color: "#ff8000", quality: "Legendary", icon: null, label: "x", partial: true,
    lines: ["One-Hand · Sword", "[?] - [?] Damage · Speed 1.90", "([?] damage per second)", "[?] Armor", "+[?] Agility", "+[?] Stamina", "Requires Level 60"],
    why: [WHY.damage, WHY.armor, WHY.stats],
  }]]));
  mocks.reported.mockResolvedValue({
    shown: [
      { fact: "armor", value: 70, reporters: 3, build: "1.60.1.70450", lastSeen: "2026-11-05T12:00:00.000Z" },
      { fact: "agility", value: 5, reporters: 5, build: "1.60.1.70450", lastSeen: null },
      { fact: "fire_resistance", value: 8, reporters: 3, build: "1.60.1.70450", lastSeen: "2026-11-06T12:00:00.000Z" },
    ],
    contested: ["stamina"], unreachable: false,
  });
  const body = tooltipResponse.parse(await (await call("item", "19019")).json());
  expect(body.lines).toEqual([
    "One-Hand · Sword", "[?] - [?] Damage · Speed 1.90", "([?] damage per second)", "70 Armor", "+5 Agility", "+[?] Stamina", "+8 Fire Resistance", "Requires Level 60",
    WHY.damage, WHY.stats,
    "[?] Stamina: installs disagree on the number, so none is shown until 3 agree on one.",
    "70 Armor: reported by 3 installs, last seen 2026-11-05, build 1.60.1.70450.",
    "+5 Agility: reported by 5 installs, last seen [?], build 1.60.1.70450.",
    "+8 Fire Resistance: reported by 3 installs, last seen 2026-11-06, build 1.60.1.70450.",
  ]);
  expect(body.partial).toBe(true);
  expect(mocks.reported).toHaveBeenCalledWith(19019);
});

// The API's lines are an ordered list other readers render as they come (packages/protocol, public/tooltips.js), so
// the site's game-style reorder of the item level is in the tooltip component, not in these lines. These are the
// orders main served before it: the item level sits after the requirements, ahead of the effects.
const SHAPE = { st: [], u: 0, d: 0, sp: 0, r: 0, b: 0, s: 0, cr: [], rq: [], fx: [] } satisfies Partial<ItemRecord>;
const MACE: ItemRecord = { ...SHAPE, n: "Test Mace", q: 2, l: 9, r: 4, b: 2, s: 21, c: 2, sc: 4, d: 2100, sp: 110, fx: ["Chance on hit: Synthetic effect."] };
const HELM: ItemRecord = {
  ...SHAPE, n: "Test Helm", q: 4, l: 61, r: 56, b: 2, s: 1, c: 4, sc: 4, st: [4, 32], sp: 21894,
  cr: ["Classes: Warrior"], fx: ["Equip: Synthetic effect."], is: { id: 1, n: "Synthetic Battlegear" }, t: "Synthetic.",
};

test.each([
  { what: "a weapon", record: MACE, lines: [
    "Binds when equipped", "Main Hand · Mace", "[?] - [?] Damage · Speed 2.10", "([?] damage per second)", "Requires Level 4", "Item Level 9",
    "Chance on hit: Synthetic effect.", "Sell Price: 1s 10c",
  ] },
  { what: "an armor piece", record: HELM, lines: [
    "Binds when equipped", "Head · Plate", "[?] Armor", "+[?] Strength", "+[?] Critical Strike Rating", "Classes: Warrior", "Requires Level 56", "Item Level 61",
    "Equip: Synthetic effect.", "Set: Synthetic Battlegear", '"Synthetic."', "Sell Price: 2g 18s 94c",
  ] },
])("/api/tooltip serves $what's lines in the order main did, with the item level after the requirements", async ({ record, lines }) => {
  const tip = itemTipText(record);
  mocks.tips.mockResolvedValue(new Map([[19019, { name: record.n, color: "#ffffff", quality: "Common", icon: null, label: "x", partial: tip.partial, lines: tip.lines, why: [] }]]));
  const body = tooltipResponse.parse(await (await call("item", "19019")).json());
  expect(body.lines).toEqual(lines);
  expect(body.lines.indexOf(`Item Level ${record.l}`)).toBeGreaterThan(0);
});

test("an item card carries the page's name, the licence and the page URL, and parses as the protocol's shape", async () => {
  const res = await call("item", "19019");
  expect(res.status).toBe(200);
  const body = tooltipResponse.parse(await res.json());
  expect(body).toMatchObject({ type: "item", id: 19019, title: "Thunderfury", url: "https://everloot.app/database/items/19019", gameData: null });
  expect(body.attribution.credit).toContain("Everloot");
  expect(res.headers.get("x-everloot-licence")).toBeTruthy();
});

test("the game files' tooltip text and icon come with their label and build, and the Blizzard credit", async () => {
  mocks.tips.mockResolvedValue(new Map([[19019, { name: "Thunderfury", color: "#ff8000", quality: "Legendary", icon: "https://assets.everloot.app/b/icons/1.webp", lines: ["Binds when picked up", '"Blessed Blade"'], partial: true, why: [], label: "x" }]]));
  const body = tooltipResponse.parse(await (await call("item", "19019")).json());
  expect(body).toMatchObject({ color: "#ff8000", icon: "https://assets.everloot.app/b/icons/1.webp", partial: true, gameData: { label: "Found in game files, unconfirmed", build: "70450" } });
  expect(body.gameData?.credit).toContain("Blizzard");
  expect(body.lines).toEqual(expect.arrayContaining(["Binds when picked up", '"Blessed Blade"']));
});

test("a tooltip line with no fact reads [?], never a blank, and the card says why", async () => {
  // Without the game files every line is a placeholder, and the last line says the files are not available.
  const bare = tooltipResponse.parse(await (await call("item", "19019")).json());
  expect(bare.lines).toEqual(["Stats: [?]", "Restrictions: [?]", "Set: [?]", "Equip and Use: [?]", "[?] The game files the card reads are not available right now."]);
  expect(bare.partial).toBe(true);
  // With them, the card carries the files' lines and the reasons the tooltip gives for its placeholders, nothing more.
  mocks.tips.mockResolvedValue(new Map([[19019, { name: "Thunderfury", color: "#ff8000", quality: "Legendary", icon: null, lines: ["One-Hand · Sword", "+[?] Agility", "Set: Synthetic Battlegear"], partial: true, why: ["[?] stat amounts: reason."], label: "x" }]]));
  const withStats = tooltipResponse.parse(await (await call("item", "19019")).json());
  expect(withStats.lines).toEqual(["One-Hand · Sword", "+[?] Agility", "Set: Synthetic Battlegear", "[?] stat amounts: reason."]);
  expect(withStats.partial).toBe(true);
  // A tooltip with nothing unknown is not partial.
  mocks.tips.mockResolvedValue(new Map([[19019, { name: "Thunderfury", color: "#ff8000", quality: "Legendary", icon: null, lines: ["Quest Item"], partial: false, why: [], label: "x" }]]));
  expect(tooltipResponse.parse(await (await call("item", "19019")).json())).toMatchObject({ lines: ["Quest Item"], partial: false });
  for (const line of [...bare.lines, ...withStats.lines]) expect(line.trim()).not.toMatch(/(^|:)$/);
});

test("agreed facts take the [?]'s place, line for line", async () => {
  const { itemFactLines } = await import("@/lib/tooltip");
  expect(itemFactLines({ restrictions: ["Classes: Warrior"], setName: "Synthetic Battlegear", effects: ["Equip: Synthetic effect."] }, true))
    .toEqual(["Classes: Warrior", "Set: Synthetic Battlegear", "Equip: Synthetic effect."]);
});

test("an item nobody reported is a 404, and so is one a single install named (the 3-install rule)", async () => {
  expect((await call("item", "123456")).status).toBe(404);
  expect((await call("item", "5")).status).toBe(404);
  expect(mocks.tips).not.toHaveBeenCalled();
});

test("npc, quest and object cards say what the page says", async () => {
  expect(await (await call("npc", "6")).json()).toMatchObject({ title: "Thrall", lines: ["Seen on 1 map, agreed by 3 or more installs."] });
  expect(await (await call("quest", "9")).json()).toMatchObject({ title: "Cutting Teeth", lines: ["Level 1", "Starts with Thrall"] });
  expect(await (await call("object", "7")).json()).toMatchObject({ title: "Object 7", lines: ["No items in 12 loot windows players opened."] });
  expect((await call("npc", "999")).status).toBe(404);
});

test("an object card shows the name 3 installs agree on", async () => {
  mocks.objects.mockResolvedValue({ rates: [], names: [], unreachable: false, dataAsOf: null, measuredZeros: [{ sourceObjectId: 7, kills: 12, reporters: 3, public: true }], objects: three((installId) => ({ installId, objectId: 7, name: "Copper Vein" })) });
  expect(await (await call("object", "7")).json()).toMatchObject({ title: "Copper Vein" });
});

test("bad types and bad ids are 404s, without reading any data", async () => {
  for (const [type, id] of [["spell", "1"], ["item", "abc"], ["item", "0"], ["item", "-1"], ["item", "01"], ["item", "1.5"], ["item", "99999999999"], ["item", "2147483648"], ["items", "1"]]) {
    const res = await call(type, id);
    expect(res.status, `${type}/${id}`).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false });
  }
  expect(mocks.items).not.toHaveBeenCalled();
});

test("unreachable storage is a 503 that is not cached", async () => {
  mocks.items.mockResolvedValue({ rates: [], names: [], npcs: [], unreachable: true });
  const res = await call("item", "19019");
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("cdn-cache-control")).toBeNull();
});

test("any site may read it with GET: CORS is open, nothing else is", async () => {
  for (const res of [await call("item", "19019"), await call("item", "x")]) {
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  }
  const pre = OPTIONS();
  expect(pre.status).toBe(204);
  expect(pre.headers.get("access-control-allow-origin")).toBe("*");
  expect(pre.headers.get("access-control-allow-methods")).toBe("GET");
});

test("the CDN keeps a card for an hour and serves it stale for a day; a 404 is kept briefly", async () => {
  expect((await call("item", "19019")).headers.get("cdn-cache-control")).toBe("public, max-age=3600");
  expect((await call("item", "123456")).headers.get("cdn-cache-control")).toBe("public, max-age=300");
  const cache = (await call("item", "19019")).headers.get("cache-control") ?? "";
  expect(cache).toContain("public");
  expect(cache).toContain("s-maxage=3600");
  expect(cache).toContain("stale-while-revalidate=86400");
  const missing = (await call("item", "123456")).headers.get("cache-control") ?? "";
  expect(missing).toContain("s-maxage=300");
});
