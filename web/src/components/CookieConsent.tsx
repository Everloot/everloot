"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { isProtectedPath } from "@/lib/document-boundary";
import { readConsent, writeConsent, syncOptionalScripts, hasRejectionFragment, withRejectionFragment, rejectionSessionKey, type ConsentCategory, type ConsentChoice } from "./consent";
import { needsAnalyticsConsent, type AnalyticsConfig } from "@/lib/analytics/config";
import { loadConsented, loadCookieless, privacySignals, unloadConsented } from "@/lib/analytics/load";

const OPEN_PREFERENCES = "everloot:cookie-preferences";
type Choices = Record<ConsentCategory, ConsentChoice | null>;
const NONE: Choices = { advertising: null, analytics: null };
// A box is ticked only for a category the visitor has accepted; nothing starts ticked.
const ticked = (choices: Choices) => ({ advertising: choices.advertising === "accepted", analytics: choices.analytics === "accepted" });

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
  // The first view is a short notice and three buttons; Choices, or reopening from the footer, shows the categories.
  const [expanded, setExpanded] = useState(false);
  const [choices, setChoices] = useState<Choices>(NONE);
  const [draft, setDraft] = useState<Record<ConsentCategory, boolean>>({ advertising: false, analytics: false });
  const [saveFailed, setSaveFailed] = useState(false);
  const panel = useRef<HTMLElement>(null);
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
      const fragmentRejected = hasRejectionFragment(window.location.hash, category);
      saved[category] = fragmentRejected ? "rejected" : null;
      fallback ||= fragmentRejected;
      try {
        fallback ||= window.sessionStorage.getItem(rejectionSessionKey(category)) === "rejected";
        saved[category] = readConsent(window.localStorage, window.sessionStorage, window.location.hash, category);
      } catch {}
    }
    setChoices(saved);
    setDraft(ticked(saved));
    setSaveFailed(fallback);
    setVisible(categories.some((c) => saved[c] === null) || (fallback && categories.length > 0));
    loaded.current = saved;
    apply(saved);
    // The cookieless beacon needs no choice; it is skipped only for DNT or GPC.
    loadCookieless(analytics, privacySignals(navigator, window), document);
    const reopen = () => {
      trigger.current = document.activeElement as HTMLElement;
      // Ticks left unsaved by Escape or Close are not a choice: show the one in force.
      setDraft(ticked(loaded.current));
      setExpanded(true);
      setVisible(true);
    };
    window.addEventListener(OPEN_PREFERENCES, reopen);
    return () => window.removeEventListener(OPEN_PREFERENCES, reopen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adsenseClient, categoryKey, analytics.gaId, analytics.posthogKey, analytics.posthogHost, analytics.cfBeaconToken, analytics.metricoolHash]);

  useEffect(() => {
    if (visible && trigger.current) heading.current?.focus();
  }, [visible]);

  // The banner sits over the foot of the window. While it is open, scroll padding of its height makes the
  // browser bring a control that takes focus (a calculator's, say) into view above it rather than under it,
  // and as much padding under the page gives the last controls on it the room to get there. The 8 px spare
  // keeps the focus ring in sight too. It is measured from the visible page (clientHeight), which a desktop
  // scrollbar along the bottom makes shorter than innerHeight.
  useEffect(() => {
    const banner = panel.current;
    if (!visible || !banner) return;
    const root = document.documentElement;
    const before = [root.style.scrollPaddingBottom, document.body.style.paddingBottom];
    const fit = () => {
      const covered = `${root.clientHeight - banner.getBoundingClientRect().top + 8}px`;
      root.style.scrollPaddingBottom = covered;
      document.body.style.paddingBottom = covered;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(banner);
    return () => {
      observer.disconnect();
      [root.style.scrollPaddingBottom, document.body.style.paddingBottom] = before;
    };
  }, [visible]);

  const close = () => {
    setVisible(false);
    trigger.current?.focus();
    trigger.current = null;
  };
  const decide = (values: Record<ConsentCategory, ConsentChoice>) => {
    const next: Choices = { ...choices };
    let allPersisted = true;
    let hash = window.location.hash;
    for (const category of categories) {
      let result = { persisted: false, needsRejectionFragment: values[category] === "rejected" };
      try { result = writeConsent(values[category], window.localStorage, window.sessionStorage, category); } catch {}
      // If every storage write is blocked the rejection rides in the URL fragment, after what the page keeps
      // there (a talent #plan=), never in its place. A saved choice or an acceptance takes it out again.
      if (result.needsRejectionFragment) hash = withRejectionFragment(hash, category, true);
      else if (result.persisted || values[category] === "accepted") hash = withRejectionFragment(hash, category, false);
      allPersisted &&= result.persisted;
      next[category] = values[category];
    }
    if (hash !== window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search + hash);
    // Removing a script cannot stop code it already ran, so a withdrawal reloads the page.
    const revoked = categories.some((c) => loaded.current[c] === "accepted" && next[c] === "rejected");
    apply(next);
    loaded.current = next;
    setChoices(next);
    setDraft(ticked(next));
    setSaveFailed(!allPersisted);
    if (allPersisted) close();
    if (revoked) window.location.reload();
  };

  if (!visible) return null;
  const allRejected = categories.length > 0 && categories.every((c) => choices[c] === "rejected");
  return (
    // At 390 px the first view is under 140 px tall. Zoom can make it taller than the window, so it stops 5rem
    // short of the top, room for a focused 44 px control and its ring above it, and scrolls inside.
    <section ref={panel} aria-labelledby="cookie-heading" className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(92%,640px)] max-h-[calc(100dvh-6rem)] overflow-y-auto z-50 rounded-xl border border-line bg-canvas p-3" onKeyDown={(event) => { if (event.key === "Escape" && categories.every((c) => choices[c])) close(); }}>
      <h2 ref={heading} tabIndex={-1} id="cookie-heading" className="text-sm font-semibold text-fg">Cookie preferences</h2>
      {categories.length === 0 ? (
        <p className="text-sm text-fg">No optional cookies are in use on this site right now.</p>
      ) : (
        <p className="text-sm text-fg">
          Optional {categories.includes("advertising") ? "analytics and advertising load" : "analytics loads"} only if you accept.
          You can change your choice in the footer.
        </p>
      )}
      {saveFailed && <p role="status" className="mt-2 text-sm text-fg">Your browser could not save this choice permanently. {allRejected ? "Optional cookies remain rejected in this tab; if all storage is blocked, keep the current URL to preserve rejection when reloading." : "Acceptance applies to this page only. Recheck your preferences after reloading."}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2 justify-end">
        {(categories.length === 0 || categories.every((c) => choices[c])) && <button type="button" onClick={close} className="btn min-h-11 px-3 text-sm">Close</button>}
        {/* Rejecting takes one action, and its button looks exactly like accepting's. */}
        {categories.length > 0 && <>
          <button type="button" onClick={() => decide({ advertising: "rejected", analytics: "rejected" })} className="btn btn-primary min-h-11 px-3 text-sm">Reject<span className="sr-only"> optional cookies</span></button>
          <button type="button" onClick={() => decide({ advertising: "accepted", analytics: "accepted" })} className="btn btn-primary min-h-11 px-3 text-sm">Accept<span className="sr-only"> optional cookies</span></button>
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="btn min-h-11 px-3 text-sm">Choices</button>
        </>}
      </div>
      {expanded && categories.length > 0 && (
        <fieldset className="mt-3 space-y-2">
          <legend className="sr-only">Optional cookie categories</legend>
          <p className="text-sm text-fg">Your choice is saved when browser storage is available.</p>
          {categories.map((category) => (
            <label key={category} className="flex items-start gap-3 text-sm text-fg">
              <input type="checkbox" className="mt-1" checked={draft[category]} onChange={(e) => setDraft({ ...draft, [category]: e.target.checked })} />
              <span><strong>{LABELS[category].title}.</strong> {LABELS[category].text}</span>
            </label>
          ))}
          <div className="flex justify-end">
            <button type="button" onClick={() => decide({ advertising: draft.advertising ? "accepted" : "rejected", analytics: draft.analytics ? "accepted" : "rejected" })} className="btn min-h-11 px-3 text-sm">Save my choices</button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
