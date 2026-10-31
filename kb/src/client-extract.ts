/**
 * Read client tables of the current build of a product from Blizzard's CDN: the files the launcher
 * downloads for every player. Encrypted blocks are skipped, never decrypted: this module loads no
 * decryption keys and no listfile (tables are found by their stable file data ids).
 */
import { CASCClient, DBDParser, WDCReader } from "@rhyster/wow-casc-dbc";
import { CLIENT_TABLES, type ExtractedTable } from "./client-snapshot.js";

/** The extraction library and version, recorded in every manifest. Kept equal to kb's pinned dependency (tested). */
export const CASC_LIBRARY = "@rhyster/wow-casc-dbc@2.16.19";

export interface TableRead {
  cKey: string | null;
  encryptedBlocks: number;
  rows: Map<number, Record<string, unknown>>;
}

/** Where tables come from: Blizzard's CDN in production, a fake in tests. Null: not in this build. */
export interface TableSource {
  read(fileDataID: number): Promise<TableRead | null>;
  /** Whether a file is in the build's root listing, and whether its content is flagged encrypted. Reads no file content. */
  fileStatus?(fileDataID: number): FileStatus;
  /** The raw bytes of a non-table file (an icon, a texture). Encrypted blocks are left out and counted, never decrypted. Null: not in this build. */
  readFile?(fileDataID: number): Promise<FileRead | null>;
}

export interface FileRead {
  cKey: string;
  buffer: Buffer;
  /** Blocks that need a key we do not have. Above zero, the buffer is incomplete and must not be used. */
  encryptedBlocks: number;
}

export type FileStatus = "present" | "encrypted" | "absent";
/** Name of the table that holds file statuses in a snapshot; its rows are keyed by file data id. */
export const FILE_STATUS_TABLE = "FileStatus";

/**
 * Looks up each file data id in the build's root listing (no download) and returns the answers as a
 * snapshot table. The files themselves are not read or exported. Null when the source cannot say.
 */
export function probeFiles(source: TableSource, ids: Iterable<number>): ExtractedTable | null {
  if (!source.fileStatus) return null;
  const rows = new Map<number, Record<string, unknown>>();
  for (const id of new Set(ids)) if (id > 0) rows.set(id, { ID: id, Status: source.fileStatus(id) });
  return { table: FILE_STATUS_TABLE, fileDataID: 0, cKey: null, encryptedBlocks: 0, rows };
}

/** The icon file ids that spells refer to (SpellMisc.SpellIconFileDataID) among the extracted tables. */
export function iconIds(tables: ExtractedTable[]): number[] {
  const misc = tables.find((t) => t.table === "SpellMisc");
  return [...(misc?.rows.values() ?? [])].map((r) => Number(r.SpellIconFileDataID)).filter((n) => Number.isFinite(n) && n > 0);
}

export const DEFS_RAW = "https://raw.githubusercontent.com/wowdev/WoWDBDefs/master/";

/** A fetch that reads WoWDBDefs files at commit `sha` instead of the moving master branch. Other URLs pass through. */
export function pinnedFetch(real: typeof fetch, sha: string): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return real(url.startsWith(DEFS_RAW) ? url.replace("/WoWDBDefs/master/", `/WoWDBDefs/${sha}/`) : input, init);
  }) as typeof fetch;
}

/**
 * Resolves WoWDBDefs master to a commit once, then makes every layout the library fetches in this process
 * come from that commit, so the recorded sha is the one actually used. Returns the first 12 characters, or
 * null when GitHub cannot be reached (the library then reads master and the snapshot says "unknown").
 */
export async function pinDefinitions(real: typeof fetch = globalThis.fetch, ref = "master"): Promise<string | null> {
  try {
    const res = await real(`https://api.github.com/repos/wowdev/WoWDBDefs/commits/${encodeURIComponent(ref)}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const sha = String((await res.json() as { sha: unknown }).sha);
    if (!/^[0-9a-f]{40}$/.test(sha)) return null;
    globalThis.fetch = pinnedFetch(real, sha);
    return sha.slice(0, 12);
  } catch {
    return null;
  }
}

export interface MissingTable { table: string; reason: string }
/** The reason given for a table the build does not have; any other reason is a failure. */
export const NOT_IN_BUILD = "not in this build";

/** One table failing to read (say, no WoWDBDefs layout for this build) is recorded and the rest still run. */
export async function extractTables(source: TableSource): Promise<{ tables: ExtractedTable[]; missing: MissingTable[] }> {
  const tables: ExtractedTable[] = [];
  const missing: MissingTable[] = [];
  for (const [table, fileDataID] of Object.entries(CLIENT_TABLES)) {
    try {
      const read = await source.read(fileDataID);
      if (read) tables.push({ table, fileDataID, ...read });
      else missing.push({ table, reason: NOT_IN_BUILD });
    } catch (err) {
      missing.push({ table, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { tables, missing };
}

export interface CdnBuild {
  product: string;
  buildConfig: string;
  buildId: number;
  version: string;
}

/** The product's current build on Blizzard's CDN, and a table source for it. */
export async function openCdn(product: string, region = "us"): Promise<{ build: CdnBuild; source: TableSource }> {
  const version = await CASCClient.getProductVersion(region, product);
  if (!version) throw new Error(`${product} has no version on the ${region} CDN`);
  const client = new CASCClient(region, product, version, 0);
  await client.init();
  const source: TableSource = {
    fileStatus(fileDataID) {
      const keys = client.getContentKeysByFileDataID(fileDataID);
      if (!keys?.length) return "absent";
      const chosen = keys.find((k) => k.localeFlags & CASCClient.LocaleFlags.enUS) ?? keys[0];
      return chosen.contentFlags & CASCClient.ContentFlags.Encrypted ? "encrypted" : "present";
    },
    async readFile(fileDataID) {
      const keys = client.getContentKeysByFileDataID(fileDataID);
      if (!keys?.length) return null;
      const chosen = keys.find((k) => k.localeFlags & CASCClient.LocaleFlags.enUS) ?? keys[0];
      const result = await client.getFileByContentKey(chosen.cKey, true);
      return { cKey: chosen.cKey, buffer: result.buffer, encryptedBlocks: result.blocks?.length ?? 0 };
    },
    async read(fileDataID) {
      const keys = client.getContentKeysByFileDataID(fileDataID);
      if (!keys?.length) return null;
      const chosen = keys.find((k) => k.localeFlags & CASCClient.LocaleFlags.enUS) ?? keys[0];
      const result = await client.getFileByContentKey(chosen.cKey, true);
      const reader = new WDCReader(result.buffer, result.blocks ?? []);
      const parser = await DBDParser.parse(reader);
      const rows = new Map<number, Record<string, unknown>>();
      for (const id of parser.getAllIDs()) {
        const row = parser.getRowData(id);
        if (row) rows.set(id, row as Record<string, unknown>);
      }
      return { cKey: chosen.cKey, encryptedBlocks: result.blocks?.length ?? 0, rows };
    },
  };
  return {
    build: { product, buildConfig: version.BuildConfig, buildId: Number(version.BuildId), version: version.VersionsName },
    source,
  };
}
