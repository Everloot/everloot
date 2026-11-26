// Uploads an extracted asset folder (`npm run kb -- client-assets`) to S3-compatible buckets such as
// Cloudflare R2. A maintainer runs it with their own credentials; nothing runs it for them.
//
//   node scripts/upload-game-assets.mjs <kb/data/assets/<build>> [--dry-run] [--skip-items]
//   node scripts/upload-game-assets.mjs --snapshot <kb/data/client/<build>.sqlite> [--dry-run] [--skip-items]
//   node scripts/upload-game-assets.mjs --renders <kb/data/renders/<build>> [--folder=<live build folder>] [--dry-run]
//
// --renders uploads model pictures (`npm run kb -- client-renders`): the pictures to the public bucket's shared
// renders/ folder, only those it does not hold yet, then renders.json to the build folder.
//
// With --snapshot it first runs the extraction (`client-assets` in kb/, which needs Python with Pillow)
// and then uploads what it wrote: one command for the talent art, the item, class, buff and profession
// icons, the map pictures and the item tooltip facts.
//
// Two folders, two buckets:
//   <build>/          manifest.json and the images     -> the PUBLIC bucket (ASSETS_BUCKET)
//   <build>-private/  items.json and items/<n>.json    -> the PRIVATE bucket (ASSETS_PRIVATE_BUCKET)
// The item files hold every named item in the build, released or not, so they never go to the public
// bucket; the site's server reads them with its own read-only key. --skip-items leaves them out.
//
// Environment (never arguments, never committed):
//   ASSETS_S3_ENDPOINT        https://<account id>.r2.cloudflarestorage.com
//   ASSETS_BUCKET             the public bucket
//   ASSETS_PRIVATE_BUCKET     the private bucket for item data (must not be the public one)
//   ASSETS_ACCESS_KEY_ID      an access key that can write to those two buckets only
//   ASSETS_SECRET_ACCESS_KEY  its secret
//   ASSETS_REGION             optional, "auto" by default (R2)
//
// What it does: checks each folder against its list (checksums.json for the public folder, which stays
// here, and items.json for the private one): every file there, every hash right, nothing extra, only the
// kinds of file each bucket may hold. Then it uploads under the build's folder name, files first and the
// manifest or index last, so a half-finished upload never lists a file that is not there. Files are
// cached for a year and never deleted by this script: a changed build goes to a new folder. See docs/ASSETS.md.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";
import { folderProblems, isPrivateFile, isPublicFile, missingRemote, parseUploadArgs, rendersCheck, uploadOrder, USAGE, withRetry } from "./game-assets-upload.mjs";

const opts = parseUploadArgs(process.argv.slice(2));
if (opts.error) fail(`${opts.error}\n${USAGE}`);

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Runs `client-assets` in kb/ on the snapshot and returns the public folder it wrote. */
function extract(snapshotPath) {
  const kb = fileURLToPath(new URL("../../kb/", import.meta.url));
  const tsx = join(kb, "node_modules", "tsx", "dist", "cli.mjs");
  console.log(`Extracting from ${snapshotPath} ...`);
  const run = spawnSync(process.execPath, [tsx, "src/cli.ts", "client-assets", resolve(snapshotPath)], { cwd: kb, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.status !== 0) fail(`The extraction stopped (exit ${run.status ?? run.signal}); nothing uploaded.`);
  const out = /^-> (.+)$/m.exec(run.stdout ?? "")?.[1]?.trim();
  if (!out) fail("The extraction did not say where it wrote the files; nothing uploaded.");
  return resolve(kb, out);
}

if (opts.renders) {
  await uploadRenders(resolve(opts.renders));
  process.exit(0);
}

/**
 * Model pictures (`npm run kb -- client-renders`): the hash-named pictures go to the public bucket's shared
 * `renders/` folder, each only if the bucket does not hold it yet (a name is the hash of what made the picture),
 * then renders.json to the build folder, last.
 */
async function uploadRenders(root) {
  if (!existsSync(join(root, "renders.json")) || !existsSync(join(root, "checksums.json"))) fail(`${root} has no renders.json and checksums.json; run client-renders first.`);
  const manifest = JSON.parse(readFileSync(join(root, "renders.json"), "utf8"));
  const sums = JSON.parse(readFileSync(join(root, "checksums.json"), "utf8"));
  const check = rendersCheck(root, manifest, sums, opts.live);
  if (check.problems.length) fail(`The renders folder does not match its list, nothing uploaded:\n${check.problems.slice(0, 20).join("\n")}`);
  const c = manifest.counts;
  console.log(`Renders: ${check.files.length} pictures for build ${manifest.build.version} (${Object.keys(manifest.creatureDisplays).length} creature and ${Object.keys(manifest.itemDisplays).length} item displays) -> <public bucket>/renders/, renders.json -> <public bucket>/${check.prefix}/`);
  console.log(`         ${c.made} drawn this run, ${c.reused} reused; skipped ${c.encrypted} encrypted, ${c.absent} not in build, ${c.failed} failed`);
  if (opts.dry) { console.log("Dry run, nothing sent. A real run first asks the bucket which pictures it already holds and sends only the others."); process.exit(0); }
  const need = ["ASSETS_S3_ENDPOINT", "ASSETS_BUCKET", "ASSETS_ACCESS_KEY_ID", "ASSETS_SECRET_ACCESS_KEY"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) fail(`Set ${missing.join(", ")} in the environment first.`);
  const bucket = process.env.ASSETS_BUCKET;
  const client = new AwsClient({ accessKeyId: process.env.ASSETS_ACCESS_KEY_ID, secretAccessKey: process.env.ASSETS_SECRET_ACCESS_KEY, service: "s3", region: process.env.ASSETS_REGION || "auto" });
  const endpoint = process.env.ASSETS_S3_ENDPOINT.replace(/\/+$/, "");
  const out = dirname(root);
  const send = async (key, path, type, cache) => {
    try {
      await withRetry(async () => {
        const res = await client.fetch(`${endpoint}/${bucket}/${key}`, { method: "PUT", headers: { "content-type": type, "cache-control": cache }, body: readFileSync(path) });
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      });
    } catch (e) {
      fail(`Upload of ${key} failed after 4 tries: ${e.message}`);
    }
  };
  const held = async (key) => {
    const res = await withRetry(async () => {
      const r = await client.fetch(`${endpoint}/${bucket}/${key}`, { method: "HEAD" });
      if (r.status !== 200 && r.status !== 404) throw new Error(`HEAD ${key}: ${r.status}`);
      return r;
    });
    return res.status === 200;
  };
  const todo = await missingRemote(check.files, held);
  console.log(`${check.files.length - todo.length} already in the bucket, ${todo.length} to send.`);
  const queue = [...todo];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let f = queue.shift(); f !== undefined; f = queue.shift()) await send(f, join(out, f), "image/webp", "public, max-age=31536000, immutable");
  }));
  await send(`${check.prefix}/renders.json`, join(root, "renders.json"), "application/json", "public, max-age=300");
  console.log(`Done. The site reads ${check.prefix}/renders.json beside manifest.json.`);
}

const root = opts.snapshot ? extract(opts.snapshot) : resolve(opts.folder);
const prefix = basename(root);
const privateRoot = `${root}-private`;

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
if (manifest.schema !== "everloot.game-assets/1") fail(`manifest.json has schema ${manifest.schema}, expected everloot.game-assets/1`);
if (manifest.items) fail("manifest.json lists item data; it was written by an older extractor. Extract again: item data must not go to the public bucket.");
if (!existsSync(join(root, "checksums.json"))) fail("checksums.json is missing beside manifest.json; extract again with this version of kb.");
const sums = JSON.parse(readFileSync(join(root, "checksums.json"), "utf8"));
const pub = folderProblems(root, new Map(Object.entries(sums.files).map(([f, s]) => [f, s.sha256])), { index: "manifest.json", allowed: isPublicFile, skip: ["checksums.json"] });

const withItems = existsSync(join(privateRoot, "items.json")) && !opts.skipItems;
const index = withItems ? JSON.parse(readFileSync(join(privateRoot, "items.json"), "utf8")) : null;
if (index && index.build?.version !== manifest.build.version) fail(`The private folder is for build ${index.build?.version}, the public one for ${manifest.build.version}; extract again.`);
const priv = index ? folderProblems(privateRoot, new Map(Object.values(index.shards).map((s) => [s.file, s.sha256])), { index: "items.json", allowed: isPrivateFile }) : null;

const problems = [...pub.problems.map((p) => `public: ${p}`), ...(priv?.problems ?? []).map((p) => `private: ${p}`)];
if (problems.length) fail(`The folders do not match their lists, nothing uploaded:\n${problems.slice(0, 20).join("\n")}`);

const maps = Object.keys(manifest.maps ?? {}).length;
console.log(`Public:  ${pub.present.length} images + manifest.json for build ${manifest.build.version} -> <public bucket>/${prefix}/ (${maps} map pictures)`);
console.log(index ? `Private: ${priv.present.length} item files + items.json (${index.count} items) -> <private bucket>/${prefix}/` : `Private: no item data${opts.skipItems ? " (--skip-items)" : ""}; item tooltips will not show.`);
if (opts.dry) { console.log("Dry run, nothing sent."); process.exit(0); }

const need = ["ASSETS_S3_ENDPOINT", "ASSETS_BUCKET", "ASSETS_ACCESS_KEY_ID", "ASSETS_SECRET_ACCESS_KEY", ...(index ? ["ASSETS_PRIVATE_BUCKET"] : [])];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) fail(`Set ${missing.join(", ")} in the environment first${index ? " (or pass --skip-items to leave the item data out)" : ""}.`);
if (index && process.env.ASSETS_PRIVATE_BUCKET === process.env.ASSETS_BUCKET) fail("ASSETS_PRIVATE_BUCKET must be a different, private bucket: the item data must not be public.");

const client = new AwsClient({
  accessKeyId: process.env.ASSETS_ACCESS_KEY_ID,
  secretAccessKey: process.env.ASSETS_SECRET_ACCESS_KEY,
  service: "s3",
  region: process.env.ASSETS_REGION || "auto",
});
const endpoint = process.env.ASSETS_S3_ENDPOINT.replace(/\/+$/, "");

async function put(bucket, base, rel, type, cache) {
  const body = readFileSync(join(base, rel));
  try {
    await withRetry(async () => {
      const res = await client.fetch(`${endpoint}/${bucket}/${prefix}/${rel}`, { method: "PUT", headers: { "content-type": type, "cache-control": cache }, body });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    });
  } catch (e) {
    fail(`Upload of ${rel} failed after 4 tries: ${e.message}`);
  }
}

/** Eight at a time: item icons run to thousands of files. The index goes alone, after all of them. */
async function upload(bucket, base, files, indexFile) {
  const order = uploadOrder(files, indexFile);
  const queue = order.slice(0, -1);
  let done = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
      await put(bucket, base, f, f.endsWith(".json") ? "application/json" : "image/webp", "public, max-age=31536000, immutable");
      if (++done % 500 === 0) console.log(`  ${done} of ${order.length - 1}`);
    }
  }));
  await put(bucket, base, indexFile, "application/json", "public, max-age=300");
}

if (index) await upload(process.env.ASSETS_PRIVATE_BUCKET, privateRoot, priv.present, "items.json");
await upload(process.env.ASSETS_BUCKET, root, pub.present, "manifest.json");
console.log(`Done. Set NEXT_PUBLIC_GAME_ASSETS_URL to <the public bucket's URL>/${prefix} and redeploy.`);
if (index) console.log("For item tooltips, also set GAME_DATA_S3_ENDPOINT, GAME_DATA_BUCKET, GAME_DATA_ACCESS_KEY_ID and GAME_DATA_SECRET_ACCESS_KEY (a read-only key) on the server.");
