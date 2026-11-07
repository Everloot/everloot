/**
 * Build and deploy the site to the Cloudflare Worker, stamped with the commit it was built from
 * (EVERLOOT_COMMIT_SHA, read by src/lib/platform.ts for the footer and the source link).
 * NEXT_PUBLIC_* values must be in the environment: they are read at build time. The Worker's `vars`
 * (wrangler.jsonc: platform, environment, feature switches) are passed to the build as well, because pages
 * built ahead of time read them then; the *_DIR paths are left out, as they exist only inside the Worker.
 *
 * It also stamps the edge cache's content versions (src/lib/cf-edge-cache.ts), so another page's deploy keeps
 * the public pages it did not change. They come from the committed trees the pages read, not the commit:
 * the rendering source, the game files, kb (news, guides, wiki and the builders), the public folder (the addon
 * zips) and the owner-approved addon source list. scripts/cache-versions.mjs fails the deploy when a version
 * cannot be read, so a missing value never silently matches another deploy.
 * Run from web/: node scripts/cf-deploy.mjs
 */
import { execFileSync, execSync } from "node:child_process";
import { unstable_readConfig } from "wrangler";
import { cacheVersions as versionsFor } from "./cache-versions.mjs";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const vars = Object.fromEntries(
  Object.entries(unstable_readConfig({ config: "wrangler.jsonc" }, {}).vars ?? {})
    .filter(([name, value]) => !name.endsWith("_DIR") && typeof value === "string"),
);
const versions = versionsFor({ knowledgeRelease: vars.KNOWLEDGE_RELEASE_SHA256 });
const cacheVersions = {
  // No colon in a value: wrangler reads `NAME:value` at the first colon.
  EVERLOOT_CACHE_TEMPLATE: versions.template,
  EVERLOOT_CACHE_DATA: versions.data,
  EVERLOOT_CACHE_KNOWLEDGE: versions.knowledge,
  EVERLOOT_CACHE_ADDON: versions.addon,
};
const env = { ...process.env, ...vars, EVERLOOT_COMMIT_SHA: sha };
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });
run("npm run cf:build");
const cacheVars = Object.entries(cacheVersions).map(([name, value]) => `--var ${name}:${value}`).join(" ");
run(`npx opennextjs-cloudflare deploy --var EVERLOOT_COMMIT_SHA:${sha} ${cacheVars}`);
