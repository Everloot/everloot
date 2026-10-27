import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";

const mocks = vi.hoisted(() => ({
  names: { items: new Map<number, string>(), npcs: new Map<number, string>(), objects: new Map<number, string>(), quests: new Map<number, string>() },
  objects: { rates: [] as unknown[], measuredZeros: [] as unknown[], names: [] as unknown[], unreachable: false },
}));
vi.mock("@/lib/names", () => ({ loadNames: async () => mocks.names }));
vi.mock("@/lib/objects", () => ({ loadObjectFacts: async () => mocks.objects }));

let release = "";
beforeAll(async () => { release = await buildLoreRelease(); });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  mocks.names = { items: new Map(), npcs: new Map(), objects: new Map(), quests: new Map() };
  mocks.objects = { rates: [], measuredZeros: [], names: [], unreachable: false };
});

async function search(q: string, path = release) {
  vi.stubEnv("KB_SNAPSHOT_PATH", path);
  const { siteSearch } = await import("./site-search");
  return siteSearch(q);
}

test("an empty query finds nothing", async () => {
  expect(await search("   ")).toEqual([]);
});

test("items, NPCs and quests are grouped by type, exact name first, then prefix, then contains", async () => {
  mocks.names.items = new Map([[1, "Thrall's Cloak"], [2, "Thrall"], [3, "Old Thrall"]]);
  mocks.names.npcs = new Map([[77, "Thrall"]]);
  mocks.names.quests = new Map([[5, "Thrall's Return"]]);
  const groups = await search("thrall");
  const types = groups.map((g) => g.type);
  expect(types).toContain("item");
  expect(types).toContain("npc");
  expect(types).toContain("quest");
  const items = groups.find((g) => g.type === "item")!.results;
  expect(items.map((r) => r.label)).toEqual(["Thrall", "Thrall's Cloak", "Old Thrall"]);
  expect(items[0]).toMatchObject({ href: "/database/items/2", exact: true });
  expect(items[1].exact).toBe(false);
  expect(groups.find((g) => g.type === "npc")!.results[0].href).toBe("/database/npcs/77");
});

test("a group with an exact match moves above one with only partial matches", async () => {
  mocks.names.items = new Map([[1, "Thrall's Cloak"]]);
  mocks.names.npcs = new Map([[77, "Thrall"]]);
  const types = (await search("thrall")).map((g) => g.type);
  expect(types.indexOf("npc")).toBeLessThan(types.indexOf("item"));
});

test("an id opens the item, NPC and quest with that id first, named when a name is agreed", async () => {
  mocks.names.items = new Map([[6948, "Hearthstone"]]);
  const groups = await search("6948");
  expect(groups.find((g) => g.type === "item")!.results[0]).toMatchObject({ label: "Hearthstone", href: "/database/items/6948", exact: true });
  expect(groups.find((g) => g.type === "npc")!.results[0]).toMatchObject({ label: "NPC 6948", href: "/database/npcs/6948" });
  expect(groups.find((g) => g.type === "quest")!.results[0]).toMatchObject({ label: "Quest 6948", href: "/database/quests/6948" });
  expect((await search("#6948")).find((g) => g.type === "item")!.results[0].href).toBe("/database/items/6948");
  // Not an id: leading zero, a decimal, or too long.
  for (const q of ["06948", "69.48", "1234567890"]) {
    expect((await search(q)).find((g) => g.type === "npc")).toBeUndefined();
  }
});

test("an object is found by id, and only when it has public loot observations", async () => {
  mocks.objects.rates = [{ sourceObjectId: 55, itemId: 9, kills: 10, drops: 3, rate: 0.3, reporters: 3, public: true }];
  expect((await search("55")).find((g) => g.type === "object")!.results[0]).toMatchObject({ href: "/database/objects/55", exact: true });
  mocks.names.objects = new Map([[55, "Copper Vein"]]);
  expect((await search("55")).find((g) => g.type === "object")!.results[0]).toMatchObject({ label: "Copper Vein" });
  mocks.names.objects = new Map();
  expect((await search("56")).find((g) => g.type === "object")).toBeUndefined();
  mocks.objects.unreachable = true;
  expect((await search("55")).find((g) => g.type === "object")).toBeUndefined();
});

test("zones are the released ones, linking to the map", async () => {
  const zones = (await search("elwynn")).find((g) => g.type === "zone")!.results;
  expect(zones[0]).toMatchObject({ label: "Elwynn Forest", href: "/database/zones/1429-elwynn-forest", exact: false });
  expect((await search("Elwynn Forest")).find((g) => g.type === "zone")!.results[0].exact).toBe(true);
});

test("lore pages come with their lore link, and tools by title or keyword", async () => {
  const groups = await search("thrall");
  expect(groups.find((g) => g.type === "lore")!.results[0]).toMatchObject({ label: "Thrall", href: "/lore/1-thrall", exact: true });
  const tools = (await search("talent")).find((g) => g.type === "tool")!.results;
  expect(tools[0]).toMatchObject({ label: "Talent Calculator", href: "/tools/talents" });
  expect((await search("raid planner")).find((g) => g.type === "tool")!.results[0].href).toBe("/tools/raid");
});

test("a question that names a class leads with that class's page", async () => {
  // Found live: "whats the best racial class for warlock on horde" found nothing, and /classes/warlock answers it.
  const groups = await search("whats the best racial class for warlock on horde");
  expect(groups[0]).toMatchObject({ type: "class", heading: "Classes" });
  expect(groups[0].results).toEqual([expect.objectContaining({ label: "Warlock", href: "/classes/warlock", exact: false })]);
  expect((await search("Warlocks")).find((g) => g.type === "class")!.results[0]).toMatchObject({ href: "/classes/warlock", exact: true });
  expect((await search("thrall")).some((g) => g.type === "class")).toBe(false);
  // A class named in passing does not lead an exact item.
  mocks.names.items = new Map([[1, "Hunter's Mark"]]);
  expect((await search("hunter's mark")).map((g) => g.type).slice(0, 2)).toEqual(["item", "class"]);
});

test("when no lore page has every word, the lore archive lists pages with some of them and says so", async () => {
  const lore = (await search("best warchief horde guide")).find((g) => g.type === "lore")!;
  expect(lore.heading).toBe("Lore archive, some of your words");
  expect(lore.results[0]).toMatchObject({ label: "Thrall", href: "/lore/1-thrall", exact: false });
  expect((await search("thrall")).find((g) => g.type === "lore")!.heading).toBe("Lore archive");
});

test("the Warcraft Wiki copies never move above Everloot's own pages, even on an exact name", async () => {
  mocks.names.items = new Map([[19019, "Thrall's Cloak"]]);
  const types = (await search("thrall")).map((g) => g.type);
  expect(types.indexOf("item")).toBeLessThan(types.indexOf("lore"));
});

test("game entries lead: an item named like a lore page comes first, and the lore archive after every database group", async () => {
  mocks.names.items = new Map([[19019, "Thrall"]]);
  const types = (await search("thrall")).map((g) => g.type);
  expect(types[0]).toBe("item");
  expect(types.indexOf("lore")).toBeGreaterThan(types.indexOf("item"));
  const database = types.filter((t) => ["item", "npc", "quest", "object", "zone", "achievement", "faction", "title", "chain"].includes(t));
  for (const t of database) expect(types.indexOf(t), t).toBeLessThan(types.indexOf("lore"));
});

test("an exact game entry leads an exact tool; a game entry that only contains the words still beats the lore archive", async () => {
  mocks.names.items = new Map([[1, "Talent Calculator"]]);
  const exact = (await search("talent calculator")).map((g) => g.type);
  expect(exact.indexOf("item")).toBeLessThan(exact.indexOf("tool"));
  mocks.names.items = new Map([[2, "Elwynn Forest Map"]]);
  const zone = (await search("elwynn forest")).map((g) => g.type);
  // The zone is an exact game entry, the item a prefix one; both come before any lore copy.
  expect(zone.slice(0, 2)).toEqual(["zone", "item"]);
});

test("without a lore release the other groups still answer", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.names.npcs = new Map([[77, "Thrall"]]);
  const groups = await search("thrall", "C:/missing/release.sqlite");
  expect(groups.map((g) => g.type)).toEqual(["npc"]);
});

test("a name nobody matches gives no groups", async () => {
  expect(await search("qqqqzzzz")).toEqual([]);
});

test("a group counts every match, lists 8, and a scoped search keeps one type with more rows", async () => {
  mocks.names.items = new Map(Array.from({ length: 12 }, (_, i) => [100 + i, `Linen thing ${i}`]));
  mocks.names.npcs = new Map([[7, "Linen merchant"]]);
  const all = await search("linen");
  const items = all.find((g) => g.type === "item")!;
  expect(items.total).toBe(12);
  expect(items.results).toHaveLength(8);
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  const { siteSearch } = await import("./site-search");
  const scoped = await siteSearch("linen", { only: "item", limit: 50 });
  expect(scoped.map((g) => g.type)).toEqual(["item"]);
  expect(scoped[0].results).toHaveLength(12);
});

test("item results carry the game files' quality and type, for colouring the name", async () => {
  const groups = await search("2589");
  expect(groups.find((g) => g.type === "item")!.results[0]).toMatchObject({ label: "Item 2589", id: 2589, quality: 1, meta: expect.stringContaining("Cloth") });
});

test("suggestions: an exact id first, then exact, prefix and contains names across types, at most 8, names players agree on only", async () => {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  const { suggest } = await import("./site-search");
  mocks.names.items = new Map([[1, "Thrall's Cloak"], [2, "Thrall"], ...Array.from({ length: 10 }, (_, i) => [200 + i, `Old Thrall ${i}`] as [number, string])]);
  mocks.names.npcs = new Map([[77, "Thrall"]]);
  const rows = await suggest("thrall");
  expect(rows).toHaveLength(8);
  expect(rows.slice(0, 3).map((r) => [r.type, r.label])).toEqual([["item", "Thrall"], ["npc", "Thrall"], ["item", "Thrall's Cloak"]]);
  expect((await suggest("thrall", "npc")).map((r) => r.href)).toEqual(["/database/npcs/77"]);
  const byId = await suggest("2589", "item");
  expect(byId[0]).toEqual({ type: "item", id: 2589, label: "Item 2589", href: "/database/items/2589", quality: 1 });
  expect(await suggest("  ")).toEqual([]);
});
