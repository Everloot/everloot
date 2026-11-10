import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assets: vi.fn(), names: vi.fn(), stored: vi.fn(), corpus: vi.fn(), talents: vi.fn() }));
vi.mock("@/lib/game-assets", async (original) => ({ ...await original<typeof import("@/lib/game-assets")>(), loadSiteAssets: mocks.assets, readSpellNames: mocks.names }));
vi.mock("@/lib/aggregate-store", () => ({ loadStoredAggregates: mocks.stored }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: mocks.corpus } }));

vi.mock("@/lib/talents/spell-talents", () => ({ loadSpellTalents: mocks.talents }));

import { PRIVATE_MALFORMED, PRIVATE_UNREACHABLE } from "@/lib/game-assets";
import { edgeTtl } from "@/lib/cf-edge-cache";
import { GET } from "./route";

const call = (type: string, id = "10") => GET(new Request(`https://everloot.app/database/card/${type}/${id}`), { params: Promise.resolve({ type, id }) });
const three = (make: (installId: string) => object) => ["a", "b", "c"].map(make);
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "https://assets.everloot.app/b");
  mocks.assets.mockReset().mockResolvedValue({ version: "70450", label: "Found in game files, unconfirmed", spellTips: new Map([[10, { name: "Blizzard", text: "Deals [?] damage.", partial: true }]]), spellIcons: new Map([[10, "https://assets.everloot.app/b/icons/10.webp"]]) });
  mocks.names.mockReset().mockResolvedValue({ version: "70450", names: new Map([[10, "Blizzard"]]) });
  mocks.talents.mockReset().mockResolvedValue(new Map());
  mocks.stored.mockReset().mockResolvedValue({ edges: [], world: {
    npcs: three((installId) => ({ installId, npcId: 10, name: "Vendor", positionKind: "npc", mapId: 1429, x: 40, y: 50 })),
    quests: [], vendors: three((installId) => ({ installId, vendorNpcId: 10, itemId: 5, priceCopper: 100 })),
  } });
  mocks.corpus.mockReset().mockRejectedValue(new Error("cards must never read the corpus"));
});

test.each(["spell", "vendor"])("a complete %s card is cached and identical with visitor credentials", async (type) => {
  const res = await call(type);
  expect(res.status).toBe(200);
  expect(edgeTtl(res)).toBe(3600);
  expect(res.headers.get("cdn-cache-control")).toBe("max-age=3600");
  const body = await res.json();
  const signedIn = await GET(new Request(`https://everloot.app/database/card/${type}/10`, { headers: { cookie: "session=private", authorization: "Bearer private" } }), { params: Promise.resolve({ type, id: "10" }) });
  expect(await signedIn.json()).toEqual(body);
  expect(mocks.corpus).not.toHaveBeenCalled();
  if (type === "spell") expect(body.card).toMatchObject({ type, title: "Blizzard", icon: "https://assets.everloot.app/b/icons/10.webp", lines: ["Deals [?] damage."], foot: "Found in game files, unconfirmed · build 70450" });
  else {
    expect(body.card).toMatchObject({ type, title: "Vendor", lines: ["Seen on 1 map, agreed by 3 or more installs.", "1 price, agreed by 3 or more installs."] });
    expect(mocks.stored).toHaveBeenCalledWith({ strict: true });
  }
});

test.each(["spell", "vendor"])("an unknown %s id is a 404, never edge cached", async (type) => {
  const res = await call(type, "999");
  expect(res.status).toBe(404);
  expect(edgeTtl(res)).toBeNull();
});

test.each(["manifest", "names", "malformed names", "thrown manifest", "thrown names", "stored view", "thrown view"])("an unreadable %s is 503 no-store", async (path) => {
  let type = "spell";
  if (path === "manifest") mocks.assets.mockResolvedValue(null);
  if (path === "names") mocks.names.mockResolvedValue(PRIVATE_UNREACHABLE);
  if (path === "malformed names") mocks.names.mockResolvedValue(PRIVATE_MALFORMED);
  if (path === "thrown manifest") mocks.assets.mockRejectedValue(new Error("down"));
  if (path === "thrown names") mocks.names.mockRejectedValue(new Error("down"));
  if (path === "stored view") { type = "vendor"; mocks.stored.mockResolvedValue(null); }
  if (path === "thrown view") { type = "vendor"; mocks.stored.mockRejectedValue(new Error("down")); }
  const res = await call(type);
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("cdn-cache-control")).toBe("no-store");
  expect(edgeTtl(res)).toBeNull();
  expect(mocks.corpus).not.toHaveBeenCalled();
});

test("an unnamed vendor has a card with agreed goods", async () => {
  const set = await mocks.stored();
  set.world.npcs = [];
  const res = await call("vendor");
  expect(res.status).toBe(200);
  expect((await res.json()).card.title).toBe("Vendor NPC 10");
});

test("goods without three agreeing installs never increase the vendor count", async () => {
  const set = await mocks.stored();
  set.world.vendors.push({ installId: "a", vendorNpcId: 10, itemId: 6, priceCopper: 200 });
  expect((await (await call("vendor")).json()).card.lines.at(-1)).toBe("1 price, agreed by 3 or more installs.");
});

test("a named NPC without vendor rows has no vendor card", async () => {
  (await mocks.stored()).world.vendors = [];
  expect((await call("vendor")).status).toBe(404);
});

test("an absent spell names file falls back to the tooltip name", async () => {
  mocks.names.mockResolvedValue(null);
  const res = await call("spell");
  expect(res.status).toBe(200);
  expect((await res.json()).card.title).toBe("Blizzard");
});

test.each(["from", "to", "talent"])("a spell with only a %s relation or talent has a card", async (source) => {
  const assets = await mocks.assets();
  assets.spellTips.clear();
  (await mocks.names()).names.clear();
  if (source === "talent") (await mocks.talents()).set(10, [{}]);
  else (await mocks.stored()).edges.push(source === "from"
    ? { fromKind: "spell", fromId: 10, toKind: "skill", toId: 1 }
    : { fromKind: "item", fromId: 1, toKind: "spell", toId: 10 });
  const res = await call("spell");
  expect(res.status).toBe(200);
  expect((await res.json()).card.title).toBe("Spell 10");
  expect(mocks.corpus).not.toHaveBeenCalled();
});

test("only positions with a map link count on the vendor card", async () => {
  (await mocks.stored()).world.npcs.push(...three((installId) => ({ installId, npcId: 10, name: "Vendor", positionKind: "npc", mapId: 999999, x: 40, y: 50 })));
  expect((await (await call("vendor")).json()).card.lines[0]).toBe("Seen on 1 map, agreed by 3 or more installs.");
});

test("unread spell relations cannot produce a cached card", async () => {
  mocks.stored.mockResolvedValue(null);
  const res = await call("spell");
  expect(res.status).toBe(503);
  expect(edgeTtl(res)).toBeNull();
});

test("without a spell names catalog an otherwise unknown spell is not ruled out", async () => {
  mocks.names.mockResolvedValue(null);
  const res = await call("spell", "999");
  expect(res.status).toBe(200);
  expect((await res.json()).card.title).toBe("Spell 999");
});
