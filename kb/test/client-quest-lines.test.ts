import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientQuestLines, ClientQuestLines, writeClientQuestLines } from "../src/client-quest-lines.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-03T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

const tables: Record<string, Rows> = {
  QuestLine: [
    [1, { Name_lang: "The Missing Diplomat" }],
    [2, { Name_lang: "Lonely" }],
    [3, { Name_lang: "" }],
    [4, { Name_lang: "<TEST> Line" }],
  ],
  QuestLineXQuest: [
    [100, { QuestLineID: 1, QuestID: 10, OrderIndex: 1 }],
    [101, { QuestLineID: 1, QuestID: 11, OrderIndex: 0 }],
    [102, { QuestLineID: 3, QuestID: 12, OrderIndex: 0 }],
  ],
};

function snapshot(t: Record<string, Rows>): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-quest-lines-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(t).map(([name, rows]) => table(name, rows)));
  return path;
}

test("quest lines: quest ids in order index order; a line with no quests keeps an empty list", () => {
  expect(buildClientQuestLines(snapshot(tables)).questLines).toEqual([
    { id: 1, name: "The Missing Diplomat", questIds: [11, 10] },
    { id: 2, name: "Lonely", questIds: [] },
  ]);
});

test("quest lines: build-stamped, and the file reads back", () => {
  const path = snapshot(tables);
  const out = buildClientQuestLines(path);
  expect(out.schema).toBe("everloot.client-quest-lines/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70707" });
  const file = join(mkdtempSync(join(tmpdir(), "kb-quest-lines-")), "out.json");
  writeClientQuestLines(path, file);
  expect(ClientQuestLines.parse(JSON.parse(readFileSync(file, "utf8")))).toEqual(out);
});

test("quest lines: a snapshot without QuestLineXQuest still lists the lines, empty", () => {
  const path = snapshot({ QuestLine: [[1, { Name_lang: "Solo" }]] });
  expect(buildClientQuestLines(path).questLines).toEqual([{ id: 1, name: "Solo", questIds: [] }]);
});

test("quest lines: a snapshot without QuestLine gives an empty list", () => {
  expect(buildClientQuestLines(snapshot({ Other: [[1, { X: 1 }]] })).questLines).toEqual([]);
});
