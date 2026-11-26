import { beforeEach, expect, test, vi } from "vitest";

// The cards of the pages the game files list (achievements, factions, titles, quest chains, zones, dungeons and raids,
// item sets, mounts, companion pets, currencies, holidays and hunter pet families), with the ids the committed game
// data holds. Storage, the asset manifest and the private name files are mocked; the cards never read the corpus.
const mocks = vi.hoisted(() => ({ assets: vi.fn(), setNames: vi.fn(), spellNames: vi.fn(), stored: vi.fn(), completion: vi.fn(), corpus: vi.fn() }));
vi.mock("@/lib/game-assets", async (original) => ({
  ...await original<typeof import("@/lib/game-assets")>(), loadSiteAssets: mocks.assets, readItemSetNames: mocks.setNames, readSpellNames: mocks.spellNames,
}));
vi.mock("@/lib/aggregate-store", () => ({ loadStoredAggregates: mocks.stored }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: mocks.corpus, loadCompletion: mocks.completion } }));

import { emptyCompletion } from "@kb/completion-rollup";
import { edgeTtl } from "@/lib/cf-edge-cache";
import { PRIVATE_UNREACHABLE } from "@/lib/game-assets";
import { instanceRows } from "@/lib/instances";
import { publicZones } from "@/lib/zones";
import { GET } from "./route";

const call = (type: string, id: number | string, headers: Record<string, string> = {}) =>
  GET(new Request(`https://everloot.app/card/${type}/${id}`, { headers }), { params: Promise.resolve({ type, id: String(id) }) });
const icon = (n: number) => `https://assets.everloot.app/b/icons/${n}.webp`;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "https://assets.everloot.app/b");
  mocks.assets.mockReset().mockResolvedValue({
    version: "70450", label: "Found in game files, unconfirmed",
    spellIcons: new Map([[458, icon(458)]]), petIcons: new Map([[39, icon(39)]]), currencyIcons: new Map([[1792, icon(1792)]]), familyIcons: new Map([[1, icon(1)]]),
  });
  mocks.setNames.mockReset().mockResolvedValue({ version: "70450", names: new Map([[1, "Ironfeather Armor"]]) });
  mocks.spellNames.mockReset().mockResolvedValue({ version: "70450", names: new Map([[9331, "Increased Defense"]]) });
  mocks.stored.mockReset().mockResolvedValue({ dataAsOf: "2026-11-20T00:00:00.000Z", world: { npcs: [], quests: [], vendors: [] }, instances: { entrances: [], encounters: [] }, edges: [] });
  // A rollup that was read and holds no agreed entry: every game-file entry is unconfirmed.
  mocks.completion.mockReset().mockResolvedValue({ state: emptyCompletion(), dataAsOf: "2026-11-20T00:00:00.000Z" });
  mocks.corpus.mockReset().mockRejectedValue(new Error("cards must never read the corpus"));
});

const zone = publicZones()[0]!;
const instance = [...instanceRows().values()].find((r) => r.name && r.encounters.length)!;

// One card per new type: its type, id, the page's name, and what its box and facts say in short.
const CASES: [type: string, id: number, card: Record<string, unknown>][] = [
  ["achievement", 627, { title: "Explore Dun Morogh", icon: null, foot: "Found in game files, unconfirmed" }],
  ["faction", 21, { title: "Booty Bay", icon: null, foot: "Found in game files, unconfirmed" }],
  ["title", 144, { title: "Bloodsail Admiral <Name>", lines: ["Character title"], foot: "Found in game files, unconfirmed" }],
  ["chain", 5963, { title: "To Have Loved and Lost", lines: ["1 quest"], foot: "Found in game files, unconfirmed" }],
  ["zone", zone.mapId, { title: zone.name, icon: null }],
  ["instance", instance.instanceMapId, { title: instance.name, icon: null }],
  ["item-set", 1, { title: "Ironfeather Armor", icon: null, foot: "Found in game files, unconfirmed" }],
  ["mount", 6, { title: "Brown Horse", icon: icon(458), lines: ["Mount", "Requires Riding (75)"], foot: null }],
  ["pet", 39, { title: "Mechanical Squirrel", icon: icon(39), lines: ["Companion pet"], foot: "Found in game files, unconfirmed" }],
  ["currency", 1792, { title: "Honor Points", icon: icon(1792), foot: "Found in game files, unconfirmed" }],
  ["holiday", 62, { title: "Fireworks Spectacular", icon: null, foot: "Found in game files, unconfirmed" }],
  ["family", 1, { title: "Wolf", icon: icon(1), foot: "Found in game files, unconfirmed" }],
];

test.each(CASES)("a %s card is the page's name, art and a few facts, cached an hour and the same for a signed-in visitor", async (type, id, card) => {
  const res = await call(type, id);
  expect(res.status).toBe(200);
  expect(edgeTtl(res)).toBe(3600);
  expect(res.headers.get("x-robots-tag")).toBe("noindex");
  const body = await res.json();
  expect(body.card).toMatchObject({ type, id, quality: null, color: null, ...card });
  expect(body.card.lines.length).toBeGreaterThanOrEqual(1);
  expect(body.card.lines.length).toBeLessThanOrEqual(5);
  const signedIn = await call(type, id, { cookie: "better-auth.session_token=private", authorization: "Bearer private" });
  expect(await signedIn.json()).toEqual(body);
  expect(mocks.corpus).not.toHaveBeenCalled();
});

test("each card's lines say what its page's box and facts say", async () => {
  const lines = async (type: string, id: number) => (await (await call(type, id)).json()).card.lines;
  expect(await lines("achievement", 627)).toEqual(["Explore Dun Morogh, revealing the covered areas of the world map.", "0 points", expect.stringMatching(/^\d+ criteria$/)]);
  expect(await lines("faction", 21)).toEqual(["Steamwheedle Cartel"]);
  expect(await lines("zone", zone.mapId)).toEqual(expect.arrayContaining([`Zone in ${zone.continentName}`]));
  expect((await lines("instance", instance.instanceMapId))[1]).toBe(`${instance.encounters.length} ${instance.encounters.length === 1 ? "boss" : "bosses"} in the game files`);
  expect(await lines("item-set", 1)).toEqual(["6 pieces", "(2) Set: Spell 1301126", "(3) Set: Increased Defense", "(4) Set: Spell 1301123", "(5) Set: Spell 1314795"]);
  expect(await lines("currency", 1792)).toEqual(["Honor is gained by killing members of the opposite faction in PvP combat. You can use honor points to purchase special items.", "Maximum: 25,000", "Player vs. Player"]);
  expect(await lines("holiday", 62)).toEqual(["Every year on 4 July at 06:00", "Lasts 18 hours"]);
  expect(await lines("family", 1)).toEqual(["Hunter pet family", "16 spells on its skill line"]);
});

test.each([
  ["achievement", 999999], ["faction", 999999], ["title", 999999], ["chain", 999999], ["zone", 999999], ["instance", 999999],
  ["item-set", 999999], ["mount", 999999], ["pet", 999999], ["currency", 999999], ["holiday", 999999], ["family", 999999],
])("an id no %s page shows is a 404, never edge cached", async (type, id) => {
  const res = await call(type, id);
  expect(res.status).toBe(404);
  expect(edgeTtl(res)).toBeNull();
});

test.each([
  ["achievement", "the completion rollup", () => mocks.completion.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true })],
  ["faction", "a thrown completion read", () => mocks.completion.mockRejectedValue(new Error("down"))],
  ["instance", "the stored view", () => mocks.stored.mockResolvedValue(null)],
  ["item-set", "the set names", () => mocks.setNames.mockResolvedValue(PRIVATE_UNREACHABLE)],
  ["item-set", "the bonus spell names", () => mocks.spellNames.mockResolvedValue(PRIVATE_UNREACHABLE)],
  ["mount", "the asset manifest", () => mocks.assets.mockResolvedValue(null)],
  ["currency", "a thrown asset manifest", () => mocks.assets.mockRejectedValue(new Error("down"))],
])("a %s card whose read of %s failed is a 503 nobody keeps", async (type, _read, fail) => {
  fail();
  const id = { achievement: 627, faction: 21, instance: instance.instanceMapId, "item-set": 1, mount: 6, currency: 1792 }[type]!;
  const res = await call(type, id);
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(edgeTtl(res)).toBeNull();
});

test("an item set the names file does not name keeps its id, as its page does", async () => {
  mocks.setNames.mockResolvedValue(null);
  expect((await (await call("item-set", 1)).json()).card.title).toBe("Item set 1");
});
