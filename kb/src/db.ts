import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { allTerms } from "./search.js";
import { syncSources } from "./sources.js";

export type DB = Database.Database;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  licence TEXT NOT NULL,
  publishable INTEGER NOT NULL CHECK (publishable IN (0, 1)),
  homepage TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('item','npc','object','quest','zone','spell','lore_page','creator','realm','achievement','faction','title','quest_chain','mount','legacy_perk','race','instance','build')),
  ext_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  game_version TEXT NOT NULL CHECK (game_version IN ('forever','classic','retail','lore')),
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_url TEXT NOT NULL,
  licence TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  UNIQUE (source_id, kind, ext_id)
);
CREATE INDEX IF NOT EXISTS entities_name ON entities(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS entities_type_name ON entities(json_extract(data, '$.type'), name COLLATE NOCASE);
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts
  USING fts5(name, body, content='entities', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, body) VALUES (new.id, new.name, new.body);
END;
CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, body) VALUES ('delete', old.id, old.name, old.body);
END;
CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, body) VALUES ('delete', old.id, old.name, old.body);
  INSERT INTO entities_fts(rowid, name, body) VALUES (new.id, new.name, new.body);
END;
CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  addNameNorm(db);
  syncSources(db);
  return db;
}

/**
 * `entities.name_norm` holds allTerms(name), so the exact-name search is an index lookup. It is
 * added with ALTER TABLE rather than in SCHEMA so a new and an upgraded database end up with the
 * same table definition; releases built before it lack the column and search falls back.
 */
function addNameNorm(db: DB): void {
  const cols = db.pragma("table_info(entities)") as { name: string }[];
  if (!cols.some((c) => c.name === "name_norm")) db.exec("ALTER TABLE entities ADD COLUMN name_norm TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS entities_name_norm ON entities(name_norm, kind)");
  fillNameNorm(db, false);
}

/**
 * Sets name_norm where it is missing, or with `checkAll` also where it no longer matches the name.
 * Returns the rows changed.
 */
export function fillNameNorm(db: DB, checkAll: boolean): number {
  const rows = db
    .prepare(`SELECT id, name, name_norm AS norm FROM entities${checkAll ? "" : " WHERE name_norm IS NULL"}`)
    .all() as { id: number; name: string; norm: string | null }[];
  const set = db.prepare("UPDATE entities SET name_norm = ? WHERE id = ?");
  let n = 0;
  db.transaction(() => {
    for (const r of rows) {
      const norm = allTerms(r.name);
      if (norm !== r.norm) {
        set.run(norm, r.id);
        n++;
      }
    }
  })();
  return n;
}

const CORE_TABLES = ["sources", "entities", "entities_fts"];

/**
 * Open an existing, populated knowledge base for reading. This is the only opener the MCP
 * service may use: it never creates a file, never initializes a schema, never syncs sources and
 * never writes — including the FTS checks, which write. A missing, empty or foreign file is a
 * startup failure rather than a healthy-looking empty knowledge base.
 */
export function openExistingReadOnlyDb(path: string): DB {
  const target = path.trim();
  if (!target) throw new Error("knowledge base path is blank: pass an explicit --db path");
  if (!existsSync(target)) throw new Error(`knowledge base not found: ${target}`);
  const db = new Database(target, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
    );
    const missing = CORE_TABLES.filter((name) => !tables.has(name));
    if (missing.length > 0) throw new Error(`knowledge base is not an Everloot KB: missing tables ${missing.join(", ")}`);
    const { n } = db.prepare("SELECT count(*) AS n FROM entities").get() as { n: number };
    if (n < 1) throw new Error("knowledge base has no entities: refusing to serve an empty knowledge base");
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}
