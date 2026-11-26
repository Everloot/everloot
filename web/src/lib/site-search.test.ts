import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";

const mocks = vi.hoisted(() => ({
  names: { items: new Map<number, string>(), npcs: new Map<number, string>(), objects: new Map<number, string>(), quests: new Map<number, string>() },
  catalog: null as unknown,
  objects: { rates: [] as unknown[], measuredZeros: [] as unknown[], names: [] as unknown[], unreachable: false },
}));
vi.mock("@/lib/names", () => ({ loadNames: async () => mocks.names }));
vi.mock("@/lib/objects", () => ({ loadObjectFacts: async () => mocks.objects }));

vi.mock("./completion-lists", async (original) => ({ ...(await original<typeof import("./completion-lists")>()), loadCatalog: async () => mocks.catalog }));
let release = "";
beforeAll(async () => { release = await buildLoreRelease(); });
afterEach(() => {
  mocks.catalog = null;
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

test("tools use their current names and leave device-only lists and hidden tools out of search", async () => {
  for (const [q, href] of [["Guild board", "/tools/guild-board"], ["Legacy perks", "/tools/legacy"]]) {
    const results = (await search(q)).find((g) => g.type === "tool")!.results;
    expect(results).toContainEqual(expect.objectContaining({ label: q, href }));
  }
  // Hidden until polished: Farming, Collections and Upload.
  for (const q of ["Plans on this device", "Alts on this device", "Collections", "Forever Farming", "Upload Addon Data"]) {
    expect((await search(q)).find((g) => g.type === "tool")).toBeUndefined();
  }
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

test("objects match agreed names in exact, prefix and substring order in search and suggestions", async () => {
  mocks.names.objects = new Map([[1, "Old Copper Vein"], [2, "Copper Vein Rich"], [3, "Copper Vein"], [4, "Copper Vein Hidden"]]);
  mocks.objects.rates = [1, 2, 3, 4].map((sourceObjectId) => ({ sourceObjectId, itemId: 9, kills: 10, drops: 3, rate: 0.3, reporters: sourceObjectId === 4 ? 2 : 3, public: sourceObjectId !== 4 }));
  const { siteSearch, suggest } = await import("./site-search");
  const group = (await siteSearch("  COPPER VEIN  ", { only: "object", limit: 2 }))[0];
  expect(group).toMatchObject({ type: "object", total: 3 });
  expect(group.results.map((r) => [r.id, r.exact])).toEqual([[3, true], [2, false]]);
  expect((await search("vein")).find((g) => g.type === "object")?.total).toBe(3);
  expect((await suggest("copper vein", "object")).map((r) => r.id)).toEqual([3, 2, 1]);
  expect((await suggest("copper vein")).filter((r) => r.type === "object").map((r) => r.id)).toEqual([3, 2, 1]);
  expect(await suggest("#3", "object")).toEqual([{ type: "object", id: 3, label: "Copper Vein", href: "/database/objects/3" }]);
  expect(await suggest("#4", "object")).toEqual([]);
  mocks.objects.unreachable = true;
  expect(await siteSearch("copper", { only: "object" })).toEqual([]);
  expect(await suggest("copper", "object")).toEqual([]);
});

test("the unscoped type-ahead suggests a zone by its name, says it is one, and a scoped box does not", async () => {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  const { suggest } = await import("./site-search");
  mocks.names.items = new Map([[7, "Westfall Stew"]]);
  mocks.names.quests = new Map([[8, "The Westfall Brigade"]]);
  const rows = await suggest("westfall");
  // The exact zone name leads; prefix and contains names follow.
  expect(rows[0]).toEqual({ type: "zone", id: expect.any(Number), label: "Westfall", href: expect.stringMatching(/^\/database\/zones\/\d+-westfall$/), note: "Zone" });
  expect(rows.map((r) => r.label)).toEqual(["Westfall", "Westfall Stew", "The Westfall Brigade"]);
  expect((await suggest("westfall", "item")).some((r) => r.type === "zone")).toBe(false);
  // The same zone page /search lists.
  expect((await search("westfall")).find((g) => g.type === "zone")!.results[0].href).toBe(rows[0].href);
});

test("a name map's sorted rows are built once per map, and a new map gets new rows", async () => {
  const { sortedNames } = await import("./site-search");
  const names = new Map([[2, "beta"], [1, "Alpha"]]);
  const rows = sortedNames(names);
  expect(rows.map((r) => r.id)).toEqual([1, 2]);
  expect(sortedNames(names)).toBe(rows);
  expect(sortedNames(new Map(names))).not.toBe(rows);
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

test("the lore archive comes after every other group, tools and docs included", async () => {
  // "quest" finds a lore page, a tool and a docs page.
  const types = (await search("quest")).map((g) => g.type);
  expect(types).toEqual(expect.arrayContaining(["tool", "doc", "lore"]));
  expect(types.at(-1)).toBe("lore");
});

test("when the words name something in Forever, lore pages about later expansions are left out; otherwise they stay", async () => {
  // Fixture lore rows "Zone N" are in Legion or Battle for Azeroth categories only.
  const alone = (await search("grommash")).find((g) => g.type === "lore");
  expect(alone?.total).toBeGreaterThan(0);
  mocks.names.npcs = new Map([[3000, "Grommash"]]);
  const groups = await search("grommash");
  expect(groups[0].type).toBe("npc");
  expect(groups.find((g) => g.type === "lore")).toBeUndefined();
  // A page with no expansion category (Thrall) stays beside a Forever match.
  mocks.names.npcs = new Map([[4000, "Thrall"]]);
  expect((await search("thrall")).find((g) => g.type === "lore")!.results[0]).toMatchObject({ label: "Thrall" });
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

test("words match in any order: the whole name, then every word at a word start, then every word anywhere", async () => {
  mocks.names.items = new Map([[1, "Linen Cloth"], [2, "Bolt of Linen Cloth"], [3, "Clothlinen Scrap"], [4, "Linen Cap"]]);
  const items = (q: string) => search(q).then((g) => g.find((x) => x.type === "item")?.results.map((r) => r.label));
  // Same rank, name order; "linen" inside "Clothlinen" starts no word, so that one comes last.
  expect(await items("cloth linen")).toEqual(["Bolt of Linen Cloth", "Linen Cloth", "Clothlinen Scrap"]);
  expect(await items("linen cloth")).toEqual(["Linen Cloth", "Bolt of Linen Cloth", "Clothlinen Scrap"]);
  expect(await items("lin clo")).toEqual(["Bolt of Linen Cloth", "Linen Cloth", "Clothlinen Scrap"]);
  // One word ranks as before: prefix, then contains, in name order.
  expect(await items("linen")).toEqual(["Linen Cap", "Linen Cloth", "Bolt of Linen Cloth", "Clothlinen Scrap"]);
  const { suggest } = await import("./site-search");
  expect((await suggest("cloth linen", "item", undefined, { tolerant: true })).map((r) => r.id)).toEqual([2, 1, 3]);
});

test("a typo finds the name when nothing matches as typed, and says how it read the query", async () => {
  mocks.names.items = new Map([[1, "Linen Cloth"], [2, "Wool Cloth"]]);
  mocks.names.npcs = new Map([[77, "Hoggrin"], [78, "Hoggrin's Pup"]]);
  const groups = await search("lnen clth");
  expect(groups.find((g) => g.type === "item")!.results.map((r) => [r.label, r.exact])).toEqual([["Linen Cloth", false]]);
  expect(groups[0].respelled).toBe("linen cloth");
  const npcs = (await search("hogrin")).find((g) => g.type === "npc")!;
  expect(npcs.results.map((r) => r.href)).toEqual(["/database/npcs/77", "/database/npcs/78"]);
  expect(npcs.respelled).toBe("hoggrin");
  const { suggest } = await import("./site-search");
  expect((await suggest("lnen clth", undefined, undefined, { tolerant: true })).map((r) => r.label)).toEqual(["Linen Cloth"]);
  expect((await suggest("hogrin", "npc", undefined, { tolerant: true })).map((r) => r.id)).toEqual([77, 78]);
});

test("a query with a hit never reads typos, and an id or a short word never does", async () => {
  mocks.names.items = new Map([[1, "Linen Cloth"], [2, "Linen Clot"]]);
  const groups = await search("linen clot");
  expect(groups.find((g) => g.type === "item")!.results.map((r) => r.label)).toEqual(["Linen Clot", "Linen Cloth"]);
  expect(groups.some((g) => g.respelled)).toBe(false);
  mocks.names.items = new Map([[1, "Linen Cloth"]]);
  expect((await search("clth")).some((g) => g.type === "item")).toBe(true);
  // Three letters are typed right or not at all.
  expect((await search("clo linnen")).find((g) => g.type === "item")?.results.map((r) => r.label)).toEqual(["Linen Cloth"]);
  expect((await search("clx")).find((g) => g.type === "item")).toBeUndefined();
  expect((await search("12345")).find((g) => g.type === "item")!.results.map((r) => r.label)).toEqual(["Item 12345"]);
});

test("the public suggestions keep matching the text as one phrase: no word order, no typos", async () => {
  mocks.names.items = new Map([[1, "Linen Cloth"]]);
  const { suggest } = await import("./site-search");
  expect(await suggest("cloth linen", "item")).toEqual([]);
  expect(await suggest("lnen clth", "item")).toEqual([]);
  expect((await suggest("linen cl", "item")).map((r) => r.id)).toEqual([1]);
});

test("the typo matcher's length pruning never drops a word one or two edits away", async () => {
  const { byTypo, editDistance } = await import("./site-search");
  // The full table, no bounds: what the pruned, early-exit version must agree with.
  const full = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
    return d[a.length]![b.length]!;
  };
  let seed = 7;
  const next = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const letters = "abcdeilnorst";
  const word = (len: number) => Array.from({ length: len }, () => letters[next(letters.length)]).join("");
  const edit = (w: string) => {
    const i = next(w.length), c = letters[next(letters.length)];
    switch (next(4)) {
      case 0: return w.slice(0, i) + w.slice(i + 1);
      case 1: return w.slice(0, i) + c + w.slice(i);
      case 2: return w.slice(0, i) + c + w.slice(i + 1);
      default: return i + 1 < w.length ? w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2) : w + c;
    }
  };
  for (let n = 0; n < 3000; n++) {
    const a = word(3 + next(8)), b = next(3) ? edit(next(2) ? a : edit(a)) : word(3 + next(8));
    const exact = full(a, b);
    for (const max of [1, 2]) expect(editDistance(a, b, max), `${a} ${b} ${max}`).toBe(Math.min(exact, max + 1));
    // As a one-word query against a two-word name: matched exactly when the full table allows it.
    const match = byTypo(a);
    if (!match) continue;
    const allowed = a.length >= 8 ? 2 : 1;
    const name = `zz ${b}`;
    const r = match(name);
    if (name.includes(a)) expect(r).toBe(5);
    else expect(r, `${a} ${b}`).toBe(exact <= allowed ? 5 + exact : null);
  }
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

test("Everloot's own published wiki pages are found by title, with or without the leading The, and sit above the lore archive", async () => {
  const groups = await search("deadmines");
  const guides = groups.find((g) => g.type === "guide")!;
  // Labelled for where they live: /guides is the reviewed class guides, a different page.
  expect(guides.heading).toBe("Wiki");
  expect(guides.results[0]).toMatchObject({ label: "The Deadmines", href: "/wiki/deadmines", exact: true });
  expect(guides.results[0].note).toContain("Defias");
  const types = groups.map((g) => g.type);
  if (types.includes("lore")) expect(types.indexOf("guide")).toBeLessThan(types.indexOf("lore"));
  // A draft page is not on the site, so it is not in the search either.
  expect((await search("alcaz")).find((g) => g.type === "guide")).toBeUndefined();
});

test("a dungeon's name finds its instance page first, with or without the leading The", async () => {
  for (const q of ["deadmines", "The Deadmines"]) {
    const groups = await search(q);
    expect(groups[0]).toMatchObject({ type: "instance", heading: "Dungeons and raids" });
    expect(groups[0].results[0]).toMatchObject({ label: "Deadmines", href: "/database/instances/36-deadmines", note: "Dungeon, level 16", exact: true });
  }
  // A partial name still finds it, after the exact hits.
  const part = (await search("deadm")).find((g) => g.type === "instance")!;
  expect(part.results.map((r) => r.href)).toEqual(["/database/instances/36-deadmines"]);
});

test("suggestions: a dungeon's name, part of it or with the leading The, suggests its instance page near the top", async () => {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  const { suggest } = await import("./site-search");
  mocks.names.items = new Map([[5, "Deadmines Map"], [6, "Old Deadmines Key"]]);
  for (const q of ["deadm", "the deadmines", "Deadmines"]) {
    const rows = await suggest(q);
    expect(rows.find((r) => r.type === "instance"), q).toEqual({ type: "instance", id: 36, label: "Deadmines", href: "/database/instances/36-deadmines", note: "Dungeon, level 16" });
  }
  // Ranked with the other names: a prefix item sits beside it, a contains-only item after; an exact name leads.
  expect((await suggest("deadm")).map((r) => r.label)).toEqual(["Deadmines Map", "Deadmines", "Old Deadmines Key"]);
  expect((await suggest("deadmines"))[0]).toMatchObject({ type: "instance" });
  // A scoped box keeps to its database type.
  expect((await suggest("deadm", "item")).some((r) => r.type === "instance")).toBe(false);
});


test.each([
  ["achievement", "achievements", "achievementId"], ["faction", "factions", "factionId"],
  ["title", "titles", "titleId"], ["chain", "chains", "questLineId"],
] as const)("nine %s matches keep exact order and scoped pages reach the ninth", async (type, collection, key) => {
  mocks.catalog = { achievements: [], factions: [], titles: [], chains: [], [collection]: Array.from({ length: 9 }, (_, i) => ({ [key]: i + 1, name: i === 8 ? "Trial & Test" : `Trial & Test ${i}` })) };
  const { siteSearch } = await import("./site-search");
  const overview = (await siteSearch("Trial & Test")).find((g) => g.type === type)!;
  expect(overview.total).toBe(9);
  expect(overview.results).toHaveLength(8);
  expect(overview.results[0].label).toBe("Trial & Test");
  const first = await siteSearch("Trial & Test", { only: type, limit: 8, page: 1 });
  const next = await siteSearch("Trial & Test", { only: type, limit: 8, page: 2 });
  expect(first.map((g) => g.type)).toEqual([type]);
  expect(next[0].results.map((r) => r.label)).toEqual(["Trial & Test 7"]);
  expect((await siteSearch("Trial & Test", { only: type, limit: 8, page: 1e100 }))[0]).toMatchObject({ page: 2 });
  expect((await siteSearch("Trial & Test", { only: type, limit: 0, page: -5 }))[0].results).toHaveLength(1);
});

test.each(["zone", "instance"] as const)("all %s matches remain reachable with the same search semantics", async (only) => {
  const { siteSearch } = await import("./site-search");
  const overview = (await siteSearch("a")).find((g) => g.type === only)!;
  expect(overview.total).toBeGreaterThan(8);
  expect(overview.results).toHaveLength(8);
  const hits = [];
  for (let page = 1; page <= Math.ceil(overview.total / 8); page++) {
    const groups = await siteSearch("a", { only, page, limit: 8 });
    expect(groups.map((g) => g.type)).toEqual([only]);
    hits.push(...groups[0].results);
  }
  expect(hits).toHaveLength(overview.total);
  expect(new Set(hits.map((r) => r.href)).size).toBe(overview.total);
  expect(hits.slice(0, 8)).toEqual(overview.results);
  const bounded = (await siteSearch("a", { only, limit: 1e9 }))[0];
  expect(bounded.results.length).toBeLessThanOrEqual(50);
});

test("spells are found by the names the spell list shows, passed in by the page, exact id first", async () => {
  const { siteSearch } = await import("./site-search");
  const spells = new Map([[133, "Fireball"], [143, "Fireball"], [2136, "Fire Blast"], [10, "Blizzard"]]);
  const group = (await siteSearch("fireball", { spells })).find((g) => g.type === "spell")!;
  expect(group.heading).toBe("Spells");
  expect(group.results.map((r) => [r.label, r.href, r.exact])).toEqual([["Fireball", "/database/spells/133", true], ["Fireball", "/database/spells/143", true]]);
  expect((await siteSearch("2136", { spells })).find((g) => g.type === "spell")!.results[0]).toMatchObject({ label: "Fire Blast", href: "/database/spells/2136", exact: true });
  // No names passed (the API's callers): no spell group.
  expect((await siteSearch("fireball")).find((g) => g.type === "spell")).toBeUndefined();
});

test("vendors are found by the NPC names the vendor list shows, among the vendors it lists only", async () => {
  mocks.names.npcs = new Map([[10, "Gina MacGregor"], [11, "Gina's Brother"], [12, "Gina Lang"]]);
  const { siteSearch } = await import("./site-search");
  const vendors = new Set([10, 12, 99]);
  const group = (await siteSearch("gina", { vendors })).find((g) => g.type === "vendor")!;
  expect(group.heading).toBe("Vendors");
  expect(group.results.map((r) => [r.label, r.href])).toEqual([["Gina Lang", "/database/vendors/12"], ["Gina MacGregor", "/database/vendors/10"]]);
  // An unnamed vendor is found by its id, under the vendor list's label.
  expect((await siteSearch("99", { vendors })).find((g) => g.type === "vendor")!.results[0]).toMatchObject({ label: "Vendor NPC 99", href: "/database/vendors/99", exact: true });
  // A promise that settles to no ids (the stored names file without the list) gives no group.
  expect((await siteSearch("gina", { vendors: Promise.resolve(undefined) })).find((g) => g.type === "vendor")).toBeUndefined();
});

test("item sets are found by the set names the set pages show, and any set the game files list by its id", async () => {
  const { siteSearch } = await import("./site-search");
  const itemSets = new Map([[1, "Ironfeather Armor"], [41, "Dal'Rend's Arms"]]);
  const group = (await siteSearch("ironfeather", { itemSets })).find((g) => g.type === "item-set")!;
  expect(group.heading).toBe("Item sets");
  expect(group.results).toEqual([{ label: "Ironfeather Armor", href: "/database/item-sets/1", note: "id 1", exact: false, id: 1 }]);
  expect((await siteSearch("1", { itemSets: new Map() })).find((g) => g.type === "item-set")!.results[0]).toMatchObject({ label: "Item set 1", href: "/database/item-sets/1", exact: true });
});

test.each(["spell", "vendor", "item-set"] as const)("a search scoped to %s pages through its matches", async (only) => {
  mocks.names.npcs = new Map(Array.from({ length: 9 }, (_, i) => [i + 1, `Trial ${i}`]));
  const names = new Map(Array.from({ length: 9 }, (_, i) => [i + 1, `Trial ${i}`]));
  const { siteSearch, isResultScope } = await import("./site-search");
  expect(isResultScope(only)).toBe(true);
  const opts = { spells: names, itemSets: names, vendors: new Set(names.keys()) };
  const first = await siteSearch("trial", { ...opts, only, page: 1, limit: 8 });
  const next = await siteSearch("trial", { ...opts, only, page: 2, limit: 8 });
  expect(first.map((g) => g.type)).toEqual([only]);
  expect(first[0].total).toBe(9);
  expect(next[0].results.map((r) => r.label)).toEqual(["Trial 8"]);
});

test("the unscoped type-ahead suggests spells and vendors from the names passed in; a scoped box does not", async () => {
  mocks.names.npcs = new Map([[10, "Frostmane Vendor"]]);
  const { suggest } = await import("./site-search");
  const rows = await suggest("frost", undefined, mocks.names, { tolerant: true, spells: new Map([[116, "Frostbolt"]]), vendors: new Set([10]) });
  expect(rows).toContainEqual({ type: "spell", id: 116, label: "Frostbolt", href: "/database/spells/116" });
  expect(rows).toContainEqual({ type: "vendor", id: 10, label: "Frostmane Vendor", href: "/database/vendors/10" });
  expect((await suggest("frost", "npc", mocks.names, { tolerant: true, spells: new Map([[116, "Frostbolt"]]), vendors: new Set([10]) })).map((r) => r.type)).toEqual(["npc"]);
});
