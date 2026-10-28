// Everloot's own releases from GitHub's public REST API, for the /addon page, cached for an hour.
// One request reads the newest hundred releases: the newest `desktop-vX.Y.Z` among them is the app
// offered, and the `addon-vX.Y.Z` that matches the zip the site serves gives its release date.
// Desktop pre-releases and all drafts are skipped. The exact served addon version can be an Alpha.
// Nightly tags never match an addon-vX.Y.Z tag. GITHUB_TOKEN is optional. Nothing here throws:
// when GitHub cannot be read, the page links the releases page instead.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_URL } from "./source";

const RELEASES_API = "https://api.github.com/repos/Everloot/everloot/releases?per_page=100";
export const RELEASES_PAGE = `${REPO_URL}/releases`;
const DOWNLOADS = `${REPO_URL}/releases/download/`;

export interface ReleaseFile {
  name: string;
  url: string;
  /** Bytes. */
  size: number;
  /** Hex SHA-256 as GitHub reports it, or null when it does not. */
  sha256: string | null;
}

export interface EverlootRelease {
  tag: string;
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  url: string;
  /** The release's SHA256SUMS file, or null when it has none. */
  sums: string | null;
  files: ReleaseFile[];
}

interface GithubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: { name?: unknown; size?: unknown; digest?: unknown; browser_download_url?: unknown }[];
}

/** The release list, or null when GitHub could not be read. */
export async function fetchReleases(): Promise<unknown[] | null> {
  const token = process.env.GITHUB_TOKEN;
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "everloot.app", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 3600 },
    } as RequestInit);
    if (!response.ok) return null;
    const list = await response.json();
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

const compare = (a: string, b: string) => {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

function shape(release: GithubRelease, version: string): EverlootRelease | null {
  const tag = release.tag_name as string;
  const date = typeof release.published_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(release.published_at) ? release.published_at.slice(0, 10) : null;
  if (!date) return null;
  const files: ReleaseFile[] = [];
  let sums: string | null = null;
  for (const asset of Array.isArray(release.assets) ? release.assets : []) {
    const { name, size, digest, browser_download_url: url } = asset ?? {};
    // A download link that leaves this repository's releases is never shown.
    if (typeof name !== "string" || typeof url !== "string" || !url.startsWith(DOWNLOADS) || typeof size !== "number") continue;
    if (name === "SHA256SUMS") { sums = url; continue; }
    const sha = typeof digest === "string" ? /^sha256:([0-9a-f]{64})$/.exec(digest)?.[1] ?? null : null;
    files.push({ name, url, size, sha256: sha });
  }
  const url = typeof release.html_url === "string" && release.html_url.startsWith(`${REPO_URL}/releases/`) ? release.html_url : `${RELEASES_PAGE}/tag/${tag}`;
  return { tag, version, date, url, sums, files };
}

/** The published releases whose tag is the prefix and a plain X.Y.Z version. */
function tagged(list: unknown[], prefix: string, includePrereleases = false) {
  const out: { release: GithubRelease; version: string }[] = [];
  for (const release of list as GithubRelease[]) {
    if (!release || release.draft || (!includePrereleases && release.prerelease) || typeof release.tag_name !== "string") continue;
    const m = /^(.+-v)(\d+\.\d+\.\d+)$/.exec(release.tag_name);
    if (m && m[1] === prefix) out.push({ release, version: m[2] });
  }
  return out;
}

/** The newest published Desktop App release in the list. */
export function newestDesktopRelease(list: unknown[] | null): EverlootRelease | null {
  if (!list) return null;
  const best = tagged(list, "desktop-v").sort((a, b) => compare(b.version, a.version))[0];
  return best ? shape(best.release, best.version) : null;
}

/** The published addon release for one version, so its date and checksums match the zip the site serves. */
export function addonReleaseFor(list: unknown[] | null, version: string): EverlootRelease | null {
  if (!list) return null;
  const found = tagged(list, "addon-v", true).find((r) => r.version === version);
  return found ? shape(found.release, found.version) : null;
}

/** Size and SHA-256 of a file the site serves from web/public, worked out from the file itself. */
export function servedFile(path: string, root = join(process.cwd(), "public")): { size: number; sha256: string } | null {
  try {
    const bytes = readFileSync(join(root, path));
    return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch {
    return null;
  }
}

/** 164889 → "161 KB", 113304866 → "108 MB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
