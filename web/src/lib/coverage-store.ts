import { AwsClient } from "aws4fetch";
import { computeCoverage } from "@kb/coverage";
import { computePlateau } from "@kb/plateau";
import { COVERAGE_BUILD, coverageInput, loadCoverageExpected } from "./coverage-compute";
import { COVERAGE_STORED_VERSION, coverageKey } from "./coverage-summary";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import { cloudConfig, uploadStore, type CloudConfig } from "./upload-store";

// The key lives in coverage-summary.ts, which the home page reads without this file's corpus code.
export { coverageKey };

/**
 * Computes the coverage score from the current corpus and writes it to R2 as `coverage/<build>.json`, stamped with the
 * snapshot's time. The snapshot cron calls it on every run: one that added uploads or rebuilt writes it; any other
 * reads only a HEAD and writes it only when the stamp is not the snapshot's (stored-view-freshness.ts), so a run that
 * failed here is caught up by the next. `dataAsOf` is the snapshot's time, the one the cron heartbeat carries, so
 * the score is dated by the last real change.
 *
 * The plateau (the score of the reports captured 28 days earlier, compared field by field) is measured here too, from
 * the records already loaded, and stored in the same file (version 2): the coverage pages read both with one GET and
 * one ETag, and the plateau always matches the score beside it. The pages compute neither.
 */
export async function writeCoverage(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: {
  cloud?: CloudConfig | null; fetch?: typeof fetch; build?: string;
} = {}): Promise<{ written: boolean; key?: string; zones?: number; bytes?: number }> {
  const cloud = deps.cloud === undefined ? cloudConfig() : deps.cloud;
  if (!cloud) throw new Error("coverage needs the cloud store");
  const doFetch = deps.fetch ?? fetch;
  const build = deps.build ?? COVERAGE_BUILD;
  const r2 = new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });
  const key = coverageKey(build);
  const url = `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${key}`;
  if (opts.added <= 0 && !opts.rebuild && !await storedViewNeedsWrite(r2, url, opts.dataAsOf, doFetch)) return { written: false };
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable) throw new Error("corpus unreachable");
  const input = coverageInput(corpus, await loadCoverageExpected(), opts.dataAsOf ?? corpus.dataAsOf ?? null);
  const report = computeCoverage(input);
  const plateau = computePlateau(input, report);
  const body = JSON.stringify({ ...report, build, version: COVERAGE_STORED_VERSION, plateau: { ...plateau, build } });
  const put = await doFetch(await r2.sign(url, { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf) } }));
  if (!put.ok) throw new Error(`coverage write failed (${put.status})`);
  return { written: true, key, zones: report.zones.length, bytes: new TextEncoder().encode(body).length };
}
