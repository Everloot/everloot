import { SITE } from "@everloot/protocol";
import { expect, test } from "vitest";
import { catalogPath } from "../src/catalog-paths.js";
import { loreUrls } from "../src/page-urls.js";
import type { ReleaseDb } from "../src/release-db.js";

test.each([
  ["achievement", "12", "Ten Quests", "/database/achievements/12-ten-quests"],
  ["faction", "1", "Stormwind", "/database/factions/1-stormwind"],
  ["title", "7", "%s, Champion", "/database/titles/7-champion"],
  ["title", "144", "Bloodsail Admiral %s", "/database/titles/144-bloodsail-admiral"],
  ["quest_chain", "3", "***", "/database/quest-chains/3"],
  ["instance", "36", "Deadmines", "/database/instances/36-deadmines"],
  ["mount", "5", "Gray Wolf", "/tools/collections"],
  ["legacy_perk", "9", "Shared Knowledge", "/tools/legacy"],
  ["race", "2", "Orc", "/classes/choose"],
  ["lore_page", "Thrall", "Thrall", null],
  ["npc", "1", "Innkeeper", null],
])("catalogPath(%s)", (kind, extId, name, want) => expect(catalogPath(kind, extId, name)).toBe(want));

test("loreUrls gives a catalog row its page without a database lookup", async () => {
  const calls: number[] = [];
  const db: ReleaseDb = {
    async all<T>(_sql: string, ...params: unknown[]) {
      calls.push(params.length);
      return [] as T[];
    },
    async get() { return undefined; },
  };
  const urls = await loreUrls(db, [
    { id: 1, extId: "1", name: "Stormwind", kind: "faction" },
    { id: 2, extId: "36", name: "Deadmines", kind: "instance" },
  ]);
  expect(urls.get(1)).toBe(`${SITE}/database/factions/1-stormwind`);
  expect(urls.get(2)).toBe(`${SITE}/database/instances/36-deadmines`);
  expect(calls).toEqual([]);
});
