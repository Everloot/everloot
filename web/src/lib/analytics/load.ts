import type { AnalyticsConfig } from "./config";
import "./track";

export interface PrivacySignals { doNotTrack?: string | null; globalPrivacyControl?: boolean }

const dntOn = (v: unknown) => v === "1" || v === "yes";

/** Browser opt-out signals: Do Not Track (navigator, window and the old IE/Edge property) and Global Privacy Control. */
export function privacySignals(nav: Navigator, win?: Window): PrivacySignals {
  const n = nav as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const w = win as (Window & { doNotTrack?: string }) | undefined;
  const dnt = [n.doNotTrack, w?.doNotTrack, n.msDoNotTrack].find(dntOn);
  return { doNotTrack: dnt ?? null, globalPrivacyControl: n.globalPrivacyControl };
}
export const optedOutBySignal = (s: PrivacySignals) => dntOn(s.doNotTrack) || s.globalPrivacyControl === true;

const CF_ID = "everloot-cf-beacon";
const GA_ID = "everloot-ga";
const METRICOOL_ID = "everloot-metricool";

declare global {
  interface Window { beTracker?: { t: (options: { hash: string }) => void } }
}

/** Cloudflare Web Analytics: no cookies, no consent needed, skipped when the browser asks not to be tracked. */
export function loadCookieless(config: AnalyticsConfig, signals: PrivacySignals, doc: Document): void {
  if (!config.cfBeaconToken || optedOutBySignal(signals) || doc.getElementById(CF_ID)) return;
  const script = doc.createElement("script");
  script.id = CF_ID;
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.setAttribute("data-cf-beacon", JSON.stringify({ token: config.cfBeaconToken }));
  doc.head.appendChild(script);
}

/** Optional analytics start only after "accepted". */
export function loadConsented(config: AnalyticsConfig, win: Window, doc: Document): void {
  if (config.gaId && !doc.getElementById(GA_ID)) {
    const w = win as Window & { dataLayer?: unknown[] };
    w.dataLayer = w.dataLayer ?? [];
    // gtag.js reads the dataLayer entries as `arguments` objects, so this cannot be an arrow function.
    const gtag = function (..._args: unknown[]) { w.dataLayer!.push(arguments); };
    win.gtag = gtag as unknown as Window["gtag"];
    gtag("js", new Date());
    gtag("config", config.gaId);
    const script = doc.createElement("script");
    script.id = GA_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.gaId)}`;
    doc.head.appendChild(script);
  }
  if (config.posthogKey) void startPosthog(config, win);
  if (config.metricoolHash && !doc.getElementById(METRICOOL_ID)) {
    const started = generation;
    const script = doc.createElement("script");
    script.id = METRICOOL_ID;
    script.async = true;
    script.src = "https://tracker.metricool.com/resources/be.js";
    script.onload = () => {
      if (started === generation && doc.getElementById(METRICOOL_ID) === script) {
        win.beTracker?.t({ hash: config.metricoolHash! });
      }
    };
    doc.head.appendChild(script);
  }
}

/** Removes the `q` (search terms) parameter from a URL. Relative or unparsable values are returned unchanged. */
export function stripSearchQuery(url: unknown): unknown {
  if (typeof url !== "string") return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("q")) return url;
    u.searchParams.delete("q");
    return u.toString();
  } catch {
    return url;
  }
}

/** posthog-js before_send hook: drops search terms from page URLs, and from the referrer when it is this site. */
export function scrubEvent<T extends { properties?: Record<string, unknown> } | null>(event: T, origin?: string): T {
  const props = event?.properties;
  if (!props) return event;
  for (const key of ["$current_url", "$initial_current_url"]) {
    if (key in props) props[key] = stripSearchQuery(props[key]);
  }
  for (const key of ["$referrer", "$initial_referrer"]) {
    const ref = props[key];
    if (typeof ref === "string" && origin) {
      try { if (new URL(ref).origin === origin) props[key] = stripSearchQuery(ref); } catch {}
    }
  }
  return event;
}

// Bumped on every withdrawal, so an import that was already in flight can tell consent was taken back.
let generation = 0;

async function startPosthog(config: AnalyticsConfig, win: Window): Promise<void> {
  const started = generation;
  const { default: posthog } = await import("posthog-js");
  if (started !== generation) return;
  if (!posthog.__loaded) {
    posthog.init(config.posthogKey!, {
      api_host: config.posthogHost,
      autocapture: false,
      disable_session_recording: true,
      capture_pageview: "history_change",
      person_profiles: "identified_only",
      before_send: (event) => scrubEvent(event, win.location.origin),
    });
  }
  posthog.opt_in_capturing();
  win.posthog = posthog;
}

/**
 * Called when analytics consent is not "accepted". Removes the tag and stops PostHog. Code that
 * already ran cannot be recalled, so the banner reloads the page after a withdrawal.
 */
export function unloadConsented(doc: Document, win: Window): void {
  generation++;
  doc.getElementById(GA_ID)?.remove();
  doc.getElementById(METRICOOL_ID)?.remove();
  delete win.beTracker;
  delete win.gtag;
  delete (win as Window & { dataLayer?: unknown }).dataLayer;
  win.posthog?.opt_out_capturing?.();
  delete win.posthog;
  clearAnalyticsStorage(doc, win);
}

const COOKIE = /^(_ga(_.+)?|_gid|_gat(_.+)?|ph_.+)$/;

/** Expires the Google Analytics and PostHog cookies on every domain and path they could have been set for. */
function clearAnalyticsStorage(doc: Document, win: Window): void {
  const host = win.location.hostname;
  const labels = host.split(".");
  const domains = new Set<string | undefined>([undefined, host]);
  if (labels.length > 1 && !/^[\d.]+$/.test(host)) {
    for (let i = 0; i < labels.length - 1; i++) {
      const name = labels.slice(i).join(".");
      domains.add(name);
      domains.add(`.${name}`);
    }
  }
  const segments = win.location.pathname.split("/").filter(Boolean);
  const paths = ["/", ...segments.map((_, i) => "/" + segments.slice(0, i + 1).join("/"))];
  const names = doc.cookie.split(";").map((c) => c.split("=")[0].trim()).filter((n) => COOKIE.test(n));
  for (const name of names) {
    for (const domain of domains) {
      for (const path of paths) {
        doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=${path}${domain ? `; domain=${domain}` : ""}`;
      }
    }
  }
  for (const store of [win.localStorage, win.sessionStorage]) {
    try {
      for (const key of Object.keys(store)) if (key.startsWith("ph_")) store.removeItem(key);
    } catch {}
  }
}
