import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";
import type { LinkNames } from "./lore-links";

type Type = Parameters<typeof import("./lore-links").databaseLink>[0]["type"];

/** The names the database knows: one page each, except where a test makes two share a name. */
const sets = (over: Partial<LinkNames> = {}): LinkNames => ({
  npcs: new Map([[77, "Thrall"], [90, "Hogger"], [91, "Hogger"]]),
  items: new Map([[9, "Warchief's Blade"]]),
  quests: new Map([[5, "Return to Sender"]]),
  objects: new Map([[1731, "Copper Vein"], [1732, "Twin Vein"], [1733, "Shared Name"]]),
  zones: new Map([[1436, "Westfall"]]),
  instances: new Map([[36, "Deadmines"]]),
  factions: new Map([[529, "Argent Dawn"], [530, "Shared Name"]]),
  titles: new Map([[200, "Jenkins"]]),
  achievements: new Map([[802, "Explore Westfall"]]),
  ...over,
});

let release = "";
beforeAll(async () => { release = await buildLoreRelease({ links: true }); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.restoreAllMocks(); });

async function links(path = release) {
  vi.stubEnv("KB_SNAPSHOT_PATH", path);
  return import("./lore-links");
}

describe("a database page asks for its lore page", () => {
  test.each([
    ["object", 1731, "Copper Vein", "300"],
    ["faction", 529, "Argent Dawn", "301"],
    ["instance", 36, "Deadmines", "302"],
    ["zone", 1436, "Westfall", "303"],
    ["achievement", 802, "Explore Westfall", "307"],
    ["title", 200, "Jenkins", "308"],
    ["npc", 77, "Thrall", "1"],
    ["quest", 5, "Return to Sender", "5"],
  ] as const)("a %s with the archive's page of exactly its name links it", async (kind, id, name, extId) => {
    const { loreFor } = await links();
    expect(await loreFor(kind, id, name, sets())).toMatchObject({ extId, name });
  });

  test("a name no archive page of the kind's type has is no link", async () => {
    const { loreFor } = await links();
    expect(await loreFor("object", 1731, "Tin Vein", sets({ objects: new Map([[1731, "Tin Vein"]]) }))).toBeNull();
    // The page exists, but under another type: an NPC called Westfall is not the zone.
    expect(await loreFor("npc", 5, "Westfall", sets({ npcs: new Map([[5, "Westfall"]]) }))).toBeNull();
    expect(await loreFor("faction", 529, "  ", sets())).toBeNull();
    expect(await loreFor("faction", 529, null, sets())).toBeNull();
  });

  test("a name two database pages of one kind share is no link, from either page", async () => {
    const { loreFor } = await links();
    expect(await loreFor("npc", 90, "Hogger", sets())).toBeNull();
    expect(await loreFor("npc", 91, "Hogger", sets())).toBeNull();
    expect(await loreFor("zone", 1, "Westfall", sets({ zones: new Map([[1436, "Westfall"], [1, "Westfall"]]) }))).toBeNull();
    // The page's own id must be the one that holds the name.
    expect(await loreFor("object", 9999, "Copper Vein", sets())).toBeNull();
  });

  test("two archive pages of one name are no link", async () => {
    const { loreFor } = await links();
    expect(await loreFor("object", 1732, "Twin Vein", sets())).toBeNull();
  });

  test("a name two kinds under one archive type could claim is no link for either", async () => {
    const { loreFor } = await links();
    expect(await loreFor("object", 1733, "Shared Name", sets())).toBeNull();
    expect(await loreFor("faction", 530, "Shared Name", sets())).toBeNull();
  });

  test("a zone and an instance of one name are no link", async () => {
    const { loreFor } = await links();
    const both = sets({ instances: new Map([[1450, "Westfall"]]) });
    expect(await loreFor("zone", 1436, "Westfall", both)).toBeNull();
    expect(await loreFor("instance", 1450, "Westfall", both)).toBeNull();
    expect(await loreFor("instance", 1450, "Westfall", sets({ instances: new Map([[1450, "Westfall"]]), zones: new Map() }))).toMatchObject({ extId: "303" });
  });

  test("the archive cannot be opened: unavailable, never a link", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { loreFor } = await links("C:/missing/release.sqlite");
    expect(await loreFor("object", 1731, "Copper Vein", sets())).toBe("unavailable");
  });
});

describe("an item by the name its page shows", () => {
  const wiki = (entries: [number, string, "wiki" | "files"][]) => new Map(entries.map(([id, name, source]) => [id, { name, source, color: "#fff", wikiPage: null }]));

  test("a name from the Warcraft Wiki links its lore page though nobody has reported the item", async () => {
    const { loreForShownItem } = await links();
    expect(await loreForShownItem(25, { name: "Worn Shortsword", source: "wiki" }, wiki([[25, "Worn Shortsword", "wiki"]]), sets())).toMatchObject({ extId: "304" });
  });

  test("a name players agreed on follows the shared rule", async () => {
    const { loreForShownItem } = await links();
    const agreed = sets({ items: new Map([[25, "Worn Shortsword"]]) });
    expect(await loreForShownItem(25, { name: "Worn Shortsword", source: "players" }, undefined, agreed)).toMatchObject({ extId: "304" });
    const twice = sets({ items: new Map([[25, "Worn Shortsword"], [26, "Worn Shortsword"]]) });
    expect(await loreForShownItem(25, { name: "Worn Shortsword", source: "players" }, undefined, twice)).toBeNull();
  });

  test("no link for a wiki name another item has agreed or the wiki gives twice, for a files name, or for no name", async () => {
    const { loreForShownItem } = await links();
    const shown = { name: "Worn Shortsword", source: "wiki" as const };
    expect(await loreForShownItem(25, shown, wiki([[25, "Worn Shortsword", "wiki"]]), sets({ items: new Map([[26, "Worn Shortsword"]]) }))).toBeNull();
    expect(await loreForShownItem(25, shown, wiki([[25, "Worn Shortsword", "wiki"], [27, "Worn Shortsword", "wiki"]]), sets())).toBeNull();
    expect(await loreForShownItem(25, { name: "Worn Shortsword", source: "files" }, wiki([[25, "Worn Shortsword", "files"]]), sets())).toBeNull();
    expect(await loreForShownItem(25, shown, null, sets())).toBeNull();
    expect(await loreForShownItem(25, null, wiki([]), sets())).toBeNull();
    // An item with no page of that name in the archive.
    expect(await loreForShownItem(28, { name: "Tin Sword", source: "wiki" }, wiki([[28, "Tin Sword", "wiki"]]), sets())).toBeNull();
  });
});

describe("a lore page leads to its database page", () => {
  const page = (type: Type, name: string, sourceId = "warcraft-wiki-2023") => ({ sourceId, type, name });

  test("each kind, by the same exact name", async () => {
    const { databaseLink, databaseHref } = await links();
    const s = sets();
    const at = (type: Type, name: string) => {
      const link = databaseLink(page(type, name), s);
      return link && { kind: link.kind, id: link.id, href: databaseHref(link) };
    };
    expect(at("other", "Copper Vein")).toEqual({ kind: "object", id: 1731, href: "/database/objects/1731" });
    expect(at("other", "Argent Dawn")).toEqual({ kind: "faction", id: 529, href: "/database/factions/529-argent-dawn" });
    expect(at("other", "Explore Westfall")).toEqual({ kind: "achievement", id: 802, href: "/database/achievements/802-explore-westfall" });
    expect(at("other", "Jenkins")).toEqual({ kind: "title", id: 200, href: "/database/titles/200-jenkins" });
    expect(at("zone", "Westfall")).toEqual({ kind: "zone", id: 1436, href: "/database/zones/1436-westfall" });
    expect(at("zone", "Deadmines")).toEqual({ kind: "instance", id: 36, href: "/database/instances/36-deadmines" });
    expect(at("npc", "thrall")).toEqual({ kind: "npc", id: 77, href: "/database/npcs/77" });
    expect(at("item", "Warchief's Blade")).toEqual({ kind: "item", id: 9, href: "/database/items/9" });
    expect(at("quest", "Return to Sender")).toEqual({ kind: "quest", id: 5, href: "/database/quests/5" });
  });

  test("no link for an unknown name, an ambiguous one, a zone that is also an instance, an untyped page or a copy that is not the wiki's", async () => {
    const { databaseLink } = await links();
    const s = sets({ instances: new Map([[36, "Deadmines"], [1450, "Westfall"]]) });
    expect(databaseLink(page("other", "Tin Vein"), s)).toBeNull();
    expect(databaseLink(page("npc", "Hogger"), s)).toBeNull();
    expect(databaseLink(page("other", "Shared Name"), s)).toBeNull();
    expect(databaseLink(page("zone", "Westfall"), s)).toBeNull();
    expect(databaseLink(page(null, "Copper Vein"), s)).toBeNull();
    expect(databaseLink(page("other", "Copper Vein", "curated"), s)).toBeNull();
    // A type with no database kind (a spell) has none.
    expect(databaseLink(page("spell", "Copper Vein"), s)).toBeNull();
  });

  test("a name one kind holds twice is no link, though another kind of the type holds it once", async () => {
    const { databaseLink, loreFor } = await links();
    // Two objects called Argent Dawn and one faction: the faction is not the one page of that name.
    const twice = sets({ objects: new Map([[1750, "Argent Dawn"], [1751, "Argent Dawn"]]) });
    expect(databaseLink(page("other", "Argent Dawn"), twice)).toBeNull();
    expect(await loreFor("faction", 529, "Argent Dawn", twice)).toBeNull();
    // Two instances called Westfall: the zone of that name links nothing either.
    const instances = sets({ instances: new Map([[36, "Deadmines"], [1450, "Westfall"], [1451, "Westfall"]]) });
    expect(databaseLink(page("zone", "Westfall"), instances)).toBeNull();
    expect(await loreFor("zone", 1436, "Westfall", instances)).toBeNull();
  });

  test("a kind whose names cannot be read stops every link of its lore type until it can, as an outage", async () => {
    const { databaseLink, loreFor, loreForShownItem } = await links();
    // The agreed object names are unreadable: the faction might share its name with an object nobody can see.
    const noObjects = sets({ objects: null });
    expect(databaseLink(page("other", "Argent Dawn"), noObjects)).toBeNull();
    expect(databaseLink(page("other", "Jenkins"), noObjects)).toBeNull();
    // The database page hears "unavailable", not "no link", so it can keep the answer out of the caches.
    expect(await loreFor("faction", 529, "Argent Dawn", noObjects)).toBe("unavailable");
    expect(await loreFor("title", 200, "Jenkins", noObjects)).toBe("unavailable");
    // Other types do not wait on it.
    expect(databaseLink(page("zone", "Westfall"), noObjects)).toMatchObject({ kind: "zone", id: 1436 });
    // The instance list is unreadable: no zone links.
    expect(databaseLink(page("zone", "Westfall"), sets({ instances: null }))).toBeNull();
    expect(await loreFor("zone", 1436, "Westfall", sets({ instances: null }))).toBe("unavailable");
    // An item shown by its wiki name, while the agreed item names cannot be read, is unavailable too.
    const wiki = new Map([[9, { name: "Warchief's Blade", source: "wiki" as const }]]);
    expect(await loreForShownItem(9, { name: "Warchief's Blade", source: "wiki" }, wiki, sets({ items: null }))).toBe("unavailable");
  });

  test("storage down: the names players agreed on are unreadable, not empty", async () => {
    vi.stubEnv("KB_SNAPSHOT_PATH", release);
    vi.doMock("./rollup-compute", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./rollup-compute")>()),
      loadItemFacts: async () => ({ unreachable: true }),
      loadWorldFacts: async () => ({ unreachable: true }),
    }));
    const { loadLinkNames, databaseLink } = await import("./lore-links");
    const other = await loadLinkNames("other");
    expect(other.objects).toBeNull();
    expect(other.factions?.size).toBeGreaterThan(0);
    expect(databaseLink(page("other", "Argent Dawn"), other)).toBeNull();
    expect((await loadLinkNames("npc")).npcs).toBeNull();
    // A zone reads nothing from storage.
    expect((await loadLinkNames("zone")).npcs).toEqual(new Map());
    vi.doUnmock("./rollup-compute");
  });
});

describe("one rule for the link back, the robots and the sitemap", () => {
  const page = (extId: string, type: Type, name: string, body = "x".repeat(400), sourceId = "warcraft-wiki-2023") => ({ extId, sourceId, type, name, body });

  test("a copy that links is indexed; one that does not, or is too short to index, is not", async () => {
    const { loreStanding } = await links();
    const s = sets();
    expect(loreStanding(page("300", "other", "Copper Vein"), "300", s)).toMatchObject({ link: { kind: "object", id: 1731 }, index: true });
    // The archive's one page of the name is another copy (or there is none): no link, so no index.
    expect(loreStanding(page("300", "other", "Copper Vein"), "999", s)).toEqual({ link: null, index: false });
    expect(loreStanding(page("300", "other", "Copper Vein"), null, s)).toEqual({ link: null, index: false });
    // Two NPCs called Hogger: the copy links neither and stays out of search.
    expect(loreStanding(page("310", "npc", "Hogger"), "310", s)).toEqual({ link: null, index: false });
    // A short page keeps its link but not the index; an untyped copy and a spell are neither.
    expect(loreStanding(page("300", "other", "Copper Vein", "short"), "300", s)).toMatchObject({ link: { id: 1731 }, index: false });
    expect(loreStanding(page("300", null, "Copper Vein"), "300", s)).toEqual({ link: null, index: false });
    // Everloot's own entries link nothing and keep the length rule alone.
    expect(loreStanding(page("forever", null, "Launch", "x".repeat(400), "curated"), null, null)).toEqual({ link: null, index: true });
  });
});
