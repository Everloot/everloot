import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { checksumFor } from "./addon";

/**
 * The app updating itself, on Windows installs only: the new installer is downloaded into the data
 * folder, checked against the SHA256SUMS published with the release, and run silently when the
 * player chooses Restart. It installs over this one and starts the app again; settings and the data
 * folder are not touched. A macOS disk image, a Linux AppImage and the portable exe cannot be swapped
 * like that, so those keep the download in the browser.
 */

export function canInstallInPlace(platform: string, portable: boolean): boolean {
  return platform === "win32" && !portable;
}

/**
 * The most an installer may be. The installed 0.1.x app is about 383 MiB uncompressed and its NSIS
 * installer is compressed, so this leaves room to grow while stopping an endless or lying download.
 */
export const INSTALLER_LIMIT = 512 * 1024 * 1024;
/** SHA256SUMS lists four files in a few hundred bytes. */
const SUMS_LIMIT = 64 * 1024;

const RELEASE_PATH = /^\/Everloot\/everloot\/releases\/download\/desktop-v(\d+\.\d+\.\d+)\/([^/]+)$/;
const INSTALLER_NAME = /^Everloot-DesktopApp-(\d+\.\d+\.\d+)-win-x64-setup\.exe$/;

/**
 * The tag version and file name of a desktop release download on this project's GitHub, or null for
 * anything else: another host or repo, http, credentials, a port, a query, or an encoded character.
 * GitHub renames asset files with special characters, so a real asset name never needs encoding.
 */
function releaseFile(url: string): { version: string; name: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.port || u.username || u.password || u.search || u.hash) return null;
  const m = RELEASE_PATH.exec(u.pathname);
  return m && !m[2].includes("%") ? { version: m[1], name: m[2] } : null;
}

/** The body's chunks, refused once its declared or actual size passes `limit` bytes; the rest is never read. */
async function* bounded(res: Response, limit: number, what: string): AsyncGenerator<Uint8Array> {
  if (Number(res.headers.get("content-length")) > limit) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`${what} is over the ${limit} bytes allowed`);
  }
  if (!res.body) throw new Error(`${what}: empty response`);
  const reader = res.body.getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      got += value.length;
      if (got > limit) throw new Error(`${what} is over the ${limit} bytes allowed`);
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** GitHub's asset redirects are followed; refuse a failed response or a final URL that is not HTTPS. */
async function checkResponse(res: Response, what: string): Promise<void> {
  const error = !res.ok || !res.body ? `${what}: ${res.status}`
    : res.url && !res.url.startsWith("https://") ? `${what} final URL is not HTTPS` : null;
  if (error) {
    await res.body?.cancel().catch(() => {});
    throw new Error(error);
  }
}

/**
 * Downloads `url` to `dir`, reporting progress from 0 to 100, and refuses a file whose SHA-256 is not
 * the one SHA256SUMS lists. Only the Windows installer of a desktop release on this project's GitHub
 * is fetched, with its SHA256SUMS from the same release (and that release `version`, when given).
 * The file is written beside the old one and replaces it only once verified.
 */
export async function downloadUpdate(options: {
  url: string; sumsUrl: string; dir: string; version?: string; limit?: number; send?: typeof fetch; onProgress?: (percent: number) => void;
}): Promise<string> {
  const send = options.send ?? fetch;
  const limit = options.limit ?? INSTALLER_LIMIT;
  const asset = releaseFile(options.url);
  const sums = releaseFile(options.sumsUrl);
  const named = asset && INSTALLER_NAME.exec(asset.name);
  if (!asset || !sums || !named || named[1] !== asset.version || sums.name !== "SHA256SUMS" || sums.version !== asset.version
    || (options.version !== undefined && options.version !== asset.version)) {
    throw new Error("the update is not an Everloot Desktop App release download; nothing was downloaded");
  }
  const file = asset.name;
  const release = `https://github.com/Everloot/everloot/releases/download/desktop-v${asset.version}/`;

  const sumsRes = await send(`${release}SHA256SUMS`, { signal: AbortSignal.timeout(15_000) });
  await checkResponse(sumsRes, "release checksums");
  const sumsChunks: Uint8Array[] = [];
  for await (const chunk of bounded(sumsRes, SUMS_LIMIT, "release checksums")) sumsChunks.push(chunk);
  const expected = checksumFor(Buffer.concat(sumsChunks).toString("utf8"), file);
  if (!expected) throw new Error(`${file} is not listed in the release checksums`);

  const res = await send(`${release}${file}`, { signal: AbortSignal.timeout(15 * 60_000) });
  await checkResponse(res, "download");
  const total = Number(res.headers.get("content-length")) || 0;
  const target = join(options.dir, file);
  const part = `${target}.part`;
  const hash = createHash("sha256");
  let got = 0;
  let shown = -1;
  try {
    mkdirSync(options.dir, { recursive: true });
    const out = await open(part, "w");
    try {
      for await (const chunk of bounded(res, limit, file)) {
        for (let offset = 0; offset < chunk.length;) {
          const { bytesWritten } = await out.write(chunk, offset, chunk.length - offset);
          if (!bytesWritten) throw new Error(`${file} could not be written`);
          offset += bytesWritten;
        }
        hash.update(chunk);
        got += chunk.length;
        const percent = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
        if (percent !== shown) { shown = percent; options.onProgress?.(percent); }
      }
    } finally {
      await out.close();
    }
    if (hash.digest("hex") !== expected) throw new Error(`${file} does not match its published checksum; nothing was installed`);
    // Replaces the old installer in one step; until here it was left as it was.
    renameSync(part, target);
  } catch (err) {
    await res.body?.cancel().catch(() => {});
    try { rmSync(part, { force: true }); } catch { /* Keep the original failure if the partial file is locked. */ }
    throw err;
  }
  options.onProgress?.(100);
  return target;
}

/**
 * Starts the downloaded installer silently and detached, so it outlives this app: it waits for the
 * app to close, installs over it, and starts it again (`--force-run`). Resolves once the process has
 * started and rejects when it cannot; the caller quits only after that. Starting is not installing:
 * the installer can still fail on its own after this app has gone.
 */
export function runInstaller(path: string, launch: typeof spawn = spawn): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = launch(path, ["/S", "--force-run"], { detached: true, stdio: "ignore" });
    // Stays attached, so a late error from the detached child is not an uncaught exception here.
    child.on("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}
