import { readdirSync } from "node:fs";
import { join } from "node:path";

export interface AddonRelease {
  version: string;
  /** Site path of the zip, served from web/public/downloads. */
  downloadPath: string;
}

const NAME = /^Everloot-(\d+)\.(\d+)\.(\d+)\.zip$/;

/**
 * The zips in public/downloads with their size and SHA-256, keyed by site path, as next.config.js worked them out
 * from the files when the site was built. The Worker serves public/ as static assets, so a page it rebuilds can
 * neither list nor read them. Null outside a Next build (tests, scripts), where the folder itself is read.
 */
export function builtDownloads(): Record<string, { size: number; sha256: string }> | null {
  const json = process.env.EVERLOOT_DOWNLOADS;
  return json ? JSON.parse(json) : null;
}

/**
 * The newest addon zip that the site actually serves. The upload page and its structured data both read this,
 * so the version and the download link cannot disagree with the file, or with each other.
 */
export function latestAddonRelease(dir = join(process.cwd(), "public", "downloads")): AddonRelease | null {
  let files: string[];
  try {
    const built = builtDownloads();
    files = built ? Object.keys(built).map((path) => path.replace(/^\/downloads\//, "")) : readdirSync(dir);
  } catch {
    return null;
  }
  // The link is rebuilt from the numbers, never copied from the file name, and a name the numbers would not
  // rebuild exactly (a leading zero) is skipped, so the link always names a file that is there.
  const found = files
    .map((file) => {
      const m = NAME.exec(file);
      const v = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      return v && file === `Everloot-${v.join(".")}.zip` ? v : null;
    })
    .filter((v): v is number[] => v !== null)
    .sort((a, b) => {
      for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] - a[i];
      return 0;
    })[0];
  if (!found) return null;
  const version = found.join(".");
  return { version, downloadPath: `/downloads/Everloot-${version}.zip` };
}
