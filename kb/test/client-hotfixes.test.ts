import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  encryptedSections, hotfixTable, onlyTable, splitHotfixes, withHotfixes, writeHotfixSnapshot,
} from "../src/client-hotfixes.js";
import { readClientMeta, readClientRows, writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";
import { sha256File } from "../src/snapshot.js";
import type { Rows } from "../src/talents/build-catalog.js";

// Made-up rows; the ids and names are invented.
const meta: ClientBuildMeta = {
  product: "wowf", buildConfig: "7a16decda3672d84db0d34d0784fda98", buildId: 71139, version: "1.60.1.71139",
  extractedAt: "2026-11-25T00:00:00.000Z", library: "@rhyster/wow-casc-dbc@2.16.21", definitions: "abc1234",
};
const table = (name: string, fileDataID: number, rows: [number, Record<string, unknown>][]): ExtractedTable =>
  ({ table: name, fileDataID, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

function snapshot() {
  const dir = mkdtempSync(join(tmpdir(), "kb-hotfix-"));
  const path = join(dir, "wowf-71139-7a16decd.sqlite");
  writeClientSnapshot(path, meta, [
    table("ItemSparse", 1572924, [[10, { ID: 10, Display_lang: "Plain Sword", OverallQualityID: 1 }]]),
    table("Item", 841626, [[10, { ID: 10, ClassID: 2 }], [20, { ID: 20, ClassID: 2 }]]),
  ]);
  return { dir, path };
}

test("a hotfix row fills only an id the file's table lacks; the file's own row stays, and other tables pass through", () => {
  const tables: Record<string, Rows> = {
    ItemSparse: new Map([[10, { ID: 10, Display_lang: "Plain Sword" }]]),
    [hotfixTable("ItemSparse")]: new Map([[10, { ID: 10, Display_lang: "Other Sword" }], [20, { ID: 20, Display_lang: "Server Dagger" }]]),
    Item: new Map([[10, { ID: 10 }]]),
  };
  const get = withHotfixes((n) => tables[n]);
  expect([...get("ItemSparse")!.entries()]).toEqual([[10, { ID: 10, Display_lang: "Plain Sword" }], [20, { ID: 20, Display_lang: "Server Dagger" }]]);
  expect(get("Item")).toBe(tables.Item);
  // Without hotfix rows, the reader hands back the file's rows as they are.
  const plain: Record<string, Rows> = { ItemSparse: tables.ItemSparse };
  expect(withHotfixes((n) => plain[n])("ItemSparse")).toBe(plain.ItemSparse);
  // A table the file lacks altogether is not made up from hotfix rows alone.
  expect(withHotfixes((n) => (n === hotfixTable("ItemSparse") ? tables[n] : undefined))("ItemSparse")).toBeUndefined();
});

test("only the table being read is handed to the reader: the cache's key rows and other tables never are", () => {
  const entry = (tableHash: number, recordID: number) => ({ regionID: 91, pushID: 5, uniqueID: 1, tableHash, recordID, dataSize: 0, recordState: 1, data: Buffer.alloc(0) });
  const keys = 0x0218_d2bb; // a key table's hash: present in a real cache, and never passed on
  const cache = { build: 71139, entries: [entry(0x919be54e, 1), entry(keys, 2)], tableEntries: new Map([[0x919be54e, [entry(0x919be54e, 1)]], [keys, [entry(keys, 2)]]]) };
  const only = onlyTable(cache, 0x919be54e);
  expect([...only.tableEntries.keys()]).toEqual([0x919be54e]);
  expect(only.entries.map((e) => e.tableHash)).toEqual([0x919be54e]);
  expect(only.build).toBe(71139);
  expect(onlyTable(cache, 0x1234).entries).toEqual([]);
});

test("hotfixes split into rows the file lacks, rows they change and rows they remove", () => {
  const split = splitHotfixes(new Set([1, 2, 3]), new Map([[2, { type: "modify" as const }], [3, { type: "delete" as const }], [9, { type: "modify" as const }], [8, { type: "modify" as const }]]), (id) => (id === 8 ? undefined : { ID: id }));
  expect([...split.added]).toEqual([[9, { ID: 9 }]]);
  expect(split).toMatchObject({ modified: 1, deleted: 1, unreadable: 1 });
});

test("the encrypted sections of a table are counted from its header, with the records they hold", () => {
  // A WDC5 header of 204 bytes, then one 40-byte header per section: the key hash first, the record count at +12
  // and the sparse id count at +32.
  const buf = Buffer.alloc(204 + 3 * 40);
  buf.writeUInt32LE(3, 200);
  const section = (i: number, key: bigint, records: number, sparse: number) => {
    buf.writeBigUInt64LE(key, 204 + i * 40);
    buf.writeUInt32LE(records, 204 + i * 40 + 12);
    buf.writeUInt32LE(sparse, 204 + i * 40 + 32);
  };
  section(0, 0n, 500, 500);
  section(1, 0xabcdefn, 0, 7);
  section(2, 0x123n, 4, 0);
  expect(encryptedSections(buf)).toEqual({ sections: 2, records: 11 });
  expect(encryptedSections(Buffer.alloc(10))).toEqual({ sections: 0, records: 0 });
});

test("a hotfix snapshot is a new file: the hotfix rows in tables of their own, the cache recorded, the original untouched", () => {
  const { dir, path } = snapshot();
  const before = sha256File(path);
  const out = join(dir, "staging", "wowf-71139-7a16decd.sqlite");
  const manifest = writeHotfixSnapshot(path, out, { build: 71139, sha256: "f".repeat(64) }, [
    { table: "ItemSparse", fileDataID: 1572924, cKey: "d".repeat(32), added: new Map([[20, { ID: 20, Display_lang: "Server Dagger", OverallQualityID: 2 }]]), modified: 3, deleted: 1, unreadable: 0, encrypted: { sections: 15, records: 89 } },
  ]);
  expect(sha256File(path)).toBe(before);
  expect(readClientRows(out, hotfixTable("ItemSparse"))).toEqual(new Map([[20, { ID: 20, Display_lang: "Server Dagger", OverallQualityID: 2 }]]));
  expect(readClientRows(out, "ItemSparse")).toEqual(readClientRows(path, "ItemSparse"));
  expect(readClientMeta(out)).toMatchObject({ buildId: 71139, version: "1.60.1.71139" });
  expect(manifest.sha256).toBe(sha256File(out));
  expect(manifest.tables.at(-1)).toEqual({ table: hotfixTable("ItemSparse"), fileDataID: 1572924, cKey: "d".repeat(32), rows: 1, encryptedBlocks: 0 });
  expect(manifest.hotfixes).toEqual({ cache: { build: 71139, sha256: "f".repeat(64) }, tables: [{ table: "ItemSparse", added: 1, modified: 3, deleted: 1, unreadable: 0, encryptedSections: 15, encryptedRecords: 89 }] });
  expect(JSON.parse(readFileSync(`${out}.manifest.json`, "utf8"))).toEqual(manifest);
  expect(existsSync(`${out}.partial`)).toBe(false);
});

test("a hotfix snapshot is refused for another build's cache, and never written over its input", () => {
  const { dir, path } = snapshot();
  expect(() => writeHotfixSnapshot(path, join(dir, "x.sqlite"), { build: 71091, sha256: "f".repeat(64) }, [])).toThrow(/71091.*71139/);
  expect(() => writeHotfixSnapshot(path, path, { build: 71139, sha256: "f".repeat(64) }, [])).toThrow(/its input/);
});
