"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { isProtectedPath } from "@/lib/document-boundary";
import { readConsent, writeConsent, syncOptionalScripts, rejectionFragment, rejectionSessionKey, type ConsentCategory, type ConsentChoice } from "./consent";
import { needsAnalyticsConsent, type AnalyticsConfig } from "@/lib/analytics/config";
import { loadConsented, loadCookieless, privacySignals, unloadConsented } from "@/lib/analytics/load";

const OPEN_PREFERENCES = "everloot:cookie-preferences";
type Choices = Record<ConsentCategory, ConsentChoice | null>;
const NONE: Choices = { advertising: null, analytics: null };

export function CookiePreferencesButton() {
  const pathname = usePathname();
  if (pathname && isProtectedPath(pathname)) return <a href="/privacy#choices" className="inline-flex items-center min-h-11 text-sm text-fg-2 hover:text-accent transition-colors">Cookie preferences</a>;
  return (
    <button type="button" className="inline-flex items-center min-h-11 text-sm text-fg-2 hover:text-accent transition-colors" onClick={() => window.dispatchEvent(new Event(OPEN_PREFERENCES))}>
      Cookie preferences
    </button>
  );
}

const LABELS: Record<ConsentCategory, { title: string; text: string }> = {
  analytics: { title: "Analytics", text: "Anonymous usage statistics so we can see which pages and tools get used." },
  advertising: { title: "Advertising", text: "Ads from Google AdSense." },
};

export default function CookieConsent({ adsenseClient, analytics = {} }: { adsenseClient?: string; analytics?: AnalyticsConfig }) {
  const categories: ConsentCategory[] = [...(needsAnalyticsConsent(analytics) ? ["analytics" as const] : []), ...(adsenseClient ? ["advertising" as const] : [])];
  const categoryKey = categories.join(",");
  const [visible, setVisible] = useState(false);
  const [choices, setChoices] = useState<Choices>(NONE);
  const [draft, setDraft] = useState<Record<ConsentCategory, boolean>>({ advertising: false, analytics: false });
  const [saveFailed, setSaveFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const loaded = useRef<Choices>(NONE);

  const apply = (next: Choices) => {
    syncOptionalScripts(next.advertising, adsenseClient, document);
    if (next.analytics === "accepted") loadConsented(analytics, window, document);
    else unloadConsented(document, window);
  };

  useEffect(() => {
    let fallback = false;
    const saved: Choices = { advertising: null, analytics: null };
    for (const category of ["advertising", "analytics"] as const) {
      const fragmentRejected = window.location.hash === rejectionFragment(category);
      saved[category] = fragmentRejected ? "rejected" : null;
      fallback ||= fragmentRejected;
      try {
        fallback ||= window.sessionStorage.getItem(rejectionSessionKey(category)) === "rejected";
        saved[category] = readConsent(window.localStorage, window.sessionStorage, window.location.hash, category);
      } catch {}
    }
    setChoices(saved);
    setDraft({ advertising: saved.advertising === "accepted", analytics: saved.analytics === "accepted" });
    setSaveFailed(fallback);
    setVisible(categories.some((c) => saved[c] === null) || (fallback && categories.length > 0));
    loaded.current = saved;
    apply(saved);
    // The cookieless beacon needs no choice; it is skipped only for DNT or GPC.
    loadCookieless(analytics, privacySignals(navigator, window), document);
    const reopen = () => {
      trigger.current = document.activeElement as HTMLElement;
      setVisible(true);
    };
    window.addEventListener(OPEN_PREFERENCES, reopen);
    return () => window.removeEventListener(OPEN_PREFERENCES, reopen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adsenseClient, categoryKey, analytics.gaId, analytics.posthogKey, analytics.posthogHost, analytics.cfBeaconToken, analytics.metricoolHash]);

  useEffect(() => {
    if (visible && trigger.current) heading.current?.focus();
  }, [visible]);

  const close = () => {
    setVisible(false);
    trigger.current?.focus();
    trigger.current = null;
  };
  const decide = (values: Record<ConsentCategory, ConsentChoice>) => {
    const next: Choices = { ...choices };
    let allPersisted = true;
    let needsFragment: ConsentCategory | null = null;
    for (const category of categories) {
      let result = { persisted: false, needsRejectionFragment: values[category] === "rejected" };
      try { result = writeConsent(values[category], window.localStorage, window.sessionStorage, category); } catch {}
      // If every storage write is blocked only one category can ride in the URL fragment.
      if (result.needsRejectionFragment && !needsFragment) needsFragment = category;
      else if (window.location.hash === rejectionFragment(category) && (result.persisted || values[category] === "accepted")) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      allPersisted &&= result.persisted;
      next[category] = values[category];
    }
    if (needsFragment) window.location.hash = rejectionFragment(needsFragment);
    // Removing a script cannot stop code it already ran, so a withdrawal reloads the page.
    const revoked = categories.some((c) => loaded.current[c] === "accepted" && next[c] === "rejected");
    apply(next);
    loaded.current = next;
    setChoices(next);
    setSaveFailed(!allPersisted);
    if (allPersisted) close();
    if (revoked) window.location.reload();
  };

  if (!visible) return null;
  const allRejected = categories.length > 0 && categories.every((c) => choices[c] === "rejected");
  return (
    <section aria-labelledby="cookie-heading" className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(92%,640px)] z-50 rounded-xl border border-line bg-canvas p-4" onKeyDown={(event) => { if (event.key === "Escape" && categories.every((c) => choices[c])) close(); }}>
      <h2 ref={heading} tabIndex={-1} id="cookie-heading" className="font-semibold text-fg">Cookie preferences</h2>
      {categories.length === 0 ? (
        <p className="mt-1 text-sm text-fg">No optional cookies are in use on this site right now.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-fg">
            Optional {categories.includes("advertising") ? "analytics and advertising load" : "analytics loads"} only if you accept.
            Your choice is saved when browser storage is available. You can change it in the footer.
          </p>
          <fieldset className="mt-3 space-y-2">
            <legend className="sr-only">Optional cookie categories</legend>
            {categories.map((category) => (
              <label key={category} className="flex items-start gap-3 text-sm text-fg">
                <input type="checkbox" className="mt-1" checked={draft[category]} onChange={(e) => setDraft({ ...draft, [category]: e.target.checked })} />
                <span><strong>{LABELS[category].title}.</strong> {LABELS[category].text}</span>
              </label>
            ))}
          </fieldset>
        </>
      )}
      {saveFailed && <p role="status" className="mt-2 text-sm text-fg">Your browser could not save this choice permanently. {allRejected ? "Optional cookies remain rejected in this tab; if all storage is blocked, keep the current URL to preserve rejection when reloading." : "Acceptance applies to this page only. Recheck your preferences after reloading."}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 justify-end">
        {(categories.length === 0 || categories.every((c) => choices[c])) && <button type="button" onClick={close} className="btn min-h-11 px-3 text-sm">Close</button>}
        {categories.length > 0 && <>
          <button type="button" onClick={() => decide({ advertising: "rejected", analytics: "rejected" })} className="btn min-h-11 px-3 text-sm">Reject optional cookies</button>
          <button type="button" onClick={() => decide({ advertising: draft.advertising ? "accepted" : "rejected", analytics: draft.analytics ? "accepted" : "rejected" })} className="btn min-h-11 px-3 text-sm">Save my choices</button>
          <button type="button" onClick={() => decide({ advertising: "accepted", analytics: "accepted" })} className="btn btn-primary min-h-11 px-3 text-sm">Accept optional cookies</button>
        </>}
      </div>
    </section>
  );
}
