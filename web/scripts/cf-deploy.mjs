/**
 * Build and deploy the site to the Cloudflare Worker, stamped with the commit it was built from
 * (EVERLOOT_COMMIT_SHA, read by src/lib/platform.ts for the footer and the source link).
 * NEXT_PUBLIC_* values must be in the environment: they are read at build time.
 * Run from web/: node scripts/cf-deploy.mjs
 */
import { execFileSync, execSync } from "node:child_process";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
// Pre-built pages (the home page among them) render the footer at build time, so the build sees the commit too.
const run = (cmd) => execSync(cmd, { stdio: "inherit", env: { ...process.env, EVERLOOT_COMMIT_SHA: sha } });
run("npm run cf:build");
run(`npx opennextjs-cloudflare deploy --var EVERLOOT_COMMIT_SHA:${sha}`);
