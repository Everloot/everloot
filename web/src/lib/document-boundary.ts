import routing from "@/data/build-versions.json";
import PROTECTED from "@/data/protected-paths.json";
import AD_FREE from "@/data/ad-free-paths.json";

/**
 * Three kinds of document; a move from one kind to another reloads the page (DocumentBoundary), and nothing on
 * the far side mounts in the old document first:
 * - Protected pages hold chat keys or the account (data/protected-paths.json). They are served with a stricter
 *   Content-Security-Policy than the rest of the site (next.config.js) and load no ads or analytics. A CSP
 *   belongs to the document, not the route: after a client-side move from a public page to /chat the public
 *   policy, and whatever scripts it allowed, would still be in force.
 * - Ad-free pages (data/ad-free-paths.json) keep the public policy but load no ads or analytics either.
 *   The Blizzard auction page shows Blizzard API data, and Blizzard's Developer API Terms allow no ads on a page showing it.
 *   AdSense loads on every other public page (app/layout.tsx) and stays in the document once loaded, so a move
 *   from any of them to an ad-free page loads a fresh document without it.
 * - Every other page is public, with ads and analytics.
 * This does not isolate origin storage: scripts on a later public page in this tab can still read tab keys.
 */

const servedPrefix = (routing.prefixes as Record<string, string>)[routing.served];

/** Whether the address is one of the listed pages or under one. The served version's prefix shows the same pages. */
function listed(list: readonly string[], pathname: string): boolean {
  const path = servedPrefix && pathname.startsWith(`${servedPrefix}/`) ? pathname.slice(servedPrefix.length) : pathname;
  return list.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Whether the address shows a protected page: the stricter policy, no ads or analytics. */
export function isProtectedPath(pathname: string): boolean {
  return listed(PROTECTED, pathname);
}

/** Whether the address shows a page with no ads or analytics: a protected page or an ad-free public one. */
export function isAdFreePath(pathname: string): boolean {
  return isProtectedPath(pathname) || listed(AD_FREE, pathname);
}

const documentKind = (pathname: string) => (isProtectedPath(pathname) ? "protected" : isAdFreePath(pathname) ? "ad-free" : "public");

/** The document's first address, for browsers without a navigation entry. */
type Fallback = { first: string | undefined };
const DOCUMENT: Fallback = { first: undefined };

/**
 * The address the document was loaded at (its navigation entry), which is the one its CSP came with.
 * Without an entry, the first address asked about stands in: the root layout asks while it hydrates.
 */
export function documentPathname(win: Window, fallback: Fallback = DOCUMENT): string {
  const entry = win.performance?.getEntriesByType?.("navigation")[0];
  if (entry?.name) return new URL(entry.name).pathname;
  fallback.first ??= win.location.pathname;
  return fallback.first;
}

/** A fresh document for the current address, with the policy that address is served with. */
export function reloadDocument() {
  window.location.reload();
}

/** Whether the page at `pathname` is another kind of document than the one loaded: another CSP, or ads loaded. */
export function crossesDocumentBoundary(pathname: string, win: Window | undefined = typeof window === "undefined" ? undefined : window, fallback: Fallback = DOCUMENT): boolean {
  if (!win) return false;
  return documentKind(pathname) !== documentKind(documentPathname(win, fallback));
}
