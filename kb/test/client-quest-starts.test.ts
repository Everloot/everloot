import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientQuestStarts, ClientQuestStarts, serializeClientQuestStarts, writeClientQuestStarts } from "../src/client-quest-starts.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-03T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

function snapshot(t: Record<string, Rows>): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-quest-starts-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(t).map(([name, rows]) => table(name, rows)));
  return path;
}

const sparse: Rows = [
  [30, { ID: 30, Display_lang: "Sealed Letter", StartQuestID: 900 }],
  [10, { ID: 10, Display_lang: "Torn Map", StartQuestID: 901 }],
  [11, { ID: 11, Display_lang: "Plain Charm", StartQuestID: 0 }],
  [12, { ID: 12, Display_lang: "", StartQuestID: 902 }],
  [13, { ID: 13, Display_lang: "<TEST> Letter", StartQuestID: 903 }],
  [14, { ID: 14, Display_lang: "Second Copy", StartQuestID: 900 }],
];

test("quest starts: every named item that begins a quest, by item id", () => {
  expect(buildClientQuestStarts(snapshot({ ItemSparse: sparse })).starts).toEqual([[10, 901], [14, 900], [30, 900]]);
});

test("quest starts: build-stamped, one pair per line, and the file reads back", () => {
  const path = snapshot({ ItemSparse: sparse });
  const out = buildClientQuestStarts(path);
  expect(out.schema).toBe("everloot.client-quest-starts/1");
  expect(out.label).toBe("Found in game files, unconfirmed");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70707" });
  expect(serializeClientQuestStarts(out)).toContain('  [10,901],\n  [14,900],\n  [30,900]\n');
  const file = join(mkdtempSync(join(tmpdir(), "kb-quest-starts-")), "out.json");
  writeClientQuestStarts(path, file);
  expect(ClientQuestStarts.parse(JSON.parse(readFileSync(file, "utf8")))).toEqual(out);
});

test("quest starts: a snapshot without ItemSparse gives an empty list", () => {
  expect(buildClientQuestStarts(snapshot({ Other: [[1, { X: 1 }]] })).starts).toEqual([]);
});
