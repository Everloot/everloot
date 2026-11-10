import { AwsClient } from "aws4fetch";
import { buildDatabaseActivity, recentFacts, type DatabaseActivity } from "./database-activity";
import { STAMP, stampOf } from "./stored-view-freshness";
import { uploadStore, type R2Config } from "./upload-store";

export const DATABASE_ACTIVITY_KEY = "snapshots/database-activity.json";
const config = (): R2Config | null => {
  const c = { r2AccountId: process.env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: process.env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: process.env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? c as R2Config : null;
};
const client = (c: R2Config) => new AwsClient({ accessKeyId: c.r2AccessKeyId, secretAccessKey: c.r2SecretAccessKey, service: "s3", region: "auto" });
const url = (c: R2Config) => `https://${c.r2AccountId}.r2.cloudflarestorage.com/${c.r2Bucket}/${DATABASE_ACTIVITY_KEY}`;
type Deps = { cloud?: R2Config | null; fetch?: typeof fetch };

/** Reconstruct only the public allowlist: unknown fields in storage can never reach a reader. */
export function parseDatabaseActivity(raw: unknown): DatabaseActivity | null {
  const v = raw as DatabaseActivity | null;
  if (!v || v.version !== 1 || typeof v.generatedAt !== "string" || !Number.isFinite(Date.parse(v.generatedAt)) || !(v.dataAsOf === null || typeof v.dataAsOf === "string") || !Array.isArray(v.entries) || v.entries.length > 500) return null;
  if (!Array.isArray(v.publicKeys) || v.publicKeys.length > 100_000 || !v.publicKeys.every((k) => typeof k === "string" && /^(item|npc|quest|object|boss|entrance):\d+$/.test(k))) return null;
  const entries: DatabaseActivity["entries"] = [];
  for (const e of v.entries) {
    if (!e || !["item", "npc", "quest", "object", "boss", "entrance"].includes(e.kind) || !Number.isInteger(e.id) || e.id <= 0 || typeof e.name !== "string" || !Number.isInteger(e.installs) || e.installs < 3 || typeof e.publicAt !== "string" || !Number.isFinite(Date.parse(e.publicAt)) || typeof e.path !== "string" || !/^\/database\/(items|npcs|quests|objects|instances)\/\d+$/.test(e.path)) return null;
    entries.push({ kind: e.kind, id: e.id, name: e.name, installs: e.installs, path: e.path, publicAt: e.publicAt, ...(e.estimated ? { estimated: true } : {}) });
  }
  return { version: 1, generatedAt: v.generatedAt, dataAsOf: v.dataAsOf, publicKeys: v.publicKeys, entries };
}

/** No corpus fallback and no success cache for an unreadable file. */
export async function loadDatabaseActivity(deps: Deps = {}): Promise<DatabaseActivity | null> {
  const cloud = deps.cloud === undefined ? config() : deps.cloud;
  if (!cloud) return null;
  try {
    const res = await (deps.fetch ?? fetch)(await client(cloud).sign(url(cloud), { headers: { "accept-encoding": "identity" } }), { cache: "no-store" });
    const file = res.ok ? parseDatabaseActivity(await res.json()) : null;
    return file ? { ...file, entries: recentFacts(file.entries) } : null;
  } catch { return null; }
}

/** Idle runs skip only with a matching stamp. A failed PUT leaves the old stamp and is retried. */
export async function writeDatabaseActivity(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: Deps & { build?: (previous: DatabaseActivity | null) => Promise<DatabaseActivity> } = {}): Promise<{ written: boolean; entries?: number }> {
  const cloud = deps.cloud === undefined ? config() : deps.cloud;
  if (!cloud) throw new Error("database activity needs the cloud store");
  const doFetch = deps.fetch ?? fetch;
  const c = client(cloud);
  if (opts.added <= 0 && !opts.rebuild) {
    try {
      const head = await doFetch(await c.sign(url(cloud), { method: "HEAD" }));
      if (head.ok && head.headers.get(STAMP) === stampOf(opts.dataAsOf)) return { written: false };
    } catch { /* Unknown freshness cannot count as a matching stamp. */ }
  }
  const read = await doFetch(await c.sign(url(cloud), { headers: { "accept-encoding": "identity" } }), { cache: "no-store" });
  const previous = read.status === 404 ? null : read.ok ? parseDatabaseActivity(await read.json()) : null;
  // An outage must not erase publication dates or turn the next run into a fresh historical backfill.
  if (read.status !== 404 && !previous) throw new Error("previous database activity is unreadable");
  const file = await (deps.build ?? (async (old) => buildDatabaseActivity(await uploadStore.loadCorpus(), new Date(), old)))(previous);
  const put = await doFetch(await c.sign(url(cloud), { method: "PUT", body: JSON.stringify(file), headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf) } }));
  if (!put.ok) throw new Error(`database activity write failed (${put.status})`);
  return { written: true, entries: file.entries.length };
}
