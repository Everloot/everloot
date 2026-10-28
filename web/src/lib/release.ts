import { join } from "node:path";
import { openPublicSnapshot } from "../../../kb/src/public-snapshot";
import { sqliteReleaseDb, type ReleaseDb } from "../../../kb/src/release-db";
import type { Manifest } from "../../../kb/src/snapshot";

/**
 * The approved knowledge release, opened once per instance and shared by the MCP mounts and the
 * lore pages. Every open runs the release checks (manifest, hash, no sidecars, non-empty); a
 * failure is logged and reported as null so callers answer "unavailable", never an empty archive.
 * The next call retries.
 */
export function releasePath(): string {
  return process.env.KB_SNAPSHOT_PATH?.trim() || join(process.cwd(), ".release", "2026-10-05-everloot-public.sqlite");
}

export interface Release {
  db: ReleaseDb;
  manifest: Manifest;
}

let handle: Release | null = null;
let failedAt = 0;
/** After a failed open (which hashes the whole file), wait this long before trying again. */
export const RETRY_AFTER_MS = 60_000;

export async function getRelease(): Promise<Release | null> {
  if (handle) return handle;
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return null;
  try {
    const file = openPublicSnapshot(releasePath());
    handle = { db: sqliteReleaseDb(file.db), manifest: file.manifest };
    failedAt = 0;
  } catch (err) {
    failedAt = Date.now();
    console.error("[release] knowledge release unavailable", err);
    return null;
  }
  return handle;
}
