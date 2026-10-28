/**
 * Build and deploy the site to the Cloudflare Worker, stamped with the commit it was built from
 * (EVERLOOT_COMMIT_SHA, read by src/lib/platform.ts for the footer and the source link).
 * NEXT_PUBLIC_* values must be in the environment: they are read at build time. The Worker's `vars`
 * (wrangler.jsonc: platform, environment, feature switches) are passed to the build as well, because pages
 * built ahead of time read them then; the *_DIR paths are left out, as they exist only inside the Worker.
 * Run from web/: node scripts/cf-deploy.mjs
 */
import { execFileSync, execSync } from "node:child_process";
import { unstable_readConfig } from "wrangler";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const vars = Object.fromEntries(
  Object.entries(unstable_readConfig({ config: "wrangler.jsonc" }, {}).vars ?? {})
    .filter(([name, value]) => !name.endsWith("_DIR") && typeof value === "string"),
);
const env = { ...process.env, ...vars, EVERLOOT_COMMIT_SHA: sha };
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });
run("npm run cf:build");
run(`npx opennextjs-cloudflare deploy --var EVERLOOT_COMMIT_SHA:${sha}`);
