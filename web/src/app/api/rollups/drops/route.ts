import { NextResponse } from "next/server";
import { admit, attribution, attributionHeaders, badPage, pageOf, pageRequest } from "@/lib/data-guard";
import { computeRollups } from "@/lib/rollup-compute";
import { loadNames } from "@/lib/names";
import { recordUsage } from "@/lib/usage-metrics";

/**
 * GET /api/rollups/drops — public corroborated drop rates with kill counts. `?offset=` and `?limit=` page
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
  const [{ rates, measuredZeros, stats }, names] = await Promise.all([computeRollups(), loadNames().catch(() => null)]);
  // Each rate names its source when the site knows the name (3 installs agree on it), so the Desktop App's price
  // file can name sources a player never met.
  const sourceName = (r: { sourceNpcId?: number; sourceObjectId?: number }) =>
    r.sourceNpcId !== undefined ? names?.npcs.get(r.sourceNpcId) : r.sourceObjectId !== undefined ? names?.objects.get(r.sourceObjectId) : undefined;
  const publicRates = stats.unreachable ? [] : rates.filter((r) => r.public).map((r) => {
    const name = sourceName(r);
    return name ? { ...r, sourceName: name } : r;
  });
  const publicZeros = stats.unreachable ? [] : measuredZeros.filter((z) => z.public);
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
    queued: stats.unreachable ? null : rates.filter((r) => !r.public).length + measuredZeros.filter((z) => !z.public).length,
    offset: page.offset,
    limit: page.limit,
    total: page.total,
    totalRates: publicRates.length,
    totalMeasuredZeros: publicZeros.length,
    next: page.next,
    attribution: attribution("/database/drops"),
  }, { headers: attributionHeaders() });
}
