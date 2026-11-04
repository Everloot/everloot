import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientTitles, ClientTitles, writeClientTitles } from "../src/client-titles.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-03T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

const tables: Record<string, Rows> = {
  CharTitles: [
    [2, { Name_lang: "   " }],
    [3, { Name_lang: "Test Title [DNT]" }],
    [1, { Name_lang: "%s, Champion of the Frozen Wastes" }],
  ],
};

function snapshot(t: Record<string, Rows>): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-titles-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(t).map(([name, rows]) => table(name, rows)));
  return path;
}

test("titles: id and name with the placeholder kept", () => {
  expect(buildClientTitles(snapshot(tables)).titles).toEqual([{ id: 1, name: "%s, Champion of the Frozen Wastes" }]);
});

test("titles: build-stamped, and the file reads back", () => {
  const path = snapshot(tables);
  const out = buildClientTitles(path);
  expect(out.schema).toBe("everloot.client-titles/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70707" });
  const file = join(mkdtempSync(join(tmpdir(), "kb-titles-")), "out.json");
  writeClientTitles(path, file);
  expect(ClientTitles.parse(JSON.parse(readFileSync(file, "utf8")))).toEqual(out);
});

test("titles: a snapshot without the table gives an empty list", () => {
  expect(buildClientTitles(snapshot({ Other: [[1, { X: 1 }]] })).titles).toEqual([]);
});
