/**
 * The stored-views job (#1354): builds the settled list, the stored views, the guild ladder, the Auction House boards,
 * the coverage score and the auction reports for the snapshot the cron's last heartbeat names
 * (src/lib/stored-views-run.ts), outside the cron Worker's 128 MB. GitHub Actions runs it on a schedule
 * (.github/workflows/stored-views.yml); docs/OPERATIONS.md, "The stored-views job", says how it is switched on.
 *
 * It reads and writes the same storage as the cron Worker, so it needs the same variables: R2_ACCOUNT_ID,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, the GAME_DATA_* reader
 * and EVERLOOT_TRUSTED_INSTALLS. The switches (EVERLOOT_GUILDS, EVERLOOT_DATA_GUARD and the rest) come from the cron
 * Worker's own vars in wrangler.cron.jsonc, so the job builds exactly what the Worker would.
 *   npm run stored-views              # each view whose stamp is not the heartbeat's snapshot
 *   npm run stored-views -- --rebuild # every view
 * Exits 1 when a view failed, so the run shows red.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { unstable_readConfig } from "wrangler";

const REQUIRED = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

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
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
  // Imported after the vars are set: the stores read them when they load.
  const { runStoredViewsJob } = await import("../src/lib/stored-views-run");
  const started = Date.now();
  const result = await runStoredViewsJob({ rebuild: process.argv.includes("--rebuild") });
  console.log(JSON.stringify({ ...result, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
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
