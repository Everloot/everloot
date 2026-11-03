import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  buildCatalogIndex, catalogCounts, catalogId, getCatalogByName, getCatalogEntity, isCatalogId, readCatalogFiles, searchCatalog,
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
    expect(title.body).toBe("%s, Champion\n");
  });

  test("ids are deterministic, reserved and reversible", () => {
    expect(isCatalogId(catalogId("instance", "36"))).toBe(true);
    expect(isCatalogId(123)).toBe(false);
    expect(getCatalogEntity(index, catalogId("mount", "5"))?.name).toBe("Gray Wolf");
  });
});
