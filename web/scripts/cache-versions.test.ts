import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { cacheVersions, inputsDigest, isTemplateFile, listWithGit, staticAssetsFingerprint, writeCacheVersions } from "./cache-versions.mjs";

const roots: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-cache-"));
  roots.push(dir);
  return dir;
};
afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });

const put = (root: string, path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A repository holding one file for every input the versions read, with the build output ignored as in the real one. */
function repo(): string {
  const root = scratch();
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  put(root, ".gitignore", "node_modules\n.next\n.open-next\n");
  put(root, "web/src/app/page.tsx", "export default () => 'home';");
  put(root, "web/src/app/api/items/route.ts", "export const GET = () => 1;");
  put(root, "web/src/app/api/items/route.test.ts", "// test");
  put(root, "web/src/lib/items.ts", "export const items = 1;");
  put(root, "web/src/data/game-data/items.json", "{\"a\":1}");
  put(root, "web/src/data/addon-repos.ts", "export const A = 1;");
  put(root, "web/next.config.js", "module.exports = {};");
  put(root, "web/postcss.config.js", "module.exports = {};");
  put(root, "web/tailwind.config.ts", "export default {};");
  put(root, "web/package.json", "{\"name\":\"web\"}");
  put(root, "web/package-lock.json", "{\"lock\":1}");
  put(root, "web/public/robots.txt", "User-agent: *");
  put(root, "packages/protocol/package.json", "{\"name\":\"protocol\"}");
  put(root, "packages/protocol/src/index.ts", "export const p = 1;");
  put(root, "packages/protocol/schema/a.json", "{}");
  put(root, "kb/news/a.md", "news");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  // The build's own output: the build id and the files a page names.
  put(root, "web/.next/BUILD_ID", "build-one");
  put(root, "web/.open-next/assets/_next/static/chunks/app-aaaa.js", "console.log('a')");
  put(root, "web/.open-next/assets/_next/static/css/site-bbbb.css", "body{}");
  put(root, "web/.open-next/assets/_next/static/build-one/_buildManifest.js", "manifest one");
  return root;
}

const VARS = { KNOWLEDGE_RELEASE_SHA256: "release1", EVERLOOT_PROFILES: "1", NEWS_DIR: "/bundle/repo/kb/news" };
const stamp = (root: string, over: { vars?: Record<string, unknown>; env?: Record<string, string> } = {}) =>
  writeCacheVersions({ webDir: join(root, "web"), vars: over.vars ?? VARS, env: over.env ?? {} });

test("the template version covers the rendering source and leaves out the API, the game data, the addon map and tests", () => {
  for (const path of ["web/src/app/page.tsx", "web/src/components/card.tsx", "web/src/lib/items.ts", "web/next.config.js", "packages/protocol/src/index.ts"]) expect(isTemplateFile(path), path).toBe(true);
  for (const path of ["web/src/app/api/items/route.ts", "web/src/data/game-data/items.json", "web/src/data/addon-repos.ts", "web/src/test/setup.ts", "web/src/lib/items.test.ts", "web/src/lib/items.spec.tsx"]) expect(isTemplateFile(path), path).toBe(false);
});

test("an unrelated change keeps every version: an API route, a test, a document outside the inputs", () => {
  const root = repo();
  const before = stamp(root);
  put(root, "web/src/app/api/items/route.ts", "export const GET = () => 2; // a different API response");
  put(root, "web/src/app/api/items/route.test.ts", "// another test");
  put(root, "web/src/app/api/brand-new/route.ts", "export const GET = () => 3;");
  put(root, "docs/notes.md", "outside every input");
  put(root, "web/README.md", "outside every input");
  expect(stamp(root)).toEqual(before);
});

test("a page, shared code, build config, dependency or protocol change starts a new template version and leaves the other versions", () => {
  const root = repo();
  const before = stamp(root);
  const changes: [string, string][] = [
    ["web/src/app/page.tsx", "export default () => 'a different home';"],
    ["web/src/lib/items.ts", "export const items = 2;"],
    ["web/next.config.js", "module.exports = { reactStrictMode: false };"],
    ["web/package-lock.json", "{\"lock\":2}"],
    ["web/package.json", "{\"name\":\"web\",\"x\":1}"],
    ["packages/protocol/src/index.ts", "export const p = 2;"],
  ];
  for (const [path, content] of changes) {
    const original = readFileSync(join(root, path), "utf8");
    put(root, path, content);
    const after = stamp(root);
    expect(after.template, path).not.toBe(before.template);
    expect({ ...after, template: "" }, path).toEqual({ ...before, template: "" });
    put(root, path, original);
    expect(stamp(root), path).toEqual(before);
  }
});

test("a game-data, knowledge or addon change starts only the version of the pages that read it", () => {
  const root = repo();
  const before = stamp(root);
  const cases: [string, string, "data" | "knowledge" | "addon"][] = [
    ["web/src/data/game-data/items.json", "{\"a\":2}", "data"],
    ["kb/news/a.md", "news changed", "knowledge"],
    ["web/public/robots.txt", "User-agent: bot", "addon"],
    ["web/src/data/addon-repos.ts", "export const A = 2;", "addon"],
  ];
  for (const [path, content, changed] of cases) {
    const original = readFileSync(join(root, path), "utf8");
    put(root, path, content);
    const after = stamp(root);
    for (const key of ["template", "data", "knowledge", "addon"] as const) {
      if (key === changed) expect(after[key], `${path} -> ${key}`).not.toBe(before[key]);
      else expect(after[key], `${path} -> ${key}`).toBe(before[key]);
    }
    put(root, path, original);
  }
});

test("a new knowledge release starts the knowledge version, and a feature switch or public build value the template", () => {
  const root = repo();
  const before = stamp(root);
  const release = stamp(root, { vars: { ...VARS, KNOWLEDGE_RELEASE_SHA256: "release2" } });
  expect(release.knowledge).not.toBe(before.knowledge);
  expect({ ...release, knowledge: "" }).toEqual({ ...before, knowledge: "" });
  expect(stamp(root, { vars: { ...VARS, EVERLOOT_PROFILES: "0" } }).template).not.toBe(before.template);
  expect(stamp(root, { vars: { ...VARS, EVERLOOT_NEW_SWITCH: "1" } }).template).not.toBe(before.template);
  expect(stamp(root, { env: { NEXT_PUBLIC_SITE_URL: "https://staging.example" } }).template).not.toBe(before.template);
  // A secret in the environment is not a build input and is never part of a version.
  expect(stamp(root, { env: { CLOUDFLARE_API_TOKEN: "secret" } })).toEqual(before);
});

test("the versions describe the working tree that was built, not the last commit", () => {
  const root = repo();
  const committed = stamp(root);
  put(root, "web/src/app/page.tsx", "export default () => 'uncommitted edit';");
  const dirty = stamp(root);
  expect(dirty.template).not.toBe(committed.template);
  // Committing that same edit changes nothing: the version follows the bytes, not the history.
  git(root, "commit", "-qam", "same bytes");
  expect(stamp(root)).toEqual(dirty);
  // A new file git has not seen is built, so it counts; an ignored one is not an input; a deleted one is gone.
  put(root, "web/src/components/new.tsx", "export const N = 1;");
  const withNew = stamp(root);
  expect(withNew.template).not.toBe(dirty.template);
  put(root, "web/src/lib/scratch.ts.orig", "x");
  put(root, "node_modules/x/index.js", "ignored");
  expect(stamp(root).template).not.toBe(withNew.template);
  rmSync(join(root, "web/src/components/new.tsx"));
  rmSync(join(root, "web/src/lib/scratch.ts.orig"));
  expect(stamp(root)).toEqual(dirty);
  rmSync(join(root, "web/src/lib/items.ts"));
  expect(stamp(root).template).not.toBe(dirty.template);
});

test("the build's static files decide the template: a changed, renamed, added or removed file starts it, the build id folder does not", () => {
  const root = repo();
  const before = stamp(root);
  const base = "web/.open-next/assets/_next/static";
  // Every build rewrites the id's folder and names it differently; no page names what is in it.
  put(root, `${base}/build-one/_buildManifest.js`, "manifest two");
  put(root, "web/.next/BUILD_ID", "build-two");
  put(root, `${base}/build-two/_buildManifest.js`, "manifest two");
  rmSync(join(root, `${base}/build-one`), { recursive: true });
  expect(stamp(root)).toEqual(before);
  // A page names its chunks and styles by file, so any change to them (a new hash, a new file, a lost one) must show.
  put(root, `${base}/chunks/app-aaaa.js`, "console.log('changed')");
  const changed = stamp(root);
  expect(changed.template).not.toBe(before.template);
  put(root, `${base}/chunks/app-aaaa.js`, "console.log('a')");
  put(root, `${base}/chunks/extra-cccc.js`, "x");
  expect(stamp(root).template).not.toBe(before.template);
  rmSync(join(root, `${base}/chunks/extra-cccc.js`));
  rmSync(join(root, `${base}/css/site-bbbb.css`));
  expect(stamp(root).template).not.toBe(before.template);
  expect(stamp(root).template).not.toBe(changed.template);
});

test("the versions are written next to the Worker entry, and a missing input stops the build instead of stamping a made-up one", () => {
  const root = repo();
  const versions = stamp(root);
  const written = JSON.parse(readFileSync(join(root, "web/.open-next/cache-versions.json"), "utf8"));
  expect(written).toEqual(versions);
  for (const key of ["template", "data", "knowledge", "addon"] as const) expect(written[key], key).toMatch(/^[0-9a-f]{32}/);
  expect(written.knowledge).toMatch(/-release1$/);

  expect(() => stamp(root, { vars: {} })).toThrow(/KNOWLEDGE_RELEASE_SHA256/);
  const noBuild = repo();
  rmSync(join(noBuild, "web/.next"), { recursive: true });
  expect(() => stamp(noBuild)).toThrow(/BUILD_ID/);
  const noAssets = repo();
  rmSync(join(noAssets, "web/.open-next/assets"), { recursive: true });
  expect(() => stamp(noAssets)).toThrow(/static assets/);
  const noData = repo();
  git(noData, "rm", "-rq", "web/src/data/game-data");
  expect(() => stamp(noData)).toThrow(/game data/);
  const noKb = repo();
  git(noKb, "rm", "-rq", "kb");
  expect(() => stamp(noKb)).toThrow(/kb/);
});

test("the static files fingerprint refuses an unreadable or empty build", () => {
  const dir = scratch();
  expect(() => staticAssetsFingerprint(join(dir, "missing"), "id")).toThrow(/static assets/);
  expect(() => staticAssetsFingerprint(dir, "")).toThrow(/static assets/);
  expect(() => staticAssetsFingerprint(dir, "id")).toThrow(/empty/);
  put(dir, "id/_buildManifest.js", "only the build id's folder");
  expect(() => staticAssetsFingerprint(dir, "id")).toThrow(/empty/);
});

test("an input list that is empty, or that git cannot give, fails closed", () => {
  const dir = scratch();
  expect(() => inputsDigest(dir, ["web/src"], { list: () => [] })).toThrow(/no input files/);
  expect(() => inputsDigest(dir, ["web/src"], { list: () => { throw new Error("not a git repository"); } })).toThrow(/cannot list/);
  expect(() => cacheVersions({ root: dir, staticAssets: "", knowledgeRelease: "r", list: () => ["a"] })).toThrow(/static assets/);
});

test("git's list holds tracked and untracked files, not ignored ones, and each version reads the real repository's files", () => {
  const root = repo();
  put(root, "web/src/untracked.ts", "u");
  put(root, "web/.next/server/x.js", "ignored");
  expect(listWithGit(root, ["web/src"])).toContain("web/src/untracked.ts");
  expect(listWithGit(root, ["web"]).some((f) => f.startsWith("web/.next/") || f.startsWith("web/.open-next/"))).toBe(false);
  // The checkout this test runs in: every input exists, so a version can be stamped for it.
  const real = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const versions = cacheVersions({ root: real, staticAssets: "assets", knowledgeRelease: "release" });
  for (const value of Object.values(versions)) expect(value).toMatch(/^[0-9a-f]{32}/);
  expect(cacheVersions({ root: real, staticAssets: "assets", knowledgeRelease: "release" })).toEqual(versions);
});

test("the Worker entry reads the versions from its bundle, and the deploy passes no cache variable", () => {
  const entry = readFileSync(join(__dirname, "cf-entry.mjs"), "utf8");
  expect(entry).toMatch(/import cacheVersions from "\.\/cache-versions\.json"/);
  expect(entry).not.toMatch(/EVERLOOT_CACHE_/);
  const deploy = readFileSync(join(__dirname, "cf-deploy.mjs"), "utf8");
  expect(deploy).not.toMatch(/EVERLOOT_CACHE_|cacheVars|--var (?!EVERLOOT_COMMIT_SHA)/);
  const bundle = readFileSync(join(__dirname, "cf-bundle-files.mjs"), "utf8");
  expect(bundle).toMatch(/writeCacheVersions\(/);
});
