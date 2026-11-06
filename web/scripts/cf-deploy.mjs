/**
 * Build and deploy the site to the Cloudflare Worker, stamped with the commit it was built from
 * (EVERLOOT_COMMIT_SHA, read by src/lib/platform.ts for the footer and the source link).
 * NEXT_PUBLIC_* values must be in the environment: they are read at build time. The Worker's `vars`
 * (wrangler.jsonc: platform, environment, feature switches) are passed to the build as well, because pages
 * built ahead of time read them then; the *_DIR paths are left out, as they exist only inside the Worker.
 *
 * It also stamps the edge cache's content versions (src/lib/cf-edge-cache.ts), so another page's deploy keeps
 * the public pages it did not change. They come from the committed trees the pages read, not the commit:
 * the game files, kb (news, guides, wiki and the builders), the public folder (the addon zips) and the knowledge
 * release var. `template` is the hand-bumped src/data/edge-cache-version.json, raised when markup changes.
 * Run from web/: node scripts/cf-deploy.mjs
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { unstable_readConfig } from "wrangler";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
/** The tree hash of a committed path, or "dev" when it cannot be read (an unborn repository). */
const tree = (path) => {
  try {
    return execFileSync("git", ["rev-parse", `HEAD:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "dev";
  }
};
const template = JSON.parse(readFileSync("src/data/edge-cache-version.json", "utf8")).template;
const vars = Object.fromEntries(
  Object.entries(unstable_readConfig({ config: "wrangler.jsonc" }, {}).vars ?? {})
    .filter(([name, value]) => !name.endsWith("_DIR") && typeof value === "string"),
);
const cacheVersions = {
  // No colon in a value: wrangler reads `NAME:value` at the first colon.
  EVERLOOT_CACHE_TEMPLATE: String(template),
  EVERLOOT_CACHE_DATA: tree("web/src/data/game-data"),
  EVERLOOT_CACHE_KNOWLEDGE: `${tree("kb")}-${vars.KNOWLEDGE_RELEASE_SHA256 ?? "dev"}`,
  EVERLOOT_CACHE_ADDON: tree("web/public"),
};
const env = { ...process.env, ...vars, EVERLOOT_COMMIT_SHA: sha };
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });
run("npm run cf:build");
const cacheVars = Object.entries(cacheVersions).map(([name, value]) => `--var ${name}:${value}`).join(" ");
run(`npx opennextjs-cloudflare deploy --var EVERLOOT_COMMIT_SHA:${sha} ${cacheVars}`);
