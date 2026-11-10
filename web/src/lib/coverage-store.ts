import { AwsClient } from "aws4fetch";
import { COVERAGE_BUILD, coverageFor, loadCoverageExpected } from "./coverage-compute";
import { coverageKey } from "./coverage-summary";
import { cloudConfig, uploadStore, type CloudConfig } from "./upload-store";

// The key lives in coverage-summary.ts, which the home page reads without this file's corpus code.
export { coverageKey };

/**
 * Computes the coverage score from the current corpus and writes it to R2 as `coverage/<build>.json`. The snapshot
 * cron calls it after `writeSnapshot`, only when that run added uploads or rebuilt: with nothing new the score
 * cannot change, so it returns `{ written: false }` without reading anything. `dataAsOf` is the snapshot's time,
 * the one the cron heartbeat carries, so the score is dated by the last real change.
 */
export async function writeCoverage(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: {
  cloud?: CloudConfig | null; fetch?: typeof fetch; build?: string;
} = {}): Promise<{ written: boolean; key?: string; zones?: number }> {
  if (opts.added <= 0 && !opts.rebuild) return { written: false };
  const cloud = deps.cloud === undefined ? cloudConfig() : deps.cloud;
  if (!cloud) throw new Error("coverage needs the cloud store");
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable) throw new Error("corpus unreachable");
  const build = deps.build ?? COVERAGE_BUILD;
  const report = coverageFor(corpus, await loadCoverageExpected(), opts.dataAsOf ?? corpus.dataAsOf ?? null);
  const r2 = new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });
  const key = coverageKey(build);
  const url = `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${key}`;
  const put = await (deps.fetch ?? fetch)(await r2.sign(url, { method: "PUT", body: JSON.stringify({ ...report, build }), headers: { "content-type": "application/json" } }));
  if (!put.ok) throw new Error(`coverage write failed (${put.status})`);
  return { written: true, key, zones: report.zones.length };
}
