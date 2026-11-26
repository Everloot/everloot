import { expect, test, vi } from "vitest";

// Players agree on no name yet; the pages show the game files and Warcraft Wiki matches.
const mocks = vi.hoisted(() => ({
  agreed: { items: new Map<number, string>(), npcs: new Map([[448, "Hogger"]]), objects: new Map<number, string>(), quests: new Map<number, string>() },
  matched: new Map([[19019, { name: "Thunderfury, Blessed Blade of the Windseeker", color: "#ff8000", wikiPage: "x" }], [647, { name: "Destiny", color: "#a335ee", wikiPage: "y" }]]),
  quests: new Map([[176, { name: "Wanted: Hogger", wikiPage: "z" }]]),
  // The stored names file, none unless a test sets it; and how often the aggregate-backed names were read.
  stored: null as unknown,
  shownReads: 0,
  objectReads: 0,
}));
vi.mock("@/lib/search-names-store", () => ({ loadStoredSearchNames: async () => mocks.stored }));
vi.mock("@/lib/names", () => ({ loadNames: async () => mocks.agreed }));
vi.mock("@/lib/shown-item-names", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/shown-item-names")>(),
  loadShownNames: async () => { mocks.shownReads++; return { matched: { names: mocks.matched }, showsTip: (id: number) => mocks.matched.has(id) }; },
}));
vi.mock("@/lib/game-assets", () => ({
  loadQuestNames: async () => ({ names: mocks.quests }),
  loadItemNames: async () => ({ names: mocks.matched }),
  PRIVATE_UNREACHABLE: Symbol("private bucket unreachable"),
  loadSiteAssets: async () => ({ base: "https://assets.everloot.app/b" }),
  unknownItemIcon: (base: string) => `${base}/icons/134400.webp`,
  // Only Thunderfury has an icon in these game files.
  readItemTips: async (_a: unknown, ids: number[]) => ({ tips: new Map(), unreachable: false, degraded: false, icons: new Map(ids.filter((id) => id === 19019).map((id) => [id, "https://assets.everloot.app/b/icons/1.webp"])) }),
}));
vi.mock("@/lib/objects", () => ({ loadObjectFacts: async () => { mocks.objectReads++; return { rates: [], measuredZeros: [], names: [], unreachable: false }; } }));

import { GET } from "./route";
import { GET as apiGET } from "../../api/suggest/route";

const get = async (query: string) => (await (await GET(new Request(`https://everloot.app/search/suggest${query}`))).json()).results as { href: string; label: string }[];

test("the type-ahead finds items and quests by the names their pages show", async () => {
  expect((await get("?q=thunderfury")).map((r) => r.href)).toEqual(["/database/items/19019"]);
  expect((await get("?q=hogger")).map((r) => r.href)).toEqual(["/database/npcs/448", "/database/quests/176"]);
  expect((await get("?q=wanted&in=quest"))[0]).toMatchObject({ label: "Wanted: Hogger", href: "/database/quests/176" });
  // An id is still named the way its page names it.
  expect((await get("?q=19019"))[0]).toMatchObject({ label: "Thunderfury, Blessed Blade of the Windseeker" });
});

test("the type-ahead suggests a dungeon's page by its name, with or without the leading The, and not in a scoped box", async () => {
  for (const q of ["deadm", "the%20deadmines"]) {
    expect((await get(`?q=${q}`))[0], q).toMatchObject({ type: "instance", label: "Deadmines", href: "/database/instances/36-deadmines", note: "Dungeon, level 16" });
  }
  expect(await get("?q=deadm&in=npc")).toEqual([]);
});

test("an item row carries its game icon where its page shows one; NPCs and quests have none", async () => {
  expect((await get("?q=thunderfury"))[0]).toMatchObject({ icon: "https://assets.everloot.app/b/icons/1.webp" });
  expect((await get("?q=destiny"))[0]).not.toHaveProperty("icon");
  expect((await get("?q=hogger")).every((r) => !("icon" in r))).toBe(true);
});

test("it is the site's route: never indexed, and /api/suggest keeps to the names players agree on", async () => {
  const res = await GET(new Request("https://everloot.app/search/suggest?q=thunderfury"));
  expect(res.headers.get("cdn-cache-control")).toBe("public, max-age=60");
  expect(res.headers.get("x-robots-tag")).toBe("noindex");
  const api = await (await apiGET(new Request("https://everloot.app/api/suggest?q=thunderfury"))).json();
  expect(api.results).toEqual([]);
});

test("a wrong scope or an overlong query is a 400 that is not cached", async () => {
  for (const q of ["?q=a&in=zone", `?q=${"x".repeat(300)}`]) {
    const res = await GET(new Request(`https://everloot.app/search/suggest${q}`));
    expect(res.status, q).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("cdn-cache-control")).toBeNull();
  }
});


test("with the stored names file the type-ahead reads no item facts: names and icons come from the file and the game files", async () => {
  mocks.stored = {
    generatedAt: "2026-11-19T06:00:00.000Z", dataAsOf: "2026-11-19T06:00:00.000Z",
    names: { items: new Map([[1003, "Linen Cloth"]]), npcs: new Map([[448, "Hogger"]]), objects: new Map([[600, "Copper Vein"], [601, "Silver Vein"]]), quests: new Map() },
    candidates: new Map(), dropped: new Set([1003]), objectIds: new Set([600]),
  };
  mocks.shownReads = 0;
  mocks.objectReads = 0;
  expect((await get("?q=linen"))[0]).toMatchObject({ label: "Linen Cloth", href: "/database/items/1003" });
  // Only an object the list shows is suggested, from the file's ids: no object facts are read.
  expect((await get("?q=vein")).map((r) => r.href)).toEqual(["/database/objects/600"]);
  expect(mocks.objectReads).toBe(0);
  expect((await get("?q=hogger"))[0]).toMatchObject({ label: "Hogger" });
  expect((await get("?q=thunderfury"))[0]).toMatchObject({ label: "Thunderfury, Blessed Blade of the Windseeker", icon: "https://assets.everloot.app/b/icons/1.webp" });
  expect(mocks.shownReads).toBe(0);
  mocks.stored = null;
});
