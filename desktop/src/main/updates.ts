import type { ReleaseNote, UpdateCheck } from "../shared/types";
import { compareVersions, newestRelease, RELEASES_API } from "./addon";
import { canInstallInPlace } from "./self-update";

export { compareVersions };
export const RELEASES_PAGE = "https://github.com/Everloot/everloot/releases";

/** The newest published `desktop-vX.Y.Z` release among the list GitHub returns. */
export const newestDesktopRelease = (releases: unknown) => newestRelease(releases, "desktop-v");

/**
 * Reads GitHub's release list, newest first, a page of 100 at a time, until it holds a published app
 * release and a published addon release, a page comes back short, or five pages are read. Addon
 * releases and nightlies can otherwise push the app's own release off the first page. It never downloads anything.
 */
export async function fetchReleases(send: typeof fetch = fetch, userAgent = "everloot-desktop"): Promise<unknown> {
  const all: unknown[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await send(`${RELEASES_API}&page=${page}`, { headers: { accept: "application/vnd.github+json", "user-agent": userAgent }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const list: unknown = await res.json();
    if (!Array.isArray(list)) return page === 1 ? list : all;
    all.push(...list);
    if (list.length < 100 || (newestDesktopRelease(all) && newestRelease(all, "addon-v"))) break;
  }
  return all;
}

/**
 * The changes a release lists, one per bullet: the CHANGELOG section the release workflow publishes
 * ("- ..."), or GitHub's generated list ("* title by @author in https://.../pull/123"). Wrapped
 * lines join their bullet; markdown links and code marks are reduced to their text; code blocks and
 * tables are skipped.
 */
export function releaseNotes(body: string): ReleaseNote[] {
  const out: ReleaseNote[] = [];
  let current: string | null = null;
  let fenced = false;
  const flush = () => {
    if (current === null) return;
    const text = current.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\s+/g, " ").trim();
    const m = /^(.*?) by @([\w[\]-]+) in https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)$/.exec(text);
    if (text) out.push(m ? { text: m[1], author: m[2], pr: Number(m[3]) } : { text, author: null, pr: null });
    current = null;
  };
  for (const raw of body.split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) { flush(); fenced = !fenced; continue; }
    if (fenced) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(raw);
    if (bullet) { flush(); current = bullet[1]; continue; }
    if (current !== null && /^\s+\S/.test(raw) && !/^\s*[|#]/.test(raw)) { current += ` ${raw.trim()}`; continue; }
    flush();
  }
  flush();
  return out;
}

interface ReleaseAsset { name?: unknown; browser_download_url?: unknown }

/** The download for this system from a release's files: the Windows installer (or the portable exe when running portable), the macOS disk image, the Linux AppImage. */
export function downloadFor(assets: unknown, platform: string, portable = false): string | null {
  if (!Array.isArray(assets)) return null;
  const want = platform === "win32" ? (portable ? /-win-x64-portable\.exe$/ : /-win-x64-setup\.exe$/)
    : platform === "darwin" ? /-mac-arm64\.dmg$/
      : platform === "linux" ? /\.AppImage$/ : null;
  if (!want) return null;
  const hit = (assets as ReleaseAsset[]).find((a) => typeof a.name === "string" && want.test(a.name) && typeof a.browser_download_url === "string");
  return hit ? (hit.browser_download_url as string) : null;
}

/** What the update popover shows: the newest desktop release against this version, with its listed changes and this system's download. */
export function updateFrom(releases: unknown, current: string, platform: string = process.platform, portable = false): UpdateCheck {
  const newest = newestDesktopRelease(releases);
  if (!newest) return { current, latest: null, url: RELEASES_PAGE, newer: false, notes: [], downloadUrl: null, publishedAt: null, sumsUrl: null, installable: false };
  const release = (releases as { tag_name?: unknown; body?: unknown; assets?: unknown; published_at?: unknown }[])
    .find((r) => r.tag_name === `desktop-v${newest.version}`);
  const downloadUrl = downloadFor(release?.assets, platform, portable);
  const sums = Array.isArray(release?.assets) ? (release.assets as ReleaseAsset[]).find((a) => a.name === "SHA256SUMS") : undefined;
  const sumsUrl = typeof sums?.browser_download_url === "string" ? sums.browser_download_url : null;
  return {
    current,
    latest: newest.version,
    url: newest.url,
    newer: compareVersions(newest.version, current) > 0,
    notes: typeof release?.body === "string" ? releaseNotes(release.body) : [],
    downloadUrl,
    publishedAt: typeof release?.published_at === "string" ? release.published_at : null,
    sumsUrl,
    installable: Boolean(downloadUrl && sumsUrl && canInstallInPlace(platform, portable)),
  };
}

export async function checkForUpdates(current: string, send: typeof fetch = fetch, platform: string = process.platform, portable = false): Promise<UpdateCheck> {
  return updateFrom(await fetchReleases(send, `everloot-desktop/${current}`), current, platform, portable);
}
