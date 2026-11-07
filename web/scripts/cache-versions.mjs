/**
 * The edge cache's content versions (src/lib/cf-edge-cache.ts), computed from the committed source a deploy
 * was built from. They are what tells the Worker whether a cached page still matches the deploy that answers
 * it: another page's deploy keeps the public pages it did not change, while a rendering change, a game-data
 * release, a knowledge release or an addon change starts a new key for the pages that read it.
 *
 * They come from `git ls-tree HEAD`, so a checkout with no readable HEAD stops the deploy instead of stamping
 * a made-up value that would match some earlier deploy ("dev"). The template version is the committed
 * rendering source (src, the page code, the shared components, lib, and the build config), minus the game
 * data the data version already covers, the API routes (they render no page) and tests (they render nothing):
 * a test-only or API-only deploy keeps every public page. A change to any page or shared component changes
 * every cached key, which is the safe direction: a page's markup never outlives the code that wrote it.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const read = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/** The committed paths whose bytes can change a rendered page. */
export const TEMPLATE_PATHS = ["web/src", "web/next.config.js", "web/postcss.config.js", "web/tailwind.config.ts"];

/** Files under those paths that cannot change a cached page's HTML, or that another version already covers. */
const TEMPLATE_EXCLUDE = [
  /^web\/src\/app\/api\//,
  /^web\/src\/data\/game-data\//,
  // The addon map is part of the addon version, which the addon pages (its only readers) carry.
  /^web\/src\/data\/addon-repos\.ts$/,
  /^web\/src\/test\//,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
];

/** Whether a committed path can change a cached page's HTML. */
export const isTemplateFile = (path) => !TEMPLATE_EXCLUDE.some((re) => re.test(path));

/** A committed tree's object id. A missing HEAD or path throws: no version beats a wrong one. */
export function tree(path, gitRead = read) {
  try {
    return gitRead(["rev-parse", `HEAD:${path}`]);
  } catch {
    throw new Error(`[cache] cannot read HEAD:${path}; refusing to stamp edge cache versions without a committed identity`);
  }
}

/** The rendering source's identity: the listed blobs, which are content hashes, folded into one value. */
export function templateVersion(gitRead = read) {
  const listing = gitRead(["ls-tree", "-r", "--full-tree", "HEAD", "--", ...TEMPLATE_PATHS]);
  const files = listing.split("\n").filter(Boolean).filter((line) => isTemplateFile(line.slice(line.indexOf("\t") + 1)));
  if (files.length === 0) throw new Error("[cache] cannot read the committed rendering source; refusing to stamp a template version");
  return digest(files.join("\n"));
}

/**
 * Every version the Worker needs for one deploy.
 * @param {{ gitRead?: (args: string[]) => string, knowledgeRelease?: string }} [options]
 */
export function cacheVersions({ gitRead = read, knowledgeRelease } = {}) {
  if (!knowledgeRelease) throw new Error("[cache] KNOWLEDGE_RELEASE_SHA256 is not set; refusing to stamp edge cache versions");
  return {
    template: templateVersion(gitRead),
    data: tree("web/src/data/game-data", gitRead),
    knowledge: `${tree("kb", gitRead)}-${knowledgeRelease}`,
    // The addon zip folder and the owner-approved source list the addon pages read.
    addon: `${tree("web/public", gitRead)}-${tree("web/src/data/addon-repos.ts", gitRead)}`,
  };
}
