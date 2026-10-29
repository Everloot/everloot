/**
 * The scheduled jobs the Cloudflare Worker runs (web/scripts/cf-entry.mjs), on the schedules in wrangler.jsonc's
 * `triggers.crons` (cf-crons.test.ts holds the two lists equal). Each run calls the route with
 * `Authorization: Bearer $CRON_SECRET`, which the routes require.
 */
export const CF_CRONS: Readonly<Record<string, readonly string[]>> = {
  "*/10 * * * *": ["/api/cron/snapshot", "/api/cron/blue"],
  "23 * * * *": ["/api/cron/indexnow"],
};

/** The routes one trigger runs; none for a schedule this file does not list. */
export function cronPaths(cron: string): readonly string[] {
  return CF_CRONS[cron] ?? [];
}

/** The request a trigger sends to one route. */
export function cronRequest(path: string, secret: string, origin = "https://everloot.app"): Request {
  return new Request(new URL(path, origin), { headers: { authorization: `Bearer ${secret}`, "user-agent": "everloot-worker-cron" } });
}
