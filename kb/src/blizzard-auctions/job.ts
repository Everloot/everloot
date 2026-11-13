import { ApiError, type ApiResult, type Region } from "../armory/api.js";
import { StoreError } from "../armory/store.js";
import type { DocumentKind, JobStore } from "./store.js";
import { summarize } from "./summary.js";

/**
 * One hourly pass over a region's auction houses. Checked 2026-11-13: every ruleset in the index lists the same 15
 * houses (ids 110-125, no 122), and a house answers with the same auctions whichever ruleset the path names, so each
 * house is read once, through the first ruleset that lists it. A pass costs 1 + rulesets + 2 per house calls
 * (35 in US and EU today), far under Blizzard's 36,000 an hour. Purges run every pass, whatever else failed.
 *
 * A house is two documents, items and commodities, each with its own Last-Modified. Each is stored as its own
 * snapshot with its own time, so a newer commodities document is never refused because the items one was newer,
 * and every row keeps the age of the document it came from.
 *
 * A house that fails on a recoverable error (Blizzard or storage answering 429/5xx, a network failure, a lock
 * timeout) is counted and skipped; the other houses and the purge still run, and the pass then exits non-zero.
 * Anything else (bad credentials, the functions missing) stops the pass, after the purge.
 */
export interface AuctionJob {
  region: Region;
  budget: number;
  api: { get(path: string, kind: "dynamic"): Promise<ApiResult> };
  store: JobStore;
  log: (line: string) => void;
  now?: () => Date;
}

export interface JobResult {
  calls: number;
  houses: number;
  written: number;
  unchanged: number;
  failed: number;
  purged: number;
}

class BudgetSpent extends Error {}

/** Thrown after a whole pass in which some houses failed; the result is complete apart from those houses. */
export class PartialFailure extends Error {
  constructor(readonly result: JobResult) {
    super(`${result.failed} auction house${result.failed === 1 ? "" : "s"} failed this pass`);
  }
}

const recoverable = (error: unknown) => (error instanceof ApiError || error instanceof StoreError) && error.transient;

const DOCUMENTS: [DocumentKind, string][] = [["items", ""], ["commodities", "/commodities"]];

export async function runAuctions(job: AuctionJob): Promise<JobResult> {
  const now = job.now ?? (() => new Date());
  const result: JobResult = { calls: 0, houses: 0, written: 0, unchanged: 0, failed: 0, purged: 0 };
  const get = async (path: string) => {
    if (result.calls >= job.budget) throw new BudgetSpent();
    result.calls++;
    return job.api.get(path, "dynamic");
  };
  let fatal: unknown = null;
  try {
    const index = await get("/data/wow/ruleset/index");
    const rulesets = ((index.body as { rulesets?: { id?: unknown }[] } | null)?.rulesets ?? [])
      .map((r) => r.id)
      .filter((id): id is number => Number.isSafeInteger(id))
      .sort((a, b) => a - b);
    const houses = new Map<number, { ruleset: number; name: string }>();
    for (const ruleset of rulesets) {
      const list = await get(`/data/wow/ruleset/${ruleset}/auctions/`);
      for (const h of (list.body as { auctions?: { id?: unknown; name?: unknown }[] } | null)?.auctions ?? [])
        if (Number.isSafeInteger(h.id) && !houses.has(h.id as number))
          houses.set(h.id as number, { ruleset, name: typeof h.name === "string" ? h.name : "Auction House" });
    }
    for (const [houseId, { ruleset, name }] of [...houses].sort((a, b) => a[0] - b[0])) {
      const path = `/data/wow/ruleset/${ruleset}/auctions/${houseId}`;
      try {
        let found = false;
        for (const [kind, suffix] of DOCUMENTS) {
          const doc = await get(`${path}${suffix}`);
          if (doc.status === 404) continue;
          found = true;
          // Blizzard's Last-Modified is when this document was published; the fetch time stands in when it is missing.
          const stamp = doc.lastModified ? Date.parse(doc.lastModified) : NaN;
          const snapshot = new Date(Number.isFinite(stamp) ? stamp : now().getTime()).toISOString();
          const n = await job.store.put(job.region, { house_id: houseId, name, kind, snapshot_at: snapshot }, summarize(doc.body));
          if (n === null) {
            result.unchanged++;
            job.log(`house ${houseId} (${name}) ${kind}: unchanged since ${snapshot}`);
          } else {
            result.written += n;
            job.log(`house ${houseId} (${name}) ${kind}: ${n} items as of ${snapshot}`);
          }
        }
        if (found) result.houses++;
        else job.log(`house ${houseId}: not found`);
      } catch (error) {
        if (!recoverable(error)) throw error;
        result.failed++;
        job.log(`house ${houseId}: ${(error as Error).message}, skipped this pass`);
      }
    }
  } catch (error) {
    if (error instanceof BudgetSpent) job.log(`budget of ${job.budget} calls spent; the rest waits for the next pass`);
    else fatal = error;
  }
  try {
    result.purged = await job.store.purge();
  } catch (error) {
    job.log(`purge failed: ${(error as Error).message}`);
    fatal ??= error;
  }
  job.log(
    `${job.region}: ${result.calls} Blizzard API calls of ${job.budget}; ${result.houses} houses, ${result.written} item rows, ` +
      `${result.unchanged} unchanged, ${result.failed} failed; ${result.purged} rows past 30 days purged`,
  );
  if (fatal) throw fatal;
  if (result.failed) throw new PartialFailure(result);
  return result;
}
