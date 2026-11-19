import { join } from "node:path";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { openD1Release, openPublicSnapshot } from "@kb/public-snapshot";
import { sqliteReleaseDb, type D1Like, type ReleaseDb } from "@kb/release-db";
import type { Manifest } from "@kb/snapshot";
import { keep, type Keeper } from "./kept";

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

/** After a failed open (which hashes the whole file), wait this long before trying again. */
export const RETRY_AFTER_MS = 60_000;

/**
 * An opened release is kept for the instance's life; a failure is kept for RETRY_AFTER_MS from when it failed.
 * Each request opens on its own (`share: false`, no shared promise): a Worker cancels work one request awaits on
 * another's behalf.
 */
const opened: Keeper<Release | null, void> = keep<Release | null>(async (_, _last, startedAt) => {
  try {
    const d1 = d1Release();
    if (d1) return { value: await openD1Release(d1.d1, d1.sha256), keepMs: Infinity };
    const file = openPublicSnapshot(releasePath());
    return { value: { db: sqliteReleaseDb(file.db), manifest: file.manifest }, keepMs: Infinity };
  } catch (err) {
    console.error("[release] knowledge release unavailable", err);
    // A request that opened it meanwhile keeps its handle; this failure does not replace it.
    const held = opened.last()?.value;
    return held ? { value: held, keepMs: Infinity } : { value: null, keepMs: Date.now() - startedAt + RETRY_AFTER_MS };
  }
}, { ttlMs: Infinity, share: false });

export async function getRelease(): Promise<Release | null> {
  return opened.get();
}
