import { join } from "node:path";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { openD1Release, openPublicSnapshot } from "../../../kb/src/public-snapshot";
import { sqliteReleaseDb, type D1Like, type ReleaseDb } from "../../../kb/src/release-db";
import type { Manifest } from "../../../kb/src/snapshot";

/**
 * The approved knowledge release, opened once per instance and shared by the MCP mounts and the
 * lore pages. On Node (local runs, tests) it is the SQLite file; on the Worker, when a D1 binding named
 * KNOWLEDGE_D1 is present, it is the release imported into D1 (web/scripts/cf-release-d1.mjs). Every
 * open runs the release checks (manifest, hash, non-empty; for D1, the release_meta row against
 * KNOWLEDGE_RELEASE_SHA256); a failure is logged and reported as null so callers answer "unavailable",
 * never an empty archive. The next call retries.
 */
export function releasePath(): string {
  return process.env.KB_SNAPSHOT_PATH?.trim() || join(process.cwd(), ".release", "2026-10-05-everloot-public.sqlite");
}

export interface Release {
  db: ReleaseDb;
  manifest: Manifest;
}

/** The Worker's D1 release and the sha256 this deployment serves; null off Cloudflare or without the binding. */
function d1Release(): { d1: D1Like; sha256: string } | null {
  let env: Record<string, unknown>;
  try {
    env = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!env.KNOWLEDGE_D1) return null;
  return { d1: env.KNOWLEDGE_D1 as D1Like, sha256: String(env.KNOWLEDGE_RELEASE_SHA256 ?? "") };
}

let handle: Release | null = null;
let failedAt = 0;
/** After a failed open (which hashes the whole file), wait this long before trying again. */
export const RETRY_AFTER_MS = 60_000;

export async function getRelease(): Promise<Release | null> {
  if (handle) return handle;
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return null;
  // Each request opens on its own (no shared promise): a Worker cancels work one request awaits on another's behalf.
  try {
    const d1 = d1Release();
    if (d1) {
      handle = await openD1Release(d1.d1, d1.sha256);
    } else {
      const file = openPublicSnapshot(releasePath());
      handle = { db: sqliteReleaseDb(file.db), manifest: file.manifest };
    }
    failedAt = 0;
  } catch (err) {
    failedAt = Date.now();
    console.error("[release] knowledge release unavailable", err);
    return null;
  }
  return handle;
}
