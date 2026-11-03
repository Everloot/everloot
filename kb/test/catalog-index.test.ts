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

  test("ids are deterministic, reserved and reversible", () => {
    expect(isCatalogId(catalogId("instance", "36"))).toBe(true);
    expect(isCatalogId(123)).toBe(false);
    expect(getCatalogEntity(index, catalogId("mount", "5"))?.name).toBe("Gray Wolf");
  });
});
