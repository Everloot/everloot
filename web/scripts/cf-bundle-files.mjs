/**
 * After `opennextjs-cloudflare build`: copy the repository files the pages read at run time into
 * .open-next/repo, so wrangler uploads them with the Worker (the `rules` in wrangler.jsonc) and node:fs finds
 * them under /bundle/repo. The directories match the NEWS_DIR, GUIDES_DIR and WIKI_DIR vars there.
 * Run from web/: node scripts/cf-bundle-files.mjs
 */
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(".open-next", "repo");
const DIRS = ["kb/news", "kb/guides", "kb/wiki"];

if (!existsSync(".open-next")) {
  console.error("No .open-next folder: run `npx opennextjs-cloudflare build` first.");
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
for (const dir of DIRS) cpSync(join("..", dir), join(OUT, dir), { recursive: true });
// The protocol's JSON Schema files, served by /schema/<file>.json (PROTOCOL_SCHEMA_DIR).
cpSync(join("node_modules", "@everloot", "protocol", "schema"), join(OUT, "protocol-schema"), { recursive: true });
// public/.well-known (MCP registry ownership, the MCP server card, security.txt, the OpenAI apps challenge): the
// asset copy skips dot-folders, so it is copied here.
cpSync(join("public", ".well-known"), join(".open-next", "assets", ".well-known"), { recursive: true });
// Headers for files the static-assets binding serves without running Next (next.config.js headers() never sees
// them): the security headers next.config sets on every route, the embeddable tooltip script's CORS and lifetime,
// and the build's hashed files.
writeFileSync(join(".open-next", "assets", "_headers"), [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  X-Frame-Options: SAMEORIGIN",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Strict-Transport-Security: max-age=63072000; includeSubDomains",
  "/tooltips.js",
  "  Cache-Control: public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
  "  Access-Control-Allow-Origin: *",
  "/_next/static/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
].join("\n"));
// The Worker entry (wrangler.jsonc `main`): OpenNext's worker plus the scheduled jobs.
cpSync(join("scripts", "cf-entry.mjs"), join(".open-next", "cf-entry.mjs"));
console.log(`Copied ${DIRS.join(", ")} and the protocol schemas into ${OUT}, and the Worker entry`);
