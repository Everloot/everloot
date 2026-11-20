/**
 * The scheduled jobs the Cloudflare Worker runs (web/scripts/cf-entry.mjs), on the schedules in wrangler.jsonc's
 * `triggers.crons` and wrangler.cron.jsonc's (cf-crons.test.ts holds the three lists equal). Each run calls the route
 * with `Authorization: Bearer $CRON_SECRET`, which the routes require.
 *
 * Two Workers carry these triggers, both built from the same bundle: the site (`everloot-web`, wrangler.jsonc) and
 * the cron Worker (`everloot-cron`, wrangler.cron.jsonc), which serves no visitor, so a job's memory never shares an
 * isolate with page traffic (#1354). Their EVERLOOT_CRON_WORKER var says which jobs each one runs (docs/OPERATIONS.md):
 * - unset, on the site before the hand-off: every job;
 * - "cron", on the cron Worker: every job but SITE_JOBS;
 * - "1", on the site after the hand-off: SITE_JOBS only.
 */
export const CF_CRONS: Readonly<Record<string, readonly string[]>> = {
  "*/10 * * * *": ["/api/cron/snapshot", "/api/cron/blue"],
  // The stored views, five minutes after each snapshot run, in their own run (#1354): the snapshot run takes under a
  // minute, so the two never hold the corpus at once.
  "5,15,25,35,45,55 * * * *": ["/api/cron/views"],
  "23 * * * *": ["/api/cron/indexnow", "/api/cron/ops"],
  // Every 30 minutes, off the 10-minute marks so it never starts with the snapshot run (profile pipeline).
  "7,37 * * * *": ["/api/cron/profiles"],
};

/**
 * The jobs that stay on the site after the hand-off. /api/cron/ops keys install pseudonyms with
 * EVERLOOT_OPS_HMAC_SECRET, a secret only the site holds; another key would change every pseudonym in the summary.
 */
export const SITE_JOBS: ReadonlySet<string> = new Set(["/api/cron/ops"]);

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
  /** "cron" on the cron Worker; "1" on the site once the cron Worker runs the jobs. See the top of this file. */
  EVERLOOT_CRON_WORKER?: string;
  WORKER_SELF_REFERENCE: { fetch(request: Request): Promise<Response> };
}

/**
 * Run one trigger's jobs. Each job runs as its own request through the Worker's self-binding, so each gets its own CPU
 * budget, memory and subrequest count rather than sharing the trigger's. A failed job throws, so Cloudflare's cron
 * history shows it (logs are sampled; this is not). Returns the paths it called.
 */
export async function runCrons(cron: string, env: CronEnv): Promise<readonly string[]> {
  const role = env.EVERLOOT_CRON_WORKER;
  const paths = cronPaths(cron).filter((path) =>
    role === "1" ? SITE_JOBS.has(path) : role === "cron" ? !SITE_JOBS.has(path) : true);
  if (!paths.length) return [];
  const secret = env.CRON_SECRET;
  if (!secret) throw new Error("[cron] CRON_SECRET is not set; nothing ran");
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
