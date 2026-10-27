import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientEncounters, writeClientEncounters } from "../src/client-encounters.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70630,
  version: "1.0.0.70630", extractedAt: "2026-10-27T00:00:00.000Z", library: "test", definitions: "abc1234",
};
const table = (name: string, rows: [number, Record<string, unknown>][]): ExtractedTable =>
  ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

function snapshotWith(tables: ExtractedTable[]): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-enc-")), "client.sqlite");
  writeClientSnapshot(path, meta, tables);
  return path;
}

// Synthetic rows in the shape of DungeonEncounter: two instances, one row out of order, one bound to a
// difficulty, one nameless, one on map 0 (the files' "no longer in use" rows).
const build = snapshotWith([
  table("DungeonEncounter", [
    [2, { ID: 2, Name_lang: "Second Warden", MapID: 34, DifficultyID: 0, OrderIndex: 1000 }],
    [1, { ID: 1, Name_lang: "First Warden", MapID: 34, DifficultyID: 0, OrderIndex: 0 }],
    [3, { ID: 3, Name_lang: "Heroic Warden", MapID: 34, DifficultyID: 2, OrderIndex: 2000 }],
    [4, { ID: 4, Name_lang: "  ", MapID: 34, DifficultyID: 0, OrderIndex: 3000 }],
    [5, { ID: 5, Name_lang: "Lost Row", MapID: 0, DifficultyID: 0, OrderIndex: 0 }],
    [6, { ID: 6, Name_lang: "Chasm Keeper", MapID: 389, DifficultyID: 0, OrderIndex: 0 }],
  ]),
]);

test("buildClientEncounters: per instance in order index, difficulty only when bound, nameless and map-0 rows left out", () => {
  const out = buildClientEncounters(build);
  expect(out.schema).toBe("everloot.client-encounters/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70630", definitions: "abc1234" });
  expect(out.instances).toEqual({
    "34": [{ id: 1, name: "First Warden" }, { id: 2, name: "Second Warden" }, { id: 3, name: "Heroic Warden", difficultyId: 2 }],
    "389": [{ id: 6, name: "Chasm Keeper" }],
  });
});

test("a snapshot without the table still yields a file, empty and labelled", () => {
  const empty = buildClientEncounters(snapshotWith([]));
  expect(empty.instances).toEqual({});
  expect(empty.label).toBe("Found in game files, unconfirmed");
});

test("writeClientEncounters writes one instance per line in map id order; the file parses back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-enc-out-")), "client-encounters.json");
  const written = writeClientEncounters(build, path);
  const text = readFileSync(path, "utf8");
  const order = text.split("\n").map((l) => /^  "(\d+)": /.exec(l)).filter((m) => m).map((m) => Number(m![1]));
  expect(order).toEqual([34, 389]);
  expect(JSON.parse(text).instances["34"]).toEqual(written.instances["34"]);
});
