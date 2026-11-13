import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { canonicalJson } from "../../../kb/src/corpus";
import type { PublicationState } from "../../../kb/src/publication";
import { buildGuildRollup, type GuildRollup } from "./guild-rollup";
import { sharingStore, uploadStore, type R2Config } from "./upload-store";
import { STAMP, stampOf } from "./stored-view-freshness";

export const GUILD_LADDER_KEY = "snapshots/guild-ladder.json";
const AUTHORITY = "x-amz-meta-authority";
const KEEP_MS = 5 * 60_000;
interface StoredGuildLadder { dataAsOf: string | null; authority: string; rollup: GuildRollup }
type StorageDeps = { cloud?: R2Config | null; fetch?: typeof fetch };

function r2FromEnv(): R2Config | null {
  const c = { r2AccountId: process.env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: process.env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: process.env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? c as R2Config : null;
}
const url = (c: R2Config) => `https://${c.r2AccountId}.r2.cloudflarestorage.com/${c.r2Bucket}/${GUILD_LADDER_KEY}`;
const client = (c: R2Config) => new AwsClient({ accessKeyId: c.r2AccessKeyId, secretAccessKey: c.r2SecretAccessKey, service: "s3", region: "auto" });

/** No evidence or grant tokens are stored in the view. Expiry changes the fingerprint even without a database write. */
function authorityKey(state: PublicationState): string {
  const now = Date.now();
  return createHash("sha256").update(canonicalJson({
    grants: state.grants.filter((g) => !g.revokedAt && Date.parse(g.expiresAt) > now).sort((a, b) => a.tokenHash.localeCompare(b.tokenHash)),
    suppressions: [...state.suppressions].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
  })).digest("hex");
}

function encode(set: StoredGuildLadder): string {
  return JSON.stringify({ version: 1, set }, (_, value: unknown) => value instanceof Map ? { $map: [...value] } : value instanceof Set ? { $set: [...value] } : value);
}
function parse(text: string): StoredGuildLadder | null {
  try {
    const raw = JSON.parse(text, (_, value) => {
      if (value && typeof value === "object" && Object.keys(value).length === 1) {
        if (Array.isArray(value.$map)) return new Map(value.$map);
        if (Array.isArray(value.$set)) return new Set(value.$set);
      }
      return value;
    });
    const s = raw?.set;
    const r = s?.rollup;
    if (raw?.version !== 1 || !(s.dataAsOf === null || typeof s.dataAsOf === "string") || typeof s.authority !== "string" ||
      typeof r?.key !== "string" || !Array.isArray(r.rows) || !Array.isArray(r.instances) || !Array.isArray(r.officers) ||
      !(r.boards instanceof Map) || !(r.names instanceof Set) || !r.facts ||
      !["counts", "members", "bosses", "loot", "attendance", "gear"].every((k) => Array.isArray(r.facts[k]))) return null;
    return s as StoredGuildLadder;
  } catch { return null; }
}

/**
 * Build only from the public corpus, bracketed by authority reads: a concurrent revoke or suppression cannot stamp an
 * old published result with new authority. Even idle runs check authority, so they refresh a revoked/expired view.
 * The file is private bucket storage; it is never a shared HTTP response or a personalised answer.
 */
export async function writeGuildLadder(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: StorageDeps = {}): Promise<{ written: boolean; bytes?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the stored guild ladder needs the cloud store");
  const doFetch = deps.fetch ?? fetch;
  const before = authorityKey(await sharingStore.loadState());
  if (opts.added <= 0 && !opts.rebuild) {
    const head = await doFetch(await client(cloud).sign(url(cloud), { method: "HEAD" }));
    if (head.ok && head.headers.get(STAMP) === stampOf(opts.dataAsOf) && head.headers.get(AUTHORITY) === before) return { written: false };
    if (!head.ok && head.status !== 404) throw new Error(`guild ladder freshness failed (${head.status})`);
  }
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable) throw new Error("corpus unreachable");
  const dataAsOf = corpus.dataAsOf ?? null;
  const generatedAt = new Date().toISOString();
  const rollup = buildGuildRollup(`${dataAsOf}|${before}|${generatedAt}`, corpus.records, dataAsOf ? new Date(dataAsOf) : new Date());
  if (authorityKey(await sharingStore.loadState()) !== before) throw new Error("guild ladder authority changed during build");
  const body = encode({ dataAsOf, authority: before, rollup });
  const put = await doFetch(await client(cloud).sign(url(cloud), { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(dataAsOf), [AUTHORITY]: before } }));
  if (!put.ok) throw new Error(`guild ladder write failed (${put.status})`);
  return { written: true, bytes: new TextEncoder().encode(body).length };
}

let kept: { at: number; set: StoredGuildLadder } | null = null;
/**
 * Recheck CURRENT publication authority on every read, including a memory hit. A revoke, expiry or suppression makes
 * the stored view unusable immediately; the caller uses the live corpus until the cron rebuilds. Guild and character
 * hide lists are applied separately by loadGuildData, on every request. Storage and authority errors never serve an
 * unchecked view, and never overwrite the last file with empty data.
 */
export async function loadStoredGuildLadder(deps: StorageDeps = {}): Promise<StoredGuildLadder | null> {
  try {
    const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
    if (!cloud) return null;
    const now = Date.now();
    if (!kept || now - kept.at >= KEEP_MS) {
      const res = await (deps.fetch ?? fetch)(await client(cloud).sign(url(cloud), { method: "GET", headers: { "accept-encoding": "identity" } }));
      const set = res.ok ? parse(await res.text()) : null;
      if (!set) { kept = null; return null; }
      kept = { at: now, set };
    }
    const current = authorityKey(await sharingStore.loadState());
    return kept.set.authority === current ? kept.set : null;
  } catch { return null; }
}
export const forgetStoredGuildLadder = () => { kept = null; };
