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

  test("an NPC, item or quest copy answers exactly as foreverMatch does", async () => {
    vi.stubEnv("KB_SNAPSHOT_PATH", release);
    const { foreverMatch } = await import("./lore-forever");
    const { databaseLink } = await import("./lore-links");
    const s = sets();
    for (const [type, name] of [["npc", "Thrall"], ["npc", "Hogger"], ["item", "Warchief's Blade"], ["quest", "Return to Sender"], ["quest", "Nothing"]] as const) {
      const p = page(type, name);
      expect(databaseLink(p, s)?.id ?? null, `${type} ${name}`).toBe(foreverMatch(p, s)?.id ?? null);
    }
  });
});
