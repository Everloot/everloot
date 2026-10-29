import type { DB } from "./db.js";

/**
 * Reads from a knowledge release, the same SQL wherever the release lives: the SQLite file through
 * better-sqlite3 (Node, tests and the CLI) or a Cloudflare D1 database (the site as a Worker).
 * Parameters are positional (`?`). Only the release's read paths go through this; build tools keep the
 * synchronous handle.
 */
export interface ReleaseDb {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
}

/** The part of a D1 binding the release reads use, so kb needs no Workers types. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
    };
  };
}

const wrapped = new WeakMap<DB, ReleaseDb>();

/** A release file opened with better-sqlite3. One reader per handle, so per-reader caches see one object. */
export function sqliteReleaseDb(db: DB): ReleaseDb {
  let reader = wrapped.get(db);
  if (!reader) {
    reader = {
      all: async <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[],
      get: async <T>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as T | undefined,
    };
    wrapped.set(db, reader);
  }
  return reader;
}

/** A release imported into D1 (web/scripts/cf-release-d1.mjs). */
export function d1ReleaseDb(d1: D1Like): ReleaseDb {
  return {
    all: async <T>(sql: string, ...params: unknown[]) => (await d1.prepare(sql).bind(...params).all<T>()).results,
    get: async <T>(sql: string, ...params: unknown[]) => (await d1.prepare(sql).bind(...params).first<T>()) ?? undefined,
  };
}

/** Either kind of release; a better-sqlite3 handle is read through `sqliteReleaseDb`. */
export type ReleaseSource = DB | ReleaseDb;

export function releaseDb(source: ReleaseSource): ReleaseDb {
  return "prepare" in source ? sqliteReleaseDb(source) : source;
}
