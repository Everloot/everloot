/**
 * The edge cache's content versions (src/lib/cf-edge-cache.ts). They tell the Worker whether a cached page still
 * matches the build that answers it: another page's deploy keeps the public pages it did not change, while a
 * rendering change, a game-data release, a knowledge release or an addon change starts a new key for the pages that
 * read it.
 *
 * They are computed after `opennextjs-cloudflare build`, by scripts/cf-bundle-files.mjs, from what that build used,
 * and written to .open-next/cache-versions.json, which the Worker entry imports. Nothing is passed as a deploy
 * variable, so the versions travel inside the bundle they describe and cannot disagree with it.
 *
 * Each version hashes the bytes of the working-tree files (tracked, or untracked and not ignored) the build read, not
 * the last commit, so a deploy from a tree with local changes is still stamped with what was built. A missing input,
 * an empty file list, an unreadable build output or a missing release stops the build: no version beats a wrong one.
 *
 * The template version covers what a page's markup depends on:
 *   - the rendering source (src, minus the API routes, the game data, the addon map and tests) and the build config;
 *   - the dependencies: web's package manifest and lock file, and the protocol package it builds against;
 *   - the build's own output: every file under `_next/static` (the scripts, styles and fonts a page's HTML names),
 *     except the build id's folder. A cached page names those files, and a deploy replaces them, so the version must
 *     change whenever one of them does. It does not change when only an API route, a test or a data file changed,
 *     because those leave the files a page names byte for byte the same;
 *   - the Worker's text variables (feature switches) and the public build-time values (NEXT_PUBLIC_*), hashed.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => sha(value).slice(0, 32);

/** The committed paths whose bytes can change a rendered page. */
export const TEMPLATE_PATHS = ["web/src", "web/next.config.js", "web/postcss.config.js", "web/tailwind.config.ts"];

/** Dependencies the build resolves outside src: the manifest, the lock file and the protocol package it builds against. */
export const DEPENDENCY_PATHS = ["web/package.json", "web/package-lock.json", "packages/protocol/package.json", "packages/protocol/src", "packages/protocol/schema"];

/** Files under those paths that cannot change a cached page's HTML, or that another version already covers. */
const TEMPLATE_EXCLUDE = [
  /^web\/src\/app\/api\//,
  /^web\/src\/data\/game-data\//,
  // The addon map is part of the addon version, which the addon pages (its only readers) carry.
  /^web\/src\/data\/addon-repos\.ts$/,
  /^web\/src\/test\//,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
];

/** Whether a repository path can change a cached page's HTML. */
export const isTemplateFile = (path) => !TEMPLATE_EXCLUDE.some((re) => re.test(path));

/** The tracked files, plus untracked ones git does not ignore, under `paths` (repository-relative), sorted. */
export function listWithGit(root, paths) {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...paths], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  return [...new Set(out.split("\0").filter(Boolean))].sort();
}

/**
 * One value for the bytes of every file under `paths` that `keep` accepts. A file git lists but the tree no longer
 * has (deleted, not yet committed) is not an input. An empty set throws: the version would then match nothing real.
 * @param {string} root
 * @param {string[]} paths
 * @param {{ list?: typeof listWithGit, keep?: (path: string) => boolean, label?: string }} [options]
 */
export function inputsDigest(root, paths, { list = listWithGit, keep = () => true, label = paths.join(", ") } = {}) {
  let files;
  try {
    files = list(root, paths).filter(keep).filter((f) => existsSync(join(root, f)));
  } catch (error) {
    throw new Error(`[cache] cannot list ${label}: ${error instanceof Error ? error.message : error}`);
  }
  if (files.length === 0) throw new Error(`[cache] no input files under ${label}; refusing to stamp a version for nothing`);
  return digest(files.map((f) => `${f}\0${sha(readFileSync(join(root, f)))}`).join("\n"));
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/**
 * The files a built page can name: everything under `_next/static` except the build id's folder (its manifests are
 * rewritten by every build and no page names them), each by path and content. Throws when the folder or the build
 * id cannot be read: a page cached without knowing its assets could outlive them.
 * @param {string} staticDir .open-next/assets/_next/static
 * @param {string} buildId the build's id (.next/BUILD_ID)
 */
export function staticAssetsFingerprint(staticDir, buildId) {
  if (!buildId || !existsSync(staticDir)) throw new Error(`[cache] cannot read the build's static assets at ${staticDir}`);
  const files = walk(staticDir)
    .map((f) => relative(staticDir, f).replaceAll("\\", "/"))
    .filter((f) => !f.startsWith(`${buildId}/`))
    .sort();
  if (files.length === 0) throw new Error(`[cache] the build's static assets at ${staticDir} are empty`);
  return digest(files.map((f) => `${f}\0${sha(readFileSync(join(staticDir, f)))}`).join("\n"));
}

/** The text variables of the Worker (feature switches), as one value. The knowledge release has its own version, so it is left out. */
export const varsDigest = (vars) => digest(JSON.stringify(Object.entries(vars).filter(([k, v]) => k !== "KNOWLEDGE_RELEASE_SHA256" && typeof v === "string").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

/** The public build-time values, as one value: they are inlined into the pages, so a changed one changes them. */
export const publicEnvDigest = (env) => digest(JSON.stringify(Object.entries(env).filter(([k, v]) => k.startsWith("NEXT_PUBLIC_") && typeof v === "string").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

/**
 * Every version the Worker needs for one build.
 * @param {{ root: string, staticAssets: string, knowledgeRelease?: string, vars?: Record<string, unknown>, env?: Record<string, string | undefined>, list?: typeof listWithGit }} options
 *   `staticAssets` is staticAssetsFingerprint's value for this build.
 */
export function cacheVersions({ root, staticAssets, knowledgeRelease, vars = {}, env = {}, list = listWithGit }) {
  if (!knowledgeRelease) throw new Error("[cache] KNOWLEDGE_RELEASE_SHA256 is not set; refusing to stamp edge cache versions");
  if (!staticAssets) throw new Error("[cache] no static assets fingerprint; refusing to stamp a template version");
  const template = digest([
    `source ${inputsDigest(root, TEMPLATE_PATHS, { list, keep: isTemplateFile, label: "the rendering source" })}`,
    `dependencies ${inputsDigest(root, DEPENDENCY_PATHS, { list, keep: isTemplateFile, label: "the dependency files" })}`,
    `assets ${staticAssets}`,
    `vars ${varsDigest(vars)}`,
    `public ${publicEnvDigest(env)}`,
  ].join("\n"));
  return {
    template,
    data: inputsDigest(root, ["web/src/data/game-data"], { list, label: "the game data" }),
    knowledge: `${inputsDigest(root, ["kb"], { list, label: "kb" })}-${knowledgeRelease}`,
    // The addon zips (and the rest of public/) and the owner-approved source list the addon pages read.
    addon: inputsDigest(root, ["web/public", "web/src/data/addon-repos.ts"], { list, label: "the public folder and addon map" }),
  };
}

/**
 * Compute this build's versions and write them where the Worker entry imports them (.open-next/cache-versions.json).
 * Run from web/ after the OpenNext build.
 * @param {{ webDir?: string, vars?: Record<string, unknown>, env?: Record<string, string | undefined> }} [options]
 */
export function writeCacheVersions({ webDir = process.cwd(), vars = {}, env = process.env } = {}) {
  const root = execFileSync("git", ["-C", webDir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const buildIdFile = join(webDir, ".next", "BUILD_ID");
  if (!existsSync(buildIdFile)) throw new Error(`[cache] ${buildIdFile} is missing: run the build first`);
  const staticAssets = staticAssetsFingerprint(join(webDir, ".open-next", "assets", "_next", "static"), readFileSync(buildIdFile, "utf8").trim());
  const versions = cacheVersions({ root, staticAssets, knowledgeRelease: typeof vars.KNOWLEDGE_RELEASE_SHA256 === "string" ? vars.KNOWLEDGE_RELEASE_SHA256 : undefined, vars, env });
  writeFileSync(join(webDir, ".open-next", "cache-versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
  return versions;
}
