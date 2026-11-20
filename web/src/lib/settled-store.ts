import { createHmac } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { isoWeek } from "@kb/spot-check";
import { computeSettled, emptySettledList, listOf, parseSettledFile, type SettledFile, type SettledList } from "@kb/settled-list";
import { BUILD_PATTERN } from "./settled-cache";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import { cloudConfig, uploadStore, type CloudConfig, type Corpus } from "./upload-store";

/**
 * The settled list (kb/src/settled-list.ts): where the cron keeps it, how the endpoint and the intake read it, the
 * intake's per-fact tally. The Desktop App's copy is settled-cache.ts. Spec: docs/design/specs/2026-10-21-coverage-plateau-design.md,
 * section 4.
 */

/** Beside the coverage score: the list and its values for one client build. */
export const settledKey = (build: string): string => `coverage/settled-${build}.json`;

function r2Url(cloud: CloudConfig, key: string): string {
  return `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${key}`;
}
function r2Client(cloud: CloudConfig): AwsClient {
  return new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });
}

/** The ISO week the weekly spot check picks with; the cron passes it so the heartbeat and the file agree. */
export const currentSettledWeek = (): string => isoWeek(new Date());

/**
 * Computes the settled list from the current corpus and writes it to R2, stamped with the snapshot's `dataAsOf` and
 * the ISO week. The snapshot cron calls it on every run, among the stored views after its heartbeat (#1354): a run
 * that added uploads or rebuilt writes it; any other reads only a HEAD and writes it when the stamp is not this
 * snapshot's and week's (stored-view-freshness.ts). So a run that could not write it is caught up by the next, and the
 * weekly spot check rotates even when nothing new arrives. Dated by the snapshot's `dataAsOf`, never the run's clock.
 */
export async function writeSettled(opts: { added: number; rebuild?: boolean; dataAsOf: string | null; week?: string }, deps: {
  cloud?: CloudConfig | null; fetch?: typeof fetch; build?: string; recheck?: Parameters<typeof computeSettled>[0]["recheck"]; week?: string;
  /** The corpus the caller has already read (the cron's stored views share one), so the list does not read it again. */
  corpus?: () => Promise<Corpus>;
} = {}): Promise<{ written: boolean; key?: string; facts?: number; week?: string }> {
  const cloud = deps.cloud === undefined ? cloudConfig() : deps.cloud;
  if (!cloud) throw new Error("settled list needs the cloud store");
  const doFetch = deps.fetch ?? fetch;
  // The build and the recheck scopes are the coverage score's; loaded here so the intake never parses the client layer.
  const { COVERAGE_BUILD, RECHECK_SCOPES } = deps.build && deps.recheck ? { COVERAGE_BUILD: deps.build, RECHECK_SCOPES: deps.recheck } : await import("./coverage-compute");
  const build = deps.build ?? COVERAGE_BUILD;
  const week = opts.week ?? deps.week ?? currentSettledWeek();
  const key = settledKey(build);
  const client = r2Client(cloud);
  if (opts.added <= 0 && !opts.rebuild && !await storedViewNeedsWrite(client, r2Url(cloud, key), opts.dataAsOf, doFetch, week)) return { written: false };
  const corpus = deps.corpus ? await deps.corpus() : await uploadStore.loadCorpus();
  if (corpus.unreachable) throw new Error("corpus unreachable");
  const file = computeSettled({ records: corpus.records, asOf: opts.dataAsOf ?? corpus.dataAsOf ?? null, build, recheck: deps.recheck ?? RECHECK_SCOPES, week });
  const put = await doFetch(await client.sign(r2Url(cloud, key), {
    method: "PUT", body: JSON.stringify(file), headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf, week) },
  }));
  if (!put.ok) throw new Error(`settled list write failed (${put.status})`);
  return { written: true, key, facts: Object.keys(file.values).length, week };
}

/** The file for a build: null when the cron has not written one (a new build), throws when storage is out of reach. */
export async function readSettledFile(build: string, deps: { cloud?: CloudConfig | null; fetch?: typeof fetch } = {}): Promise<SettledFile | null> {
  if (!BUILD_PATTERN.test(build) || build.length > 32) return null;
  const cloud = deps.cloud === undefined ? cloudConfig() : deps.cloud;
  if (!cloud) return null;
  const res = await (deps.fetch ?? fetch)(await r2Client(cloud).sign(r2Url(cloud, settledKey(build)), { method: "GET", headers: { "accept-encoding": "identity" } }));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`settled list read failed (${res.status})`);
  let raw: unknown;
  try { raw = JSON.parse(await res.text()); } catch { return null; }
  const file = parseSettledFile(raw);
  return file && file.build === build ? file : null;
}

/** The public list for a build: the cron's, or an empty one when it has not looked at the build yet. */
export async function readSettledList(build: string, deps: Parameters<typeof readSettledFile>[1] = {}): Promise<SettledList> {
  const file = await readSettledFile(build, deps);
  return file ? listOf(file) : emptySettledList(build);
}

const INTAKE_CACHE_MS = 10 * 60_000;
let intakeCache: { build: string; at: number; file: SettledFile | null } | null = null;

/**
 * The file the intake compares rows against, read at most every 10 minutes. Null when there is none or storage is
 * out of reach: the intake then stores every row, as it always has.
 */
export async function settledForIntake(build: string, deps: Parameters<typeof readSettledFile>[1] & { now?: () => number } = {}): Promise<SettledFile | null> {
  const now = (deps.now ?? Date.now)();
  if (intakeCache && intakeCache.build === build && now - intakeCache.at < INTAKE_CACHE_MS) return intakeCache.file;
  let file: SettledFile | null = null;
  try { file = await readSettledFile(build, deps); } catch { return intakeCache?.build === build ? intakeCache.file : null; }
  intakeCache = { build, at: now, file };
  return file;
}

/**
 * The server-side tally for settled facts (spec section 4, last paragraph): a row that matches its settled value adds
 * its install to the fact's agreeing voters instead of being stored. Off unless EVERLOOT_SETTLED_TALLY=1, which waits
 * for the owner to apply its migration and for the data policy's decision on tallies instead of rows (open question 3).
 */
export function settledTallyOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_SETTLED_TALLY === "1";
}

export interface SettledTally {
  /** Adds one install's agreement to each fact; a fact counts each install once. Throws when it was not recorded. */
  add(build: string, installId: string, facts: readonly string[]): Promise<void>;
}

/**
 * Production writes through `tally_settled_facts`, a `security definer` function like the intake quotas. The install
 * is kept only as a keyed hash, so the table counts distinct voters without holding an install id. Without Supabase
 * (local development) the tally is kept in memory.
 */
export function createSettledTally(opts: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {}): SettledTally & { local: Map<string, Set<string>> } {
  const env = opts.env ?? process.env;
  const url = env.SUPABASE_URL?.trim();
  const secret = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const local = new Map<string, Set<string>>();
  return {
    local,
    async add(build, installId, facts) {
      if (!facts.length) return;
      if (url && secret) {
        const voter = createHmac("sha256", secret).update(`settled:${installId}`).digest("hex");
        const response = await (opts.fetch ?? fetch)(`${url.replace(/\/$/, "")}/rest/v1/rpc/tally_settled_facts`, {
          method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
          headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({ p_build: build, p_voter: voter, p_facts: [...new Set(facts)] }),
        });
        if (!response.ok) throw new Error("Settled tally unavailable");
        return;
      }
      if (env.NODE_ENV === "production" || url || secret) throw new Error("Settled tally storage is not configured");
      for (const fact of facts) local.set(`${build}|${fact}`, (local.get(`${build}|${fact}`) ?? new Set<string>()).add(installId));
    },
  };
}

export const settledTally = createSettledTally();
