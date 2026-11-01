import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { unzipSync } from "fflate";

/** The collector addon's folder under Interface/AddOns, and the zip's top folder. */
export const ADDON_FOLDER = "Everloot";
export const RELEASES_API = "https://api.github.com/repos/Everloot/everloot/releases?per_page=100";
const RELEASE_DOWNLOADS = "https://github.com/Everloot/everloot/releases/download";

/** `## Version:` from the installed addon's TOC, or null when the addon is not there. */
export function installedAddonVersion(addonsDir: string): string | null {
  const toc = join(addonsDir, ADDON_FOLDER, `${ADDON_FOLDER}.toc`);
  if (!existsSync(toc)) return null;
  const m = /^## Version:\s*(\S+)/m.exec(readFileSync(toc, "utf8"));
  return m ? m[1] : null;
}

/** Whether the three slot addons the app writes exist yet. */
export function slotAddons(addonsDir: string): { prices: boolean; answers: boolean; builds: boolean } {
  const has = (name: string) => existsSync(join(addonsDir, name, `${name}.toc`));
  return { prices: has("EverlootPrices"), answers: has("EverlootAnswers"), builds: has("EverlootBuilds") };
}

interface Release { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown }
// X.Y.Z, or a pre-release such as a nightly (0.3.4-nightly.20261019.4): the fourth number is 1 for a release, 0 for a pre-release.
const parse = (v: string): number[] | null => { const m = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.]+)?$/.exec(v); return m ? [...m.slice(1, 4).map(Number), m[4] ? 0 : 1] : null; };

/** Positive when a is newer than b. A nightly is newer than the release before it and older than its own release; a non-numeric version (a dev build) is older than anything. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * The addon release to offer: the newest `addon-vX.Y.Z`, an Alpha (published as a GitHub pre-release)
 * included, which is what the download page serves. Nightlies have their own tag and stay out.
 */
export const newestAddonRelease = (releases: unknown) => newestRelease(releases, "addon-v", true);

/** The newest published `<prefix>X.Y.Z` release in GitHub's list. Drafts and other tags are skipped, and pre-releases unless asked for. */
export function newestRelease(releases: unknown, prefix: string, includePrereleases = false): { version: string; url: string } | null {
  if (!Array.isArray(releases)) return null;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+\\.\\d+\\.\\d+)$`);
  let best: { version: string; url: string } | null = null;
  for (const r of releases as Release[]) {
    if (r.draft || (r.prerelease && !includePrereleases) || typeof r.tag_name !== "string") continue;
    const m = re.exec(r.tag_name);
    if (!m) continue;
    const url = typeof r.html_url === "string" ? r.html_url : `https://github.com/Everloot/everloot/releases/tag/${r.tag_name}`;
    if (!best || compareVersions(m[1], best.version) > 0) best = { version: m[1], url };
  }
  return best;
}

/**
 * The zip's files that may be written: regular files under `Everloot/`, with no `..`, no absolute
 * path and no backslash tricks. Anything else in the archive is ignored, never an error, so a
 * stray README at the top does not block an install.
 */
export function safeAddonEntries(entries: Record<string, Uint8Array>): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/") || name.includes("\\") || name.includes("\0")) continue;
    const parts = name.split("/");
    if (parts[0] !== ADDON_FOLDER || parts.length < 2) continue;
    if (parts.some((p) => p === "" || p === "." || p === "..")) continue;
    if (posix.isAbsolute(name)) continue;
    out.push([name, data]);
  }
  return out;
}

/**
 * Writes the addon from a zip into Interface/AddOns in one swap: the files go to `Everloot.new`,
 * the old folder becomes `Everloot.old`, the new one takes its place, the old one is removed.
 * The game folder never sees a half-written addon. If the new folder cannot take its place (a file
 * locked by an antivirus or the game), the old one is put back; if that fails too, both stay on disk
 * and the error names them.
 */
export function extractAddon(zip: Uint8Array, addonsDir: string): number {
  const entries = safeAddonEntries(unzipSync(zip));
  if (entries.length === 0) throw new Error("the zip holds no Everloot/ files");
  if (!entries.some(([name]) => name === `${ADDON_FOLDER}/${ADDON_FOLDER}.toc`)) throw new Error("the zip has no Everloot.toc");
  const target = join(addonsDir, ADDON_FOLDER), fresh = `${target}.new`, old = `${target}.old`;
  if (!existsSync(target) && existsSync(old)) {
    throw new Error(`A previous addon install needs recovery. Rename ${old} to ${target} before trying again; the saved copies have been kept.`);
  }
  rmSync(fresh, { recursive: true, force: true });
  rmSync(old, { recursive: true, force: true });
  for (const [name, data] of entries) {
    const path = join(fresh, ...name.split("/").slice(1));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
  const hadOld = existsSync(target);
  if (hadOld) renameSync(target, old);
  try {
    renameSync(fresh, target);
  } catch (err) {
    if (!hadOld) throw err;
    const why = err instanceof Error ? err.message : String(err);
    try { renameSync(old, target); }
    catch { throw new Error(`${why}; the old addon could not be put back: it is in ${old}, the new one in ${fresh}. Rename ${old} to ${target} before trying again.`); }
    throw err;
  }
  rmSync(old, { recursive: true, force: true });
  return entries.length;
}

/** The sha256 line for a file in a `SHA256SUMS` text, or null when the file is not listed. */
export function checksumFor(sums: string, fileName: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === fileName) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Downloads `Everloot-<version>.zip` from the site, checks it against the `SHA256SUMS` published
 * with the GitHub release, and installs it. No matching checksum means no install.
 */
export async function installAddon(options: { version: string; endpoint: string; addonsDir: string; send?: typeof fetch }): Promise<{ version: string; files: number }> {
  const send = options.send ?? fetch;
  const file = `Everloot-${options.version}.zip`;
  const sumsRes = await send(`${RELEASE_DOWNLOADS}/addon-v${options.version}/SHA256SUMS`, { signal: AbortSignal.timeout(15_000) });
  if (!sumsRes.ok) throw new Error(`release checksums: ${sumsRes.status}`);
  const expected = checksumFor(await sumsRes.text(), file);
  if (!expected) throw new Error(`${file} is not listed in the release checksums`);
  const zipRes = await send(`${options.endpoint}/downloads/${file}`, { signal: AbortSignal.timeout(120_000) });
  if (!zipRes.ok) throw new Error(`addon download: ${zipRes.status}`);
  const bytes = new Uint8Array(await zipRes.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error("the download does not match the release checksum; nothing was installed");
  return { version: options.version, files: extractAddon(bytes, options.addonsDir) };
}
