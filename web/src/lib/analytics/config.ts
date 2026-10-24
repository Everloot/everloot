/**
 * Which analytics tools are switched on. Every tool is off unless its environment variable is set.
 * NEXT_PUBLIC_* values are read in the root layout (a server component) and passed down as props, so
 * client code never reads process.env itself.
 */
export interface AnalyticsConfig {
  /** Cookie-based: loads only after the visitor accepts analytics. */
  gaId?: string;
  /** Loads only after the visitor accepts analytics. */
  metricoolHash?: string;
  /** Cookie and storage based: loads only after the visitor accepts analytics. */
  posthogKey?: string;
  posthogHost?: string;
  /** Cookieless: loads without consent, but not when the browser sends DNT or GPC. */
  cfBeaconToken?: string;
}

const clean = (value: string | undefined) => value?.trim() || undefined;
const GA_ID = /^G-[A-Z0-9]{4,20}$/;
const POSTHOG_KEY = /^phc_[A-Za-z0-9]{10,100}$/;
const CF_TOKEN = /^[a-f0-9]{32}$/;
const POSTHOG_HOSTS = ["https://us.i.posthog.com", "https://eu.i.posthog.com"];

/** A malformed value counts as unset, so a typo in Vercel cannot inject anything into the page. */
export function analyticsConfig(env: Record<string, string | undefined> = process.env): AnalyticsConfig {
  const gaId = clean(env.NEXT_PUBLIC_GA_ID);
  // PostHog only runs on the Production deployment, so Preview and local builds never send events.
  // VERCEL_ENV is read here on the server (root layout) and passed down with the rest of the config.
  const posthogKey = env.VERCEL_ENV === "production" ? clean(env.NEXT_PUBLIC_POSTHOG_KEY) : undefined;
  const host = clean(env.NEXT_PUBLIC_POSTHOG_HOST)?.replace(/\/$/, "");
  const cf = clean(env.NEXT_PUBLIC_CF_BEACON_TOKEN);
  const metricool = clean(env.NEXT_PUBLIC_METRICOOL_HASH);
  return {
    gaId: gaId && GA_ID.test(gaId) ? gaId : undefined,
    posthogKey: posthogKey && POSTHOG_KEY.test(posthogKey) ? posthogKey : undefined,
    // Unset or unknown host falls back to the US cloud, where the Everloot project (684968) lives.
    posthogHost: host && POSTHOG_HOSTS.includes(host) ? host : POSTHOG_HOSTS[0],
    cfBeaconToken: cf && CF_TOKEN.test(cf) ? cf : undefined,
    metricoolHash: metricool && /^[a-f0-9]{32}$/.test(metricool) ? metricool : undefined,
  };
}

/** True when at least one tool needs the analytics consent choice. */
export const needsAnalyticsConsent = (c: AnalyticsConfig) => Boolean(c.gaId || c.posthogKey || c.metricoolHash);
