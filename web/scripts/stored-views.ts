/**
 * The stored-views job (#1354): builds the settled list, the stored views, the guild ladder, the Auction House boards,
 * the coverage score and the auction reports for the snapshot the cron's last heartbeat names
 * (src/lib/stored-views-run.ts), outside the cron Worker's 128 MB. GitHub Actions runs it on a schedule
 * (.github/workflows/stored-views.yml); docs/OPERATIONS.md, "The stored-views job", says how it is switched on.
 *
 * It reads and writes the same storage as the cron Worker, so it needs the same variables: R2_ACCOUNT_ID,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, the GAME_DATA_* reader,
 * NEXT_PUBLIC_GAME_ASSETS_URL and EVERLOOT_TRUSTED_INSTALLS. The switches (EVERLOOT_GUILDS, EVERLOOT_DATA_GUARD and the
 * rest) come from the cron Worker's own vars in wrangler.cron.jsonc, so the job builds exactly what the Worker would.
 *   npm run stored-views              # each view whose stamp is not the heartbeat's snapshot
 *   npm run stored-views -- --rebuild # every view
 * With EVERLOOT_SNAPSHOT at "job" in those vars it first folds new uploads into the corpus and the rollups and writes
 * the cron heartbeat, as the cron Worker did, then sweeps corpus parts no snapshot names (lib/snapshot-pass.ts).
 * Exits 1 when the fold or a view failed, so the run shows red.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { unstable_readConfig } from "wrangler";

/**
 * The storage, and the game files the views name items from: the site's build has NEXT_PUBLIC_GAME_ASSETS_URL inlined,
 * the job reads it at run time. Without it the views held only the names players agree on (every other item "Item N").
 */
export const REQUIRED = [
  "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_GAME_ASSETS_URL", "GAME_DATA_S3_ENDPOINT", "GAME_DATA_BUCKET", "GAME_DATA_ACCESS_KEY_ID", "GAME_DATA_SECRET_ACCESS_KEY",
];

/** The required variables `env` leaves unset or blank. */
export const missingVars = (env: Record<string, string | undefined>) => REQUIRED.filter((key) => !env[key]?.trim());

/** The cron Worker's vars, minus its role switch and the bundle paths only a Worker has; a variable already set wins. */
export function cronWorkerVars(vars: Record<string, unknown>, env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key === "EVERLOOT_CRON_WORKER" || typeof value !== "string" || value.startsWith("/bundle/") || env[key] !== undefined) continue;
    out[key] = value;
  }
  return out;
}

async function main(): Promise<void> {
  const config = unstable_readConfig({ config: join(import.meta.dirname, "..", "wrangler.cron.jsonc") }, {});
  Object.assign(process.env, cronWorkerVars(config.vars as Record<string, unknown>, process.env));
  const missing = missingVars(process.env);
  if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
  // Imported after the vars are set: the stores read them when they load.
  const { runStoredViewsJob } = await import("../src/lib/stored-views-run");
  const started = Date.now();
  // With EVERLOOT_SNAPSHOT at "job" (wrangler.cron.jsonc), the cron Worker hands each run with something to fold to
  // this job, which folds it here before the views are built for it (lib/snapshot-pass.ts).
  let fold: Awaited<ReturnType<typeof import("../src/lib/snapshot-pass").runJobFold>> | null = null;
  if (process.env.EVERLOOT_SNAPSHOT === "job") {
    const { runJobFold } = await import("../src/lib/snapshot-pass");
    fold = await runJobFold();
  }
  const failedBefore = fold?.status === "failed" ? ["snapshot"] : [];
  const result = await runStoredViewsJob({ rebuild: process.argv.includes("--rebuild"), failedBefore });
  console.log(JSON.stringify({ fold, ...result, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
  if (result.failed.length) {
    console.error(`failed: ${result.failed.join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(process.exitCode ?? 0), (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
