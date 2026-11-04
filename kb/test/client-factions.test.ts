import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientFactions, ClientFactions, writeClientFactions } from "../src/client-factions.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-03T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

const tables: Record<string, Rows> = {
  Faction: [
    [1, { Name_lang: "Stormwind", ParentFactionID: 0, ReputationIndex: 3 }],
    [2, { Name_lang: "", ParentFactionID: 0, ReputationIndex: 4 }],
    [3, { Name_lang: "<TEST> Faction", ParentFactionID: 0, ReputationIndex: 5 }],
  ],
};

function snapshot(t: Record<string, Rows>): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-factions-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(t).map(([name, rows]) => table(name, rows)));
  return path;
}

test("factions: name, parent and shown flag; empty and dev names skipped", () => {
  expect(buildClientFactions(snapshot(tables)).factions).toEqual([{ id: 1, name: "Stormwind", shown: true }]);
});

test("factions: a parent is kept, a hidden faction (ReputationIndex -1) is not shown, ids sort", () => {
  const path = snapshot({
    Faction: [
      [9, { Name_lang: "Darnassus", ParentFactionID: 8, ReputationIndex: -1 }],
      [8, { Name_lang: "Alliance Forces", ParentFactionID: 0, ReputationIndex: 0 }],
    ],
  });
  expect(buildClientFactions(path).factions).toEqual([
    { id: 8, name: "Alliance Forces", shown: true },
    { id: 9, name: "Darnassus", parentId: 8, shown: false },
  ]);
});

test("factions: no reputation slot reads as hidden whether the column holds -1 or its unsigned 255", () => {
  const path = snapshot({
    Faction: [
      [1, { Name_lang: "Signed", ParentFactionID: 0, ReputationIndex: -1 }],
      [2, { Name_lang: "Unsigned", ParentFactionID: 0, ReputationIndex: 255 }],
      [3, { Name_lang: "First slot", ParentFactionID: 0, ReputationIndex: 0 }],
    ],
  });
  expect(buildClientFactions(path).factions.map((f) => f.shown)).toEqual([false, false, true]);
});

test("factions: build-stamped, and the file reads back", () => {
  const path = snapshot(tables);
  const out = buildClientFactions(path);
  expect(out.schema).toBe("everloot.client-factions/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70707" });
  const file = join(mkdtempSync(join(tmpdir(), "kb-factions-")), "out.json");
  writeClientFactions(path, file);
  expect(ClientFactions.parse(JSON.parse(readFileSync(file, "utf8")))).toEqual(out);
});

test("factions: a snapshot without the table gives an empty list", () => {
  expect(buildClientFactions(snapshot({ Other: [[1, { X: 1 }]] })).factions).toEqual([]);
});
