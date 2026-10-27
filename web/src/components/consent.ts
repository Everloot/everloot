export type ConsentChoice = "accepted" | "rejected";
/** Optional categories. "advertising" keeps the original storage keys so earlier choices still count. */
export type ConsentCategory = "advertising" | "analytics";
const KEYS: Record<ConsentCategory, { storage: string; session: string; fragment: string }> = {
  advertising: { storage: "gg-cookie-consent-v1", session: "everloot-cookie-rejection", fragment: "#everloot-cookie-rejected" },
  analytics: { storage: "everloot-analytics-consent-v1", session: "everloot-analytics-rejection", fragment: "#everloot-analytics-rejected" },
};
const SCRIPT_ID = "everloot-optional-ads";
export const REJECTION_SESSION_KEY = KEYS.advertising.session;
export const REJECTION_FRAGMENT = KEYS.advertising.fragment;
export const rejectionFragment = (category: ConsentCategory) => KEYS[category].fragment;
export const rejectionSessionKey = (category: ConsentCategory) => KEYS[category].session;

// The address fragment can hold other parts joined by "&" (a talent #plan=, a #raid=), so a rejection is
// one part among them: it is added at the end and removed on its own, and the readers of those parts still
// find their codes.
const fragmentParts = (hash: string) => (hash.length > 1 ? hash.slice(1).split("&") : []);

export function hasRejectionFragment(hash: string, category: ConsentCategory = "advertising"): boolean {
  return fragmentParts(hash).includes(KEYS[category].fragment.slice(1));
}

export function withRejectionFragment(hash: string, category: ConsentCategory, rejected: boolean): string {
  const part = KEYS[category].fragment.slice(1);
  const parts = fragmentParts(hash).filter((p) => p !== part);
  if (rejected) parts.push(part);
  return parts.length ? `#${parts.join("&")}` : "";
}

export function readConsent(storage: Pick<Storage, "getItem">, session?: Pick<Storage, "getItem">, hash = "", category: ConsentCategory = "advertising"): ConsentChoice | null {
  const keys = KEYS[category];
  if (hasRejectionFragment(hash, category)) return "rejected";
  try {
    if (session?.getItem(keys.session) === "rejected") return "rejected";
  } catch { return null; }
  try {
    const value = storage.getItem(keys.storage);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch { return null; }
}

export function writeConsent(choice: ConsentChoice, storage: Pick<Storage, "setItem" | "removeItem">, session: Pick<Storage, "setItem" | "removeItem">, category: ConsentCategory = "advertising"): { persisted: boolean; needsRejectionFragment: boolean } {
  const keys = KEYS[category];
  const persisted = saveConsent(choice, storage, category);
  if (persisted || choice === "accepted") {
    try { session.removeItem(keys.session); } catch {}
    return { persisted, needsRejectionFragment: false };
  }
  // A failed overwrite can leave a readable "accepted" value behind. Remove it
  // where possible, and retain a rejection veto across this tab's navigations.
  try { storage.removeItem(keys.storage); } catch {}
  try {
    session.setItem(keys.session, "rejected");
    return { persisted: false, needsRejectionFragment: false };
  } catch {
    return { persisted: false, needsRejectionFragment: true };
  }
}

export function saveConsent(choice: ConsentChoice, storage: Pick<Storage, "setItem">, category: ConsentCategory = "advertising"): boolean {
  try {
    storage.setItem(KEYS[category].storage, choice);
    return true;
  } catch { return false; }
}

export function syncOptionalScripts(choice: ConsentChoice | null, adsenseClient: string | undefined, doc: Document): void {
  const existing = doc.getElementById(SCRIPT_ID);
  if (choice !== "accepted") {
    existing?.remove();
    return;
  }
  if (!adsenseClient || existing) return;
  const script = doc.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adsenseClient)}`;
  doc.head.appendChild(script);
}
