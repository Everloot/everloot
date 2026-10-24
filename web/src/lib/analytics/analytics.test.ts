// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsConfig, needsAnalyticsConsent } from "./config";
import { loadConsented, loadCookieless, optedOutBySignal, privacySignals, scrubEvent, stripSearchQuery, unloadConsented } from "./load";

const posthogMock = vi.hoisted(() => ({ init: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn(), __loaded: false }));
vi.mock("posthog-js", () => ({ default: posthogMock }));
import { track } from "./track";

const GA = "G-ABCD1234";
const PH = "phc_abcdefghij1234567890";
const CF = "0123456789abcdef0123456789abcdef";
const METRICOOL = "424c5c3857a5c9d4bfab8635880f0e69";

afterEach(() => {
  vi.clearAllMocks();
  posthogMock.__loaded = false;
  for (const c of document.cookie.split(";")) document.cookie = `${c.split("=")[0].trim()}=; max-age=0; path=/`;
  localStorage.clear();
  document.head.innerHTML = "";
  delete window.gtag;
  delete window.posthog;
  delete window.beTracker;
});

describe("analyticsConfig", () => {
  it("validates the Metricool hash and requires analytics consent", () => {
    expect(analyticsConfig({}).metricoolHash).toBeUndefined();
    expect(analyticsConfig({ NEXT_PUBLIC_METRICOOL_HASH: "<script>" }).metricoolHash).toBeUndefined();
    const config = analyticsConfig({ NEXT_PUBLIC_METRICOOL_HASH: ` ${METRICOOL} ` });
    expect(config.metricoolHash).toBe(METRICOOL);
    expect(needsAnalyticsConsent(config)).toBe(true);
  });
  it("has every tool off when no variable is set", () => {
    const c = analyticsConfig({});
    expect(c.gaId).toBeUndefined();
    expect(c.posthogKey).toBeUndefined();
    expect(c.cfBeaconToken).toBeUndefined();
    expect(needsAnalyticsConsent(c)).toBe(false);
  });

  it("treats malformed values as unset", () => {
    const c = analyticsConfig({ NEXT_PUBLIC_GA_ID: "<script>", NEXT_PUBLIC_POSTHOG_KEY: "nope", NEXT_PUBLIC_CF_BEACON_TOKEN: "x", NEXT_PUBLIC_POSTHOG_HOST: "https://evil.example" });
    expect(c.gaId).toBeUndefined();
    expect(c.posthogKey).toBeUndefined();
    expect(c.cfBeaconToken).toBeUndefined();
    expect(c.posthogHost).toBe("https://us.i.posthog.com");
  });

  it("defaults PostHog to the US cloud and keeps an EU override", () => {
    expect(analyticsConfig({}).posthogHost).toBe("https://us.i.posthog.com");
    expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com" }).posthogHost).toBe("https://eu.i.posthog.com");
  });

  it("turns PostHog on only for the Production deployment", () => {
    expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: PH }).posthogKey).toBeUndefined();
    expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: PH, VERCEL_ENV: "preview" }).posthogKey).toBeUndefined();
    expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: PH, VERCEL_ENV: "production" }).posthogKey).toBe(PH);
  });

  it("accepts well-formed values", () => {
    const c = analyticsConfig({ NEXT_PUBLIC_GA_ID: GA, NEXT_PUBLIC_POSTHOG_KEY: PH, NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com/", NEXT_PUBLIC_CF_BEACON_TOKEN: CF, VERCEL_ENV: "production" });
    expect(c).toEqual({ gaId: GA, posthogKey: PH, posthogHost: "https://us.i.posthog.com", cfBeaconToken: CF });
    expect(needsAnalyticsConsent(c)).toBe(true);
  });
});

describe("script loading", () => {
  it("loads Metricool once after consent and sends the supplied hash when ready", () => {
    const t = vi.fn();
    window.beTracker = { t };
    loadConsented({ metricoolHash: METRICOOL }, window, document);
    loadConsented({ metricoolHash: METRICOOL }, window, document);
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[src="https://tracker.metricool.com/resources/be.js"]');
    expect(scripts).toHaveLength(1);
    expect(t).not.toHaveBeenCalled();
    scripts[0].dispatchEvent(new Event("load"));
    expect(t).toHaveBeenCalledExactlyOnceWith({ hash: METRICOOL });
  });

  it("does not send a visit if consent is withdrawn before Metricool finishes loading", () => {
    const t = vi.fn();
    loadConsented({ metricoolHash: METRICOOL }, window, document);
    const script = document.querySelector<HTMLScriptElement>('script[src="https://tracker.metricool.com/resources/be.js"]')!;
    expect(script).not.toBeNull();
    unloadConsented(document, window);
    window.beTracker = { t };
    script.dispatchEvent(new Event("load"));
    expect(t).not.toHaveBeenCalled();
    expect(document.getElementById("everloot-metricool")).toBeNull();
  });
  it("loads nothing without env vars, even after consent", () => {
    loadCookieless({}, {}, document);
    loadConsented({}, window, document);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
    expect(window.gtag).toBeUndefined();
  });

  it("loads the cookieless beacon without consent and only once", () => {
    loadCookieless({ cfBeaconToken: CF }, {}, document);
    loadCookieless({ cfBeaconToken: CF }, {}, document);
    const scripts = document.head.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(JSON.parse(scripts[0].getAttribute("data-cf-beacon")!)).toEqual({ token: CF });
  });

  it.each([{ doNotTrack: "1" }, { globalPrivacyControl: true }])("skips the beacon for %o", (signals) => {
    expect(optedOutBySignal(signals)).toBe(true);
    loadCookieless({ cfBeaconToken: CF }, signals, document);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });

  it("loads Google Analytics only when asked to, and removes it on withdrawal", () => {
    expect(document.getElementById("everloot-ga")).toBeNull();
    loadConsented({ gaId: GA }, window, document);
    expect((document.getElementById("everloot-ga") as HTMLScriptElement).src).toContain(`googletagmanager.com/gtag/js?id=${GA}`);
    unloadConsented(document, window);
    expect(document.getElementById("everloot-ga")).toBeNull();
    expect(window.gtag).toBeUndefined();
  });
});

describe("track", () => {
  it("does nothing when no tool is loaded", () => {
    expect(() => track("search", { surface: "lore" })).not.toThrow();
  });

  it("sends to loaded tools and survives one that throws", () => {
    const capture = vi.fn();
    window.posthog = { capture };
    window.gtag = vi.fn();
    track("addon_download", { addon: "polestar", to: "github" });
    expect(capture).toHaveBeenCalledWith("addon_download", { addon: "polestar", to: "github" });
    expect(window.gtag).toHaveBeenCalledWith("event", "addon_download", { addon: "polestar", to: "github" });
    window.posthog = { capture: () => { throw new Error("boom"); } };
    expect(() => track("search", { surface: "lore" })).not.toThrow();
  });
});

describe("DNT and GPC signals", () => {
  const nav = (props: object) => props as Navigator;
  it.each([
    [nav({ doNotTrack: "yes" }), undefined],
    [nav({ msDoNotTrack: "1" }), undefined],
    [nav({}), { doNotTrack: "1" } as unknown as Window],
    [nav({ globalPrivacyControl: true }), undefined],
  ])("keeps the beacon off for %o", (n, w) => {
    const signals = privacySignals(n, w);
    expect(optedOutBySignal(signals)).toBe(true);
    loadCookieless({ cfBeaconToken: CF }, signals, document);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });

  it("does not treat DNT 0 or no signal as an opt-out", () => {
    expect(optedOutBySignal(privacySignals(nav({ doNotTrack: "0" }), { doNotTrack: "0" } as unknown as Window))).toBe(false);
    expect(optedOutBySignal(privacySignals(nav({})))).toBe(false);
  });
});

describe("PostHog consent gating", () => {
  const config = { posthogKey: PH, posthogHost: "https://eu.i.posthog.com" };

  it("never starts without a key", async () => {
    loadConsented({}, window, document);
    await new Promise((r) => setTimeout(r, 10));
    expect(posthogMock.init).not.toHaveBeenCalled();
  });

  it("starts after consent", async () => {
    loadConsented(config, window, document);
    await vi.waitFor(() => expect(posthogMock.init).toHaveBeenCalledOnce());
    expect(posthogMock.init.mock.calls[0][1]).toMatchObject({ autocapture: false, disable_session_recording: true });
  });

  it("does not initialise if consent is withdrawn while the import is in flight", async () => {
    loadConsented(config, window, document);
    unloadConsented(document, window);
    await new Promise((r) => setTimeout(r, 10));
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(window.posthog).toBeUndefined();
  });
});

describe("search term scrubbing", () => {
  it("strips q and keeps other params", () => {
    expect(stripSearchQuery("https://everloot.app/search?q=thunderfury&page=2")).toBe("https://everloot.app/search?page=2");
    expect(stripSearchQuery("https://everloot.app/items")).toBe("https://everloot.app/items");
    expect(stripSearchQuery(undefined)).toBeUndefined();
  });

  it("scrubs page URLs and same-origin referrers only", () => {
    const e = scrubEvent({ properties: { $current_url: "https://everloot.app/?q=onyxia", $referrer: "https://everloot.app/s?q=x", $initial_referrer: "https://google.com/?q=everloot" } }, "https://everloot.app");
    expect(e.properties).toEqual({ $current_url: "https://everloot.app/", $referrer: "https://everloot.app/s", $initial_referrer: "https://google.com/?q=everloot" });
    expect(scrubEvent(null)).toBeNull();
  });

  it("wires before_send into init", async () => {
    loadConsented({ posthogKey: PH, posthogHost: "https://us.i.posthog.com" }, window, document);
    await vi.waitFor(() => expect(posthogMock.init).toHaveBeenCalledOnce());
    const before = posthogMock.init.mock.calls[0][1].before_send;
    expect(before({ properties: { $current_url: `${window.location.origin}/x?q=1` } }).properties.$current_url).toBe(`${window.location.origin}/x`);
  });
});

describe("withdrawal cleanup", () => {
  it("expires analytics cookies, ph_ storage and the dataLayer but leaves other data", () => {
    document.cookie = "_ga=1; path=/";
    document.cookie = "_ga_ABC123=1; path=/";
    document.cookie = "ph_phc_key_posthog=1; path=/";
    document.cookie = "essential=1; path=/";
    localStorage.setItem("ph_phc_key_posthog", "{}");
    localStorage.setItem("gg-cookie-consent-v1", "accepted");
    (window as Window & { dataLayer?: unknown[] }).dataLayer = [1];
    posthogMock.opt_out_capturing.mockClear();
    window.posthog = { opt_out_capturing: posthogMock.opt_out_capturing };
    unloadConsented(document, window);
    expect(document.cookie).toBe("essential=1");
    expect(localStorage.getItem("ph_phc_key_posthog")).toBeNull();
    expect(localStorage.getItem("gg-cookie-consent-v1")).toBe("accepted");
    expect((window as Window & { dataLayer?: unknown }).dataLayer).toBeUndefined();
    expect(posthogMock.opt_out_capturing).toHaveBeenCalled();
  });
});
