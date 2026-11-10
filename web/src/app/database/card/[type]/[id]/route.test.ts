import { beforeEach, expect, test, vi } from "vitest";

// Players agree on one item name (19019) and one quest; the name rule shows a wiki-matched item (647) and a
// wiki quest title (176). Item 5 is in the game files only: no card, as on its page.
const mocks = vi.hoisted(() => ({
  items: vi.fn(), world: vi.fn(), reported: vi.fn(), objects: vi.fn(), assets: vi.fn(), tips: vi.fn(), quests: vi.fn(), shown: vi.fn(), names: vi.fn(), tipsDown: vi.fn(), store: vi.fn(),
}));
vi.mock("@/lib/rollup-compute", () => ({ loadItemFacts: mocks.items, loadWorldFacts: mocks.world, loadReportedItemFacts: mocks.reported, loadAllReportedItemFacts: vi.fn() }));
vi.mock("@/lib/objects", () => ({ loadObjectFacts: mocks.objects }));
vi.mock("@/lib/game-assets", () => ({
  loadSiteAssets: mocks.assets, loadItemTips: mocks.tips, loadQuestNames: mocks.quests, readQuestNames: mocks.quests, loadItemNames: mocks.names,
  // With a private folder set (mocks.store), the real reader reads it; else the stubbed tips.
  readItemTips: async (assets: never, ids: number[]) => {
    const store = mocks.store();
    if (store) return (await vi.importActual<typeof import("@/lib/game-assets")>("@/lib/game-assets")).readItemTips(assets, ids, store);
    return { tips: await mocks.tips(assets, ids), unreachable: mocks.tipsDown(), degraded: false };
  },
  PRIVATE_UNREACHABLE: Symbol.for("unreachable"),
}));
vi.mock("@/lib/shown-item-names", () => ({ loadShownNames: mocks.shown }));

import { edgeTtl } from "@/lib/cf-edge-cache";
import { itemIndex, memoryStore, shard0 } from "@/lib/game-assets.fixture";
import { forgetItemView } from "@/lib/item-view-store";
import { GET } from "./route";

const three = (make: (installId: string) => object) => ["a", "b", "c"].map(make);
const call = (type: string, id: string) => GET(new Request(`https://everloot.app/database/card/${type}/${id}`), { params: Promise.resolve({ type, id }) });
const TIP = { name: "Destiny", color: "#a335ee", quality: "Epic", icon: "https://assets.everloot.app/b/icons/7.webp", lines: ["Two-Hand", "+[?] Strength"], partial: true, why: ["[?] stat amounts: reason."], label: "Found in game files, unconfirmed · build 70450" };

beforeEach(() => {
  forgetItemView();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.items.mockReset().mockResolvedValue({ rates: [], npcs: [], unreachable: false, names: three((installId) => ({ installId, itemId: 19019, name: "Thunderfury" })) });
  mocks.world.mockReset().mockResolvedValue({
    unreachable: false, vendors: [],
    npcs: three((installId) => ({ installId, npcId: 6, name: "Thrall", positionKind: "npc", mapId: 1, x: 40, y: 50 })),
    quests: three((installId) => ({ installId, questId: 9, title: "Cutting Teeth", level: 1, giverNpcId: 6, rewardItemIds: [] })),
  });
  mocks.reported.mockReset().mockResolvedValue({ shown: [], contested: [], unreachable: false });
  mocks.objects.mockReset().mockResolvedValue({ rates: [], names: [], unreachable: false, dataAsOf: null, measuredZeros: [] });
  mocks.assets.mockReset().mockResolvedValue({ base: "https://assets.everloot.app/b", version: "70450", label: "Found in game files, unconfirmed" });
  mocks.tipsDown.mockReset().mockReturnValue(false);
  mocks.store.mockReset().mockReturnValue(null);
  mocks.tips.mockReset().mockImplementation(async (_a: unknown, ids: number[]) => new Map(ids.includes(647) ? [[647, TIP]] : []));
  mocks.quests.mockReset().mockResolvedValue({ names: new Map([[176, { name: "Wanted: Hogger", wikiPage: "z" }]]) });
  const agreed = new Map([[19019, "Thunderfury"]]);
  const matched = new Map([[647, { name: "Destiny", color: "#a335ee", wikiPage: "Destiny", source: "wiki" }]]);
  mocks.names.mockReset().mockResolvedValue({ names: matched });
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
  expect((await call("unsupported", "1")).status).toBe(404);
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

test("a card is kept an hour by the Worker's edge cache and five minutes by the browser; a 404 is not kept at the edge", async () => {
  const res = await call("item", "647");
  expect(res.headers.get("cdn-cache-control")).toBe("max-age=3600");
  expect(res.headers.get("cache-control")).toMatch(/^public, max-age=300\b/);
  expect(edgeTtl(res)).toBe(3600);
  const missing = await call("item", "5");
  expect(missing.status).toBe(404);
  expect(edgeTtl(missing)).toBeNull();
});

test("with the cron's stored item view, an item card reads that one small file: never the corpus or the aggregate set", async () => {
  for (const [k, v] of Object.entries({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "everloot-uploads" })) vi.stubEnv(k, v);
  const view = {
    version: 1, generatedAt: "2026-11-10T00:00:00.000Z", dataAsOf: null, agreed: [[19019, "Thunderfury"]], dropped: [], seen: [19019], from: [],
    reported: [[647, { shown: [{ fact: "strength", value: 7, reporters: 4, build: "1.60.1.70450", lastSeen: "2026-11-05T12:00:00.000Z" }], contested: [] }]],
  };
  const r2 = vi.fn(async () => new Response(JSON.stringify(view), { status: 200 }));
  vi.stubGlobal("fetch", r2);
  const { card } = await (await call("item", "647")).json();
  expect(card.lines).toEqual(["Two-Hand", "+7 Strength", "+7 Strength: reported by 4 installs, last seen 2026-11-05, build 1.60.1.70450."]);
  expect((await (await call("item", "19019")).json()).card).toMatchObject({ title: "Thunderfury", foot: "Name confirmed by players" });
  expect((await call("item", "5")).status).toBe(404);
  // The names and the reported numbers came from the view, read once for both cards.
  expect(mocks.shown).not.toHaveBeenCalled();
  expect(mocks.reported).not.toHaveBeenCalled();
  expect(mocks.items).not.toHaveBeenCalled();
  expect(r2).toHaveBeenCalledTimes(1);
});

test("a stored view written before it held the reported numbers still names the card, and the numbers come from the aggregates", async () => {
  for (const [k, v] of Object.entries({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "everloot-uploads" })) vi.stubEnv(k, v);
  const view = { version: 1, generatedAt: "2026-11-10T00:00:00.000Z", dataAsOf: null, agreed: [], dropped: [], seen: [], from: [] };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(view), { status: 200 })));
  expect((await call("item", "647")).status).toBe(200);
  expect(mocks.shown).not.toHaveBeenCalled();
  expect(mocks.reported).toHaveBeenCalledWith(647);
});

const DOWN = Symbol.for("unreachable");
const R2 = { R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "everloot-uploads" };
/** The cron's stored item view, read from the (stubbed) uploads bucket. */
function storedView(view: object) {
  for (const [k, v] of Object.entries(R2)) vi.stubEnv(k, v);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(view), { status: 200 })));
}
/** A read failed: a 503 neither the browser nor the edge keeps, so the next hover asks again. */
function expectUnavailable(res: Response) {
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("cdn-cache-control")).toBe("no-store");
  expect(edgeTtl(res)).toBeNull();
}

test("an asset manifest that did not load is a 503, not a card without its game file lines", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "https://assets.everloot.app/b");
  mocks.assets.mockResolvedValue(null);
  expectUnavailable(await call("item", "647"));
  expect(mocks.tips).not.toHaveBeenCalled();
  // Without a manifest URL there is nothing to read: the card is whole without game file lines.
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "");
  const res = await call("item", "19019");
  expect(res.status).toBe(200);
  expect(edgeTtl(res)).toBe(3600);
});

test("an item file shard that could not be read is a 503, not a card without its game file lines", async () => {
  mocks.tipsDown.mockReturnValue(true);
  expectUnavailable(await call("item", "647"));
});

test("a stored view from before the reported numbers, with the aggregates out of reach, is a 503 rather than a card without them", async () => {
  storedView({ version: 1, generatedAt: "2026-11-10T00:00:00.000Z", dataAsOf: null, agreed: [], dropped: [], seen: [], from: [] });
  mocks.reported.mockResolvedValue({ shown: [], contested: [], unreachable: true });
  expectUnavailable(await call("item", "647"));
  expect(mocks.reported).toHaveBeenCalledWith(647);
});

test("a quest with storage down is a 503: the Warcraft Wiki title does not stand in for the players' facts", async () => {
  mocks.world.mockResolvedValue({ unreachable: true, vendors: [], npcs: [], quests: [] });
  expectUnavailable(await call("quest", "176"));
  expectUnavailable(await call("quest", "9"));
  // Quest titles that could not be read are a 503 too, for a quest players have not titled.
  mocks.world.mockResolvedValue({ unreachable: false, vendors: [], npcs: [], quests: [] });
  mocks.quests.mockResolvedValue(DOWN);
  expectUnavailable(await call("quest", "176"));
});

test("names that could not be read are a 503, never a 404 a browser would keep: with the stored view and without it", async () => {
  storedView({ version: 1, generatedAt: "2026-11-10T00:00:00.000Z", dataAsOf: null, agreed: [[19019, "Thunderfury"]], dropped: [], seen: [], from: [], reported: [] });
  mocks.names.mockResolvedValue(DOWN);
  // 647 is shown only under its wiki name, which is now unread: it could be shown or not.
  expectUnavailable(await call("item", "647"));
  expectUnavailable(await call("item", "5"));

  forgetItemView();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mocks.shown.mockResolvedValue({ facts: { unreachable: false }, degraded: true, agreed: new Map(), matched: null, showsTip: () => false });
  expectUnavailable(await call("item", "647"));
  // With the names read, an id no page shows is a 404 as before.
  mocks.shown.mockResolvedValue({ facts: { unreachable: false }, degraded: false, agreed: new Map(), matched: null, showsTip: () => false });
  expect((await call("item", "5")).status).toBe(404);
});

// The private item folder as the real reader sees it: 647 is in shard 1 (512 a shard).
const FOLDER = "wow_classic_beta-70450-84bea423";
function privateFolder(shard: unknown, listed = true) {
  mocks.assets.mockResolvedValue({ base: `https://assets.everloot.app/${FOLDER}`, version: itemIndex.build.version, label: "found in game files, unconfirmed" });
  const index = { ...itemIndex, shards: listed ? { "1": { file: "items/1.json", bytes: 1, sha256: "0".repeat(64) } } : {} };
  mocks.store.mockReturnValue(memoryStore({ [`${FOLDER}/items.json`]: index, ...(shard === undefined ? {} : { [`${FOLDER}/items/1.json`]: shard }) }));
}

test("the private item files read whole make a card the edge keeps; an item its shard does not hold is no failure", async () => {
  privateFolder({ "647": shard0["9"] });
  const res = await call("item", "647");
  expect(res.status).toBe(200);
  expect((await res.json()).card.lines.length).toBeGreaterThan(0);
  expect(edgeTtl(res)).toBe(3600);
  privateFolder({ "648": { n: 1 } });
  expect(edgeTtl(await call("item", "647"))).toBe(3600);
  privateFolder(undefined, false);
  expect(edgeTtl(await call("item", "647"))).toBe(3600);
});

test("a shard the index lists that is not there is a 503, not a card without its game file lines", async () => {
  privateFolder(undefined);
  expectUnavailable(await call("item", "647"));
});

test("a shard that is not a shard is a 503, not a card without its game file lines", async () => {
  for (const shard of [[shard0["9"]], "items", 7]) {
    privateFolder(shard);
    expectUnavailable(await call("item", "647"));
  }
});

test("a record for the item that is not a record is a 503, not a card without its game file lines", async () => {
  privateFolder({ "647": { n: 1 } });
  expectUnavailable(await call("item", "647"));
});
