import { publicDropRate, publicMeasuredZero } from "@kb/drop-rollup";
import { measureDropRate } from "@kb/drop-rate-settling";
import { NextResponse } from "next/server";
import { admit, attribution, attributionHeaders, badPage, pageOf, pageRequest } from "@/lib/data-guard";
import { computeRollups } from "@/lib/rollup-compute";
import { loadDropSourceNames } from "@/lib/names";
import { recordUsage } from "@/lib/usage-metrics";

/**
 * GET /api/rollups/drops — tiered drop rates with kill counts. `?offset=` and `?limit=` page
 * the rates followed by the measured zeros as one list, so a page never holds more than the cap; with the
 * data guard on, a page is capped and `next` links the following page.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  recordUsage("api.rollups_drops");
  const admitted = await admit(req, "drops");
  if (admitted instanceof Response) return admitted;
  const at = pageRequest(req, admitted.pageMax);
  if (!at) return badPage();
  // Names are extra: a failed name read leaves the rates unnamed instead of failing the answer.
  const [{ rates, measuredZeros, stats }, names] = await Promise.all([computeRollups(), loadDropSourceNames().catch(() => null)]);
  // Source names have their own tier, independent of the rate's reporter count.
  const sourceName = (r: { sourceNpcId?: number; sourceObjectId?: number }) =>
    r.sourceNpcId !== undefined ? names?.npcs.get(r.sourceNpcId) : r.sourceObjectId !== undefined ? names?.objects.get(r.sourceObjectId) : undefined;
  const publicRates = stats.unreachable ? [] : rates.filter((r) => r.reporters > 0).map((r) => {
    const name = sourceName(r);
    const measurement = measureDropRate(r, stats.dataAsOf ?? "");
    return {
      ...publicDropRate(r),
      rateLow: measurement.interval?.lower ?? null,
      rateHigh: measurement.interval?.upper ?? null,
      settled: measurement.settled,
      ...(name ? { sourceName: name.name, sourceNameTier: name.tier } : {}),
    };
  });
  const publicZeros = stats.unreachable ? [] : measuredZeros.filter((z) => z.reporters > 0).map((z) => {
    const name = sourceName(z);
    return { ...publicMeasuredZero(z), ...(name ? { sourceName: name.name, sourceNameTier: name.tier } : {}) };
  });
  const both = [
    ...publicRates.map((rate) => ({ rate })),
    ...publicZeros.map((zero) => ({ zero })),
  ] as Array<{ rate: (typeof publicRates)[number] } | { zero: (typeof publicZeros)[number] }>;
  const { items, page } = pageOf(req, both, at);
  return NextResponse.json({
    // generatedAt is when this response was made; dataAsOf is when the uploads behind it were current.
    generatedAt: new Date().toISOString(),
    dataAsOf: stats.dataAsOf,
    stats,
    unreachable: stats.unreachable,
    rates: items.flatMap((item) => ("rate" in item ? [item.rate] : [])),
    measuredZeros: items.flatMap((item) => ("zero" in item ? [item.zero] : [])),
    // Every row with a reporter is shown; queued counts only rows without a reporter (normally zero).
    queued: stats.unreachable ? null : rates.filter((r) => r.reporters === 0).length + measuredZeros.filter((z) => z.reporters === 0).length,
    offset: page.offset,
    limit: page.limit,
    total: page.total,
    totalRates: publicRates.length,
    totalMeasuredZeros: publicZeros.length,
    next: page.next,
    attribution: attribution("/database/drops"),
  }, { headers: attributionHeaders() });
}
