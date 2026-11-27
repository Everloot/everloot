import { unstable_cache } from "next/cache";

/**
 * Seconds a prerendered or ISR page drawn with a failed read stays fresh. The deploy builds those pages on the runner
 * with no storage settings, and OpenNext serves that render for the page's whole `revalidate` after the deploy; a cold
 * instance whose read failed is the same. Next keeps a page for the shortest lifetime any kept read in it asks for, so
 * asking for this one makes the next request after it draw the page again. A healthy render never asks, and keeps its
 * own lifetime. Pair it with components/EdgeDegraded.tsx on an HTML page, so the Worker's edge cache keeps it briefly too.
 */
export const DEGRADED_REVALIDATE = 10;
const brief = unstable_cache(async () => true, ["degraded-render"], { revalidate: DEGRADED_REVALIDATE });

/** Keep this render only DEGRADED_REVALIDATE seconds. The lifetime is lowered before the read, so a failed read changes nothing. */
export async function keepBriefly(): Promise<void> {
  try { await brief(); } catch { /* the lifetime is already lowered */ }
}

/** `keepBriefly` when `degraded`; returns `degraded`, so a page can pass it on to EdgeDegraded. */
export async function keepBrieflyIf(degraded: boolean): Promise<boolean> {
  if (degraded) await keepBriefly();
  return degraded;
}
