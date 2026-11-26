import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientCollections, ClientCollections, writeClientCollections } from "../src/client-collections.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-25T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

const tables: Record<string, Rows> = {
  CurrencyCategory: [
    [1, { ID: 1, Name_lang: "Miscellaneous" }],
    [2, { ID: 2, Name_lang: "Player vs. Player" }],
    [142, { ID: 142, Name_lang: "Hidden" }],
  ],
  CurrencyTypes: [
    [1792, { Name_lang: "Honor Points", Description_lang: "Honor is gained in PvP combat.", CategoryID: 2, InventoryIconFileID: 0, MaxQty: 25000 }],
    [515, { Name_lang: "Darkmoon Prize Ticket", Description_lang: "Awarded at the Faire.", CategoryID: 1, InventoryIconFileID: 134481, MaxQty: 0 }],
    // A hidden tracker and a development leftover are left out.
    [3473, { Name_lang: "Renown - PvP Rank", Description_lang: "[DNT]", CategoryID: 142, MaxQty: 14 }],
    [3498, { Name_lang: "[DNT] Class Talent Reset", CategoryID: 1 }],
    [9, { Name_lang: "Blank Text", Description_lang: "[DNT] not for players", CategoryID: 1 }],
  ],
  Creature: [[2671, { Name_lang: "Mechanical Squirrel" }], [7385, { Name_lang: "Tabby Cat" }]],
  BattlePetSpecies: [
    [40, { CreatureID: 7385, SummonSpellID: 10673, IconFileDataID: 132599 }],
    [39, { CreatureID: 2671, SummonSpellID: 4055, IconFileDataID: 132761 }],
    // A species whose creature the files do not name is left out.
    [41, { CreatureID: 7384, SummonSpellID: 10674, IconFileDataID: 132599 }],
  ],
  Toy: [[29, { ItemID: 21540 }], [1, { ItemID: 1973 }], [2, { ItemID: 0 }]],
};

function snapshot(t: Record<string, Rows>): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-collections-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(t).map(([name, rows]) => table(name, rows)));
  return path;
}

test("currencies: name, category, own text and cap; hidden trackers and leftovers are left out", () => {
  expect(buildClientCollections(snapshot(tables)).currencies).toEqual([
    { id: 515, name: "Darkmoon Prize Ticket", category: "Miscellaneous", description: "Awarded at the Faire.", iconFileId: 134481 },
    { id: 1792, name: "Honor Points", category: "Player vs. Player", description: "Honor is gained in PvP combat.", max: 25000 },
  ]);
});

test("companion pets: the species named by its creature, with the summon spell and icon file", () => {
  expect(buildClientCollections(snapshot(tables)).pets).toEqual([
    { id: 39, name: "Mechanical Squirrel", creatureId: 2671, spellId: 4055, iconFileId: 132761 },
    { id: 40, name: "Tabby Cat", creatureId: 7385, spellId: 10673, iconFileId: 132599 },
  ]);
});

test("toys: the toy id and its item, no names", () => {
  expect(buildClientCollections(snapshot(tables)).toys).toEqual([{ id: 1, itemId: 1973 }, { id: 29, itemId: 21540 }]);
});

test("the file parses back, one entry per line, stamped with the build", () => {
  const path = snapshot(tables);
  const file = join(mkdtempSync(join(tmpdir(), "kb-collections-out-")), "client-collections.json");
  const out = writeClientCollections(path, file);
  expect(out.schema).toBe("everloot.client-collections/1");
  expect(out.build.version).toBe("1.0.0.70707");
  const text = readFileSync(file, "utf8");
  expect(ClientCollections.parse(JSON.parse(text))).toEqual(out);
  expect(text).toContain('\n  {"id":39,"name":"Mechanical Squirrel"');
});

test("a build without the tables gives empty lists", () => {
  const out = buildClientCollections(snapshot({ Other: [[1, { X: 1 }]] }));
  expect([out.currencies, out.pets, out.toys]).toEqual([[], [], []]);
});
