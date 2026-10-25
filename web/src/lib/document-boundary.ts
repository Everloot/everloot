import routing from "@/data/build-versions.json";
import PROTECTED from "@/data/protected-paths.json";

/**
 * The pages that hold chat keys or the account (data/protected-paths.json) are served with a stricter
 * Content-Security-Policy than the rest of the site (next.config.js), and load no ads or analytics. A CSP
 * belongs to the document, not the route: after a client-side move from a public page to /chat the public
 * policy, and whatever scripts it allowed, would still be in force. So a move across the line reloads the
 * page (DocumentBoundary), and nothing on the far side mounts first.
 * This does not isolate origin storage: scripts on a later public page in this tab can still read tab keys.
 */

const servedPrefix = (routing.prefixes as Record<string, string>)[routing.served];

/** Whether the address shows a protected page. The served version's prefix shows the same pages. */
export function isProtectedPath(pathname: string): boolean {
  const path = servedPrefix && pathname.startsWith(`${servedPrefix}/`) ? pathname.slice(servedPrefix.length) : pathname;
  return PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));
}

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

/** Whether the page at `pathname` sits on the other side of the line from the document's own CSP. */
export function crossesDocumentBoundary(pathname: string, win: Window | undefined = typeof window === "undefined" ? undefined : window, fallback: Fallback = DOCUMENT): boolean {
  if (!win) return false;
  return isProtectedPath(pathname) !== isProtectedPath(documentPathname(win, fallback));
}
