import { beforeEach, expect, test, vi } from "vitest";

// Players agree on one item name (19019) and one quest; the name rule shows a wiki-matched item (647) and a
// wiki quest title (176). Item 5 is in the game files only: no card, as on its page.
const mocks = vi.hoisted(() => ({
  items: vi.fn(), world: vi.fn(), reported: vi.fn(), objects: vi.fn(), assets: vi.fn(), tips: vi.fn(), quests: vi.fn(), shown: vi.fn(),
}));
vi.mock("@/lib/rollup-compute", () => ({ loadItemFacts: mocks.items, loadWorldFacts: mocks.world, loadReportedItemFacts: mocks.reported }));
vi.mock("@/lib/objects", () => ({ loadObjectFacts: mocks.objects }));
vi.mock("@/lib/game-assets", () => ({ loadSiteAssets: mocks.assets, loadItemTips: mocks.tips, loadQuestNames: mocks.quests }));
vi.mock("@/lib/shown-item-names", () => ({ loadShownNames: mocks.shown }));

import { GET } from "./route";

const three = (make: (installId: string) => object) => ["a", "b", "c"].map(make);
const call = (type: string, id: string) => GET(new Request(`https://everloot.app/database/card/${type}/${id}`), { params: Promise.resolve({ type, id }) });
const TIP = { name: "Destiny", color: "#a335ee", quality: "Epic", icon: "https://assets.everloot.app/b/icons/7.webp", lines: ["Two-Hand", "+[?] Strength"], partial: true, why: ["[?] stat amounts: reason."], label: "Found in game files, unconfirmed · build 70450" };

beforeEach(() => {
  mocks.items.mockReset().mockResolvedValue({ rates: [], npcs: [], unreachable: false, names: three((installId) => ({ installId, itemId: 19019, name: "Thunderfury" })) });
  mocks.world.mockReset().mockResolvedValue({
    unreachable: false, vendors: [],
    npcs: three((installId) => ({ installId, npcId: 6, name: "Thrall", positionKind: "npc", mapId: 1, x: 40, y: 50 })),
    quests: three((installId) => ({ installId, questId: 9, title: "Cutting Teeth", level: 1, giverNpcId: 6, rewardItemIds: [] })),
  });
  mocks.reported.mockReset().mockResolvedValue({ shown: [], contested: [], unreachable: false });
  mocks.objects.mockReset().mockResolvedValue({ rates: [], names: [], unreachable: false, dataAsOf: null, measuredZeros: [] });
  mocks.assets.mockReset().mockResolvedValue({ base: "https://assets.everloot.app/b", version: "70450", label: "Found in game files, unconfirmed" });
  mocks.tips.mockReset().mockImplementation(async (_a: unknown, ids: number[]) => new Map(ids.includes(647) ? [[647, TIP]] : []));
  mocks.quests.mockReset().mockResolvedValue({ names: new Map([[176, { name: "Wanted: Hogger", wikiPage: "z" }]]) });
  const agreed = new Map([[19019, "Thunderfury"]]);
  const matched = new Map([[647, { name: "Destiny", color: "#a335ee", wikiPage: "Destiny" }]]);
  mocks.shown.mockReset().mockResolvedValue({
    facts: { unreachable: false }, agreed, matched: { names: matched },
    showsTip: (id: number) => agreed.has(id) || matched.has(id),
  });
});

test("an item the name rule shows gets its page's box: the game's lines, its quality, its icon, and where the name comes from", async () => {
  const res = await call("item", "647");
  expect(res.status).toBe(200);
  const { card } = await res.json();
  // No quality in the client layer for this one: the name keeps its own colour.
  expect(card).toMatchObject({ type: "item", id: 647, title: "Destiny", quality: null, color: "#a335ee", icon: TIP.icon });
  // The reason for the placeholder is a note for the card to draw under it, not a line in the box.
  expect(card.lines).toEqual(["Two-Hand", "+[?] Strength"]);
  expect(card.notes).toEqual(["[?] stat amounts: reason."]);
  expect(card.foot).toBe("Name from the Warcraft Wiki · Found in game files, unconfirmed · build 70450");
  expect(mocks.tips).toHaveBeenCalledWith(expect.anything(), [647]);
});

test("a number 3 installs' tooltips agree on fills its placeholder, with the installs, the build and the date", async () => {
  mocks.reported.mockResolvedValue({
    shown: [{ fact: "strength", value: 7, reporters: 4, build: "1.60.1.70450", lastSeen: "2026-11-05T12:00:00.000Z" }], contested: [], unreachable: false,
  });
  const { card } = await (await call("item", "647")).json();
  expect(card.notes).toEqual(["[?] stat amounts: reason."]);
  expect(card.lines).toEqual(["Two-Hand", "+7 Strength", "+7 Strength: reported by 4 installs, last seen 2026-11-05, build 1.60.1.70450."]);
  expect(mocks.reported).toHaveBeenCalledWith(647);
});

test("a name players agree on says so; an item without its game file tooltip still names its type", async () => {
  const { card } = await (await call("item", "19019")).json();
  expect(card).toMatchObject({ title: "Thunderfury", quality: 5, color: null, icon: null });
  expect(card.foot).toBe("Name confirmed by players");
});

test("an id no page shows (unreported, unreleased) is a 404, without reading the game files", async () => {
  for (const id of ["5", "123456"]) expect((await call("item", id)).status, id).toBe(404);
  expect(mocks.tips).not.toHaveBeenCalled();
  expect((await call("npc", "999")).status).toBe(404);
  expect((await call("spell", "1")).status).toBe(404);
  expect((await call("item", "01")).status).toBe(404);
});

test("a quest shows the title players agree on, else the Warcraft Wiki's with its source", async () => {
  expect((await (await call("quest", "9")).json()).card).toMatchObject({ title: "Cutting Teeth", lines: ["Level 1", "Starts with Thrall"], foot: null });
  expect((await (await call("quest", "176")).json()).card).toMatchObject({ title: "Wanted: Hogger", lines: [], foot: "Name from the Warcraft Wiki" });
  expect((await call("quest", "177")).status).toBe(404);
});

test("NPCs say what the embeddable card says", async () => {
  expect((await (await call("npc", "6")).json()).card).toMatchObject({ title: "Thrall", lines: ["Seen on 1 map, agreed by 3 or more installs."], quality: null });
});

test("it is the site's own route: no CORS, never indexed; storage down is a 503 that is not cached", async () => {
  const res = await call("item", "647");
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  expect(res.headers.get("x-robots-tag")).toBe("noindex");
  expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
  mocks.shown.mockResolvedValue({ facts: { unreachable: true }, agreed: new Map(), matched: null, showsTip: () => false });
  const down = await call("item", "19019");
  expect(down.status).toBe(503);
  expect(down.headers.get("cache-control")).toBe("no-store");
});
