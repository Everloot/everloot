/**
 * A knowledge release as SQL files that Cloudflare D1 imports, for the site running as a Worker
 * (docs/2026-10-28-cloudflare-workers-migration.md, section 3). Reads the release .sqlite and its
 * .manifest.json, runs the checks fetch-release.mjs runs (manifest sha256 = the file's), and writes numbered
 * files to run in order with `wrangler d1 execute <db> --file <part>` into a new, empty database:
 *
 *   the release's tables (sources, entities, api_cache) and a one-row release_meta table,
 *   their rows, as multi-row INSERTs under D1's 100 KB statement limit; a body too long for one
 *   statement is inserted with its first part and the rest appended with UPDATE ... body || '...',
 *   the indexes, then the FTS5 table, filled from entities in id ranges (one 'rebuild' over ~500 MB of text
 *   is a single statement, which risks D1's per-statement time limit), then the triggers,
 *   last, the release_meta row: the manifest and the file's sha256. Its id is 1 only when the row count per
 *   source, the total body length and the FTS index all match the release; otherwise its CHECK fails, the
 *   import stops with an error, and the site, finding no release_meta row, refuses to serve.
 *
 * Run from web/: node scripts/cf-release-d1.mjs <release.sqlite> [--out <dir>] [--part-mb <n>]
 * The release is opened read-only and never changed.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

/** D1 refuses a statement over 100 KB; stay under it with room for the statement around the values. */
export const STATEMENT_BYTES = 90_000;
/** Text indexed per FTS statement: small enough that each finishes well inside D1's time limit. */
const FTS_BATCH_BYTES = 4_000_000;
const TABLES = ["sources", "entities", "api_cache"];

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const bytes = (s) => Buffer.byteLength(s, "utf8");

/** One SQL literal. Text is quoted; a NUL would end the literal early, so it is refused rather than cut. */
export function literal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (Buffer.isBuffer(v)) return `X'${v.toString("hex")}'`;
  const s = String(v);
  if (s.includes("\0")) throw new Error("a text value holds a NUL character, which a SQL literal cannot carry");
  return `'${s.replaceAll("'", "''")}'`;
}

/**
 * `text` cut into pieces whose quoted literals are each at most `max` bytes, never inside a character
 * (a surrogate pair stays whole).
 */
export function splitText(text, max) {
  const parts = [];
  let part = "", size = 2;
  for (const ch of text) {
    const n = ch === "'" ? 2 : bytes(ch);
    if (size + n > max && part) { parts.push(part); part = ""; size = 2; }
    part += ch;
    size += n;
  }
  parts.push(part);
  return parts;
}

/** Writes statements into numbered files of at most `partBytes` each. */
class Parts {
  constructor(dir, partBytes) { this.dir = dir; this.partBytes = partBytes; this.files = []; this.buf = []; this.size = 0; this.longest = 0; }
  add(sql) {
    const line = `${sql};\n`;
    this.longest = Math.max(this.longest, bytes(sql));
    if (this.size + bytes(line) > this.partBytes && this.buf.length) this.flush();
    this.buf.push(line);
    this.size += bytes(line);
  }
  flush() {
    if (!this.buf.length) return;
    const file = join(this.dir, `${String(this.files.length + 1).padStart(4, "0")}.sql`);
    writeFileSync(file, this.buf.join(""));
    this.files.push(file);
    this.buf = []; this.size = 0;
  }
}

/** The release's own manifest: present, and naming the file's sha256. */
function readManifest(dbPath) {
  const path = `${dbPath}.manifest.json`;
  if (!existsSync(path)) throw new Error(`no manifest beside the release: ${path}`);
  const text = readFileSync(path, "utf8");
  const manifest = JSON.parse(text);
  if (typeof manifest.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.sha256)) throw new Error("the manifest has no usable sha256");
  if (typeof manifest.counts !== "object" || manifest.counts === null) throw new Error("the manifest has no counts");
  return { text, manifest };
}

/**
 * @param {{ release: string, out: string, partBytes?: number, log?: (msg: string) => void }} options
 * @returns {Promise<{ files: string[], sha256: string, rows: number, longest: number }>}
 */
export async function writeD1Release({ release, out, partBytes = 50 * 1024 * 1024, log = console.log }) {
  if (!existsSync(release)) throw new Error(`release not found: ${release}`);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${release}${suffix}`;
    if (existsSync(sidecar) && statSync(sidecar).size > 0) throw new Error(`the release has an active ${suffix} sidecar: it must be inactive`);
  }
  const { text: manifestText, manifest } = readManifest(release);
  const actual = await sha256File(release);
  if (actual !== manifest.sha256) throw new Error(`the manifest hash does not match the file: ${actual} != ${manifest.sha256}`);
  if (bytes(literal(manifestText)) > STATEMENT_BYTES - 2_000) throw new Error("the manifest is too long for one D1 statement");

  const db = new Database(release, { readonly: true, fileMustExist: true });
  try {
    const counts = Object.fromEntries(
      db.prepare("SELECT source_id AS id, count(*) AS n FROM entities GROUP BY source_id").all().map((r) => [r.id, r.n]),
    );
    for (const [id, n] of Object.entries(manifest.counts)) {
      if ((counts[id] ?? 0) !== n) throw new Error(`the manifest counts ${n} ${id} rows, the release holds ${counts[id] ?? 0}`);
    }
    if (Object.keys(counts).some((id) => !(id in manifest.counts))) throw new Error("the release holds rows from a source its manifest does not count");
    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    if (rows === 0) throw new Error("the release has no entities: refusing to write an empty archive");

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const parts = new Parts(out, partBytes);
    const master = db.prepare("SELECT type, name, tbl_name AS tbl, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid").all();
    const schema = (type, filter = () => true) => master.filter((m) => m.type === type && filter(m)).map((m) => m.sql);

    parts.add(`-- Everloot knowledge release ${basename(release)}, sha256 ${manifest.sha256}, for a new, empty D1 database\n` +
      "CREATE TABLE release_meta (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  sha256 TEXT NOT NULL,\n  manifest TEXT NOT NULL\n)");
    for (const name of TABLES) {
      const sql = master.find((m) => m.type === "table" && m.name === name)?.sql;
      if (!sql) throw new Error(`the release has no ${name} table`);
      parts.add(sql);
    }

    for (const table of TABLES) {
      const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((c) => c.name);
      const head = `INSERT INTO ${table} (${cols.join(", ")}) VALUES `;
      let tuples = [], size = bytes(head);
      const flush = () => { if (tuples.length) parts.add(head + tuples.join(",")); tuples = []; size = bytes(head); };
      for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).raw().iterate()) {
        const values = row.map(literal);
        const tuple = `(${values.join(",")})`;
        if (bytes(head) + bytes(tuple) <= STATEMENT_BYTES) {
          if (size + bytes(tuple) + 1 > STATEMENT_BYTES) flush();
          tuples.push(tuple);
          size += bytes(tuple) + 1;
          continue;
        }
        // One row longer than a statement: only entities.body is (the release's longest is ~490 KB).
        if (table !== "entities") throw new Error(`a ${table} row is longer than one D1 statement`);
        flush();
        const b = cols.indexOf("body"), id = row[cols.indexOf("id")];
        const room = STATEMENT_BYTES - bytes(head) - (bytes(tuple) - bytes(values[b])) - 10;
        const [first] = splitText(row[b], room);
        values[b] = literal(first);
        parts.add(`${head}(${values.join(",")})`);
        const append = "UPDATE entities SET body = body || ", where = ` WHERE id = ${id}`;
        for (const piece of splitText(row[b].slice(first.length), STATEMENT_BYTES - bytes(append) - bytes(where))) {
          parts.add(`${append}${literal(piece)}${where}`);
        }
      }
      flush();
    }

    for (const sql of schema("index", (m) => TABLES.includes(m.tbl))) parts.add(sql);
    const fts = master.find((m) => m.type === "table" && m.name === "entities_fts")?.sql;
    if (!fts) throw new Error("the release has no entities_fts table");
    parts.add(fts);
    // The same rows the insert trigger would index, in id ranges of about FTS_BATCH_BYTES of text.
    let from = null, to = null, text = 0;
    const ftsRange = () => { if (from !== null) parts.add(`INSERT INTO entities_fts(rowid, name, body) SELECT id, name, body FROM entities WHERE id BETWEEN ${from} AND ${to}`); from = null; text = 0; };
    for (const r of db.prepare("SELECT id, length(CAST(name AS BLOB)) + length(CAST(body AS BLOB)) AS n FROM entities ORDER BY id").iterate()) {
      if (from === null) from = r.id;
      to = r.id;
      text += r.n;
      if (text >= FTS_BATCH_BYTES) ftsRange();
    }
    ftsRange();
    for (const sql of schema("trigger", (m) => m.tbl === "entities")) parts.add(sql);

    const sums = db.prepare("SELECT count(*) AS n, coalesce(sum(length(body)), 0) AS body FROM entities").get();
    const sources = db.prepare("SELECT count(*) AS n FROM sources").get().n;
    const checks = [
      `(SELECT count(*) FROM entities) = ${sums.n}`,
      ...Object.entries(manifest.counts).map(([id, n]) => `(SELECT count(*) FROM entities WHERE source_id = ${literal(id)}) = ${n}`),
      `(SELECT coalesce(sum(length(body)), 0) FROM entities) = ${sums.body}`,
      `(SELECT count(*) FROM sources) = ${sources}`,
      `(SELECT count(*) FROM entities_fts_docsize) = ${sums.n}`,
    ];
    parts.add(`INSERT INTO release_meta (id, sha256, manifest) VALUES (\n  CASE WHEN ${checks.join("\n    AND ")} THEN 1 ELSE 0 END,\n  ${literal(manifest.sha256)},\n  ${literal(manifestText)}\n)`);
    parts.flush();
    log(`[d1] ${basename(release)}: ${rows} rows into ${parts.files.length} file(s) in ${out}, longest statement ${parts.longest} bytes`);
    return { files: parts.files, sha256: manifest.sha256, rows, longest: parts.longest };
  } finally {
    db.close();
  }
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const release = args[0];
  if (!release || release.startsWith("--")) {
    console.error("Usage: node scripts/cf-release-d1.mjs <release.sqlite> [--out <dir>] [--part-mb <n>]");
    process.exit(1);
  }
  const out = flag(args, "--out") ?? join(".release", "d1", basename(release, ".sqlite"));
  const partMb = Number(flag(args, "--part-mb") ?? 50);
  const { files, sha256 } = await writeD1Release({ release, out, partBytes: partMb * 1024 * 1024 });
  console.log(`[d1] import into a new database, in order (add --remote for Cloudflare, --local for wrangler dev):`);
  for (const file of files) console.log(`  npx wrangler d1 execute KNOWLEDGE_D1 --file ${file}`);
  console.log(`[d1] then set KNOWLEDGE_RELEASE_SHA256 to ${sha256} in wrangler.jsonc`);
}
