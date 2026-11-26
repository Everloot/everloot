import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientPlaces, ClientPlaces, writeClientPlaces } from "../src/client-places.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-25T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });
/** A whole-map assignment of UiMap `ui` on game map 0, showing `area`. */
const assign = (ui: number, area: number) => ({ UiMapID: ui, MapID: 0, AreaID: area, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: [-10000, -1000, 0, -9000, 0, 0] });

const tables: Record<string, Rows> = {
  AreaTable: [
    [12, { AreaName_lang: "Elwynn Forest", ParentAreaID: 0 }],
    [87, { AreaName_lang: "Goldshire", ParentAreaID: 12 }],
    [88, { AreaName_lang: "Lion's Pride Inn", ParentAreaID: 87 }],
    [90, { AreaName_lang: "Test Area UNUSED", ParentAreaID: 12 }],
    // An area of no zone the map shows.
    [700, { AreaName_lang: "Somewhere Else", ParentAreaID: 0 }],
  ],
  UiMapAssignment: [[1, assign(1429, 12)]],
  AreaPOI: [
    [3, { Name_lang: "Goldshire", Pos: [-9464.04, 62.11, 56], ContinentID: 0, AreaID: 87 }],
    // No area: the pages place it by position.
    [4, { Name_lang: "Darkshire", Pos: [-10564.7, -1170.65, 28], ContinentID: 0, AreaID: -1 }],
    [5, { Name_lang: "", Pos: [0, 0, 0], ContinentID: 0, AreaID: 0 }],
  ],
};

function snapshot(t: Record<string, Rows>): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-places-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(t).map(([name, rows]) => table(name, rows)));
  return path;
}

test("subzones: every named area under a zone's own area, with that zone; leftovers and other areas left out", () => {
  expect(buildClientPlaces(snapshot(tables)).subzones).toEqual([
    { id: 87, name: "Goldshire", uiMapId: 1429 },
    { id: 88, name: "Lion's Pride Inn", uiMapId: 1429 },
  ]);
});

test("points of interest: name and world position, with the zone their area leads to when it leads to one", () => {
  expect(buildClientPlaces(snapshot(tables)).pois).toEqual([
    { id: 3, name: "Goldshire", continentId: 0, worldX: -9464, worldY: 62.1, uiMapId: 1429 },
    { id: 4, name: "Darkshire", continentId: 0, worldX: -10564.7, worldY: -1170.6 },
  ]);
});

test("the file parses back, one place per line", () => {
  const file = join(mkdtempSync(join(tmpdir(), "kb-places-out-")), "client-places.json");
  const out = writeClientPlaces(snapshot(tables), file);
  expect(out.schema).toBe("everloot.client-places/1");
  const text = readFileSync(file, "utf8");
  expect(ClientPlaces.parse(JSON.parse(text))).toEqual(out);
  expect(text).toContain('\n  {"id":87,"name":"Goldshire","uiMapId":1429}');
});
