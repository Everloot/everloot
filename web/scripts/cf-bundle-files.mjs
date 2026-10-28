/**
 * After `opennextjs-cloudflare build`: copy the repository files the pages read at run time into
 * .open-next/repo, so wrangler uploads them with the Worker (the `rules` in wrangler.jsonc) and node:fs finds
 * them under /bundle/repo. The directories match the NEWS_DIR, GUIDES_DIR and WIKI_DIR vars there.
 * Run from web/: node scripts/cf-bundle-files.mjs
 */
import { cpSync, existsSync, rmSync } from "node:fs";
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
console.log(`Copied ${DIRS.join(", ")} and the protocol schemas into ${OUT}`);
