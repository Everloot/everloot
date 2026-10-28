/**
 * The scheduled jobs the Cloudflare Worker runs (web/cf-worker.ts), the same routes and schedules as vercel.json's
 * crons so the two hosts never drift (cf-crons.test.ts). Each run calls the route with the same
 * `Authorization: Bearer $CRON_SECRET` Vercel sends.
 *
 * Only one host may run them: the Worker's `triggers.crons` in wrangler.jsonc stay empty until Vercel's crons are
 * switched off at the cutover (docs/2026-10-28-cloudflare-workers-migration.md).
 */
export const CF_CRONS: Readonly<Record<string, readonly string[]>> = {
  "*/10 * * * *": ["/api/cron/snapshot", "/api/cron/blue"],
  "23 * * * *": ["/api/cron/indexnow"],
};

/** The routes one trigger runs; none for a schedule this file does not list. */
export function cronPaths(cron: string): readonly string[] {
  return CF_CRONS[cron] ?? [];
}

/** The request a trigger sends to one route, as Vercel's cron would. */
export function cronRequest(path: string, secret: string, origin = "https://everloot.app"): Request {
  return new Request(new URL(path, origin), { headers: { authorization: `Bearer ${secret}`, "user-agent": "everloot-worker-cron" } });
}
