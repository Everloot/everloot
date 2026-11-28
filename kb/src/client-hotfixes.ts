/**
 * Rows the game client's hotfix cache holds for the table rows the build's files lack.
 *
 * Forever's `Item` table lists about 12,600 items whose `ItemSparse` row (name, quality, item level, tooltip) is not
 * in the files on Blizzard's CDN: the server sends those rows as hotfixes, which every client of the region receives
 * and keeps in its cache (`_forever_/Cache/ADB/enUS/DBCache.bin`). Read with the table's own file and layout, the
 * cache gives those rows back exactly as the client shows them.
 *
 * What this does and does not do:
 * - Only the entries of the table being read are handed to the reader (`onlyTable`). The cache also carries key
 *   rows; they are never read, kept or passed on, and nothing is decrypted.
 * - A hotfix row is kept only for an id the file's table has no row for. A row the file has stays as the file has
 *   it; how many hotfixes change or remove a file row is counted, not applied.
 * - The rows go into a new snapshot file, in tables of their own (`hotfixTable`), beside the file's tables, with the
 *   cache's build and checksum in its manifest. The snapshot read from the CDN is not changed.
 * - Readers that want them ask for them (`withHotfixes`); every other reader sees the files alone.
 */
import { ADBReader } from "@rhyster/wow-casc-dbc";
import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TableSource } from "./client-extract.js";
import { CLIENT_TABLES, readClientManifest, readClientMeta, type ClientManifest } from "./client-snapshot.js";
import { sha256File } from "./snapshot.js";
import type { Row, Rows, TableReader } from "./talents/build-catalog.js";

/** The tables whose missing rows the hotfix cache fills. ItemSparse only: in 1.60.1.71139 the cache adds no `Item` rows. */
export const HOTFIX_TABLES = ["ItemSparse"] as const;

/** The snapshot table that holds a table's hotfix rows. */
export const hotfixTable = (table: string) => `Hotfix.${table}`;

/** A reader that adds each table's hotfix rows for ids the file's table lacks. A table the file lacks stays absent. */
export function withHotfixes(get: TableReader): TableReader {
  const merged = new Map<string, Rows | undefined>();
  return (table) => {
    if (!(HOTFIX_TABLES as readonly string[]).includes(table)) return get(table);
    if (!merged.has(table)) {
      const base = get(table), extra = get(hotfixTable(table));
      if (!base || !extra?.size) merged.set(table, base);
      else {
        const rows: Rows = new Map(base);
        for (const [id, row] of [...extra].sort((a, b) => a[0] - b[0])) if (!rows.has(id)) rows.set(id, row);
        merged.set(table, rows);
      }
    }
    return merged.get(table);
  };
}

/** One entry of the cache, as the extraction library reads it. */
export interface HotfixEntry { regionID: number; pushID: number; uniqueID: number; tableHash: number; recordID: number; dataSize: number; recordState: number; data: Buffer }
/** The cache, as the extraction library reads it. */
export interface HotfixCache { build: number; entries: HotfixEntry[]; tableEntries: Map<number, HotfixEntry[]> }

/** The cache cut down to one table's entries, so the reader of that table is handed nothing else. */
export function onlyTable(cache: HotfixCache, tableHash: number): HotfixCache {
  const entries = cache.tableEntries.get(tableHash) ?? [];
  return { build: cache.build, entries, tableEntries: new Map([[tableHash, entries]]) };
}

/** The reader's hotfixes, split: rows for ids the file lacks (kept), and counts of the rows they change or remove. */
export function splitHotfixes(fileIds: ReadonlySet<number>, hotfixes: ReadonlyMap<number, { type: "modify" | "delete" }>, rowOf: (id: number) => Row | undefined) {
  const added = new Map<number, Row>();
  let modified = 0, deleted = 0, unreadable = 0;
  for (const [id, h] of [...hotfixes].sort((a, b) => a[0] - b[0])) {
    if (h.type === "delete") deleted += 1;
    else if (fileIds.has(id)) modified += 1;
    else {
      const row = rowOf(id);
      if (row) added.set(id, row);
      else unreadable += 1;
    }
  }
  return { added, modified, deleted, unreadable };
}

/**
 * The sections of a table file (WDC5) that need a key, and how many records they hold, from the file's header: a
 * section with a key hash is one the client cannot read without that key. Nothing is decrypted.
 */
export function encryptedSections(buffer: Buffer): { sections: number; records: number } {
  if (buffer.byteLength < 204) return { sections: 0, records: 0 };
  const count = buffer.readUInt32LE(200);
  let sections = 0, records = 0;
  for (let i = 0; i < count && 204 + (i + 1) * 40 <= buffer.byteLength; i++) {
    const at = 204 + i * 40;
    if (buffer.readBigUInt64LE(at) === 0n) continue;
    sections += 1;
    // A sparse table's section counts its records in the offset map; a plain one in its record count.
    records += buffer.readUInt32LE(at + 32) || buffer.readUInt32LE(at + 12);
  }
  return { sections, records };
}

/** One table read with the cache: its hotfix rows for ids the file lacks, and what else the cache does to it. */
export interface HotfixTableRead {
  table: string;
  fileDataID: number;
  cKey: string | null;
  added: Map<number, Row>;
  modified: number;
  deleted: number;
  unreadable: number;
  encrypted: { sections: number; records: number };
}

export interface HotfixManifest extends ClientManifest {
  hotfixes: {
    cache: { build: number; sha256: string };
    tables: { table: string; added: number; modified: number; deleted: number; unreadable: number; encryptedSections: number; encryptedRecords: number }[];
  };
}

/** The client's hotfix cache file, read with the extraction library, and its checksum. Nothing in it is decrypted. */
export function readHotfixCache(path: string): { cache: HotfixCache; sha256: string } {
  return { cache: new ADBReader(readFileSync(path)), sha256: sha256File(path) };
}

/**
 * One run: reads each of HOTFIX_TABLES from the source (the snapshot's own build on the CDN) with the cache, and
 * writes the hotfix snapshot. Refuses a source of another build.
 */
export async function runClientHotfixes(opts: { snapshotPath: string; cachePath: string; outPath: string; source: TableSource; sourceBuildConfig: string }): Promise<HotfixManifest> {
  const meta = readClientMeta(opts.snapshotPath);
  if (opts.sourceBuildConfig !== meta.buildConfig) throw new Error(`the CDN serves build config ${opts.sourceBuildConfig.slice(0, 8)}, the snapshot is ${meta.buildConfig.slice(0, 8)}`);
  if (!opts.source.readHotfixes) throw new Error("this source cannot read tables with the hotfix cache");
  const { cache, sha256 } = readHotfixCache(opts.cachePath);
  if (cache.build !== meta.buildId) throw new Error(`the hotfix cache is from build ${cache.build}, the snapshot from build ${meta.buildId}`);
  const reads: HotfixTableRead[] = [];
  for (const table of HOTFIX_TABLES) {
    const fileDataID = CLIENT_TABLES[table];
    const read = await opts.source.readHotfixes(fileDataID, cache);
    if (read) reads.push({ table, fileDataID, ...read });
  }
  return writeHotfixSnapshot(opts.snapshotPath, opts.outPath, { build: cache.build, sha256 }, reads);
}

/**
 * Writes `outPath`: a copy of the snapshot with each table's hotfix rows in `hotfixTable(table)`, and a manifest that
 * records the cache's build and checksum. Refuses a cache of another build and an output that is the input.
 */
export function writeHotfixSnapshot(inPath: string, outPath: string, cache: { build: number; sha256: string }, reads: HotfixTableRead[]): HotfixManifest {
  if (resolve(inPath) === resolve(outPath)) throw new Error("the hotfix snapshot is a new file; it is never written over its input");
  const meta = readClientMeta(inPath);
  if (cache.build !== meta.buildId) throw new Error(`the hotfix cache is from build ${cache.build}, the snapshot from build ${meta.buildId}`);
  const partial = `${outPath}.partial`;
  mkdirSync(dirname(outPath), { recursive: true });
  rmSync(partial, { force: true });
  copyFileSync(inPath, partial);
  const db = new Database(partial);
  try {
    db.transaction(() => {
      const put = db.prepare("INSERT OR REPLACE INTO client_rows (tbl, id, raw) VALUES (?, ?, ?)");
      for (const r of reads) for (const [id, row] of r.added) put.run(hotfixTable(r.table), id, JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('hotfixCache', ?)").run(JSON.stringify(cache));
    })();
  } finally {
    db.close();
  }
  renameSync(partial, outPath);
  const base = readClientManifest(inPath) ?? { ...meta, tables: [], missing: [], sha256: "" };
  const manifest: HotfixManifest = {
    ...base,
    tables: [...base.tables, ...reads.map((r) => ({ table: hotfixTable(r.table), fileDataID: r.fileDataID, cKey: r.cKey, rows: r.added.size, encryptedBlocks: 0 }))],
    hotfixes: {
      cache,
      tables: reads.map((r) => ({ table: r.table, added: r.added.size, modified: r.modified, deleted: r.deleted, unreadable: r.unreadable, encryptedSections: r.encrypted.sections, encryptedRecords: r.encrypted.records })),
    },
    sha256: sha256File(outPath),
  };
  writeFileSync(`${outPath}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
