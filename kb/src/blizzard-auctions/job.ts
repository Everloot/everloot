import { ApiError, type ApiResult, type Region } from "../armory/api.js";
import type { JobStore } from "./store.js";
import { summarize } from "./summary.js";

/**
 * One hourly pass over a region's auction houses. Checked 2026-11-13: every ruleset in the index lists the same 15
 * houses (ids 110-125, no 122), and a house answers with the same auctions whichever ruleset the path names, so each
 * house is read once, through the first ruleset that lists it. A pass costs 1 + rulesets + 2 per house calls
 * (35 in US and EU today), far under Blizzard's 36,000 an hour. Purges run every pass, whatever else failed.
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
        const items = await get(path);
        const commodities = await get(`${path}/commodities`);
        if (items.status === 404 && commodities.status === 404) {
          job.log(`house ${houseId}: not found`);
          continue;
        }
        // Blizzard's Last-Modified is when the house was read; the fetch time stands in when it is missing.
        const stamps = [items.lastModified, commodities.lastModified].map((s) => (s ? Date.parse(s) : NaN)).filter(Number.isFinite);
        const snapshot = new Date(stamps.length ? Math.max(...stamps) : now().getTime());
        const rows = summarize(items.body, commodities.body);
        const n = await job.store.put(job.region, { house_id: houseId, name, snapshot_at: snapshot.toISOString() }, rows);
        result.houses++;
        if (n === null) {
          result.unchanged++;
          job.log(`house ${houseId} (${name}): unchanged since ${snapshot.toISOString()}`);
        } else {
          result.written += n;
          job.log(`house ${houseId} (${name}): ${n} items as of ${snapshot.toISOString()}`);
        }
      } catch (error) {
        if (error instanceof BudgetSpent) throw error;
        if (!(error instanceof ApiError && error.transient)) throw error;
        result.failed++;
        job.log(`house ${houseId}: ${error.message}, skipped this pass`);
      }
    }
  } catch (error) {
    if (error instanceof BudgetSpent) job.log(`budget of ${job.budget} calls spent; the rest waits for the next pass`);
    else fatal = error;
  }
  result.purged = await job.store.purge();
  job.log(
    `${job.region}: ${result.calls} Blizzard API calls of ${job.budget}; ${result.houses} houses, ${result.written} item rows, ` +
      `${result.unchanged} unchanged, ${result.failed} failed; ${result.purged} rows past 30 days purged`,
  );
  if (fatal) throw fatal;
  return result;
}
