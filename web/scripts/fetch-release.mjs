/**
 * Prebuild: put the approved knowledge release in web/.release so the /mcp function ships it.
 * The release is gitignored, so a Node build fetches it from the private R2 bucket the site already
 * uses, at EVERLOOT_KB_RELEASE_KEY (e.g. knowledge/2026-10-05-everloot-public.sqlite), plus its
 * manifest, and keeps it only if the file's sha256 matches the manifest. Every other outcome leaves
 * no release and lets the build continue: /mcp then answers 503, never an unverified knowledge base.
 * Run: node scripts/fetch-release.mjs (npm runs it before `next build`).
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AwsClient } from "aws4fetch";

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function verified(db, manifest) {
  if (!existsSync(db) || !existsSync(manifest)) return false;
  const expected = JSON.parse(readFileSync(manifest, "utf8")).sha256;
  return typeof expected === "string" && expected === (await sha256File(db));
}

/**
 * @param {{ dir: string, env?: Record<string, string | undefined>, fetch?: (req: Request) => Promise<Response>, log?: (msg: string) => void }} options
 * @returns {Promise<"skipped" | "present" | "downloaded" | "mismatch" | "failed">}
 */
export async function fetchRelease({ dir, env = process.env, fetch = globalThis.fetch, log = console.log }) {
  const key = env.EVERLOOT_KB_RELEASE_KEY?.trim();
  const name = key ? basename(key) : "";
  const db = join(dir, name), manifest = `${db}.manifest.json`;
  if (key && (await verified(db, manifest))) {
    log(`[release] ${name} present, hash verified`);
    return "present";
  }
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: id, R2_SECRET_ACCESS_KEY: secret, R2_BUCKET: bucket } = env;
  if (!key || !account || !id || !secret || !bucket) {
    log("[release] no knowledge release configured; /mcp will answer 503");
    return "skipped";
  }
  const aws = new AwsClient({ accessKeyId: id, secretAccessKey: secret, service: "s3", region: "auto" });
  const url = (objectKey) => `https://${account}.r2.cloudflarestorage.com/${bucket}/${objectKey}`;
  const get = async (objectKey) => fetch(await aws.sign(url(objectKey), { method: "GET" }));
  try {
    mkdirSync(dir, { recursive: true });
    const m = await get(`${key}.manifest.json`);
    if (!m.ok) throw new Error(`manifest ${m.status}`);
    writeFileSync(manifest, await m.text());
    const d = await get(key);
    if (!d.ok || !d.body) throw new Error(`release ${d.status}`);
    await pipeline(Readable.fromWeb(d.body), createWriteStream(db));
  } catch (err) {
    rmSync(db, { force: true });
    rmSync(manifest, { force: true });
    log(`[release] download failed (${err instanceof Error ? err.message : String(err)}); /mcp will answer 503`);
    return "failed";
  }
  if (!(await verified(db, manifest))) {
    rmSync(db, { force: true });
    rmSync(manifest, { force: true });
    log("[release] sha256 does not match the manifest; removed. /mcp will answer 503");
    return "mismatch";
  }
  log(`[release] ${name} downloaded, hash verified`);
  return "downloaded";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(fileURLToPath(new URL("..", import.meta.url)), ".release");
  await fetchRelease({ dir });
}
