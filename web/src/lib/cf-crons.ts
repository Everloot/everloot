/**
 * The scheduled jobs the Cloudflare Worker runs (web/scripts/cf-entry.mjs), on the schedules in wrangler.jsonc's
 * `triggers.crons` and wrangler.cron.jsonc's (cf-crons.test.ts holds the three lists equal). Each run calls the route
 * with `Authorization: Bearer $CRON_SECRET`, which the routes require.
 *
 * Two Workers carry these triggers, both built from the same bundle: the site (`everloot-web`, wrangler.jsonc) and
 * the cron Worker (`everloot-cron`, wrangler.cron.jsonc), which serves no visitor, so a job's memory never shares an
 * isolate with page traffic (#1354). The site runs the jobs until its EVERLOOT_CRON_WORKER var is "1"; from then on
 * its triggers return without running anything and the cron Worker alone runs them (docs/OPERATIONS.md).
 */
export const CF_CRONS: Readonly<Record<string, readonly string[]>> = {
  "*/10 * * * *": ["/api/cron/snapshot", "/api/cron/blue"],
  "23 * * * *": ["/api/cron/indexnow", "/api/cron/ops"],
  // Every 30 minutes, off the 10-minute marks so it never starts with the snapshot run (profile pipeline).
  "7,37 * * * *": ["/api/cron/profiles"],
};

/** The routes one trigger runs; none for a schedule this file does not list. */
export function cronPaths(cron: string): readonly string[] {
  return CF_CRONS[cron] ?? [];
}

/** The request a trigger sends to one route. */
export function cronRequest(path: string, secret: string, origin = "https://everloot.app"): Request {
  return new Request(new URL(path, origin), { headers: { authorization: `Bearer ${secret}`, "user-agent": "everloot-worker-cron" } });
}

/** What a trigger reads from the Worker's environment. */
export interface CronEnv {
  CRON_SECRET?: string;
  /** "1" on the site Worker once the cron Worker runs the jobs: its triggers then run nothing. */
  EVERLOOT_CRON_WORKER?: string;
  WORKER_SELF_REFERENCE: { fetch(request: Request): Promise<Response> };
}

/**
 * Run one trigger's jobs. Each job runs as its own request through the Worker's self-binding, so each gets its own CPU
 * budget, memory and subrequest count rather than sharing the trigger's. A failed job throws, so Cloudflare's cron
 * history shows it (logs are sampled; this is not). Returns the paths it called.
 */
export async function runCrons(cron: string, env: CronEnv): Promise<readonly string[]> {
  if (env.EVERLOOT_CRON_WORKER === "1") return [];
  const secret = env.CRON_SECRET;
  if (!secret) throw new Error("[cron] CRON_SECRET is not set; nothing ran");
  const paths = cronPaths(cron);
  const failures: string[] = [];
  await Promise.all(paths.map(async (path) => {
    const res = await env.WORKER_SELF_REFERENCE.fetch(cronRequest(path, secret));
    // Read to the end even on success: a body left unread is cut off when the trigger ends, and the job's own
    // invocation is then logged as "canceled" although it finished.
    const body = await res.text();
    if (!res.ok) failures.push(`${path} answered ${res.status}: ${body.slice(0, 300)}`);
  }));
  if (failures.length) throw new Error(`[cron] ${failures.join("; ")}`);
  return paths;
}
