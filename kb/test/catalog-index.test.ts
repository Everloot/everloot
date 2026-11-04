import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  buildCatalogIndex, CATALOG_ID_BASE, CATALOG_LICENCE, catalogCounts, catalogId, getCatalogByName, getCatalogEntity, isCatalogId, readCatalogFiles, searchCatalog,
} from "../src/catalog-index.js";

const fixtureRoot = join(import.meta.dirname, "fixtures", "game-files");
const tmpRoots: string[] = [];

function rootWithoutTitles(): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-index-"));
  tmpRoots.push(dir);
  cpSync(fixtureRoot, dir, { recursive: true });
  rmSync(join(dir, "client-titles.json"));
  return dir;
}

afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

const index = buildCatalogIndex(readCatalogFiles(fixtureRoot).files);

describe("catalog index", () => {
  test("builds one record per catalog entry, with page url, credit and reserved id", () => {
    const { files, missing } = readCatalogFiles(fixtureRoot);
    expect(missing).toEqual([]);
    const built = buildCatalogIndex(files);
    expect(catalogCounts(built)).toEqual({ achievement: 1, faction: 1, title: 1, quest_chain: 2, mount: 1, legacy_perk: 1, race: 1, instance: 1 });
    const [row] = getCatalogByName(built, "Stormwind", "faction");
    expect(row.id).toBe(catalogId("faction", "1"));
    expect(row.sourceUrl).toBe("https://everloot.app/database/factions/1-stormwind");
    expect(row.licence).toMatch(/Blizzard/);
    expect(row.data).toMatchObject({ shown: true, build: expect.any(String) });
    expect(row.body.startsWith("Stormwind\n")).toBe(true);
  });

  test("a missing file is reported, not thrown; statistics are not achievements", () => {
    const { files, missing } = readCatalogFiles(rootWithoutTitles());
    expect(missing).toEqual(["client-titles.json"]);
    const counts = catalogCounts(buildCatalogIndex(files));
    expect(counts.title).toBeUndefined();
    expect(counts.achievement).toBe(1);
  });

  test("search ranks an exact name first, then all-term matches, and honours kinds and limit", () => {
    expect(searchCatalog(index, "Deadmines")[0]).toMatchObject({ kind: "instance", extId: "36" });
    expect(searchCatalog(index, "champion", { kinds: ["title"] }).map((r) => r.kind)).toEqual(["title"]);
    expect(searchCatalog(index, "the", { limit: 1 })).toHaveLength(1);
  });

  test("search orders exact, then every-term, then any-term matches", () => {
    const build = { version: "1.0.0", extractedAt: "2026-11-03" };
    const entrance = (mapId: number, name: string) => ({ mapId, name, raid: false });
    const ranked = buildCatalogIndex({
      map: {
        source: build,
        entrances: [entrance(1, "Mines of Gold"), entrance(2, "Key of Deadmines Mines"), entrance(3, "Deadmines Key"), entrance(4, "Deadmines")],
      },
    });
    expect(searchCatalog(ranked, "deadmines key").map((r) => r.name)).toEqual(["Deadmines Key", "Key of Deadmines Mines", "Deadmines"]);
    expect(searchCatalog(ranked, "deadmines")[0].name).toBe("Deadmines");
  });

  test("an empty name or a development name is not indexed, and a name-only record still starts with the name and a newline", () => {
    const build = { version: "1.0.0", extractedAt: "2026-11-03" };
    const built = buildCatalogIndex({
      titles: { build, titles: [{ id: 1, name: "" }, { id: 2, name: "<TEST> Title" }, { id: 3, name: "%s, Champion" }] },
      map: { source: build, entrances: [{ mapId: 9, name: "   ", raid: false }, { mapId: 10, name: "Deprecated Keep", raid: true }] },
    } as unknown as Parameters<typeof buildCatalogIndex>[0]);
    expect(catalogCounts(built)).toEqual({ title: 1 });
    expect(built.byId.size).toBe(1);
    expect(searchCatalog(built, "test")).toEqual([]);
    const [title] = getCatalogByName(built, "%s, Champion");
    expect(title.body).toBe("%s, Champion\nFound in game files, unconfirmed (build 1.0.0).");
  });

  test("the licence line is plain UTF-8, and the source file has no byte order mark", () => {
    expect(CATALOG_LICENCE).toBe("Game data © Blizzard Entertainment, Inc.; not under Everloot's licence");
    for (const r of index.byId.values()) expect(r.licence).toBe(CATALOG_LICENCE);
    const bytes = readFileSync(join(import.meta.dirname, "..", "src", "catalog-index.ts"));
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.includes(Buffer.from([0xc3, 0x82, 0xc2, 0xa9]))).toBe(false);
  });

  test("an achievement's description and criteria text are in no record", () => {
    const achievements = JSON.parse(readFileSync(join(fixtureRoot, "client-achievements.json"), "utf8")).achievements;
    const texts: string[] = [achievements["1234"].description, ...achievements["1234"].criteria.map((c: { text: string }) => c.text)];
    expect(texts.length).toBeGreaterThan(1);
    for (const r of index.byId.values()) {
      for (const text of texts) {
        expect(r.body).not.toContain(text);
        expect(r.snippet).not.toContain(text);
        expect(JSON.stringify(r.data)).not.toContain(text);
      }
    }
    const [loremaster] = getCatalogByName(index, "Loremaster", "achievement");
    expect(loremaster.body).toBe("Loremaster\nFound in game files, unconfirmed (build 1.60.1.70707).\npoints: 10\ncriteriaCount: 2");
  });

  test("every record names the game files and its build on its second line, and the snippet keeps both", () => {
    expect(index.byId.size).toBeGreaterThan(8);
    for (const r of index.byId.values()) {
      const build = (r.data as { build: string }).build;
      expect(build).toMatch(/^1\.60\.1\.\d+$/);
      expect(r.body.split("\n")[1]).toBe(`Found in game files, unconfirmed (build ${build}).`);
      expect(r.snippet).toContain(`Found in game files, unconfirmed (build ${build}).`);
    }
  });

  test("only factions the game shows are indexed; statistics and hidden factions have no page", () => {
    const build = { product: "wowf", buildId: 1, version: "1.0.0", buildConfig: "x", definitions: "y", extractedAt: "2026-11-03" };
    const built = buildCatalogIndex({
      factions: {
        schema: "everloot.client-factions/1", label: "Found in game files, unconfirmed", credit: "c", build,
        factions: [{ id: 72, name: "Stormwind", shown: true }, { id: 1, name: "PLAYER, Human", shown: false }, { id: 2, name: "Creature", shown: false }],
      },
    } as unknown as Parameters<typeof buildCatalogIndex>[0]);
    expect([...built.byId.values()].map((r) => r.name)).toEqual(["Stormwind"]);
    expect(built.byId.get(catalogId("faction", "72"))?.sourceUrl).toBe("https://everloot.app/database/factions/72-stormwind");
    expect(searchCatalog(built, "creature")).toEqual([]);
    expect(getCatalogByName(built, "PLAYER, Human")).toEqual([]);
  });

  test("an id outside its kind's span is refused, not folded into the next kind", () => {
    for (const bad of ["abc", "-1", "1.5", "", "10000000", "99999999999"]) expect(() => catalogId("faction", bad), bad).toThrow(/not a catalog id/);
    expect(catalogId("faction", "0")).toBe(CATALOG_ID_BASE + 10_000_000);
    expect(catalogId("faction", "9999999")).toBe(CATALOG_ID_BASE + 2 * 10_000_000 - 1);
  });

  test("an instance lists its encounters as name (id) lines, never as JSON", () => {
    const [row] = getCatalogByName(index, "Deadmines", "instance");
    expect(row.body).toBe([
      "Deadmines", "Found in game files, unconfirmed (build 1.60.1.70707).", "raid: false", "minLevel: 10", "maxLevel: 20",
      "encounters:", "Rhahk'Zor (1)", "Edwin VanCleef (2)",
    ].join("\n"));
    expect(row.body).not.toContain("{");
    expect(row.data.encounters).toEqual([{ id: 1, name: "Rhahk'Zor" }, { id: 2, name: "Edwin VanCleef" }]);
  });

  test("search reads a query the way the release search does: stopwords dropped, short forms and Spanish understood", () => {
    const build = { version: "1.0.0", extractedAt: "2026-11-03" };
    const entrance = (mapId: number, name: string) => ({ mapId, name, raid: false });
    const built = buildCatalogIndex({
      map: { source: build, entrances: [entrance(1, "Molten Core"), entrance(2, "The Barrens Hall"), entrance(3, "Gold of the Deep"), entrance(4, "Gnome Keep")] },
    });
    // "the" and "in" match nothing; only "gold" and "barrens" are asked for.
    expect(searchCatalog(built, "best gold farm in the barrens").map((r) => r.name)).toEqual(["The Barrens Hall", "Gold of the Deep"]);
    expect(searchCatalog(built, "best gold farm in the barrens", { anyWord: false })).toEqual([]);
    expect(searchCatalog(built, "gold in the")).toEqual(searchCatalog(built, "gold"));
    expect(searchCatalog(built, "MC").map((r) => r.name)).toEqual(["Molten Core"]);
    // A pick word never matches alone: "best gnome" finds the gnome, not a name for "best".
    expect(searchCatalog(built, "best gnome").map((r) => r.name)).toEqual(["Gnome Keep"]);
  });

  test("any-word hits are ranked by how many asked words the name holds, and anyWord: false leaves them out", () => {
    const build = { version: "1.0.0", extractedAt: "2026-11-03" };
    const entrance = (mapId: number, name: string) => ({ mapId, name, raid: false });
    const built = buildCatalogIndex({
      map: {
        source: build,
        entrances: [entrance(1, "Zeta Alpha"), entrance(2, "Alpha Beta Gamma Delta"), entrance(3, "Alpha Beta Omega"), entrance(4, "Alpha Beta Gamma")],
      },
    });
    expect(searchCatalog(built, "alpha beta gamma").map((r) => r.name)).toEqual(["Alpha Beta Gamma", "Alpha Beta Gamma Delta", "Alpha Beta Omega", "Zeta Alpha"]);
    expect(searchCatalog(built, "alpha beta gamma", { anyWord: false }).map((r) => r.name)).toEqual(["Alpha Beta Gamma", "Alpha Beta Gamma Delta"]);
  });

  test("ids are deterministic, reserved and reversible", () => {
    expect(isCatalogId(catalogId("instance", "36"))).toBe(true);
    expect(isCatalogId(123)).toBe(false);
    expect(getCatalogEntity(index, catalogId("mount", "5"))?.name).toBe("Gray Wolf");
  });
});
